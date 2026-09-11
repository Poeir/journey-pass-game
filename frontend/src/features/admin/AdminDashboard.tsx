import { Link } from 'react-router-dom';
import { Pill } from '@/design-system/Pill';
import { adminEndpoints } from '@/api/endpoints';
import { useAdminData } from './useAdminData';
import './admin.css';
import './AdminDashboard.css';

export function AdminDashboard() {
  const { data, loading, error } = useAdminData(() => adminEndpoints.dashboard());

  if (loading && !data) {
    return <div className="adm-empty">กำลังโหลดข้อมูลแดชบอร์ด…</div>;
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
          <h1 className="adm-page-head__title">แดชบอร์ด</h1>
          <p className="adm-page-head__subtitle">
            ภาพรวมสถานะเกมแบบเรียลไทม์
          </p>
        </div>
        <div className="adm-page-head__actions">
          <Pill tone={data.isGameEnded ? 'ink' : 'flame'}>
            {data.isGameEnded ? 'เกมจบแล้ว' : 'LIVE'}
          </Pill>
          <Pill tone="ink">เหลือเวลา {minutesLeft} นาที</Pill>
        </div>
      </header>

      <div className="adm-stat-grid">
        <div className="adm-stat adm-stat--peach">
          <span className="adm-stat__label">ผู้เล่นทั้งหมด</span>
          <span className="adm-stat__value">{data.totalPlayers}</span>
          <span className="adm-stat__hint">จำนวนพนักงานที่ลงทะเบียน</span>
        </div>
        <div className="adm-stat">
          <span className="adm-stat__label">เล่นจบแล้ว</span>
          <span className="adm-stat__value">{data.finished}</span>
          <span className="adm-stat__hint">เก็บภารกิจครบทั้งหมดแล้ว</span>
        </div>
        <div className="adm-stat">
          <span className="adm-stat__label">กำลังเล่น</span>
          <span className="adm-stat__value">{data.playing}</span>
          <span className="adm-stat__hint">เริ่มแล้วยังไม่จบ</span>
        </div>
        <div className="adm-stat adm-stat--cream">
          <span className="adm-stat__label">ยังไม่เริ่ม</span>
          <span className="adm-stat__value">{data.notStarted}</span>
          <span className="adm-stat__hint">ยังไม่ได้สแกนหรือเก็บเพื่อนเลย</span>
        </div>
        <div className="adm-stat adm-stat--sky">
          <span className="adm-stat__label">คู่ที่ค้าง</span>
          <span className="adm-stat__value">{data.activePairs}</span>
          <span className="adm-stat__hint">รอผู้ถูกสแกนอัปรูปลงโทษ</span>
        </div>
        <div className="adm-stat">
          <span className="adm-stat__label">การสแกนวันนี้</span>
          <span className="adm-stat__value">{data.scansToday}</span>
          <span className="adm-stat__hint">นับรวมทั้งที่ตรงและพลาด</span>
        </div>
        <div className="adm-stat">
          <span className="adm-stat__label">รูปภาพอัปโหลด</span>
          <span className="adm-stat__value">{data.memoriesUploaded}</span>
          <span className="adm-stat__hint">รวมรูปกำแพงความทรงจำและรูปลงโทษ</span>
        </div>
        <div className="adm-stat">
          <span className="adm-stat__label">ภารกิจที่เก็บได้รวม</span>
          <span className="adm-stat__value">
            {data.completedQuests}
            <span className="adm-dashboard__quest-total">/{data.totalQuests}</span>
          </span>
          <span className="adm-stat__hint">
            สูงสุด 10 ภารกิจต่อคน (5 ใบไขปริศนา + 5 เพื่อนร่วมทีม) ของผู้เล่นที่ไม่ใช่หัวหน้า
          </span>
        </div>
      </div>

      <div className="adm-grid-2">
        <section className="adm-panel">
          <header className="adm-panel__head">
            <h2 className="adm-panel__title">กิจกรรมล่าสุด</h2>
            <Link to="/admin/scans" className="adm-link-btn">
              ดูทั้งหมด →
            </Link>
          </header>
          {data.recentScans.length === 0 ? (
            <p className="adm-table__sub">ยังไม่มีการสแกน</p>
          ) : (
            <ul className="adm-dashboard__feed">
              {data.recentScans.map((s) => (
                <li key={s.id} className="adm-dashboard__feed-item">
                  <span
                    className={`adm-dashboard__dot adm-dashboard__dot--${s.outcome.toLowerCase()}`}
                  />
                  <span className="adm-dashboard__feed-text">
                    <span>
                      <strong>{s.scanner.name}</strong> สแกน <strong>{s.target.name}</strong>
                    </span>
                    <span className="adm-table__sub">
                      {s.mode === 'TRIVIA' ? 'โหมดใบไขปริศนา' : 'โหมดเพื่อนร่วมทีม'} ·{' '}
                      {s.outcome === 'MATCH' ? 'ตรงเป้าหมาย' : 'พลาดเป้าหมาย'} ·{' '}
                      {relTime(s.createdAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="adm-panel">
          <header className="adm-panel__head">
            <h2 className="adm-panel__title">คู่ที่ค้างอยู่</h2>
            <Link to="/admin/pairs" className="adm-link-btn">
              จัดการ →
            </Link>
          </header>
          {data.activePairsList.length === 0 ? (
            <p className="adm-table__sub">ไม่มีคู่ที่ค้างลงโทษ</p>
          ) : (
            <ul className="adm-dashboard__pairs">
              {data.activePairsList.map((p) => (
                <li key={p.id} className="adm-dashboard__pair">
                  <span>
                    <strong>{p.hunter?.name ?? '?'}</strong> → {p.target?.name ?? '?'}
                    <span className="adm-table__sub">
                      {p.kind === 'TRIVIA' ? 'ใบไขปริศนา' : 'เพื่อนร่วมทีม'} · {relTime(p.createdAt)}
                    </span>
                  </span>
                  <Pill tone={p.kind === 'TRIVIA' ? 'flame' : 'blue'}>{p.kind}</Pill>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function relTime(iso: string): string {
  const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return `${diffSec} วินาทีก่อน`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} นาทีก่อน`;
  const diffHr = Math.round(diffMin / 60);
  return `${diffHr} ชั่วโมงก่อน`;
}
