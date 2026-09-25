/** 借展批次（LoanBatch）：字模外借展览的批次登记与归库清点 */
import type { DefectSeverity, DefectType } from './defect';
import { todayStr } from '../utils/format';

/** 归库清点结论 */
export const LOAN_CONDITIONS = ['完好', '损坏'] as const;
export type LoanCondition = (typeof LOAN_CONDITIONS)[number];

/** 借展批次中一枚字模的借出 / 归库明细 */
export interface LoanItem {
  matrixId: string;
  /** 冗余保存字符与编号，便于批次清单直接展示 */
  character: string;
  matrixCode: string;
  /** 借出日期 YYYY-MM-DD */
  loanDate: string;
  /** 应还日期 YYYY-MM-DD */
  dueDate: string;
  /** 实际归库日期，空串表示仍在外借 */
  returnedDate: string;
  /** 归库清点结论：完好 / 损坏；空串表示尚未归库 */
  condition: LoanCondition | '';
  /** 损坏归库时自动生成的缺损记录 id */
  defectId: string;
  /** 清点备注（缺损情形或其他说明） */
  note: string;
  /** 归库操作时间戳（ISO），空串表示尚未归库 */
  returnedAt: string;
}

export interface LoanBatch {
  id: string;
  /** 批次编号，例：JZ-20260925-01 */
  code: string;
  /** 借用人 / 借用单位 */
  borrower: string;
  /** 借展用途（展览名称等） */
  purpose: string;
  /** 借出日期 YYYY-MM-DD */
  loanDate: string;
  /** 应还日期 YYYY-MM-DD */
  dueDate: string;
  /** 经手人 */
  operator: string;
  note: string;
  items: LoanItem[];
  /** 批次涉及的全部字模 id（多值索引，便于按字模反查借展记录） */
  matrixId: string[];
  createdAt: string;
  updatedAt: string;
}

/** 批次借出登记表单 */
export interface LoanFormInput {
  borrower: string;
  purpose: string;
  loanDate: string;
  dueDate: string;
  operator: string;
  note: string;
  /** 本次批次勾选借出的字模 id */
  matrixIds: string[];
}

/** 单枚归库清点表单 */
export interface ReturnFormInput {
  returnedDate: string;
  condition: LoanCondition;
  /** 损坏时登记缺损用 */
  defectType: DefectType;
  severity: DefectSeverity;
  /** 缺损说明（损坏时必填，写入缺损记录处理方式） */
  handling: string;
  operator: string;
  note: string;
}

/** 该枚是否仍在外借 */
export function isItemOnLoan(item: LoanItem): boolean {
  return !item.returnedDate;
}

/** 该枚是否已逾期（外借中且今天已过应还日期） */
export function isItemOverdue(item: LoanItem, today: string = todayStr()): boolean {
  return isItemOnLoan(item) && !!item.dueDate && item.dueDate < today;
}

/** 逾期天数（未逾期返回 0） */
export function daysOverdue(dueDate: string, today: string = todayStr()): number {
  if (!dueDate) return 0;
  const a = new Date(`${dueDate}T00:00:00`).getTime();
  const b = new Date(`${today}T00:00:00`).getTime();
  const days = Math.round((b - a) / 86_400_000);
  return Number.isFinite(days) && days > 0 ? days : 0;
}

export interface ActiveLoan {
  batch: LoanBatch;
  item: LoanItem;
  overdue: boolean;
}

/** 找出一枚字模当前生效的外借记录（已全部归还则返回 null） */
export function findActiveLoan(
  loans: LoanBatch[],
  matrixId: string,
  today: string = todayStr(),
): ActiveLoan | null {
  for (const batch of loans) {
    const item = batch.items.find((it) => it.matrixId === matrixId);
    if (item && isItemOnLoan(item)) {
      return { batch, item, overdue: isItemOverdue(item, today) };
    }
  }
  return null;
}

/** 当前外借中的字模 id → 外借记录（供落位 / 再借拦截与筛选使用） */
export function activeLoanMap(
  loans: LoanBatch[],
  today: string = todayStr(),
): Map<string, ActiveLoan> {
  const map = new Map<string, ActiveLoan>();
  for (const batch of loans) {
    for (const item of batch.items) {
      if (isItemOnLoan(item)) {
        map.set(item.matrixId, { batch, item, overdue: isItemOverdue(item, today) });
      }
    }
  }
  return map;
}

export interface LoanStats {
  batches: number;
  /** 外借中（含逾期） */
  active: number;
  /** 逾期未还 */
  overdue: number;
  /** 已归库 */
  returned: number;
  /** 归库时发现损坏（转待补刻） */
  damaged: number;
}

export function summarizeLoans(loans: LoanBatch[], today: string = todayStr()): LoanStats {
  const stats: LoanStats = { batches: loans.length, active: 0, overdue: 0, returned: 0, damaged: 0 };
  for (const batch of loans) {
    for (const item of batch.items) {
      if (isItemOnLoan(item)) {
        stats.active += 1;
        if (isItemOverdue(item, today)) stats.overdue += 1;
      } else {
        stats.returned += 1;
        if (item.condition === '损坏') stats.damaged += 1;
      }
    }
  }
  return stats;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 批次借出登记表单校验 */
export function validateLoanForm(input: Partial<LoanFormInput>): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!(input.borrower || '').trim()) errors.borrower = '请填写借用人或借用单位';
  if (!(input.purpose || '').trim()) errors.purpose = '请填写借展用途';
  const loanDate = (input.loanDate || '').trim();
  if (!loanDate) errors.loanDate = '请选择借出日期';
  else if (!DATE_RE.test(loanDate)) errors.loanDate = '日期格式需为 YYYY-MM-DD';
  const dueDate = (input.dueDate || '').trim();
  if (!dueDate) errors.dueDate = '请选择应还日期';
  else if (!DATE_RE.test(dueDate)) errors.dueDate = '日期格式需为 YYYY-MM-DD';
  else if (loanDate && dueDate < loanDate) errors.dueDate = '应还日期不能早于借出日期';
  if (!(input.operator || '').trim()) errors.operator = '请填写经手人';
  if (!input.matrixIds || input.matrixIds.length === 0) errors.matrixIds = '请至少勾选一枚在库字模';
  return errors;
}

/** 单枚归库清点表单校验 */
export function validateReturnForm(input: Partial<ReturnFormInput>): Record<string, string> {
  const errors: Record<string, string> = {};
  const returnedDate = (input.returnedDate || '').trim();
  if (!returnedDate) errors.returnedDate = '请选择归库日期';
  else if (!DATE_RE.test(returnedDate)) errors.returnedDate = '日期格式需为 YYYY-MM-DD';
  if (!input.condition) errors.condition = '请给出清点结论（完好 / 损坏）';
  if (!(input.operator || '').trim()) errors.operator = '请填写清点人';
  if (input.condition === '损坏') {
    if (!input.defectType) errors.defectType = '请选择缺损类型';
    if (!input.severity) errors.severity = '请选择缺损程度';
    if (!(input.handling || '').trim()) errors.handling = '请描述归库清点发现的缺损情况';
  }
  return errors;
}
