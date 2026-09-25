export interface LoanBadgeProps {
  overdue?: boolean;
  /** 逾期天数（逾期时展示） */
  overdueDays?: number;
  compact?: boolean;
  testId?: string;
}

/** 借展状态标签：借出中 / 逾期未还，被总览卡片、字模详情与借展页复用 */
export default function LoanBadge({
  overdue = false,
  overdueDays = 0,
  compact = false,
  testId = 'loan-badge',
}: LoanBadgeProps) {
  const style = overdue
    ? 'border-seal/50 bg-seal text-paper'
    : 'border-brass/50 bg-brass-pale text-brass';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${
        compact ? 'text-[10px]' : 'text-[11px]'
      } ${style}`}
      data-testid={testId}
      data-overdue={overdue ? 'true' : 'false'}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {overdue ? `逾期未还${overdueDays > 0 ? ` ${overdueDays} 天` : ''}` : '借展中'}
    </span>
  );
}
