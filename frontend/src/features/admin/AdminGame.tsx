import { useState } from 'react';
import { Button } from '@/design-system/Button';
import { Pill } from '@/design-system/Pill';
import { adminEndpoints, type AdminWipeResult } from '@/api/endpoints';
import { useAdminData } from './useAdminData';
import './admin.css';
import './AdminGame.css';

export function AdminGame() {
  const { data, loading, error } = useAdminData(() => adminEndpoints.getGameClock());

  if (loading && !data) {
    return <div className="adm-empty">กำลังโหลด…</div>;
  }
  if (error && !data) {
    return <div className="adm-empty">โหลดข้อมูลไม่สำเร็จ</div>;
  }
  if (!data) return null;

  const minutesLeft = Math.max(
    0,
    Math.round((new Date(data.gameEndAt).getTime() - Date.now()) / 60000),
  );

  return (
    <div className="adm-stack--lg">
      <header className="adm-page-head">
        <div className="adm-page-head__lead">
          <h1 className="adm-page-head__title">ควบคุมเกม</h1>
          <p className="adm-page-head__subtitle">
            สถานะเวลาเกมปัจจุบัน — ยังไม่สามารถแก้เวลาจบเกมผ่านหน้านี้ได้
            (ค่านี้ตั้งไว้ในระบบ ต้องให้ทีมเทคนิคปรับให้)
          </p>
        </div>
        <div className="adm-page-head__actions">
          <Pill tone={data.isEnded ? 'ink' : 'flame'}>
            {data.isEnded ? 'เกมจบแล้ว' : 'กำลังเล่นอยู่'}
          </Pill>
        </div>
      </header>

      <section className="adm-panel">
        <header className="adm-panel__head">
          <h2 className="adm-panel__title">เวลาเกม (อ่านอย่างเดียว)</h2>
          <span className="adm-table__sub">เหลือ {minutesLeft} นาที</span>
        </header>
        <div className="adm-form-row">
          <label className="adm-form-row__label">เวลาจบเกม</label>
          <code className="adm-game__readonly">{data.gameEndAt}</code>
        </div>
        <div className="adm-form-row">
          <label className="adm-form-row__label">เวลาเซิร์ฟเวอร์</label>
          <code className="adm-game__readonly">{data.serverNow}</code>
        </div>
      </section>

      <RedistributeLeaders />

      <DangerZone />
    </div>
  );
}

