import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  adminEndpoints,
  type AdminChatAnswer,
  type AdminChatQuestionGroup,
} from '@/api/endpoints';
import { Button } from '@/design-system/Button';
import { Pill } from '@/design-system/Pill';
import { Sheet } from '@/design-system/Sheet';
import { ApiError } from '@/api/client';
import './admin.css';
import './AdminChatAnswers.css';

const PAGE_SIZE = 50;

type View = 'by-question' | 'by-time';

export function AdminChatAnswers() {
  const [view, setView] = useState<View>('by-question');
  const [privateMode, setPrivateMode] = useState(false);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div className="adm-stack--lg">
      <header className="adm-page-head">
        <div className="adm-page-head__lead">
          <h1 className="adm-page-head__title">คำตอบจากแชท</h1>
          <p className="adm-page-head__subtitle">
            คำตอบที่ผู้เล่นทั้งสองฝ่ายพิมพ์ตอนยืนยันเพื่อนร่วมทีม —
            แต่ละคู่เก็บได้สูงสุด 2 คำตอบ (ผู้สแกนและผู้ถูกสแกนต่างฝ่ายต่างพิมพ์)
          </p>
        </div>
        <div className="adm-chat-answers__head-actions">
          <button
            type="button"
            className={`adm-chat-answers__privacy${
              privateMode ? ' adm-chat-answers__privacy--on' : ''
            }`}
            onClick={() => setPrivateMode((v) => !v)}
            aria-pressed={privateMode}
            title={privateMode ? 'เปิดดูชื่อ' : 'ซ่อนชื่อ (เบลอ — hover เพื่อดู)'}
          >
            {privateMode ? <EyeOffIcon /> : <EyeIcon />}
            <span>{privateMode ? 'ซ่อนชื่อ' : 'แสดงชื่อ'}</span>
          </button>
          <div className="adm-chat-answers__view-toggle" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'by-question'}
              className={`adm-chat-answers__view-btn${
                view === 'by-question' ? ' adm-chat-answers__view-btn--active' : ''
              }`}
              onClick={() => setView('by-question')}
            >
              ตามคำถาม
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'by-time'}
              className={`adm-chat-answers__view-btn${
                view === 'by-time' ? ' adm-chat-answers__view-btn--active' : ''
              }`}
              onClick={() => setView('by-time')}
            >
              ตามเวลา
            </button>
          </div>
        </div>
      </header>

      <div className="adm-panel">
        <div className="adm-filter-bar">
          <label className="adm-search">
            <SearchIcon />
            <input
              className="adm-search__input"
              type="search"
              placeholder="ค้นหา ชื่อผู้สแกน, ชื่อเป้า, หรือคำตอบ…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>

        {view === 'by-question' ? (
          <ByQuestionView query={debouncedQuery} privateMode={privateMode} />
        ) : (
          <ByTimeView query={debouncedQuery} privateMode={privateMode} />
        )}
      </div>
    </div>
  );
}

// ─── Masked name ──────────────────────────────────────────────────

function Name({ name, masked }: { name: string; masked: boolean }) {
  if (masked) {
    return (
      <span className="adm-chat-answers__name adm-chat-answers__name--masked">
        {'x'.repeat([...name].length)}
      </span>
    );
  }
  return <strong className="adm-chat-answers__name">{name}</strong>;
}

// ─── By question ──────────────────────────────────────────────────

interface QuestionDraft {
  mode: 'add' | 'edit';
  id?: string; // present when editing
  text: string;
}

