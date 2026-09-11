import { useState } from 'react';
import { Button } from '@/design-system/Button';
import { Pill } from '@/design-system/Pill';
import { adminEndpoints } from '@/api/endpoints';
import { useAdminData } from './useAdminData';
import './admin.css';
import './AdminPairs.css';

type Filter = 'pending' | 'confirmed' | 'all';
type KindFilter = 'all' | 'TRIVIA' | 'TEAMMATE';

export function AdminPairs() {
  const [filter, setFilter] = useState<Filter>('pending');
  const [kind, setKind] = useState<KindFilter>('all');
  const [acting, setActing] = useState<string | null>(null);

  const { data, loading, error, reload } = useAdminData(
    () => adminEndpoints.listPairs(filter, kind),
    [filter, kind],
  );
  const rows = data?.pairs ?? [];

  const handleForceClear = async (id: string) => {
    if (!window.confirm('ปลดคู่นี้? ผู้สแกนจะหลุดจากหน้ารอลงโทษโดยอัตโนมัติ')) return;
    setActing(id);
    try {
      await adminEndpoints.forceClearPair(id);
      await reload();
    } finally {
      setActing(null);
    }
  };

  return (
    <div className="adm-stack--lg">
      <header className="adm-page-head">
        <div className="adm-page-head__lead">
          <h1 className="adm-page-head__title">คู่ลงโทษ</h1>
          <p className="adm-page-head__subtitle">
            รอบลงโทษที่ยังค้างอยู่ — ถ้าผู้ถูกสแกนอัปรูปไม่ได้
            ผู้ดูแลสามารถปลดคู่เพื่อให้ผู้สแกนเล่นต่อได้ที่นี่
          </p>
        </div>
      </header>

      <div className="adm-panel">
        <div className="adm-filter-bar">
          <select
            className="adm-select"
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
          >
            <option value="pending">เฉพาะที่ค้าง</option>
            <option value="confirmed">เฉพาะที่ปิดรอบแล้ว</option>
            <option value="all">ทั้งหมด</option>
          </select>
          <select
            className="adm-select"
            value={kind}
            onChange={(e) => setKind(e.target.value as KindFilter)}
          >
            <option value="all">ทุกประเภท</option>
            <option value="TRIVIA">ใบไขปริศนา</option>
            <option value="TEAMMATE">เพื่อนร่วมทีม</option>
          </select>
          <span className="adm-table__sub">
            {loading && !data ? 'กำลังโหลด…' : `${rows.length} คู่`}
          </span>
        </div>

        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>รหัสคู่</th>
                <th>ประเภท</th>
                <th>ผู้สแกน</th>
                <th>ผู้ถูกสแกน</th>
                <th>สถานะ</th>
                <th>เริ่มเมื่อ</th>
                <th>บทลงโทษ</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {!!error && !data && (
                <tr>
                  <td colSpan={8} className="adm-empty">
                    โหลดข้อมูลไม่สำเร็จ
                  </td>
                </tr>
              )}
              {!error &&
                rows.map((p) => (
                  <tr key={p.id} className={p.targetConfirmed ? '' : 'adm-pairs__pending'}>
                    <td className="adm-table__id">{p.id}</td>
                    <td>
                      <Pill tone={p.kind === 'TRIVIA' ? 'flame' : 'blue'}>
                        {p.kind === 'TRIVIA' ? 'ใบไขปริศนา' : 'เพื่อนร่วมทีม'}
                      </Pill>
                    </td>
                    <td>
                      <div className="adm-table__primary">{p.hunter?.name ?? '?'}</div>
                      <div className="adm-table__id">{p.hunter?.id}</div>
                    </td>
                    <td>
                      <div className="adm-table__primary">{p.target?.name ?? '?'}</div>
                      <div className="adm-table__id">{p.target?.id}</div>
                    </td>
                    <td>
                      {p.targetConfirmed ? (
                        <Pill tone="ink">ปิดรอบแล้ว</Pill>
                      ) : (
                        <Pill tone="flame">ค้าง</Pill>
                      )}
                      {p.proofPhotoUrl && (
                        <a
                          href={p.proofPhotoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="adm-link-btn"
                          style={{ marginLeft: 8 }}
                        >
                          ดูรูป
                        </a>
                      )}
                    </td>
                    <td className="adm-table__sub">{relTime(p.createdAt)}</td>
                    <td className="adm-table__id">{p.penalty?.text ?? '—'}</td>
                    <td>
                      {!p.targetConfirmed && (
                        <Button
                          variant="secondary"
                          color="ink"
                          disabled={acting === p.id}
                          onClick={() => handleForceClear(p.id)}
                        >
                          ปลดคู่
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              {!error && !loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="adm-empty">
                    ไม่มีคู่ที่ตรงกับเงื่อนไข
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

function relTime(iso: string): string {
  const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return `${diffSec} วินาทีก่อน`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} นาทีก่อน`;
  return `${Math.round(diffMin / 60)} ชั่วโมงก่อน`;
}
