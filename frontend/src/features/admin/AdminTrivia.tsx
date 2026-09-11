import { useState } from 'react';
import { Button } from '@/design-system/Button';
import { Pill } from '@/design-system/Pill';
import { Sheet } from '@/design-system/Sheet';
import {
  adminEndpoints,
  type AdminTriviaCardRow,
  type AdminEmployee,
} from '@/api/endpoints';
import { useAdminData } from './useAdminData';
import './admin.css';
import './AdminTrivia.css';

export function AdminTrivia() {
  const [editing, setEditing] = useState<AdminTriviaCardRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [acting, setActing] = useState(false);

  const { data, loading, error, reload } = useAdminData(() => adminEndpoints.listTrivia());
  const cards = data?.cards ?? [];

  const handleDelete = async (c: AdminTriviaCardRow) => {
    if (!window.confirm(`ลบการ์ด #${c.index}?`)) return;
    setActing(true);
    try {
      await adminEndpoints.deleteTrivia(c.id);
      await reload();
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="adm-stack--lg">
      <header className="adm-page-head">
        <div className="adm-page-head__lead">
          <h1 className="adm-page-head__title">การ์ดใบไขปริศนา</h1>
          <p className="adm-page-head__subtitle">
            แต่ละการ์ดมีคำใบ้และรายชื่อเป้าหมายที่ถูกต้องหลายคน — สแกนใครก็ได้ในรายการถือว่าตรง
          </p>
        </div>
        <div className="adm-page-head__actions">
          <Button color="flame" onClick={() => setCreating(true)}>
            + เพิ่มการ์ดใหม่
          </Button>
        </div>
      </header>

      {loading && !data && <div className="adm-empty">กำลังโหลด…</div>}
      {!!error && !data && <div className="adm-empty">โหลดข้อมูลไม่สำเร็จ</div>}

      {data && (
        <div className="adm-trivia__grid">
          {cards.map((c) => {
            const usagePct =
              c.assignedToCount > 0 ? (c.stampedCount / c.assignedToCount) * 100 : 0;
            return (
              <article key={c.id} className="adm-trivia__card">
                <header className="adm-trivia__card-head">
                  <span className="adm-trivia__index">การ์ด #{c.index}</span>
                  <span className="adm-table__id">{c.id}</span>
                </header>
                <p className="adm-trivia__clue">{c.clue}</p>
                <div className="adm-trivia__targets-block">
                  <span className="adm-trivia__targets-label">เป้าหมายที่ถูกต้อง</span>
                  <div className="adm-trivia__targets">
                    {c.targets.length === 0 ? (
                      <span className="adm-table__sub">ยังไม่มีเป้าหมาย</span>
                    ) : (
                      c.targets.map((t) => (
                        <Pill key={t.id} tone="blue">
                          {t.name}
                        </Pill>
                      ))
                    )}
                  </div>
                </div>
                <footer className="adm-trivia__card-foot">
                  <div className="adm-trivia__stat">
                    <span className="adm-table__sub">มอบหมายให้</span>
                    <strong>{c.assignedToCount} คน</strong>
                  </div>
                  <div className="adm-trivia__stat">
                    <span className="adm-table__sub">สแกนเจอแล้ว</span>
                    <strong>{c.stampedCount} คน</strong>
                  </div>
                  <div className="adm-trivia__stat adm-trivia__stat--full">
                    <span className="adm-progress-mini" aria-hidden="true">
                      <span
                        className="adm-progress-mini__fill"
                        style={{ ['--pct' as never]: `${usagePct}%` }}
                      />
                    </span>
                    <span className="adm-table__sub">{Math.round(usagePct)}% สแกนเจอ</span>
                  </div>
                </footer>
                <div className="adm-trivia__actions">
                  <button className="adm-link-btn" onClick={() => setEditing(c)}>
                    แก้ไข
                  </button>
                  <button
                    className="adm-link-btn adm-link-btn--danger"
                    disabled={acting}
                    onClick={() => handleDelete(c)}
                  >
                    ลบ
                  </button>
                </div>
              </article>
            );
          })}
          {cards.length === 0 && <div className="adm-empty">ยังไม่มีการ์ด</div>}
        </div>
      )}

      <Sheet
        open={!!editing || creating}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        title={creating ? 'เพิ่มการ์ดใหม่' : `แก้ไขการ์ด #${editing?.index}`}
        position="center"
        size="lg"
      >
        <CardForm
          card={editing ?? undefined}
          existingCards={cards}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            setEditing(null);
            setCreating(false);
            reload();
          }}
        />
      </Sheet>
    </div>
  );
}

