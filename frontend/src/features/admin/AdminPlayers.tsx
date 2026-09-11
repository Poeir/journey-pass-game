import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Avatar } from '@/design-system/Avatar';
import { Button } from '@/design-system/Button';
import { Pill } from '@/design-system/Pill';
import { adminEndpoints, type AdminPlayerRow } from '@/api/endpoints';
import { useAdminData } from './useAdminData';
import './admin.css';
import './AdminPlayers.css';

type Filter = 'all' | 'finished' | 'playing' | 'not_started';

export function AdminPlayers() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  // Debounce text query so we don't refetch on every keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data, loading, error } = useAdminData(
    () => adminEndpoints.listPlayers(debouncedQuery || undefined, filter),
    [debouncedQuery, filter],
  );

  const rows = data?.players ?? [];
  const total = useMemo(() => rows.length, [rows]);

  return (
    <div className="adm-stack--lg">
      <header className="adm-page-head">
        <div className="adm-page-head__lead">
          <h1 className="adm-page-head__title">ผู้เล่น</h1>
          <p className="adm-page-head__subtitle">
            ความคืบหน้าของผู้เล่นแต่ละคนแบบเรียลไทม์ คลิกที่แถวเพื่อดูรายละเอียดหรือแก้ไข
          </p>
        </div>
        <div className="adm-page-head__actions">
          <Button variant="secondary" color="ink" disabled>
            ส่งออก CSV
          </Button>
        </div>
      </header>

      <div className="adm-panel">
        <div className="adm-filter-bar">
          <label className="adm-search">
            <SearchIcon />
            <input
              className="adm-search__input"
              type="search"
              placeholder="ค้นหาชื่อ, รหัส, แผนก…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            className="adm-select"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
            aria-label="กรองสถานะ"
          >
            <option value="all">ทุกสถานะ</option>
            <option value="finished">เล่นจบแล้ว</option>
            <option value="playing">กำลังเล่น</option>
            <option value="not_started">ยังไม่เริ่ม</option>
          </select>
          <span className="adm-table__sub">
            {loading && !data ? 'กำลังโหลด…' : `${total} คน`}
          </span>
        </div>

        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>ผู้เล่น</th>
                <th>ตำแหน่ง</th>
                <th>แผนก</th>
                <th>ปีที่เข้า</th>
                <th>ใบไขปริศนา</th>
                <th>เพื่อนร่วมทีม</th>
                <th>สถานะ</th>
                <th>อัปเดตล่าสุด</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!!error && !data && (
                <tr>
                  <td colSpan={9} className="adm-empty">
                    โหลดข้อมูลไม่สำเร็จ
                  </td>
                </tr>
              )}
              {!error && rows.map((p) => <PlayerRow key={p.player.id} p={p} />)}
              {!error && !loading && rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="adm-empty">
                    ไม่พบผู้เล่นที่ตรงกับเงื่อนไข
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PlayerRow({ p }: { p: AdminPlayerRow }) {
  const triviaCount = Object.keys(p.triviaStamps).length;
  const memberCount = p.teammateSlots.filter((s) => !s.isLeader).length;
  const hasLeader = p.teammateSlots.some((s) => s.isLeader);
  const total = Math.min(5, triviaCount) + Math.min(5, memberCount);
  const pct = (total / 10) * 100;

  return (
    <tr>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar
            initial={p.player.name.charAt(0).toUpperCase()}
            photoUrl={p.player.photoUrl}
            size={36}
            tone={p.player.isLeader ? 'blue' : 'flame'}
          />
          <div>
            <div className="adm-table__primary">{p.player.name}</div>
            {p.player.nickname ? (
              <div className="adm-table__sub">"{p.player.nickname}"</div>
            ) : (
              <div className="adm-table__id">{p.player.id}</div>
            )}
          </div>
        </div>
      </td>
      <td>
        {p.player.position ? (
          p.player.position
        ) : (
          <span className="adm-table__sub">—</span>
        )}
      </td>
      <td>{p.player.dept}</td>
      <td>{p.player.year}</td>
      <td>
        <span className="adm-players__count">
          <strong>{Math.min(5, triviaCount)}</strong>/5
        </span>
      </td>
      <td>
        <span className="adm-players__count">
          <strong>{Math.min(5, memberCount)}</strong>/5
        </span>
        {hasLeader && (
          <Pill tone="blue" className="adm-players__leader-pill">
            +หัวหน้า
          </Pill>
        )}
      </td>
      <td>
        {p.completedAt ? (
          <Pill tone="flame">จบแล้ว</Pill>
        ) : total === 0 ? (
          <Pill>ยังไม่เริ่ม</Pill>
        ) : (
          <span className="adm-players__pct">
            <span className="adm-progress-mini" aria-hidden="true">
              <span
                className="adm-progress-mini__fill"
                style={{ ['--pct' as never]: `${pct}%` }}
              />
            </span>
            <span className="adm-table__sub">{Math.round(pct)}%</span>
          </span>
        )}
      </td>
      <td className="adm-table__sub">{relTime(p.updatedAt)}</td>
      <td>
        <Link to={`/admin/players/${p.player.id}`} className="adm-link-btn">
          ดูรายละเอียด →
        </Link>
      </td>
    </tr>
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

function relTime(iso: string): string {
  const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return `${diffSec} วินาทีก่อน`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} นาทีก่อน`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} ชั่วโมงก่อน`;
  return `${Math.round(diffHr / 24)} วันก่อน`;
}
