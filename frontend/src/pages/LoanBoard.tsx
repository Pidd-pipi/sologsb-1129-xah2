import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../components/common/EmptyState';
import LoanBadge from '../components/common/LoanBadge';
import { useActiveLoans } from '../hooks/useActiveLoans';
import { DRAFT_KEYS, useLocalDraft } from '../hooks/useLocalDraft';
import { useLoanStore } from '../stores/loanStore';
import { useMatrixStore } from '../stores/matrixStore';
import { useUiStore } from '../stores/uiStore';
import { DEFECT_SEVERITIES, DEFECT_TYPES, type DefectSeverity, type DefectType } from '../types/defect';
import {
  isLoanBatchOverdue,
  loanOverdueDays,
  validateLoanCheckinEntry,
  validateLoanInput,
  type LoanBatch,
  type LoanCheckinEntry,
  type LoanCondition,
} from '../types/loan';
import { addDays, dash, formatDate, formatStamp, suggestLoanCode, todayStr } from '../utils/format';

interface LoanFormState {
  borrower: string;
  purpose: string;
  lendDate: string;
  dueDate: string;
  operator: string;
  note: string;
  keyword: string;
  selected: string[];
}

/** `/loans` 批次借展：一次勾选多枚在库字模借出，并按枚归库清点 */
export default function LoanBoard() {
  const loans = useLoanStore((s) => s.loans);
  const loaded = useLoanStore((s) => s.loaded);
  const createLoan = useLoanStore((s) => s.createLoan);
  const checkinLoan = useLoanStore((s) => s.checkinLoan);
  const matrices = useMatrixStore((s) => s.matrices);
  const pushToast = useUiStore((s) => s.pushToast);
  const { isOnLoan, onLoanCount, overdueCount } = useActiveLoans();

  const today = todayStr();
  const initialForm = useMemo<LoanFormState>(
    () => ({
      borrower: '',
      purpose: '',
      lendDate: today,
      dueDate: addDays(today, 30),
      operator: '',
      note: '',
      keyword: '',
      selected: [],
    }),
    // 仅作为草稿初始值，挂载时计算一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const { draft, patch, reset } = useLocalDraft<LoanFormState>(DRAFT_KEYS.loanBoard, initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [selectedBatchId, setSelectedBatchId] = useState('');

  const selectedBatch =
    loans.find((b) => b.id === selectedBatchId) ?? loans.find((b) => b.status === '借出中') ?? loans[0];

  /** 在库 = 可用性「可用」且当前无未归还借出记录；停用 / 待补刻 / 借出中均不可再借 */
  const lendableMatrices = useMemo(
    () =>
      matrices
        .filter((m) => m.availability === '可用' && !isOnLoan(m.id))
        .filter((m) => {
          const k = draft.keyword.trim().toLowerCase();
          if (!k) return true;
          return (
            m.character === draft.keyword.trim() ||
            m.code.toLowerCase().includes(k) ||
            m.engraver.toLowerCase().includes(k)
          );
        })
        .sort((a, b) => a.code.localeCompare(b.code)),
    [matrices, isOnLoan, draft.keyword],
  );

  const activeBatches = useMemo(() => loans.filter((b) => b.status === '借出中'), [loans]);
  const returnedBatches = useMemo(() => loans.filter((b) => b.status === '已归还'), [loans]);
  const returnedTotal = useMemo(
    () => loans.reduce((n, b) => n + b.items.filter((it) => it.status === '已归还').length, 0),
    [loans],
  );

  const toggleSelected = (id: string) => {
    patch({
      selected: draft.selected.includes(id)
        ? draft.selected.filter((x) => x !== id)
        : [...draft.selected, id],
    });
  };

  const suggestedCode = useMemo(
    () => suggestLoanCode(draft.lendDate || today, loans.length + 1),
    [draft.lendDate, loans.length, today],
  );

  const handleLend = async (e: FormEvent) => {
    e.preventDefault();
    const input = {
      borrower: draft.borrower,
      purpose: draft.purpose,
      lendDate: draft.lendDate,
      dueDate: draft.dueDate,
      operator: draft.operator,
      note: draft.note,
      matrixIds: draft.selected,
    };
    const next = validateLoanInput(input);
    setErrors(next);
    if (Object.keys(next).length > 0) {
      pushToast('借出登记未通过校验，请按提示修正', 'warn');
      return;
    }
    setSubmitting(true);
    try {
      const row = await createLoan(input, suggestedCode);
      pushToast(`批次 ${row.code} 已借出 ${row.items.length} 枚字模`);
      reset();
      setErrors({});
      setSelectedBatchId(row.id);
    } catch (err) {
      pushToast(err instanceof Error ? err.message : '借出登记失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="mt-title" data-testid="loan-board-title">
            批次借展与归库
          </h2>
          <p className="mt-sub">
            一次勾选多枚在库字模登记借出；借出期间字模不能再次借出或排进字盘，归还时按枚清点，完好的恢复可用、损坏的转待补刻。
          </p>
        </div>
        <div className="flex flex-wrap gap-2" data-testid="loan-stats">
          <span className="mt-chip border-brass/40 text-brass" data-testid="loan-stat-active">
            借出中 {onLoanCount} 枚
          </span>
          <span className="mt-chip border-seal/40 text-seal" data-testid="loan-stat-overdue">
            逾期 {overdueCount} 枚
          </span>
          <span className="mt-chip" data-testid="loan-stat-returned">
            已归库 {returnedTotal} 枚次
          </span>
        </div>
      </section>

      <form className="mt-panel space-y-3 px-4 py-4" onSubmit={handleLend} data-testid="loan-create-form">
        <div className="mt-panel-head -mx-4 -mt-4">
          <h3 className="font-song text-sm font-semibold text-ink">登记一批借出</h3>
          <span className="mt-sub">批次编号（自动）：{suggestedCode}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <div className="md:col-span-2">
            <label className="mt-label" htmlFor="loan-borrower">
              借用人 / 借用单位
            </label>
            <input
              id="loan-borrower"
              data-testid="loan-borrower"
              className="mt-input"
              placeholder="例：市博物馆「古代印刷文明」特展"
              value={draft.borrower}
              onChange={(e) => patch({ borrower: e.target.value })}
            />
            {errors.borrower ? <p className="mt-error">{errors.borrower}</p> : null}
          </div>
          <div className="md:col-span-2">
            <label className="mt-label" htmlFor="loan-purpose">
              用途
            </label>
            <input
              id="loan-purpose"
              data-testid="loan-purpose"
              className="mt-input"
              placeholder="例：年度特展展陈"
              value={draft.purpose}
              onChange={(e) => patch({ purpose: e.target.value })}
            />
            {errors.purpose ? <p className="mt-error">{errors.purpose}</p> : null}
          </div>
          <div>
            <label className="mt-label" htmlFor="loan-lend-date">
              借出日期
            </label>
            <input
              id="loan-lend-date"
              data-testid="loan-lend-date"
              type="date"
              className="mt-input"
              value={draft.lendDate}
              onChange={(e) => patch({ lendDate: e.target.value })}
            />
            {errors.lendDate ? <p className="mt-error">{errors.lendDate}</p> : null}
          </div>
          <div>
            <label className="mt-label" htmlFor="loan-due-date">
              应还日期
            </label>
            <input
              id="loan-due-date"
              data-testid="loan-due-date"
              type="date"
              className="mt-input"
              value={draft.dueDate}
              onChange={(e) => patch({ dueDate: e.target.value })}
            />
            {errors.dueDate ? <p className="mt-error">{errors.dueDate}</p> : null}
          </div>
          <div>
            <label className="mt-label" htmlFor="loan-operator">
              经手人
            </label>
            <input
              id="loan-operator"
              data-testid="loan-operator"
              className="mt-input"
              placeholder="例：吴少泉"
              value={draft.operator}
              onChange={(e) => patch({ operator: e.target.value })}
            />
            {errors.operator ? <p className="mt-error">{errors.operator}</p> : null}
          </div>
          <div className="md:col-span-2">
            <label className="mt-label" htmlFor="loan-note">
              备注
            </label>
            <input
              id="loan-note"
              data-testid="loan-note"
              className="mt-input"
              placeholder="例：随附字模托架四只"
              value={draft.note}
              onChange={(e) => patch({ note: e.target.value })}
            />
          </div>
        </div>

        <div className="rounded border border-paper-line bg-paper/40 px-3 py-3" data-testid="loan-picker">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-song text-sm font-semibold text-ink">勾选借出字模</h4>
            <div className="flex items-center gap-2">
              <input
                className="mt-input max-w-[220px]"
                placeholder="筛选字符 / 编号 / 刻工"
                data-testid="loan-picker-keyword"
                value={draft.keyword}
                onChange={(e) => patch({ keyword: e.target.value })}
              />
              <span className="text-[11px] text-ink-mute">
                在库可借 {lendableMatrices.length} 枚 · 已选 {draft.selected.length} 枚
              </span>
            </div>
          </div>
          {errors.matrixIds ? <p className="mt-error" data-testid="error-matrixIds">{errors.matrixIds}</p> : null}
          <p className="mt-hint">仅列出在库且「可用」的字模；停用、待补刻或已借出的字模不能勾选。</p>
          {lendableMatrices.length === 0 ? (
            <p className="mt-2 text-xs text-ink-mute" data-testid="loan-picker-empty">
              当前没有可借出的在库字模。
            </p>
          ) : (
            <div className="mt-2 grid max-h-[280px] grid-cols-1 gap-1 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
              {lendableMatrices.map((m) => {
                const checked = draft.selected.includes(m.id);
                return (
                  <label
                    key={m.id}
                    className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 text-xs transition ${
                      checked ? 'border-seal bg-seal-pale/70' : 'border-paper-line bg-white hover:border-brass'
                    }`}
                    data-testid={`loan-pick-${m.id}`}
                  >
                    <input
                      type="checkbox"
                      className="accent-seal"
                      checked={checked}
                      onChange={() => toggleSelected(m.id)}
                      data-testid={`loan-pick-check-${m.id}`}
                    />
                    <span className="font-song text-base text-ink">{m.character}</span>
                    <span className="truncate text-ink-mute">
                      {m.code} · {m.font}/{m.sizeName} · {m.material}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="mt-btn mt-btn-primary" data-testid="loan-submit" disabled={submitting}>
            {submitting ? '登记中…' : `登记借出（${draft.selected.length} 枚）`}
          </button>
          <button
            type="button"
            className="mt-btn"
            data-testid="loan-reset"
            onClick={() => {
              reset();
              setErrors({});
            }}
          >
            清空表单
          </button>
          <span className="mt-hint">借出后所选字模自动从字盘格位取出，归还清点前不可再次借出或排字。</span>
        </div>
      </form>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_1fr]">
        <aside className="space-y-3">
          <div className="mt-panel">
            <div className="mt-panel-head">
              <h3 className="font-song text-sm font-semibold text-ink">借出中批次</h3>
              <span className="mt-sub">{activeBatches.length} 批</span>
            </div>
            <ul className="divide-y divide-paper-line" data-testid="loan-active-list">
              {activeBatches.length === 0 ? (
                <li className="px-4 py-3 text-xs text-ink-mute">
                  {loaded ? '当前没有借出中的批次。' : '正在读取借展档案…'}
                </li>
              ) : (
                activeBatches.map((b) => (
                  <BatchListItem
                    key={b.id}
                    batch={b}
                    active
                    selected={selectedBatch?.id === b.id}
                    onSelect={() => setSelectedBatchId(b.id)}
                  />
                ))
              )}
            </ul>
          </div>
          <div className="mt-panel">
            <div className="mt-panel-head">
              <h3 className="font-song text-sm font-semibold text-ink">已归库批次</h3>
              <span className="mt-sub">{returnedBatches.length} 批</span>
            </div>
            <ul className="divide-y divide-paper-line" data-testid="loan-returned-list">
              {returnedBatches.length === 0 ? (
                <li className="px-4 py-3 text-xs text-ink-mute">暂无已归库批次。</li>
              ) : (
                returnedBatches.map((b) => (
                  <BatchListItem
                    key={b.id}
                    batch={b}
                    active={false}
                    selected={selectedBatch?.id === b.id}
                    onSelect={() => setSelectedBatchId(b.id)}
                  />
                ))
              )}
            </ul>
          </div>
        </aside>

        {selectedBatch ? (
          <BatchDetail key={selectedBatch.id} batch={selectedBatch} onCheckin={checkinLoan} />
        ) : (
          <EmptyState
            title="尚未选择借展批次"
            description="在左侧清单中选择一个批次查看借出明细，或先登记一批借出。"
            testId="loan-batch-empty"
          />
        )}
      </div>
    </div>
  );
}

function BatchListItem({
  batch,
  active,
  selected,
  onSelect,
}: {
  batch: LoanBatch;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const overdue = isLoanBatchOverdue(batch);
  const outCount = batch.items.filter((it) => it.status === '借出中').length;
  return (
    <li>
      <button
        type="button"
        data-testid={`loan-batch-item-${batch.id}`}
        onClick={onSelect}
        className={`flex w-full flex-col items-start gap-1 px-4 py-2 text-left transition hover:bg-paper-deep/60 ${
          selected ? 'bg-seal-pale/70' : ''
        }`}
      >
        <span className="flex w-full flex-wrap items-center gap-2">
          <span className="font-song text-sm text-ink">{batch.code}</span>
          {active ? (
            <LoanBadge overdue={overdue} overdueDays={loanOverdueDays(batch.dueDate)} compact testId={`loan-batch-badge-${batch.id}`} />
          ) : (
            <span className="mt-chip border-jade/40 text-jade">已归库</span>
          )}
        </span>
        <span className="line-clamp-1 text-[11px] text-ink-soft">{dash(batch.borrower)}</span>
        <span className="text-[11px] text-ink-mute">
          {formatDate(batch.lendDate)} 借出 · 应还 {formatDate(batch.dueDate)} ·{' '}
          {active ? `在外 ${outCount}/${batch.items.length} 枚` : `${batch.items.length} 枚已清点`}
        </span>
      </button>
    </li>
  );
}

interface CheckinRowState {
  condition: LoanCondition;
  defectType: DefectType;
  severity: DefectSeverity;
  handling: string;
  note: string;
}

function BatchDetail({
  batch,
  onCheckin,
}: {
  batch: LoanBatch;
  onCheckin: (batchId: string, entries: LoanCheckinEntry[], operator: string) => Promise<void>;
}) {
  const pushToast = useUiStore((s) => s.pushToast);
  const [returnDate, setReturnDate] = useState(todayStr());
  const [operator, setOperator] = useState('');
  const [rows, setRows] = useState<Record<string, CheckinRowState>>({});
  const [errors, setErrors] = useState<Record<string, Record<string, string>>>({});
  const [dateError, setDateError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const overdue = isLoanBatchOverdue(batch);
  const overdueDays = loanOverdueDays(batch.dueDate);
  const outItems = batch.items.filter((it) => it.status === '借出中');
  const doneItems = batch.items.filter((it) => it.status === '已归还');

  useEffect(() => {
    setRows({});
    setErrors({});
    setDateError('');
    setReturnDate(todayStr());
  }, [batch.id]);

  const patchRow = (matrixId: string, patch: Partial<CheckinRowState>) => {
    setRows((cur) => ({ ...cur, [matrixId]: { ...defaultRow(), ...cur[matrixId], ...patch } }));
  };

  const rowState = (matrixId: string): CheckinRowState => rows[matrixId] ?? defaultRow();

  const handleCheckin = async (onlyMatrixId?: string) => {
    const targets = outItems.filter((it) => !onlyMatrixId || it.matrixId === onlyMatrixId);
    if (targets.length === 0) return;
    const entries: LoanCheckinEntry[] = targets.map((it) => {
      const r = rowState(it.matrixId);
      return {
        matrixId: it.matrixId,
        condition: r.condition,
        returnDate,
        defectType: r.defectType,
        severity: r.severity,
        handling: r.handling,
        note: r.note,
      };
    });

    const nextErrors: Record<string, Record<string, string>> = {};
    let globalDateError = '';
    entries.forEach((entry) => {
      const errs = validateLoanCheckinEntry(entry);
      if (errs.returnDate && !globalDateError) globalDateError = errs.returnDate;
      delete errs.returnDate;
      if (Object.keys(errs).length > 0) nextErrors[entry.matrixId] = errs;
    });
    setErrors(nextErrors);
    setDateError(globalDateError);
    if (globalDateError || Object.keys(nextErrors).length > 0) {
      pushToast('归库清点未通过校验，请补全归还日期与损坏字模的缺损信息', 'warn');
      return;
    }
    setSubmitting(true);
    try {
      await onCheckin(batch.id, entries, operator);
      pushToast(
        onlyMatrixId
          ? `已归库 1 枚：${targets[0].character}（${entries[0].condition === '完好' ? '恢复可用' : '转待补刻'}）`
          : `已归库清点 ${entries.length} 枚`,
      );
    } catch (err) {
      pushToast(err instanceof Error ? err.message : '归库清点失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="mt-panel" data-testid={`loan-detail-${batch.id}`}>
      <div className="mt-panel-head">
        <div>
          <h3 className="font-song text-sm font-semibold text-ink">
            批次 {batch.code}
            {batch.status === '借出中' ? (
              <span className="ml-2 align-middle">
                <LoanBadge overdue={overdue} overdueDays={overdueDays} testId="loan-detail-badge" />
              </span>
            ) : (
              <span className="ml-2 mt-chip border-jade/40 align-middle text-jade">已归库</span>
            )}
          </h3>
          <p className="mt-sub">
            {formatDate(batch.lendDate)} 借出 · 应还 {formatDate(batch.dueDate)}
            {overdue ? ` · 已逾期 ${overdueDays} 天` : ''} · 经手 {dash(batch.operator)}
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 border-b border-paper-line px-4 py-3 text-xs md:grid-cols-2" data-testid="loan-detail-info">
        <div>
          <dt className="text-ink-mute">借用人 / 借用单位</dt>
          <dd className="text-ink-soft">{dash(batch.borrower)}</dd>
        </div>
        <div>
          <dt className="text-ink-mute">用途</dt>
          <dd className="text-ink-soft">{dash(batch.purpose)}</dd>
        </div>
        {batch.note ? (
          <div className="md:col-span-2">
            <dt className="text-ink-mute">备注</dt>
            <dd className="text-ink-soft">{batch.note}</dd>
          </div>
        ) : null}
      </dl>

      <div className="px-4 py-3">
        <h4 className="mb-2 font-song text-sm font-semibold text-ink">
          归库清点（按枚）
          <span className="ml-2 text-[11px] font-normal text-ink-mute">
            未归还 {outItems.length} 枚 · 已归还 {doneItems.length} 枚
          </span>
        </h4>

        {outItems.length > 0 ? (
          <div className="space-y-3" data-testid="loan-checkin-list">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mt-label" htmlFor="loan-return-date">
                  归还日期
                </label>
                <input
                  id="loan-return-date"
                  data-testid="loan-return-date"
                  type="date"
                  className="mt-input"
                  value={returnDate}
                  onChange={(e) => {
                    setReturnDate(e.target.value);
                    setDateError('');
                  }}
                />
                {dateError ? <p className="mt-error" data-testid="error-return-date">{dateError}</p> : null}
              </div>
              <div>
                <label className="mt-label" htmlFor="loan-checkin-operator">
                  归库经手人
                </label>
                <input
                  id="loan-checkin-operator"
                  data-testid="loan-checkin-operator"
                  className="mt-input"
                  placeholder={`默认：${batch.operator}`}
                  value={operator}
                  onChange={(e) => setOperator(e.target.value)}
                />
              </div>
              <button
                type="button"
                className="mt-btn mt-btn-primary"
                data-testid="loan-checkin-all"
                disabled={submitting}
                onClick={() => handleCheckin()}
              >
                全部按所选结论归库（{outItems.length} 枚）
              </button>
            </div>

            {outItems.map((item) => {
              const r = rowState(item.matrixId);
              const errs = errors[item.matrixId] ?? {};
              return (
                <div
                  key={item.matrixId}
                  className="rounded border border-paper-line bg-paper/40 px-3 py-3"
                  data-testid={`loan-checkin-row-${item.matrixId}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      className="font-song text-lg text-ink hover:text-seal"
                      to={`/matrices/${item.matrixId}`}
                      data-testid={`loan-checkin-char-${item.matrixId}`}
                    >
                      {item.character}
                    </Link>
                    <span className="text-[11px] text-ink-mute">{dash(item.matrixCode)}</span>
                    <div className="ml-auto flex items-center gap-3">
                      {(['完好', '损坏'] as LoanCondition[]).map((c) => (
                        <label key={c} className="flex cursor-pointer items-center gap-1 text-xs text-ink-soft">
                          <input
                            type="radio"
                            name={`condition-${item.matrixId}`}
                            className="accent-seal"
                            checked={r.condition === c}
                            onChange={() => patchRow(item.matrixId, { condition: c })}
                            data-testid={`loan-condition-${item.matrixId}-${c}`}
                          />
                          {c}
                        </label>
                      ))}
                      <button
                        type="button"
                        className="mt-btn"
                        disabled={submitting}
                        data-testid={`loan-checkin-one-${item.matrixId}`}
                        onClick={() => handleCheckin(item.matrixId)}
                      >
                        清点归库
                      </button>
                    </div>
                  </div>
                  {errs.condition ? <p className="mt-error">{errs.condition}</p> : null}
                  {r.condition === '损坏' ? (
                    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4" data-testid={`loan-defect-fields-${item.matrixId}`}>
                      <div>
                        <label className="mt-label">缺损类型</label>
                        <select
                          className="mt-input"
                          value={r.defectType}
                          onChange={(e) => patchRow(item.matrixId, { defectType: e.target.value as DefectType })}
                          data-testid={`loan-defect-type-${item.matrixId}`}
                        >
                          {DEFECT_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mt-label">程度</label>
                        <select
                          className="mt-input"
                          value={r.severity}
                          onChange={(e) => patchRow(item.matrixId, { severity: e.target.value as DefectSeverity })}
                          data-testid={`loan-defect-severity-${item.matrixId}`}
                        >
                          {DEFECT_SEVERITIES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="md:col-span-2">
                        <label className="mt-label">缺损情况说明</label>
                        <input
                          className="mt-input"
                          placeholder="例：边角磕损断裂，需补刻"
                          value={r.handling}
                          onChange={(e) => patchRow(item.matrixId, { handling: e.target.value })}
                          data-testid={`loan-defect-handling-${item.matrixId}`}
                        />
                        {errs.handling ? <p className="mt-error">{errs.handling}</p> : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-xs text-jade" data-testid="loan-all-returned">
            本批次 {batch.items.length} 枚字模均已归库清点。
          </p>
        )}

        <h4 className="mb-2 mt-4 font-song text-sm font-semibold text-ink">清点记录</h4>
        <div className="overflow-x-auto">
          <table className="min-w-full" data-testid="loan-item-table">
            <thead className="border-b border-paper-line bg-paper/60">
              <tr>
                <th className="mt-th">字模</th>
                <th className="mt-th">状态</th>
                <th className="mt-th">结论</th>
                <th className="mt-th">归还日期</th>
                <th className="mt-th">清点说明</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-paper-line">
              {batch.items.map((it) => (
                <tr key={it.matrixId} data-testid={`loan-item-row-${it.matrixId}`}>
                  <td className="mt-td">
                    <Link className="font-song text-base text-ink hover:text-seal" to={`/matrices/${it.matrixId}`}>
                      {it.character}
                    </Link>
                    <div className="text-[11px] text-ink-mute">{dash(it.matrixCode)}</div>
                  </td>
                  <td className="mt-td">{it.status}</td>
                  <td className="mt-td">
                    {it.condition ? (
                      <span
                        className={`mt-chip ${
                          it.condition === '完好' ? 'border-jade/40 text-jade' : 'border-seal/40 text-seal'
                        }`}
                      >
                        {it.condition}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="mt-td">{it.returnDate ? formatDate(it.returnDate) : '—'}</td>
                  <td className="mt-td text-xs">{dash(it.note)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-hint mt-2">批次登记于 {formatStamp(batch.createdAt)}，最近更新 {formatStamp(batch.updatedAt)}</p>
      </div>
    </section>
  );
}

function defaultRow(): CheckinRowState {
  return { condition: '完好', defectType: '缺笔', severity: '中', handling: '', note: '' };
}