function deriveNextCard(cards: AdminTriviaCardRow[]): { id: string; index: number } {
  const nextIndex = cards.reduce((m, c) => Math.max(m, c.index), 0) + 1;
  if (cards.length === 0) {
    return { id: `CARD-${String(nextIndex).padStart(3, '0')}`, index: nextIndex };
  }
  const reference = cards.reduce((max, c) => (c.index > max.index ? c : max), cards[0]);
  const m = /^(.*?)(\d+)$/.exec(reference.id);
  if (!m) return { id: '', index: nextIndex };
  const prefix = m[1];
  const padLen = m[2].length;
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const numRe = new RegExp(`^${escapedPrefix}(\\d+)$`);
  const maxNum = cards.reduce((max, c) => {
    const mm = numRe.exec(c.id);
    return mm ? Math.max(max, parseInt(mm[1], 10)) : max;
  }, 0);
  return { id: `${prefix}${String(maxNum + 1).padStart(padLen, '0')}`, index: nextIndex };
}

function CardForm({
  card,
  existingCards,
  onClose,
  onSaved,
}: {
  card?: AdminTriviaCardRow;
  existingCards: AdminTriviaCardRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isCreate = !card;
  const initial = useState(() => (isCreate ? deriveNextCard(existingCards) : null))[0];
  const id = card?.id ?? initial?.id ?? '';
  const index = card?.index ?? initial?.index ?? 1;
  const [clue, setClue] = useState(card?.clue ?? '');
  const [targets, setTargets] = useState<AdminEmployee[]>(card?.targets ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Lazy-load employee list for target picker the first time the field is opened.
  const [empSearch, setEmpSearch] = useState('');
  const [empResults, setEmpResults] = useState<AdminEmployee[]>([]);
  const searchEmployees = async (q: string) => {
    setEmpSearch(q);
    if (!q.trim()) {
      setEmpResults([]);
      return;
    }
    try {
      const data = await adminEndpoints.listEmployees(q);
      setEmpResults(data.employees);
    } catch {
      setEmpResults([]);
    }
  };

  const addTarget = (e: AdminEmployee) => {
    if (targets.some((t) => t.id === e.id)) return;
    setTargets([...targets, e]);
    setEmpSearch('');
    setEmpResults([]);
  };
  const removeTarget = (id: string) => setTargets(targets.filter((t) => t.id !== id));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !clue) {
      setErr('กรุณากรอกรหัสการ์ดและคำใบ้');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      if (isCreate) {
        await adminEndpoints.createTrivia({
          id,
          index,
          clue,
          targetIds: targets.map((t) => t.id),
        });
      } else {
        await adminEndpoints.updateTrivia(card.id, {
          index,
          clue,
          targetIds: targets.map((t) => t.id),
        });
      }
      onSaved();
    } catch (error) {
      setErr('บันทึกไม่สำเร็จ — กรุณาลองใหม่');
      console.error(error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="adm-stack" onSubmit={submit}>
      <div className="adm-form-row">
        <label className="adm-form-row__label">รหัสการ์ด</label>
        <input className="adm-input" value={id} readOnly disabled />
      </div>
      <div className="adm-form-row">
        <label className="adm-form-row__label">ลำดับการ์ด</label>
        <input className="adm-input" type="number" value={index} readOnly disabled />
      </div>
      <div className="adm-form-row">
        <div>
          <label className="adm-form-row__label">คำใบ้</label>
          <div className="adm-form-row__hint">
            ข้อความที่จะแสดงให้ผู้ที่ได้รับการ์ดนี้เห็น
          </div>
        </div>
        <textarea
          className="adm-textarea"
          value={clue}
          onChange={(e) => setClue(e.target.value)}
        />
      </div>
      <div className="adm-form-row">
        <div>
          <label className="adm-form-row__label">เป้าหมาย</label>
          <div className="adm-form-row__hint">สแกนใครก็ได้ในรายการถือว่าตรง</div>
        </div>
        <div className="adm-stack">
          <div className="adm-tag-list">
            {targets.length === 0 && (
              <span className="adm-table__sub">ยังไม่มีเป้าหมาย</span>
            )}
            {targets.map((t) => (
              <button
                key={t.id}
                type="button"
                className="adm-trivia__target-chip"
                onClick={() => removeTarget(t.id)}
                title="คลิกเพื่อลบ"
              >
                {t.name} ×
              </button>
            ))}
          </div>
          <input
            className="adm-input"
            placeholder="ค้นหาและเพิ่มพนักงาน…"
            value={empSearch}
            onChange={(e) => searchEmployees(e.target.value)}
          />
          {empResults.length > 0 && (
            <ul className="adm-trivia__emp-results">
              {empResults.slice(0, 8).map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className="adm-trivia__emp-pick"
                    onClick={() => addTarget(e)}
                  >
                    {e.name}{' '}
                    <span className="adm-table__id">
                      {e.id} · {e.dept}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {err && (
        <div className="adm-callout adm-callout--danger">
          <span className="adm-callout__icon">!</span>
          <span>{err}</span>
        </div>
      )}
      <div className="adm-row-actions" style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" color="ink" type="button" onClick={onClose}>
          ยกเลิก
        </Button>
        <Button color="flame" type="submit" disabled={submitting}>
          {submitting ? 'กำลังบันทึก…' : 'บันทึก'}
        </Button>
      </div>
    </form>
  );
}
