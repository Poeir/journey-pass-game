import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/design-system/Button';
import { Pill } from '@/design-system/Pill';
import { Sheet } from '@/design-system/Sheet';
import { adminEndpoints, type AdminEmployee } from '@/api/endpoints';
import type { Employee } from '@/types/game';
import { useAdminData } from './useAdminData';
import './admin.css';
import './AdminPlayerDetail.css';

type StampPickerState = { cardId: string; cardIndex: number; clue: string; targetIds: string[] };

export function AdminPlayerDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: progress, loading, error, reload } = useAdminData(
    () => adminEndpoints.getPlayer(id),
    [id],
  );
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmReroll, setConfirmReroll] = useState(false);
  const [acting, setActing] = useState(false);
  const [stampPicker, setStampPicker] = useState<StampPickerState | null>(null);
  const [teammatePicker, setTeammatePicker] = useState(false);
  const [leaderPicker, setLeaderPicker] = useState(false);

  if (loading && !progress) {
    return <div className="adm-empty">กำลังโหลด…</div>;
  }
  if (error && !progress) {
    return (
      <div className="adm-empty">
        ไม่พบผู้เล่นรหัส <code>{id}</code>
        <div style={{ marginTop: 12 }}>
          <Link to="/admin/players" className="adm-link-btn">
            ← กลับไปรายชื่อผู้เล่น
          </Link>
        </div>
      </div>
    );
  }
  if (!progress) return null;

  const triviaCount = Object.keys(progress.triviaStamps).length;
  const memberCount = progress.teammateSlots.filter((s) => !s.isLeader).length;
  const leader = progress.teammateSlots.find((s) => s.isLeader);
  const cards = progress.assignedCards;
  const assignedLeader = progress.assignedLeader;

  const allSlotIds = new Set(progress.teammateSlots.map((s) => s.id));

  const toggleComplete = async () => {
    setActing(true);
    try {
      if (progress.completedAt) {
        await adminEndpoints.unmarkPlayerComplete(progress.player.id);
      } else {
        await adminEndpoints.markPlayerComplete(progress.player.id);
      }
      await reload();
    } finally {
      setActing(false);
    }
  };

  const resetProgress = async () => {
    setActing(true);
    try {
      await adminEndpoints.resetPlayerProgress(progress.player.id);
      setConfirmReset(false);
      await reload();
    } finally {
      setActing(false);
    }
  };

  const rerollCards = async () => {
    setActing(true);
    try {
      await adminEndpoints.rerollAssignedCards(progress.player.id);
      setConfirmReroll(false);
      await reload();
    } finally {
      setActing(false);
    }
  };

  const grantStamp = async (cardId: string, targetId: string) => {
    setActing(true);
    try {
      await adminEndpoints.grantStamp(progress.player.id, cardId, targetId);
      setStampPicker(null);
      await reload();
    } finally {
      setActing(false);
    }
  };

  const revokeStamp = async (cardId: string) => {
    if (!window.confirm('ลบตราของการ์ดนี้?')) return;
    setActing(true);
    try {
      await adminEndpoints.revokeStamp(progress.player.id, cardId);
      await reload();
    } finally {
      setActing(false);
    }
  };

  const addTeammate = async (employeeId: string) => {
    setActing(true);
    try {
      await adminEndpoints.addTeammate(progress.player.id, employeeId);
      setTeammatePicker(false);
      await reload();
    } finally {
      setActing(false);
    }
  };

  const removeTeammate = async (employeeId: string, name: string) => {
    const playerName = progress.player.name;
    const warning =
      `ลบความสัมพันธ์เพื่อนร่วมทีมระหว่าง ${playerName} กับ ${name}?\n\n` +
      `⚠️ การลบนี้จะลบออกจากทั้งสองฝั่ง:\n` +
      `• ลบ ${name} ออกจากรายชื่อของ ${playerName}\n` +
      `• ลบ ${playerName} ออกจากรายชื่อของ ${name} (ถ้ามี)\n` +
      `• ลบประวัติการจับคู่ของทั้งสองทิศทาง (รวมถึงคำตอบจากแชท)\n\n` +
      `ถ้าอยากให้ทั้งสองคนกลับมาเป็นเพื่อนร่วมทีมกัน ต้องเริ่มสแกนใหม่ตั้งแต่ต้น`;
    if (!window.confirm(warning)) return;
    setActing(true);
    try {
      await adminEndpoints.removeTeammate(progress.player.id, employeeId);
      await reload();
    } finally {
      setActing(false);
    }
  };

  const patchLeader = async (leaderId: string | null) => {
    setActing(true);
    try {
      await adminEndpoints.patchAssignedLeader(progress.player.id, leaderId);
      setLeaderPicker(false);
      await reload();
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="adm-stack--lg">
      <header className="adm-page-head">
        <div className="adm-page-head__lead">
          <button
            type="button"
            onClick={() => navigate('/admin/players')}
            className="adm-link-btn"
            style={{ alignSelf: 'flex-start' }}
          >
            ← กลับไปรายชื่อผู้เล่น
          </button>
          <h1 className="adm-page-head__title">{progress.player.name}</h1>
          <p className="adm-page-head__subtitle">
            <code>{progress.player.id}</code> · {progress.player.dept} · ปี {progress.player.year}
            {progress.player.isLeader && (
              <Pill tone="blue" className="adm-player-detail__pill">
                หัวหน้าทีม
              </Pill>
            )}
          </p>
        </div>
        <div className="adm-page-head__actions">
          {progress.completedAt ? (
            <Button variant="secondary" color="ink" disabled={acting} onClick={toggleComplete}>
              ยกเลิกสถานะ "เล่นจบ"
            </Button>
          ) : (
            <Button color="flame" disabled={acting} onClick={toggleComplete}>
              บังคับให้เป็นเล่นจบ
            </Button>
          )}
        </div>
      </header>

      <div className="adm-grid-2">
        <section className="adm-panel">
          <header className="adm-panel__head">
            <h2 className="adm-panel__title">ตราใบไขปริศนา</h2>
            <span className="adm-table__sub">{triviaCount} / 5</span>
          </header>
          <ul className="adm-player-detail__cards">
            {cards.map((c) => {
              const stampedByEmp = progress.stampedBy[c.id];
              return (
                <li key={c.id} className="adm-player-detail__card">
                  <div className="adm-player-detail__card-head">
                    <span className="adm-player-detail__card-idx">#{c.index}</span>
                    <span className="adm-player-detail__card-clue">{c.clue}</span>
                  </div>
                  <div className="adm-player-detail__card-body">
                    {stampedByEmp ? (
                      <>
                        <Pill tone="flame">เก็บตราแล้ว</Pill>
                        <span className="adm-table__sub">โดย {stampedByEmp.name}</span>
                        <button
                          type="button"
                          className="adm-link-btn adm-link-btn--danger"
                          disabled={acting}
                          onClick={() => revokeStamp(c.id)}
                        >
                          ลบตรา
                        </button>
                      </>
                    ) : (
                      <>
                        <Pill>ยังไม่ได้</Pill>
                        <button
                          type="button"
                          className="adm-link-btn"
                          disabled={acting}
                          onClick={() =>
                            setStampPicker({
                              cardId: c.id,
                              cardIndex: c.index,
                              clue: c.clue,
                              targetIds: c.targetIds,
                            })
                          }
                        >
                          ให้ตราด้วยตนเอง
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
            {cards.length === 0 && (
              <p className="adm-table__sub">ยังไม่ได้สุ่มการ์ดใบไขปริศนา</p>
            )}
          </ul>
        </section>

        <section className="adm-panel">
          <header className="adm-panel__head">
            <h2 className="adm-panel__title">รายชื่อเพื่อนร่วมทีม</h2>
            <span className="adm-table__sub">
              {memberCount} / 5 · {leader ? 'มีหัวหน้า 1 คน' : 'ยังไม่มีหัวหน้า'}
            </span>
          </header>
          <ul className="adm-player-detail__slots">
            {Array.from({ length: 5 }).map((_, i) => {
              const member = progress.teammateSlots.filter((s) => !s.isLeader)[i];
              return (
                <li key={`m-${i}`} className="adm-player-detail__slot">
                  <span className="adm-player-detail__slot-num">{i + 1}</span>
                  {member ? (
                    <>
                      <span className="adm-player-detail__slot-name">
                        {member.name}
                        <span className="adm-table__sub">
                          {member.dept} · ปี {member.year}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="adm-link-btn adm-link-btn--danger"
                        disabled={acting}
                        onClick={() => removeTeammate(member.id, member.name)}
                      >
                        ลบ
                      </button>
                    </>
                  ) : (
                    <span className="adm-player-detail__slot-empty">ว่าง</span>
                  )}
                </li>
              );
            })}
            <li className="adm-player-detail__slot adm-player-detail__slot--leader">
              <span className="adm-player-detail__slot-num">★</span>
              {leader ? (
                <>
                  <span className="adm-player-detail__slot-name">
                    {leader.name}
                    <span className="adm-table__sub">หัวหน้าทีม · {leader.dept}</span>
                  </span>
                  <button
                    type="button"
                    className="adm-link-btn adm-link-btn--danger"
                    disabled={acting}
                    onClick={() => removeTeammate(leader.id, leader.name)}
                  >
                    ลบ
                  </button>
                </>
              ) : (
                <span className="adm-player-detail__slot-empty">ช่องหัวหน้า (โบนัส)</span>
              )}
            </li>
          </ul>
          <div className="adm-row-actions" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
            <Button
              variant="secondary"
              color="ink"
              disabled={acting}
              onClick={() => setTeammatePicker(true)}
            >
              + เพิ่มเพื่อนร่วมทีม
            </Button>
          </div>
          <div className="adm-form-row__hint" style={{ marginTop: 8 }}>
            หมายเหตุ: ผู้ดูแลสามารถเพิ่มได้เกินจำนวนที่กำหนด — เพิ่มได้แม้ครบ 5 คนแล้ว
          </div>
        </section>
      </div>

      <section className="adm-panel">
        <header className="adm-panel__head">
          <h2 className="adm-panel__title">การมอบหมาย</h2>
          <span className="adm-table__sub">กระจายให้หัวหน้าแต่ละคนได้รับลูกทีมเท่าๆ กัน</span>
        </header>
        <div className="adm-form-row">
          <div>
            <label className="adm-form-row__label">หัวหน้าที่ต้องสแกน</label>
            <div className="adm-form-row__hint">
              หัวหน้าทีมที่ผู้เล่นคนนี้ต้องไปเจอ — ถ้าสแกนผิดคนจะนับว่าสแกนผิดหัวหน้า
              และระบบจะใช้ใบ้ของหัวหน้าคนนี้แสดงในหน้าแนะนำภารกิจเพื่อนร่วมทีม
            </div>
          </div>
          <div className="adm-stack">
            <div className="adm-player-detail__assignment">
              {assignedLeader ? (
                <>
                  <strong>{assignedLeader.name}</strong>
                  <span className="adm-table__sub">{assignedLeader.dept}</span>
                </>
              ) : (
                <span className="adm-table__sub">ยังไม่ได้กำหนด</span>
              )}
            </div>
            <div className="adm-row-actions">
              <Button
                variant="secondary"
                color="ink"
                disabled={acting}
                onClick={() => setLeaderPicker(true)}
              >
                {assignedLeader ? 'เปลี่ยนหัวหน้า' : 'กำหนดหัวหน้า'}
              </Button>
              {assignedLeader && (
                <button
                  type="button"
                  className="adm-link-btn adm-link-btn--danger"
                  disabled={acting}
                  onClick={() => {
                    if (window.confirm('ยกเลิกการมอบหมายหัวหน้า?')) patchLeader(null);
                  }}
                >
                  ยกเลิกมอบหมาย
                </button>
              )}
            </div>
            {assignedLeader && leader && leader.id !== assignedLeader.id && (
              <div className="adm-callout adm-callout--info">
                <span className="adm-callout__icon">i</span>
                ผู้เล่นมีหัวหน้าในรายชื่อแล้ว แต่เป็นคนละคนกับที่ระบบมอบหมายไว้
              </div>
            )}
          </div>
        </div>
        <div className="adm-form-row">
          <div>
            <label className="adm-form-row__label">การ์ดใบไขปริศนาที่ได้รับ</label>
            <div className="adm-form-row__hint">
              5 ใบที่ระบบสุ่มให้ผู้เล่นในครั้งแรกที่เริ่มภารกิจใบไขปริศนา
            </div>
          </div>
          <div className="adm-stack" style={{ gap: 8 }}>
            <div className="adm-tag-list">
              {progress.assignedCardIds.length === 0 ? (
                <span className="adm-table__sub">ยังไม่ได้สุ่ม</span>
              ) : (
                progress.assignedCardIds.map((cid) => {
                  const card = progress.assignedCards.find((c) => c.id === cid);
                  return <Pill key={cid}>#{card?.index ?? '?'}</Pill>;
                })
              )}
            </div>
            <div className="adm-row-actions">
              <Button
                variant="secondary"
                color="ink"
                disabled={acting}
                onClick={() => setConfirmReroll((v) => !v)}
              >
                สุ่มการ์ดใหม่
              </Button>
            </div>
            {confirmReroll && (
              <div className="adm-callout adm-callout--danger">
                <span className="adm-callout__icon">!</span>
                <div style={{ flex: 1 }}>
                  ยืนยัน? — การ์ดชุดเดิมและตราที่เก็บไว้บนการ์ดเดิมจะถูกลบทั้งหมด
                </div>
                <Button color="flame" disabled={acting} onClick={rerollCards}>
                  ยืนยันสุ่มใหม่
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="adm-panel adm-player-detail__danger">
        <header className="adm-panel__head">
          <h2 className="adm-panel__title">โซนอันตราย</h2>
        </header>
        <div className="adm-form-row">
          <div>
            <label className="adm-form-row__label">รีเซ็ตความคืบหน้า</label>
            <div className="adm-form-row__hint">
              ลบตราที่เก็บได้, รายชื่อเพื่อนร่วมทีม และสถานะเล่นจบทั้งหมด
              (การ์ดและหัวหน้าที่มอบหมายไว้จะไม่ถูกแตะต้อง)
            </div>
          </div>
          <div className="adm-stack" style={{ gap: 8 }}>
            <Button
              variant="secondary"
              color="ink"
              disabled={acting}
              onClick={() => setConfirmReset((v) => !v)}
            >
              รีเซ็ตความคืบหน้า
            </Button>
            {confirmReset && (
              <div className="adm-callout adm-callout--danger">
                <span className="adm-callout__icon">!</span>
                <div style={{ flex: 1 }}>ยืนยันการลบความคืบหน้า — ไม่สามารถย้อนได้</div>
                <Button color="flame" disabled={acting} onClick={resetProgress}>
                  ยืนยันรีเซ็ต
                </Button>
              </div>
            )}
          </div>
        </div>
      </section>

      <Sheet
        open={!!stampPicker}
        onClose={() => setStampPicker(null)}
        title={stampPicker ? `ให้ตราด้วยตนเอง · #${stampPicker.cardIndex}` : ''}
        position="center"
        size="md"
      >
        {stampPicker && (
          <EmployeePicker
            restrictToIds={stampPicker.targetIds}
            hint={
              <>
                เลือกคนที่จะนับว่าผู้เล่นสแกนเจอแล้ว (ใบ้:{' '}
                <em>{stampPicker.clue}</em>)
              </>
            }
            disableIds={[progress.player.id]}
            disabledReason="ผู้เล่นเอง"
            onPick={(emp) => grantStamp(stampPicker.cardId, emp.id)}
            acting={acting}
          />
        )}
      </Sheet>

      <Sheet
        open={teammatePicker}
        onClose={() => setTeammatePicker(false)}
        title="เพิ่มเพื่อนร่วมทีม (โดยผู้ดูแลระบบ)"
        position="center"
        size="md"
      >
        <EmployeePicker
          hint="ค้นหาพนักงานที่ต้องการเพิ่มเข้ารายชื่อ — ผู้ดูแลสามารถเพิ่มได้แม้เกินจำนวนสูงสุด และไม่ตรวจเงื่อนไขรุ่นพี่/รุ่นน้องหรือกฎหัวหน้า"
          disableIds={[progress.player.id, ...allSlotIds]}
          disabledReason="อยู่ในรายชื่อแล้ว / เป็นตัวผู้เล่นเอง"
          onPick={(emp) => addTeammate(emp.id)}
          acting={acting}
        />
      </Sheet>

      <Sheet
        open={leaderPicker}
        onClose={() => setLeaderPicker(false)}
        title="เปลี่ยนหัวหน้าที่มอบหมาย"
        position="center"
        size="md"
      >
        <EmployeePicker
          role="leaders"
          hint="เลือกหัวหน้าทีมที่ผู้เล่นคนนี้ต้องไปเจอ"
          disableIds={progress.player.isLeader ? [progress.player.id] : []}
          disabledReason="ผู้เล่นเอง"
          onPick={(emp) => patchLeader(emp.id)}
          acting={acting}
        />
      </Sheet>

    </div>
  );
}

interface EmployeePickerProps {
  hint?: React.ReactNode;
  role?: 'all' | 'leaders' | 'members';
  restrictToIds?: string[];
  disableIds?: string[];
  disabledReason?: string;
  onPick: (emp: Employee) => void;
  acting: boolean;
}

function EmployeePicker({
  hint,
  role = 'all',
  restrictToIds,
  disableIds = [],
  disabledReason,
  onPick,
  acting,
}: EmployeePickerProps) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const { data, loading, error } = useAdminData(
    () => adminEndpoints.listEmployees(debounced || undefined, role === 'all' ? undefined : role),
    [debounced, role],
  );

  const restrictSet = useMemo(
    () => (restrictToIds ? new Set(restrictToIds) : null),
    [restrictToIds],
  );
  const disableSet = useMemo(() => new Set(disableIds), [disableIds]);

  const rows: AdminEmployee[] = (data?.employees ?? []).filter(
    (e) => !restrictSet || restrictSet.has(e.id),
  );

  return (
    <div className="adm-stack">
      {hint && <div className="adm-form-row__hint">{hint}</div>}
      <input
        className="adm-input"
        type="search"
        placeholder="ค้นหาชื่อ, รหัส, แผนก…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <div className="adm-picker__list">
        {loading && !data && <div className="adm-empty">กำลังโหลด…</div>}
        {!!error && !data && <div className="adm-empty">โหลดข้อมูลไม่สำเร็จ</div>}
        {!error && !loading && rows.length === 0 && (
          <div className="adm-empty">ไม่พบพนักงานที่ตรงกับเงื่อนไข</div>
        )}
        {rows.map((emp) => {
          const disabled = disableSet.has(emp.id);
          return (
            <button
              key={emp.id}
              type="button"
              className="adm-picker__row"
              disabled={disabled || acting}
              onClick={() => onPick(emp)}
            >
              <div className="adm-picker__row-main">
                <div className="adm-table__primary">{emp.name}</div>
                <div className="adm-table__sub">
                  <code>{emp.id}</code> · {emp.dept} · ปี {emp.year}
                </div>
              </div>
              <div className="adm-picker__row-meta">
                {emp.isLeader && <Pill tone="blue">หัวหน้า</Pill>}
                {disabled && disabledReason && (
                  <span className="adm-table__sub">{disabledReason}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