function RedistributeLeaders() {
  const [confirm, setConfirm] = useState(false);
  const [acting, setActing] = useState(false);
  const [result, setResult] = useState<{
    totalPlayers: number;
    leaderCount: number;
    counts: Record<string, number>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setActing(true);
    setError(null);
    try {
      const res = await adminEndpoints.redistributeLeaders();
      setResult({
        totalPlayers: res.totalPlayers,
        leaderCount: res.leaderCount,
        counts: res.counts,
      });
      setConfirm(false);
    } catch {
      setError('สุ่มใหม่ไม่สำเร็จ — ตรวจสอบว่ามีหัวหน้าในระบบหรือยัง');
    } finally {
      setActing(false);
    }
  };

  return (
    <section className="adm-panel">
      <header className="adm-panel__head">
        <h2 className="adm-panel__title">ระบบมอบหมายหัวหน้า</h2>
        <span className="adm-table__sub">
          กระจายลูกทีมให้หัวหน้าแต่ละคนได้รับเท่าๆ กัน
        </span>
      </header>

      <div className="adm-form-row">
        <div>
          <label className="adm-form-row__label">สุ่มหัวหน้าใหม่ทั้งระบบ</label>
          <div className="adm-form-row__hint">
            สุ่มลำดับผู้เล่นใหม่ทั้งหมด แล้วจับคู่กับหัวหน้าให้แต่ละคน
            หัวหน้าแต่ละคนจะได้รับลูกทีมเท่าๆ กัน (และห้ามมอบหมายให้ตัวเอง)
          </div>
          <div className="adm-form-row__hint" style={{ marginTop: 4, fontStyle: 'italic' }}>
            หมายเหตุ: หัวหน้าที่มอบหมายไว้เดิมของผู้เล่นทุกคนจะถูกเขียนทับ
            และคำใบ้หัวหน้าที่ผู้เล่นเห็นจะเปลี่ยนตามครั้งต่อไปที่เปิดหน้าภารกิจเพื่อนร่วมทีม
          </div>
        </div>
        <div className="adm-stack" style={{ gap: 8 }}>
          {!confirm ? (
            <Button
              variant="secondary"
              color="ink"
              disabled={acting}
              onClick={() => {
                setConfirm(true);
                setResult(null);
                setError(null);
              }}
            >
              สุ่มหัวหน้าใหม่
            </Button>
          ) : (
            <div className="adm-callout adm-callout--info">
              <span className="adm-callout__icon">!</span>
              <div className="adm-stack" style={{ gap: 8, flex: 1 }}>
                <span>
                  ยืนยัน? — หัวหน้าที่มอบหมายไว้เดิมจะถูกแทนที่ด้วยชุดใหม่
                </span>
                <div className="adm-row-actions">
                  <Button
                    variant="secondary"
                    color="ink"
                    disabled={acting}
                    onClick={() => setConfirm(false)}
                  >
                    ยกเลิก
                  </Button>
                  <Button color="flame" disabled={acting} onClick={run}>
                    {acting ? 'กำลังสุ่ม…' : 'ยืนยัน'}
                  </Button>
                </div>
              </div>
            </div>
          )}
          {error && (
            <div className="adm-callout adm-callout--danger">
              <span className="adm-callout__icon">!</span>
              <span>{error}</span>
            </div>
          )}
          {result && (
            <div className="adm-callout adm-callout--info">
              <span className="adm-callout__icon">i</span>
              <div className="adm-stack" style={{ gap: 4, flex: 1 }}>
                <strong>
                  สำเร็จ — มอบหมายให้ {result.totalPlayers} คน, ใช้หัวหน้า {result.leaderCount} คน
                </strong>
                <ul className="adm-game__wipe-counts">
                  {Object.entries(result.counts).map(([leaderId, n]) => (
                    <li key={leaderId}>
                      <code>{leaderId}</code>: {n} คน
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="adm-link-btn"
                  onClick={() => setResult(null)}
                  style={{ alignSelf: 'flex-start' }}
                >
                  ปิด
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

type WipeLevel = 'gameplay' | 'employees' | 'all';

interface WipeAction {
  level: WipeLevel;
  title: string;
  desc: string;
  cta: string;
  warning: string;
  call: () => Promise<AdminWipeResult>;
}

function DangerZone() {
  const [pending, setPending] = useState<WipeLevel | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [acting, setActing] = useState(false);
  const [result, setResult] = useState<AdminWipeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actions: WipeAction[] = [
    {
      level: 'gameplay',
      title: 'ล้างข้อมูลการเล่น',
      desc: 'ลบประวัติการสแกน, คู่ลงโทษ, ตรา, รายชื่อเพื่อนร่วมทีม, รูปกำแพงความทรงจำ, การ์ดที่สุ่มไว้ให้ผู้เล่น และหัวหน้าที่มอบหมาย — รอบใหม่ผู้เล่นจะได้การ์ดและหัวหน้าชุดใหม่',
      cta: 'ล้างข้อมูลการเล่น',
      warning: 'ใช้สำหรับ "เริ่มรอบใหม่" — เก็บรายชื่อพนักงาน การ์ด คำถามแชท บทลงโทษ และตำแหน่งถ่ายรูปไว้ · ต้องกด "สุ่มหัวหน้าใหม่ทั้งระบบ" ด้านบนตามด้วยเพื่อมอบหมายหัวหน้าใหม่ให้ผู้เล่น',
      call: () => adminEndpoints.wipeGameplay(),
    },
    {
      level: 'employees',
      title: 'ล้างเฉพาะพนักงาน',
      desc: 'ลบรายชื่อพนักงานทั้งหมด พร้อมข้อมูลที่อ้างถึงพนักงาน (ประวัติการสแกน, คู่ลงโทษ, แสตมป์, เพื่อนร่วมทีม, การ์ดที่สุ่มไว้, หัวหน้าที่มอบหมาย, รูปกำแพงความทรงจำ และสถานะเล่นจบ) — แต่ยังเก็บการ์ด trivia, คำถามแชท, บทลงโทษ และตำแหน่งถ่ายรูปไว้',
      cta: 'ล้างเฉพาะพนักงาน',
      warning: 'ใช้เมื่อจะเปลี่ยนชุดพนักงานใหม่ (เช่น งานครั้งหน้าคนละทีม) — ต้อง sync จาก HR หรือ seed รายชื่อใหม่ก่อนเริ่มเล่น · ผู้เล่นที่ออนไลน์อยู่จะถูกตัดออกจากระบบ',
      call: () => adminEndpoints.wipeEmployees(),
    },
    {
      level: 'all',
      title: 'ล้างทั้งหมด',
      desc: 'ลบทุกอย่างในระบบ: พนักงาน, การ์ด, คำถามแชท, บทลงโทษ, ตำแหน่งถ่ายรูป และข้อมูลการเล่น — เหลือเฉพาะข้อมูลการเข้าสู่ระบบของผู้ดูแล',
      cta: 'ล้างทั้งหมด (รีเซ็ตค่าโรงงาน)',
      warning: 'ต้องให้ทีมเทคนิคโหลดข้อมูลพนักงานและการ์ดกลับใหม่ — ผู้เล่นที่ออนไลน์อยู่จะถูกตัดออกจากระบบ',
      call: () => adminEndpoints.wipeAll(),
    },
  ];

  const reset = () => {
    setPending(null);
    setConfirmText('');
    setError(null);
  };

  const submit = async (action: WipeAction) => {
    if (confirmText !== 'WIPE') {
      setError('พิมพ์ WIPE เพื่อยืนยัน');
      return;
    }
    setActing(true);
    setError(null);
    try {
      const res = await action.call();
      setResult(res);
      reset();
    } catch (err) {
      setError('ล้างไม่สำเร็จ — กรุณาแจ้งทีมเทคนิคให้ตรวจสอบ');
      // eslint-disable-next-line no-console
      console.error(err);
    } finally {
      setActing(false);
    }
  };

  return (
    <section className="adm-panel adm-game__danger">
      <header className="adm-panel__head">
        <h2 className="adm-panel__title">เขตอันตราย — ล้างข้อมูล</h2>
        <span className="adm-table__sub">ลบถาวร · ทำพร้อมกันทั้งชุด · ไม่สามารถย้อนได้</span>
      </header>

      {result && (
        <div className="adm-callout adm-callout--info">
          <span className="adm-callout__icon">i</span>
          <div className="adm-stack" style={{ gap: 4, flex: 1 }}>
            <strong>ล้างสำเร็จ — ระดับ: {result.level}</strong>
            <ul className="adm-game__wipe-counts">
              {Object.entries(result.counts).map(([k, v]) => (
                <li key={k}>
                  <code>{k}</code>: {v}
                </li>
              ))}
            </ul>
            <span className="adm-table__sub">
              ระบบเก็บรูปภาพ: ลบ {result.cloudinary.destroyed} ไฟล์
              {result.cloudinary.failed > 0 ? ` · ล้มเหลว ${result.cloudinary.failed} (แจ้งทีมเทคนิคให้ตรวจสอบ)` : ''}
            </span>
            <button
              type="button"
              className="adm-link-btn"
              onClick={() => setResult(null)}
              style={{ alignSelf: 'flex-start' }}
            >
              ปิด
            </button>
          </div>
        </div>
      )}

      {actions.map((a) => (
        <div key={a.level} className="adm-form-row">
          <div>
            <label className="adm-form-row__label">{a.title}</label>
            <div className="adm-form-row__hint">{a.desc}</div>
            <div className="adm-form-row__hint" style={{ marginTop: 4, fontStyle: 'italic' }}>
              {a.warning}
            </div>
          </div>
          <div className="adm-stack" style={{ gap: 8 }}>
            {pending !== a.level ? (
              <Button
                variant="secondary"
                color="ink"
                disabled={acting}
                onClick={() => {
                  setPending(a.level);
                  setConfirmText('');
                  setError(null);
                }}
              >
                {a.cta}
              </Button>
            ) : (
              <div className="adm-callout adm-callout--danger">
                <span className="adm-callout__icon">!</span>
                <div className="adm-stack" style={{ gap: 8, flex: 1 }}>
                  <span>
                    พิมพ์ <code>WIPE</code> ในช่องข้างล่างเพื่อยืนยัน — ไม่สามารถย้อนได้
                  </span>
                  <input
                    className="adm-input"
                    placeholder="พิมพ์ WIPE"
                    value={confirmText}
                    onChange={(e) => {
                      setConfirmText(e.target.value);
                      setError(null);
                    }}
                    autoFocus
                    disabled={acting}
                  />
                  {error && <span className="adm-table__sub">{error}</span>}
                  <div className="adm-row-actions">
                    <Button
                      variant="secondary"
                      color="ink"
                      disabled={acting}
                      onClick={reset}
                    >
                      ยกเลิก
                    </Button>
                    <Button
                      color="flame"
                      disabled={acting || confirmText !== 'WIPE'}
                      onClick={() => submit(a)}
                    >
                      {acting ? 'กำลังลบ…' : 'ยืนยัน'}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
