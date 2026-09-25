import type { ActiveLoan } from '../../types/loan';
import { daysOverdue } from '../../types/loan';
import { todayStr } from '../../utils/format';

export interface LoanBadgeProps {
  loan: ActiveLoan;
  compact?: boolean;
  testId?: string;
}

/** 借展状态角标：借出中（黄铜色）/ 逾期未还（红色），被总览卡片与字模详情复用 */
export default function LoanBadge({ loan, compact = false, testId = 'loan-badge' }: LoanBadgeProps) {
  const overdue = loan.overdue;
  const days = overdue ? daysOverdue(loan.item.dueDate, todayStr()) : 0;
  const style = overdue
    ? 'border-seal/50 bg-seal-pale text-seal'
    : 'border-brass/50 bg-brass-pale text-brass';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${
        compact ? 'text-[10px]' : 'text-[11px]'
      } ${style}`}
      data-testid={testId}
      data-loan-status={overdue ? 'overdue' : 'on-loan'}
      title={`批次 ${loan.batch.code} · 应还 ${loan.item.dueDate}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      <span>{overdue ? `逾期未还${days > 0 ? ` ${days} 天` : ''}` : `借出中 · 应还 ${loan.item.dueDate}`}</span>
    </span>
  );
}
