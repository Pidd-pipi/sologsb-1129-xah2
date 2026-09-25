import { create } from 'zustand';
import { db, ensureSeed } from '../db';
import { useCaseStore } from './caseStore';
import { useMatrixStore } from './matrixStore';
import type { DefectLog } from '../types/defect';
import type {
  LoanBatch,
  LoanCheckinEntry,
  LoanInput,
  LoanItem,
} from '../types/loan';
import type { TypeMatrix } from '../types/matrix';
import { makeId, toPlain, todayStr } from '../utils/format';

interface LoanState {
  loans: LoanBatch[];
  loaded: boolean;
  loading: boolean;
  error: string;
  load: () => Promise<void>;
  /** 批次借出：校验在库、登记批次，并把借出字模从全部字盘格位取出 */
  createLoan: (input: LoanInput, code: string) => Promise<LoanBatch>;
  /** 归库清点：逐枚完好恢复可用 / 损坏转待补刻并登记缺损 */
  checkinLoan: (batchId: string, entries: LoanCheckinEntry[], operator: string) => Promise<void>;
}

const byLendDesc = (a: LoanBatch, b: LoanBatch) => (a.lendDate < b.lendDate ? 1 : -1);

/** 借出中条目覆盖的字模 id 集合（以 loans 表未归还条目为唯一事实源） */
export function activeLoanMatrixIds(loans: LoanBatch[]): Set<string> {
  const ids = new Set<string>();
  for (const batch of loans) {
    if (batch.status !== '借出中') continue;
    for (const item of batch.items) {
      if (item.status === '借出中') ids.add(item.matrixId);
    }
  }
  return ids;
}

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
      set({ loans: loans.sort(byLendDesc), loaded: true, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : '借展档案读取失败' });
    }
  },

  createLoan: async (input, code) => {
    const matrixIds = Array.from(new Set(input.matrixIds));
    const now = new Date().toISOString();

    // 事务内以库内最新借展记录二次校验，防止并发重复借出
    const batch = await db.transaction('rw', db.loans, db.matrices, db.cases, async () => {
      const matrices = await db.matrices.bulkGet(matrixIds);
      const found = matrices.filter((m): m is TypeMatrix => Boolean(m));
      if (found.length !== matrixIds.length) throw new Error('勾选的字模中有不存在的档案，请刷新后重试');
      const notAvailable = found.filter((m) => m.availability !== '可用');
      if (notAvailable.length > 0) {
        throw new Error(`以下字模非可用状态，不能借出：${notAvailable.map((m) => m.code).join('、')}`);
      }

      const allLoans = await db.loans.toArray();
      const lentIds = activeLoanMatrixIds(allLoans);
      const conflict = matrixIds.filter((id) => lentIds.has(id));
      if (conflict.length > 0) {
        const codes = found.filter((m) => conflict.includes(m.id)).map((m) => m.code);
        throw new Error(`以下字模已在借展中，不能重复借出：${codes.join('、')}`);
      }

      const items: LoanItem[] = found.map((m) => ({
        matrixId: m.id,
        character: m.character,
        matrixCode: m.code,
        status: '借出中',
        condition: '',
        returnDate: '',
        returnedAt: '',
        note: '',
      }));
      const row: LoanBatch = toPlain({
        id: makeId('loan'),
        code: code.trim(),
        borrower: input.borrower.trim(),
        purpose: input.purpose.trim(),
        lendDate: input.lendDate || todayStr(),
        dueDate: input.dueDate,
        operator: input.operator.trim(),
        note: (input.note ?? '').trim(),
        status: '借出中' as const,
        items,
        matrixId: matrixIds,
        createdAt: now,
        updatedAt: now,
      });
      await db.loans.add(row);

      // 借出后字模实物离馆，自动从全部字盘格位取出，避免仍被排进字盘
      const cases = await db.cases.toArray();
      const affected = cases.filter((c) => c.slots.some((s) => matrixIds.includes(s.matrixId)));
      for (const c of affected) {
        const slots = c.slots.filter((s) => !matrixIds.includes(s.matrixId));
        await db.cases.update(c.id, {
          slots,
          matrixId: Array.from(new Set(slots.map((s) => s.matrixId).filter(Boolean))),
          updatedAt: now,
        });
      }
      return { row, affectedIds: affected.map((c) => c.id) };
    });

    set((s) => ({ loans: [batch.row, ...s.loans].sort(byLendDesc) }));
    // 同步字盘店内状态（取出借出字模后的格位）
    const caseState = useCaseStore.getState();
    if (batch.affectedIds.length > 0) {
      const refreshed = (await db.cases.bulkGet(batch.affectedIds)).filter(
        (c): c is NonNullable<typeof c> => Boolean(c),
      );
      const map = new Map(refreshed.map((c) => [c.id, c]));
      useCaseStore.setState({
        cases: caseState.cases.map((c) => map.get(c.id) ?? c),
      });
    }
    return batch.row;
  },

  checkinLoan: async (batchId, entries, operator) => {
    const current = get().loans.find((b) => b.id === batchId);
    if (!current) throw new Error('未找到借展批次');
    const now = new Date().toISOString();

    const result = await db.transaction('rw', db.loans, db.matrices, db.defects, async () => {
      const fresh = await db.loans.get(batchId);
      if (!fresh) throw new Error('未找到借展批次');
      const entryMap = new Map(entries.map((e) => [e.matrixId, e]));
      const damaged: LoanCheckinEntry[] = [];
      const intactIds: string[] = [];

      const items: LoanItem[] = fresh.items.map((item) => {
        const entry = entryMap.get(item.matrixId);
        if (!entry || item.status === '已归还') return item;
        if (entry.condition === '损坏') damaged.push(entry);
        else intactIds.push(item.matrixId);
        return {
          ...item,
          status: '已归还' as const,
          condition: entry.condition,
          returnDate: entry.returnDate || todayStr(),
          returnedAt: now,
          note:
            entry.condition === '损坏'
              ? [entry.handling.trim(), (entry.note ?? '').trim()].filter(Boolean).join('；')
              : (entry.note ?? '').trim(),
        };
      });

      const pendingIds = entries.map((e) => e.matrixId);
      const pendingSet = new Set(pendingIds);
      const stillOut = fresh.items.some((it) => !pendingSet.has(it.matrixId) && it.status === '借出中');
      const status = stillOut ? ('借出中' as const) : ('已归还' as const);
      await db.loans.update(batchId, { items, status, updatedAt: now });

      // 完好：恢复可用
      if (intactIds.length > 0) {
        const intactMatrices = await db.matrices.bulkGet(intactIds);
        for (const m of intactMatrices) {
          if (m) await db.matrices.update(m.id, { availability: '可用', updatedAt: now });
        }
      }

      // 损坏：转待补刻并留下缺损记录
      const newDefects: DefectLog[] = [];
      for (const entry of damaged) {
        const m = await db.matrices.get(entry.matrixId);
        if (!m) continue;
        await db.matrices.update(m.id, { availability: '待补刻', updatedAt: now });
        const row: DefectLog = toPlain({
          id: makeId('dft'),
          matrixId: m.id,
          character: m.character,
          matrixCode: m.code,
          defectType: entry.defectType,
          severity: entry.severity,
          foundDate: entry.returnDate || todayStr(),
          handling: `借展「${fresh.code}」归库清点发现：${entry.handling.trim()}，转待补刻`,
          availability: '待补刻' as const,
          operator: operator.trim() || fresh.operator,
          note: [`借用人：${fresh.borrower}`, (entry.note ?? '').trim()].filter(Boolean).join('；'),
          createdAt: now,
        });
        await db.defects.add(row);
        newDefects.push(row);
      }

      return { items, status, intactIds, newDefects };
    });

    set((s) => ({
      loans: s.loans
        .map((b) => (b.id === batchId ? { ...b, items: result.items, status: result.status, updatedAt: now } : b))
        .sort(byLendDesc),
    }));

    // 同步字模 / 缺损店内状态
    const matrixState = useMatrixStore.getState();
    if (result.intactIds.length > 0 || result.newDefects.length > 0) {
      const changedIds = new Set([...result.intactIds, ...result.newDefects.map((d) => d.matrixId)]);
      const refreshed = (await db.matrices.bulkGet(Array.from(changedIds))).filter(
        (m): m is NonNullable<typeof m> => Boolean(m),
      );
      const map = new Map(refreshed.map((m) => [m.id, m]));
      useMatrixStore.setState({
        matrices: matrixState.matrices
          .map((m) => (map.has(m.id) ? { ...m, ...map.get(m.id)! } : m))
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
        defects: [...result.newDefects, ...matrixState.defects],
      });
    }
  },
}));