function ByQuestionView({ query, privateMode }: { query: string; privateMode: boolean }) {
  const [data, setData] = useState<AdminChatQuestionGroup[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<QuestionDraft | null>(null);
  const [acting, setActing] = useState(false);
  const [deleteError, setDeleteError] = useState<{ id: string; msg: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await adminEndpoints.listChatAnswersByQuestion();
      setData(r.questions);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!query) return data;
    const needle = query.toLowerCase();
    // Filter answers within each group; keep only groups that still have answers
    // OR whose question text matches.
    return data
      .map((g) => {
        const questionMatch = g.question.toLowerCase().includes(needle);
        const answers = g.answers.filter(
          (a) =>
            a.answer.toLowerCase().includes(needle) ||
            a.answerer.name.toLowerCase().includes(needle) ||
            a.target.name.toLowerCase().includes(needle),
        );
        if (questionMatch) return g; // keep all answers under matching question
        return { ...g, answers, answerCount: answers.length };
      })
      .filter((g) => g.answerCount > 0 || g.question.toLowerCase().includes(needle));
  }, [data, query]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveDraft = async () => {
    if (!draft || !draft.text.trim()) return;
    setActing(true);
    try {
      if (draft.mode === 'add') {
        await adminEndpoints.createChatQuestion({ question: draft.text.trim() });
      } else if (draft.id) {
        await adminEndpoints.updateChatQuestion(draft.id, { question: draft.text.trim() });
      }
      setDraft(null);
      await reload();
    } finally {
      setActing(false);
    }
  };

  const deleteQuestion = async (g: AdminChatQuestionGroup) => {
    if (!window.confirm(`ลบคำถาม "${g.question}"? ไม่สามารถย้อนได้`)) return;
    setActing(true);
    setDeleteError(null);
    try {
      await adminEndpoints.deleteChatQuestion(g.id);
      await reload();
    } catch (err) {
      let msg = 'ลบไม่สำเร็จ';
      if (err instanceof ApiError && err.status === 409) {
        if (err.code === 'last_question') {
          msg = 'ลบไม่ได้ — ต้องเหลือคำถามอย่างน้อย 1 ข้อในระบบ';
        } else if (err.code === 'has_answers') {
          const n =
            (err.body as { answerCount?: number } | null)?.answerCount ?? g.answerCount;
          msg = `ลบไม่ได้ — มีคนตอบคำถามนี้ไปแล้ว ${n} คน (ต้องไปลบเพื่อนร่วมทีมของผู้เล่นเหล่านั้นในหน้ารายละเอียดผู้เล่นก่อน)`;
        }
      }
      setDeleteError({ id: g.id, msg });
    } finally {
      setActing(false);
    }
  };

  if (loading && !data) return <div className="adm-empty">กำลังโหลด…</div>;
  if (error && !data) return <div className="adm-empty">โหลดข้อมูลไม่สำเร็จ</div>;

  return (
    <>
      <div className="adm-chat-answers__manage-bar">
        <span className="adm-table__sub">
          {data?.length ?? 0} คำถามในระบบ — แก้ไขข้อความได้สด, ลบได้ก็ต่อเมื่อยังไม่มีคนตอบ
        </span>
        <Button color="flame" onClick={() => setDraft({ mode: 'add', text: '' })}>
          + เพิ่มคำถาม
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="adm-empty">
          {query ? 'ไม่พบคำถามที่ตรงกับเงื่อนไข' : 'ยังไม่มีคำถาม — เพิ่มอันแรกได้ด้านบน'}
        </div>
      ) : (
        <ul className="adm-chat-answers__qlist">
          {filtered.map((g) => {
            const isOpen = expanded.has(g.id) || !!query;
            return (
              <li key={g.id} className="adm-chat-answers__qcard">
                <div className="adm-chat-answers__qhead-wrap">
                  <button
                    type="button"
                    className="adm-chat-answers__qhead"
                    onClick={() => toggle(g.id)}
                    aria-expanded={isOpen}
                  >
                    <span className="adm-chat-answers__qtext">{g.question}</span>
                    <span className="adm-chat-answers__qmeta">
                      <Pill tone={g.answerCount > 0 ? 'flame' : 'ink'}>
                        {g.answerCount} คำตอบ
                      </Pill>
                      <span className="adm-chat-answers__chev" aria-hidden="true">
                        {isOpen ? '▾' : '▸'}
                      </span>
                    </span>
                  </button>
                  <div className="adm-chat-answers__qactions">
                    <button
                      type="button"
                      className="adm-link-btn"
                      disabled={acting}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDraft({ mode: 'edit', id: g.id, text: g.question });
                      }}
                    >
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      className="adm-link-btn adm-link-btn--danger"
                      disabled={acting}
                      onClick={(e) => {
                        e.stopPropagation();
                        void deleteQuestion(g);
                      }}
                    >
                      ลบ
                    </button>
                  </div>
                </div>
                {deleteError?.id === g.id && (
                  <div className="adm-callout adm-callout--danger">
                    <span className="adm-callout__icon">!</span>
                    <span>{deleteError.msg}</span>
                  </div>
                )}
            {isOpen && g.answers.length > 0 && (
              <ul className="adm-chat-answers__alist">
                {g.answers.map((a) => (
                  <li key={`${a.pairId}-${a.answererId}`} className="adm-chat-answers__arow">
                    <div className="adm-chat-answers__atext">"{a.answer}"</div>
                    <div className="adm-chat-answers__ameta">
                      <Name name={a.answerer.name} masked={privateMode} />
                      <span className="adm-table__sub"> ตอบเรื่อง </span>
                      <Name name={a.target.name} masked={privateMode} />
                      <span className="adm-table__sub"> · {formatDateTime(a.createdAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {isOpen && g.answers.length === 0 && (
              <div className="adm-chat-answers__empty-q">ยังไม่มีคำตอบสำหรับคำถามนี้</div>
            )}
          </li>
            );
          })}
        </ul>
      )}

      <Sheet
        open={!!draft}
        onClose={() => setDraft(null)}
        title={draft?.mode === 'add' ? 'เพิ่มคำถามใหม่' : 'แก้ไขคำถาม'}
        position="center"
        size="md"
      >
        {draft && (
          <div className="adm-stack">
            <div className="adm-form-row__hint">
              {draft.mode === 'add'
                ? 'คำถามใหม่จะถูกเพิ่มต่อท้ายคำถามล่าสุด — ไม่กระทบคู่ที่ได้รับคำถามไปแล้ว'
                : 'แก้ข้อความได้ทันที — ไม่กระทบคนที่ตอบไปแล้ว เพราะระบบเลือกคำถามให้แต่ละคู่จากลำดับของคำถาม ไม่ใช่ตัวข้อความ'}
            </div>
            <textarea
              className="adm-textarea"
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              rows={4}
              autoFocus
              placeholder="เช่น: ถ้าวันนี้ไปกินข้าวกลางวันด้วยกัน เขาจะสั่งอะไร?"
            />
            <div className="adm-row-actions" style={{ justifyContent: 'flex-end' }}>
              <Button
                variant="secondary"
                color="ink"
                type="button"
                onClick={() => setDraft(null)}
                disabled={acting}
              >
                ยกเลิก
              </Button>
              <Button
                color="flame"
                type="button"
                onClick={saveDraft}
                disabled={acting || !draft.text.trim()}
              >
                {acting ? 'กำลังบันทึก…' : draft.mode === 'add' ? 'เพิ่ม' : 'บันทึก'}
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}

// ─── By time ──────────────────────────────────────────────────────

function ByTimeView({ query, privateMode }: { query: string; privateMode: boolean }) {
  const [rows, setRows] = useState<AdminChatAnswer[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  // Reset pagination when search changes.
  useEffect(() => {
    setRows([]);
    setCursor(null);
    setNextCursor(null);
  }, [query]);

  const fetchPage = useCallback(
    async (pageCursor: string | null, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(false);
      try {
        const res = await adminEndpoints.listChatAnswers({
          q: query || undefined,
          limit: PAGE_SIZE,
          cursor: pageCursor ?? undefined,
        });
        setRows((prev) => (append ? [...prev, ...res.answers] : res.answers));
        setNextCursor(res.nextCursor);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [query],
  );

  useEffect(() => {
    void fetchPage(cursor, cursor !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, cursor]);

  if (loading && rows.length === 0) return <div className="adm-empty">กำลังโหลด…</div>;
  if (error && rows.length === 0)
    return <div className="adm-empty">โหลดข้อมูลไม่สำเร็จ</div>;
  if (rows.length === 0)
    return <div className="adm-empty">ยังไม่มีคำตอบ{query ? 'ที่ตรงกับเงื่อนไข' : ''}</div>;

  return (
    <>
      <div className="adm-chat-answers__count">
        <span className="adm-table__sub">
          {rows.length} คำตอบ{nextCursor && ' · มีต่ออีก'}
        </span>
      </div>
      <ul className="adm-chat-answers__list">
        {rows.map((a) => (
          <li key={`${a.pairId}-${a.answerer.id}`} className="adm-chat-answers__row">
            <div className="adm-chat-answers__head">
              <div className="adm-chat-answers__people">
                <Name name={a.answerer.name} masked={privateMode} />
                <span className="adm-table__sub"> ตอบเรื่อง </span>
                <Name name={a.target.name} masked={privateMode} />
              </div>
              <span className="adm-table__sub">{formatDateTime(a.createdAt)}</span>
            </div>
            <div className="adm-chat-answers__question">
              <span className="adm-chat-answers__label">คำถาม</span>
              <span>{a.question}</span>
            </div>
            <div className="adm-chat-answers__answer">
              <span className="adm-chat-answers__label">คำตอบ</span>
              <span>{a.answer}</span>
            </div>
            <div className="adm-table__id">รหัสคู่: {a.pairId}</div>
          </li>
        ))}
      </ul>
      {nextCursor && (
        <div className="adm-chat-answers__more">
          <button
            type="button"
            className="adm-link-btn"
            onClick={() => setCursor(nextCursor)}
            disabled={loadingMore}
          >
            {loadingMore ? 'กำลังโหลด…' : 'โหลดเพิ่ม'}
          </button>
        </div>
      )}
    </>
  );
}

function SearchIcon() {
  return (
    <svg
      className="adm-search__icon"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx={11} cy={11} r={7} />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx={12} cy={12} r={3} />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a19.55 19.55 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a19.31 19.31 0 0 1-2.16 3.19" />
      <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88" />
      <path d="M1 1l22 22" />
    </svg>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${min}`;
}
