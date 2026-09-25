import { useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../components/common/EmptyState';
import LoanBadge from '../components/common/LoanBadge';
import { DRAFT_KEYS, useLocalDraft } from '../hooks/useLocalDraft';
import { useLoanStore } from '../stores/loanStore';
import { useMatrixStore } from '../stores/matrixStore';
import { useUiStore } from '../stores/uiStore';
import { DEFECT_SEVERITIES, DEFECT_TYPES } from '../types/defect';
import type { DefectSeverity, DefectType } from '../types/defect';
import type { LoanBatch, LoanCondition, LoanItem, ReturnFormInput } from '../types/loan';
import {
  activeLoanMap,
  isItemOnLoan,
  isItemOverdue,
  summarizeLoans,
  validateLoanForm,
  validateReturnForm,
} from '../types/loan';
import { addDays, dash, formatDate, todayStr } from '../utils/format';

interface LoanDraftState {
  borrower: string;
  purpose: string;
  loanDate: string;
  dueDate: string;
  operator: string;
  note: string;
  matrixIds: string[];
  keyword: string;
}

const INITIAL_DRAFT: LoanDraftState = {
  borrower: '',
  purpose: '',
  loanDate: todayStr(),
  dueDate: addDays(todayStr(), 30),
  operator: '',
  note: '',
  matrixIds: [],
  keyword: '',
};

interface ReturnFormState {
  returnedDate: string;
  condition: LoanCondition;
  defectType: DefectType;
  severity: DefectSeverity;
  handling: string;
  operator: string;
  note: string;
}

const returnKey = (batchId: string, matrixId: string) => `${batchId}:${matrixId}`;

/** 归库清点表单的默认值（清点人默认沿用批次经手人） */
function defaultReturnForm(batch: LoanBatch): ReturnFormState {
  return {
    returnedDate: todayStr(),
    condition: '完好',
    defectType: '磨损',
    severity: '中',
    handling: '',
    operator: batch.operator,
    note: '',
  };
}

/** `/loans` 借展管理：批次借出登记 + 按枚归库清点 */
export default function LoanBoard() {
  const loans = useLoanStore((s) => s.loans);
  const loaded = useLoanStore((s) => s.loaded);
  const createLoan = useLoanStore((s) => s.createLoan);
  const returnItem = useLoanStore((s) => s.returnItem);
  const matrices = useMatrixStore((s) => s.matrices);
  const pushToast = useUiStore((s) => s.pushToast);

  const { draft, patch, reset, savedAt, existed } = useLocalDraft<LoanDraftState>(
    DRAFT_KEYS.loanNew,
    INITIAL_DRAFT,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [openReturns, setOpenReturns] = useState<Record<string, boolean>>({});
  const [returnForms, setReturnForms] = useState<Record<string, ReturnFormState>>({});
  const [returnErrors, setReturnErrors] = useState<Record<string, Record<string, string>>>({});

  const loanMap = useMemo(() => activeLoanMap(loans), [loans]);
  const stats = useMemo(() => summarizeLoans(loans), [loans]);

  /** 可借出的在库字模：可用且当前没有外借记录 */
  const eligible = useMemo(
    () =>
      matrices
        .filter((m) => m.availability === '可用' && !loanMap.has(m.id))
        .sort((a, b) => a.code.localeCompare(b.code)),
    [matrices, loanMap],
  );

  const visibleEligible = useMemo(() => {
    const k = draft.keyword.trim().toLowerCase();
    if (!k) return eligible;
    return eligible.filter(
      (m) => m.character.includes(draft.keyword.trim()) || m.code.toLowerCase().includes(k),
    );
  }, [eligible, draft.keyword]);

  const selectedSet = useMemo(() => new Set(draft.matrixIds), [draft.matrixIds]);

  /** 草稿中已勾选、但当前已不可借的字模（例如被其它批次借走），单独提示并可移除 */
  const staleSelected = useMemo(
    () => matrices.filter((m) => selectedSet.has(m.id) && (m.availability !== '可用' || loanMap.has(m.id))),
    [matrices, selectedSet, loanMap],
  );

  const toggleMatrix = (id: string) => {
    const next = new Set(selectedSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    patch({ matrixIds: Array.from(next) });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const input = {
      borrower: draft.borrower,
      purpose: draft.purpose,
      loanDate: draft.loanDate,
      dueDate: draft.dueDate,
      operator: draft.operator,
      note: draft.note,
      matrixIds: draft.matrixIds,
    };
    const next = validateLoanForm(input);
    setErrors(next);
    if (Object.keys(next).length > 0) {
      pushToast('借展登记未通过校验，请按提示修正', 'warn');
      return;
    }
    setSubmitting(true);
    try {
      const row = await createLoan(input);
      pushToast(`已登记借展批次 ${row.code}，共 ${row.items.length} 枚字模借出`);
      patch({ borrower: '', purpose: '', note: '', matrixIds: [], keyword: '' });
      setErrors({});
    } catch (err) {
      pushToast(err instanceof Error ? err.message : '借展登记失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const returnFormOf = (batch: LoanBatch, item: LoanItem): ReturnFormState =>
    returnForms[returnKey(batch.id, item.matrixId)] ?? defaultReturnForm(batch);

  const patchReturnForm = (batch: LoanBatch, item: LoanItem, next: Partial<ReturnFormState>) => {
    const key = returnKey(batch.id, item.matrixId);
    setReturnForms((cur) => ({
      ...cur,
      [key]: { ...(cur[key] ?? defaultReturnForm(batch)), ...next },
    }));
  };

  const handleReturn = async (batch: LoanBatch, item: LoanItem) => {
    const key = returnKey(batch.id, item.matrixId);
    const form = returnFormOf(batch, item);
    const input: ReturnFormInput = {
      returnedDate: form.returnedDate,
      condition: form.condition,
      defectType: form.defectType,
      severity: form.severity,
      handling: form.handling,
      operator: form.operator,
      note: form.note,
    };
    const errs = validateReturnForm(input);
    setReturnErrors((cur) => ({ ...cur, [key]: errs }));
    if (Object.keys(errs).length > 0) {
      pushToast('归库清点未通过校验，请按提示修正', 'warn');
      return;
    }
    try {
      await returnItem(batch.id, item.matrixId, input);
      pushToast(
        form.condition === '损坏'
          ? `「${item.character}」已归库，因损坏转入待补刻并登记缺损`
          : `「${item.character}」清点完好，已恢复可用`,
      );
      setOpenReturns((cur) => ({ ...cur, [key]: false }));
      setReturnErrors((cur) => ({ ...cur, [key]: {} }));
    } catch (err) {
      pushToast(err instanceof Error ? err.message : '归库清点失败', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="mt-title" data-testid="loan-board-title">
            借展管理
          </h2>
          <p className="mt-sub">
            批次登记字模外借：一次勾选多枚在库字模，登记借用人、用途与应还日期；借出期间不可再借、不可排进字盘，归库时按枚清点。
          </p>
        </div>
        <div className="flex flex-wrap gap-2" data-testid="loan-stats">
          <span className="mt-chip" data-testid="loan-stat-batches">
            批次 {stats.batches}
          </span>
          <span className="mt-chip border-brass/40 text-brass" data-testid="loan-stat-active">
            在借 {stats.active}
          </span>
          <span className="mt-chip border-seal/40 text-seal" data-testid="loan-stat-overdue">
            逾期 {stats.overdue}
          </span>
          <span className="mt-chip border-jade/40 text-jade" data-testid="loan-stat-returned">
            已归库 {stats.returned}
          </span>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[400px_1fr]">
        <section className="mt-panel self-start">
          <div className="mt-panel-head">
            <h3 className="font-song text-sm font-semibold text-ink">登记借出</h3>
            <span className="mt-sub" data-testid="loan-draft-status">
              {existed ? `草稿已恢复 · ${savedAt || '—'}` : `草稿自动保存 ${savedAt || '—'}`}
            </span>
          </div>
          <form className="space-y-3 px-4 py-4" onSubmit={handleSubmit} data-testid="loan-form">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mt-label" htmlFor="loan-borrower">
                  借用人 / 单位
                </label>
                <input
                  id="loan-borrower"
                  data-testid="loan-borrower"
                  className="mt-input"
                  placeholder="例：城南印刷博物馆"
                  value={draft.borrower}
                  onChange={(e) => patch({ borrower: e.target.value })}
                />
                {errors.borrower ? <p className="mt-error">{errors.borrower}</p> : null}
              </div>
              <div>
                <label className="mt-label" htmlFor="loan-operator">
                  经手人
                </label>
                <input
                  id="loan-operator"
                  data-testid="loan-operator"
                  className="mt-input"
                  placeholder="例：陈之安"
                  value={draft.operator}
                  onChange={(e) => patch({ operator: e.target.value })}
                />
                {errors.operator ? <p className="mt-error">{errors.operator}</p> : null}
              </div>
              <div className="sm:col-span-2">
                <label className="mt-label" htmlFor="loan-purpose">
                  借展用途
                </label>
                <input
                  id="loan-purpose"
                  data-testid="loan-purpose"
                  className="mt-input"
                  placeholder="例：「铅火与纸」活字印刷特展"
                  value={draft.purpose}
                  onChange={(e) => patch({ purpose: e.target.value })}
                />
                {errors.purpose ? <p className="mt-error">{errors.purpose}</p> : null}
              </div>
              <div>
                <label className="mt-label" htmlFor="loan-date">
                  借出日期
                </label>
                <input
                  id="loan-date"
                  data-testid="loan-date"
                  type="date"
                  className="mt-input"
                  value={draft.loanDate}
                  onChange={(e) => patch({ loanDate: e.target.value })}
                />
                {errors.loanDate ? <p className="mt-error">{errors.loanDate}</p> : null}
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
              <div className="sm:col-span-2">
                <label className="mt-label" htmlFor="loan-note">
                  备注
                </label>
                <input
                  id="loan-note"
                  data-testid="loan-note"
                  className="mt-input"
                  placeholder="例：展柜恒温恒湿，运输已投保"
                  value={draft.note}
                  onChange={(e) => patch({ note: e.target.value })}
                />
              </div>
            </div>

            <div className="rounded border border-paper-line bg-paper/40 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-ink-soft" data-testid="loan-selected-count">
                  勾选借出字模（已选 {draft.matrixIds.length} 枚）
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="mt-btn-ghost mt-btn px-2 py-0.5 text-[11px]"
                    data-testid="loan-select-all"
                    onClick={() => patch({ matrixIds: visibleEligible.map((m) => m.id) })}
                  >
                    全选当前
                  </button>
                  <button
                    type="button"
                    className="mt-btn-ghost mt-btn px-2 py-0.5 text-[11px]"
                    data-testid="loan-select-none"
                    onClick={() => patch({ matrixIds: [] })}
                  >
                    清空
                  </button>
                </div>
              </div>
              <input
                className="mt-input mt-2"
                data-testid="loan-matrix-keyword"
                placeholder="按字符或编号筛选在库字模"
                value={draft.keyword}
                onChange={(e) => patch({ keyword: e.target.value })}
              />
              {staleSelected.length > 0 ? (
                <div
                  className="mt-2 rounded border border-seal/40 bg-seal-pale px-2 py-1.5 text-[11px] text-seal"
                  data-testid="loan-stale-selected"
                >
                  以下勾选已不可借出，请移除后再提交：
                  {staleSelected.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      className="ml-1 rounded-full border border-seal/40 bg-white px-1.5 py-0.5 hover:bg-seal hover:text-paper"
                      data-testid={`loan-stale-${m.id}`}
                      onClick={() => toggleMatrix(m.id)}
                    >
                      {m.character}（{m.availability !== '可用' ? m.availability : '已借出'}）✕
                    </button>
                  ))}
                </div>
              ) : null}
              <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto pr-1" data-testid="loan-matrix-list">
                {visibleEligible.length === 0 ? (
                  <li className="px-1 py-2 text-[11px] text-ink-mute" data-testid="loan-matrix-empty">
                    没有可借出的在库字模（停用 / 待补刻 / 已借出的字模不在此列）。
                  </li>
                ) : (
                  visibleEligible.map((m) => (
                    <li key={m.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1 text-xs transition ${
                          selectedSet.has(m.id)
                            ? 'border-seal/60 bg-seal-pale/60 text-ink'
                            : 'border-paper-line bg-white/70 text-ink-soft hover:border-brass'
                        }`}
                        data-testid={`loan-matrix-${m.id}`}
                      >
                        <input
                          type="checkbox"
                          className="accent-seal"
                          checked={selectedSet.has(m.id)}
                          onChange={() => toggleMatrix(m.id)}
                        />
                        <span className="font-song text-base text-ink">{m.character}</span>
                        <span className="text-[11px] text-ink-mute">
                          {m.code} · {m.font}/{m.sizeName} · {m.material}
                        </span>
                      </label>
                    </li>
                  ))
                )}
              </ul>
              {errors.matrixIds ? <p className="mt-error">{errors.matrixIds}</p> : null}
              <p className="mt-hint">
                仅列出「可用」且未借出的字模；借出期间将自动禁止再次借展与排进字盘。
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                className="mt-btn mt-btn-primary"
                data-testid="loan-submit"
                disabled={submitting}
              >
                {submitting ? '登记中…' : `登记借出（${draft.matrixIds.length} 枚）`}
              </button>
              <button
                type="button"
                className="mt-btn"
                data-testid="loan-reset-draft"
                onClick={() => {
                  reset();
                  setErrors({});
                  pushToast('已清空借展登记草稿', 'warn');
                }}
              >
                清空草稿
              </button>
            </div>
          </form>
        </section>

        <section className="space-y-3" data-testid="loan-batch-list">
          {loans.length === 0 ? (
            <EmptyState
              title={loaded ? '暂无借展批次' : '正在读取借展档案…'}
              description={loaded ? '在左侧勾选在库字模并登记借用人、用途与应还日期，即可开立借展批次。' : '首次进入会写入示例档案，请稍候。'}
              testId="loan-empty"
            />
          ) : (
            loans.map((batch) => (
              <BatchCard
                key={batch.id}
                batch={batch}
                openReturns={openReturns}
                setOpenReturns={setOpenReturns}
                returnFormOf={returnFormOf}
                patchReturnForm={patchReturnForm}
                returnErrors={returnErrors}
                onReturn={handleReturn}
              />
            ))
          )}
        </section>
      </div>
    </div>
  );
}

interface BatchCardProps {
  batch: LoanBatch;
  openReturns: Record<string, boolean>;
  setOpenReturns: Dispatch<SetStateAction<Record<string, boolean>>>;
  returnFormOf: (batch: LoanBatch, item: LoanItem) => ReturnFormState;
  patchReturnForm: (batch: LoanBatch, item: LoanItem, next: Partial<ReturnFormState>) => void;
  returnErrors: Record<string, Record<string, string>>;
  onReturn: (batch: LoanBatch, item: LoanItem) => Promise<void>;
}

function BatchCard({
  batch,
  openReturns,
  setOpenReturns,
  returnFormOf,
  patchReturnForm,
  returnErrors,
  onReturn,
}: BatchCardProps) {
  const today = todayStr();
  const activeItems = batch.items.filter((it) => isItemOnLoan(it));
  const overdueCount = activeItems.filter((it) => isItemOverdue(it, today)).length;
  const returnedCount = batch.items.length - activeItems.length;
  const allReturned = activeItems.length === 0;

  return (
    <article className="mt-panel" data-testid={`loan-batch-${batch.id}`}>
      <div className="mt-panel-head">
        <div>
          <h3 className="font-song text-sm font-semibold text-ink" data-testid={`loan-batch-code-${batch.id}`}>
            {batch.code} · {batch.borrower}
          </h3>
          <p className="mt-sub">
            {batch.purpose} · 借出 {formatDate(batch.loanDate)} · 应还 {formatDate(batch.dueDate)} · 经手{' '}
            {dash(batch.operator)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="mt-chip">{batch.items.length} 枚</span>
          {activeItems.length > 0 ? (
            <span className="mt-chip border-brass/40 text-brass">在借 {activeItems.length}</span>
          ) : null}
          {overdueCount > 0 ? (
            <span className="mt-chip border-seal/40 text-seal" data-testid={`loan-batch-overdue-${batch.id}`}>
              逾期 {overdueCount}
            </span>
          ) : null}
          {allReturned ? (
            <span className="mt-chip border-jade/40 text-jade" data-testid={`loan-batch-done-${batch.id}`}>
              已全部归库
            </span>
          ) : returnedCount > 0 ? (
            <span className="mt-chip border-jade/40 text-jade">已归 {returnedCount}</span>
          ) : null}
        </div>
      </div>
      {batch.note ? <p className="border-b border-paper-line px-4 py-2 text-[11px] text-ink-mute">备注：{batch.note}</p> : null}
      <ul className="divide-y divide-paper-line">
        {batch.items.map((item) => {
          const key = returnKey(batch.id, item.matrixId);
          const onLoan = isItemOnLoan(item);
          const overdue = isItemOverdue(item, today);
          const open = Boolean(openReturns[key]);
          const form = returnFormOf(batch, item);
          const errs = returnErrors[key] ?? {};
          return (
            <li key={item.matrixId} className="px-4 py-3" data-testid={`loan-item-${batch.id}-${item.matrixId}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    className="font-song text-lg text-ink hover:text-seal"
                    to={`/matrices/${item.matrixId}`}
                    data-testid={`loan-item-link-${item.matrixId}`}
                  >
                    {item.character}
                  </Link>
                  <span className="text-[11px] text-ink-mute">{item.matrixCode}</span>
                  {onLoan ? (
                    <LoanBadge loan={{ batch, item, overdue }} testId={`loan-item-badge-${item.matrixId}`} />
                  ) : (
                    <span
                      className={`mt-chip ${
                        item.condition === '损坏' ? 'border-seal/40 text-seal' : 'border-jade/40 text-jade'
                      }`}
                      data-testid={`loan-item-returned-${item.matrixId}`}
                    >
                      {formatDate(item.returnedDate)} 归库 · {item.condition}
                    </span>
                  )}
                </div>
                {onLoan ? (
                  <button
                    type="button"
                    className="mt-btn"
                    data-testid={`loan-return-toggle-${item.matrixId}`}
                    onClick={() => setOpenReturns((cur) => ({ ...cur, [key]: !open }))}
                  >
                    {open ? '收起清点' : '归库清点'}
                  </button>
                ) : item.note ? (
                  <span className="text-[11px] text-ink-mute">清点备注：{item.note}</span>
                ) : null}
              </div>
              {!onLoan && item.condition === '损坏' ? (
                <p className="mt-1 text-[11px] text-seal">
                  已转待补刻并登记缺损记录，可在字模详情或缺损登记页查看。
                </p>
              ) : null}
              {onLoan && open ? (
                <div
                  className="mt-2 space-y-3 rounded border border-paper-line bg-paper/40 px-3 py-3"
                  data-testid={`loan-return-form-${item.matrixId}`}
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="mt-label">归库日期</label>
                      <input
                        type="date"
                        className="mt-input"
                        data-testid={`loan-return-date-${item.matrixId}`}
                        value={form.returnedDate}
                        onChange={(e) => patchReturnForm(batch, item, { returnedDate: e.target.value })}
                      />
                      {errs.returnedDate ? <p className="mt-error">{errs.returnedDate}</p> : null}
                    </div>
                    <div>
                      <label className="mt-label">清点结论</label>
                      <div className="flex gap-3 pt-1.5" data-testid={`loan-return-condition-${item.matrixId}`}>
                        {(['完好', '损坏'] as const).map((c) => (
                          <label key={c} className="flex items-center gap-1 text-xs text-ink-soft">
                            <input
                              type="radio"
                              className="accent-seal"
                              checked={form.condition === c}
                              onChange={() => patchReturnForm(batch, item, { condition: c })}
                            />
                            {c}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="mt-label">清点人</label>
                      <input
                        className="mt-input"
                        data-testid={`loan-return-operator-${item.matrixId}`}
                        value={form.operator}
                        onChange={(e) => patchReturnForm(batch, item, { operator: e.target.value })}
                      />
                      {errs.operator ? <p className="mt-error">{errs.operator}</p> : null}
                    </div>
                  </div>
                  {form.condition === '损坏' ? (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid={`loan-return-damage-${item.matrixId}`}>
                      <div>
                        <label className="mt-label">缺损类型</label>
                        <select
                          className="mt-input"
                          data-testid={`loan-return-defect-type-${item.matrixId}`}
                          value={form.defectType}
                          onChange={(e) =>
                            patchReturnForm(batch, item, { defectType: e.target.value as DefectType })
                          }
                        >
                          {DEFECT_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mt-label">缺损程度</label>
                        <select
                          className="mt-input"
                          data-testid={`loan-return-severity-${item.matrixId}`}
                          value={form.severity}
                          onChange={(e) =>
                            patchReturnForm(batch, item, { severity: e.target.value as DefectSeverity })
                          }
                        >
                          {DEFECT_SEVERITIES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mt-label">缺损情况</label>
                        <input
                          className="mt-input"
                          data-testid={`loan-return-handling-${item.matrixId}`}
                          placeholder="例：字面右上角磨损，笔画发虚"
                          value={form.handling}
                          onChange={(e) => patchReturnForm(batch, item, { handling: e.target.value })}
                        />
                        {errs.handling ? <p className="mt-error">{errs.handling}</p> : null}
                      </div>
                    </div>
                  ) : null}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
                    <div>
                      <label className="mt-label">清点备注</label>
                      <input
                        className="mt-input"
                        data-testid={`loan-return-note-${item.matrixId}`}
                        placeholder="例：展期保存良好 / 运输途中磕碰"
                        value={form.note}
                        onChange={(e) => patchReturnForm(batch, item, { note: e.target.value })}
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="button"
                        className="mt-btn mt-btn-primary"
                        data-testid={`loan-return-submit-${item.matrixId}`}
                        onClick={() => void onReturn(batch, item)}
                      >
                        确认归库
                      </button>
                    </div>
                  </div>
                  <p className="mt-hint">
                    完好归库后字模恢复可用；损坏归库将自动登记缺损并转入待补刻清单。
                  </p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </article>
  );
}
