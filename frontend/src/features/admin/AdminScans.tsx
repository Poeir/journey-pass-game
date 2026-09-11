import { useEffect, useState } from 'react';
import { Pill } from '@/design-system/Pill';
import { adminEndpoints } from '@/api/endpoints';
import { useAdminData } from './useAdminData';
import './admin.css';
import './AdminScans.css';

type ModeFilter = 'all' | 'TRIVIA' | 'TEAMMATE';
type OutcomeFilter = 'all' | 'MATCH' | 'MISMATCH';

export function AdminScans() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [mode, setMode] = useState<ModeFilter>('all');
  const [outcome, setOutcome] = useState<OutcomeFilter>('all');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data, loading, error } = useAdminData(
    () =>
      adminEndpoints.listScans({
        q: debouncedQuery || undefined,
        mode,
        outcome,
        limit: 100,
      }),
    [debouncedQuery, mode, outcome],
  );
  const rows = data?.scans ?? [];

  return (
    <div className="adm-stack--lg">
      <header className="adm-page-head">
        <div className="adm-page-head__lead">
          <h1 className="adm-page-head__title">บันทึกการสแกน</h1>
          <p className="adm-page-head__subtitle">
            ประวัติการสแกนทั้งหมด หมายเหตุ: กรณีสแกนซ้ำคนเดิม, สแกนผิดหัวหน้า,
            หรือรายชื่อเต็มแล้ว จะไม่ถูกบันทึกในตารางนี้
          </p>
        </div>
      </header>

      <div className="adm-panel">
        <div className="adm-filter-bar">
          <label className="adm-search">
            <SearchIcon />
            <input
              className="adm-search__input"
              type="search"
              placeholder="ชื่อผู้เล่น, รหัส, รหัสการ์ด…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            className="adm-select"
            value={mode}
            onChange={(e) => setMode(e.target.value as ModeFilter)}
          >
            <option value="all">ทุกโหมด</option>
            <option value="TRIVIA">ใบไขปริศนา</option>
            <option value="TEAMMATE">เพื่อนร่วมทีม</option>
          </select>
          <select
            className="adm-select"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as OutcomeFilter)}
          >
            <option value="all">ทุกผลลัพธ์</option>
            <option value="MATCH">ตรง</option>
            <option value="MISMATCH">พลาด</option>
          </select>
          <span className="adm-table__sub">
            {loading && !data ? 'กำลังโหลด…' : `${rows.length} แถว`}
          </span>
        </div>

        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>เวลา</th>
                <th>โหมด</th>
                <th>ผู้สแกน</th>
                <th>ผู้ถูกสแกน</th>
                <th>การ์ด</th>
                <th>ผลลัพธ์</th>
                <th>รหัสคู่</th>
              </tr>
            </thead>
            <tbody>
              {!!error && !data && (
                <tr>
                  <td colSpan={7} className="adm-empty">
                    โหลดข้อมูลไม่สำเร็จ
                  </td>
                </tr>
              )}
              {!error &&
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="adm-table__sub">{formatTime(r.createdAt)}</td>
                    <td>
                      <Pill tone={r.mode === 'TRIVIA' ? 'flame' : 'blue'}>
                        {r.mode === 'TRIVIA' ? 'ใบไขปริศนา' : 'เพื่อนร่วมทีม'}
                      </Pill>
                    </td>
                    <td>
                      <div className="adm-table__primary">{r.scanner.name}</div>
                      <div className="adm-table__id">{r.scanner.id}</div>
                    </td>
                    <td>
                      <div className="adm-table__primary">{r.target.name}</div>
                      <div className="adm-table__id">{r.target.id}</div>
                    </td>
                    <td className="adm-table__id">{r.cardRef ?? '—'}</td>
                    <td>
                      <span
                        className={`adm-scans__outcome adm-scans__outcome--${r.outcome.toLowerCase()}`}
                      >
                        {r.outcome === 'MATCH' ? 'ตรง' : 'พลาด'}
                      </span>
                    </td>
                    <td className="adm-table__id">{r.pairId ?? '—'}</td>
                  </tr>
                ))}
              {!error && !loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="adm-empty">
                    ไม่พบรายการที่ตรงกับเงื่อนไข
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

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d
    .getMinutes()
    .toString()
    .padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}
