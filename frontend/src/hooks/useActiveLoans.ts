import { useMemo } from 'react';
import { useLoanStore } from '../stores/loanStore';
import { buildActiveLoanMap, isLoanBatchOverdue, type ActiveLoan } from '../types/loan';

export interface ActiveLoanInfo extends ActiveLoan {
  overdue: boolean;
}

export interface ActiveLoansResult {
  /** matrixId → 借展摘要（仅未归还条目） */
  map: Map<string, ActiveLoanInfo>;
  /** 某枚字模当前是否在借展中 */
  isOnLoan: (matrixId: string) => boolean;
  /** 取某枚字模的借展摘要 */
  loanOf: (matrixId: string) => ActiveLoanInfo | undefined;
  /** 当前借出中的字模数量 */
  onLoanCount: number;
  /** 借出中且已逾期的字模数量 */
  overdueCount: number;
}

/**
 * 由借展批次派生「当前借出中」状态：字模在库与否、逾期与否的唯一判定入口。
 * 被总览页、字模详情页、字盘页与借展页复用。
 */
export function useActiveLoans(): ActiveLoansResult {
  const loans = useLoanStore((s) => s.loans);

  const map = useMemo(() => {
    const base = buildActiveLoanMap(loans);
    const out = new Map<string, ActiveLoanInfo>();
    base.forEach((info, matrixId) => {
      const batch = loans.find((b) => b.id === info.batchId);
      out.set(matrixId, { ...info, overdue: batch ? isLoanBatchOverdue(batch) : false });
    });
    return out;
  }, [loans]);

  const overdueCount = useMemo(() => {
    let n = 0;
    map.forEach((v) => {
      if (v.overdue) n += 1;
    });
    return n;
  }, [map]);

  return {
    map,
    isOnLoan: (matrixId) => map.has(matrixId),
    loanOf: (matrixId) => map.get(matrixId),
    onLoanCount: map.size,
    overdueCount,
  };
}
