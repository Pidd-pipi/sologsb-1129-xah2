import type { DefectSeverity, DefectType } from './defect';
import { todayStr } from '../utils/format';

/** 借展批次（LoanBatch）：一批字模一次性借出展览与逐枚归库清点的手续记录 */

/** 批次 / 条目的流转状态 */
export const LOAN_STATUSES = ['借出中', '已归还'] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

/** 归库清点结论 */
export const LOAN_CONDITIONS = ['完好', '损坏'] as const;
export type LoanCondition = (typeof LOAN_CONDITIONS)[number];

/** 批次内单枚字模的借出与归库信息 */
export interface LoanItem {
  matrixId: string;
  /** 冗余保存字符与编号，字模档案删除后履历仍可展示 */
  character: string;
  matrixCode: string;
  status: LoanStatus;
  /** 归库清点结论：未归还为空 */
  condition: LoanCondition | '';
  /** 实际归还日期 YYYY-MM-DD，未归还为空 */
  returnDate: string;
  /** 归库操作时间戳，未归还为空 */
  returnedAt: string;
  /** 归库清点备注（损坏情形 / 特殊情况说明） */
  note: string;
}

export interface LoanBatch {
  id: string;
  /** 批次编号，例：JZ-20260925-01 */
  code: string;
  /** 借用人 / 借用单位 */
  borrower: string;
  /** 借展用途 */
  purpose: string;
  /** 借出日期 YYYY-MM-DD */
  lendDate: string;
  /** 应还日期 YYYY-MM-DD */
  dueDate: string;
  /** 经手人 */
  operator: string;
  note: string;
  /** 批次状态：尚有未归还条目时为「借出中」 */
  status: LoanStatus;
  items: LoanItem[];
  /** 借出字模 id 集合（多值索引，便于按字模反查借展记录） */
  matrixId: string[];
  createdAt: string;
  updatedAt: string;
}

export interface LoanInput {
  borrower: string;
  purpose: string;
  lendDate: string;
  dueDate: string;
  operator: string;
  note?: string;
  matrixIds: string[];
}

/** 单枚归库清点结果 */
export interface LoanCheckinEntry {
  matrixId: string;
  condition: LoanCondition;
  returnDate: string;
  /** 损坏时登记缺损用 */
  defectType: DefectType;
  severity: DefectSeverity;
  /** 缺损情况说明（损坏时必填） */
  handling: string;
  note?: string;
}

/** 字模当前正在借展时的摘要信息（由借出中批次派生） */
export interface ActiveLoan {
  batchId: string;
  code: string;
  borrower: string;
  purpose: string;
  operator: string;
  lendDate: string;
  dueDate: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 两个 YYYY-MM-DD 日期相差天数（to - from） */
export function dayDiff(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  return Math.round((b - a) / 86400000);
}

/** 批次是否逾期：尚有字模未归还且已过应还日期（应还当天不计逾期） */
export function isLoanBatchOverdue(batch: Pick<LoanBatch, 'status' | 'dueDate'>, today = todayStr()): boolean {
  return batch.status === '借出中' && Boolean(batch.dueDate) && batch.dueDate < today;
}

/** 逾期天数；未逾期返回 0 */
export function loanOverdueDays(dueDate: string, today = todayStr()): number {
  if (!dueDate) return 0;
  return Math.max(0, dayDiff(dueDate, today));
}

/** 汇总全部借出中批次，得到 matrixId → 借展摘要 的映射（一枚字模同一时刻至多有一条未归还记录） */
export function buildActiveLoanMap(loans: LoanBatch[]): Map<string, ActiveLoan> {
  const map = new Map<string, ActiveLoan>();
  for (const batch of loans) {
    if (batch.status !== '借出中') continue;
    for (const item of batch.items) {
      if (item.status !== '借出中') continue;
      map.set(item.matrixId, {
        batchId: batch.id,
        code: batch.code,
        borrower: batch.borrower,
        purpose: batch.purpose,
        operator: batch.operator,
        lendDate: batch.lendDate,
        dueDate: batch.dueDate,
      });
    }
  }
  return map;
}

/** 某枚字模是否在库（没有未归还的借出记录即为在库） */
export function isMatrixOnLoan(loans: LoanBatch[], matrixId: string): boolean {
  return buildActiveLoanMap(loans).has(matrixId);
}

export interface LoanHistoryEntry {
  batch: LoanBatch;
  item: LoanItem;
}

/** 某枚字模的全部借展履历（含已归还），按借出日期倒序 */
export function loanHistoryOf(loans: LoanBatch[], matrixId: string): LoanHistoryEntry[] {
  const out: LoanHistoryEntry[] = [];
  for (const batch of loans) {
    const item = batch.items.find((it) => it.matrixId === matrixId);
    if (item) out.push({ batch, item });
  }
  return out.sort((a, b) => (a.batch.lendDate < b.batch.lendDate ? 1 : -1));
}

/** 借出登记表单校验：返回逐字段错误信息，空对象表示通过 */
export function validateLoanInput(input: Partial<LoanInput>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!(input.borrower || '').trim()) errors.borrower = '请填写借用人 / 借用单位';
  if (!(input.purpose || '').trim()) errors.purpose = '请填写借展用途';
  if (!(input.operator || '').trim()) errors.operator = '请填写经手人';
  const lendDate = (input.lendDate || '').trim();
  if (!lendDate) errors.lendDate = '请填写借出日期';
  else if (!DATE_RE.test(lendDate)) errors.lendDate = '日期格式需为 YYYY-MM-DD';
  const dueDate = (input.dueDate || '').trim();
  if (!dueDate) errors.dueDate = '请填写应还日期';
  else if (!DATE_RE.test(dueDate)) errors.dueDate = '日期格式需为 YYYY-MM-DD';
  if (!errors.lendDate && !errors.dueDate && dueDate < lendDate) {
    errors.dueDate = '应还日期不能早于借出日期';
  }
  if (!input.matrixIds || input.matrixIds.length === 0) errors.matrixIds = '请至少勾选一枚在库字模';
  return errors;
}

/** 单枚归库清点结果校验 */
export function validateLoanCheckinEntry(entry: Partial<LoanCheckinEntry>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!entry.condition) errors.condition = '请清点为完好或损坏';
  const returnDate = (entry.returnDate || '').trim();
  if (!returnDate) errors.returnDate = '请填写归还日期';
  else if (!DATE_RE.test(returnDate)) errors.returnDate = '日期格式需为 YYYY-MM-DD';
  if (entry.condition === '损坏') {
    if (!entry.defectType) errors.defectType = '请选择缺损类型';
    if (!entry.severity) errors.severity = '请选择缺损程度';
    if (!(entry.handling || '').trim()) errors.handling = '请说明归库发现的缺损情况';
  }
  return errors;
}
