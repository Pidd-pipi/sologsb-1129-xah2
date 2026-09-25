import { create } from 'zustand';
import { db, ensureSeed } from '../db';
import type { LoanBatch, LoanFormInput, LoanItem, ReturnFormInput } from '../types/loan';
import { activeLoanMap, isItemOnLoan } from '../types/loan';
import { makeId, suggestLoanCode, todayStr, toPlain } from '../utils/format';
import { useMatrixStore } from './matrixStore';

interface LoanState {
  loans: LoanBatch[];
  loaded: boolean;
  loading: boolean;
  error: string;
  load: () => Promise<void>;
  /** 批次借出：一次登记多枚在库字模，借出期间不可再借、不可落位 */
  createLoan: (input: LoanFormInput) => Promise<LoanBatch>;
  /** 单枚归库清点：完好恢复可用，损坏转待补刻并留下缺损记录 */
  returnItem: (batchId: string, matrixId: string, input: ReturnFormInput) => Promise<void>;
}

const byCreatedDesc = (a: LoanBatch, b: LoanBatch) => (a.createdAt < b.createdAt ? 1 : -1);

export const useLoanStore = create<LoanState>((set, get) => ({
  loans: [],
  loaded: false,
  loading: false,
  error: '',

  load: async () => {
    set({ loading: true, error: '' });
    try {
      await ensureSeed();
      const loans = await db.loans.toArray();
      set({ loans: loans.sort(byCreatedDesc), loaded: true, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : '借展档案读取失败' });
    }
  },

  createLoan: async (input) => {
    const matrixStore = useMatrixStore.getState();
    const ids = Array.from(new Set(input.matrixIds));
    if (ids.length === 0) throw new Error('请至少勾选一枚在库字模');
    const active = activeLoanMap(get().loans);
    const loanDate = input.loanDate || todayStr();
    const dueDate = input.dueDate || todayStr();
    const items: LoanItem[] = [];
    for (const id of ids) {
      const matrix = matrixStore.matrices.find((m) => m.id === id);
      if (!matrix) throw new Error(`字模 ${id} 不存在，无法办理借出`);
      if (matrix.availability !== '可用') {
        throw new Error(`「${matrix.character}」（${matrix.code}）当前为${matrix.availability}，不能借出`);
      }
      const held = active.get(id);
      if (held) {
        throw new Error(`「${matrix.character}」（${matrix.code}）已在 ${held.batch.code} 批次借出，不能重复借展`);
      }
      items.push({
        matrixId: matrix.id,
        character: matrix.character,
        matrixCode: matrix.code,
        loanDate,
        dueDate,
        returnedDate: '',
        condition: '',
        defectId: '',
        note: '',
        returnedAt: '',
      });
    }
    const now = new Date().toISOString();
    const row: LoanBatch = toPlain({
      id: makeId('loan'),
      code: suggestLoanCode(loanDate, get().loans.map((l) => l.code)),
      borrower: input.borrower.trim(),
      purpose: input.purpose.trim(),
      loanDate,
      dueDate,
      operator: input.operator.trim(),
      note: (input.note ?? '').trim(),
      items,
      matrixId: items.map((it) => it.matrixId),
      createdAt: now,
      updatedAt: now,
    });
    await db.loans.add(row);
    set((s) => ({ loans: [row, ...s.loans] }));
    return row;
  },

  returnItem: async (batchId, matrixId, input) => {
    const batch = get().loans.find((l) => l.id === batchId);
    if (!batch) throw new Error('未找到借展批次');
    const item = batch.items.find((it) => it.matrixId === matrixId);
    if (!item) throw new Error('该批次中没有这枚字模');
    if (!isItemOnLoan(item)) throw new Error(`「${item.character}」已归库，请勿重复清点`);

    const matrixStore = useMatrixStore.getState();
    const matrix = matrixStore.matrices.find((m) => m.id === matrixId);
    const returnedDate = input.returnedDate || todayStr();
    const operator = input.operator.trim();
    const now = new Date().toISOString();

    let defectId = '';
    if (input.condition === '损坏') {
      // 损坏归库：自动登记缺损并转待补刻，缺损记录可在详情与缺损页回溯
      const defect = await matrixStore.addDefect({
        matrixId,
        defectType: input.defectType,
        severity: input.severity,
        foundDate: returnedDate,
        handling: `借展归库清点发现：${input.handling.trim()}（批次 ${batch.code} · ${batch.borrower}）`,
        availability: '待补刻',
        operator,
        note: input.note.trim() || `借展批次 ${batch.code} 归库清点`,
      });
      defectId = defect.id;
    } else if (matrix && matrix.availability === '停用') {
      // 完好归库：恢复可用（仅纠正「停用」，不影响「待补刻」等既有结论）
      await matrixStore.updateMatrix(matrixId, { availability: '可用' });
    }

    const nextItem: LoanItem = {
      ...item,
      returnedDate,
      condition: input.condition,
      defectId,
      note: input.note.trim(),
      returnedAt: now,
    };
    const nextBatch: LoanBatch = toPlain({
      ...batch,
      items: batch.items.map((it) => (it.matrixId === matrixId ? nextItem : it)),
      updatedAt: now,
    });
    await db.loans.put(nextBatch);
    set((s) => ({ loans: s.loans.map((l) => (l.id === batchId ? nextBatch : l)) }));
  },
}));

/** 某枚字模当前的外借记录（组件内配合 useMemo 使用） */
export function selectActiveLoan(loans: LoanBatch[], matrixId: string) {
  for (const batch of loans) {
    const item = batch.items.find((it) => it.matrixId === matrixId);
    if (item && isItemOnLoan(item)) return { batch, item };
  }
  return null;
}
