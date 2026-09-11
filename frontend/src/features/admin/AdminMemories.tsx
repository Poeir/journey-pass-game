import { useState } from 'react';
import { Button } from '@/design-system/Button';
import { Pill } from '@/design-system/Pill';
import { adminEndpoints, type AdminMemory } from '@/api/endpoints';
import { useAdminData } from './useAdminData';
import './admin.css';
import './AdminMemories.css';

type KindFilter = 'all' | 'memory' | 'penalty';

export function AdminMemories() {
  const [kind, setKind] = useState<KindFilter>('all');
  const [picked, setPicked] = useState<AdminMemory | null>(null);
  const [acting, setActing] = useState(false);

  const { data, loading, error, reload } = useAdminData(
    () => adminEndpoints.listMemories(kind),
    [kind],
  );
  const items = data?.memories ?? [];

  const handleDelete = async (id: string) => {
    if (!window.confirm('ลบรูปนี้? ไม่สามารถย้อนได้')) return;
    setActing(true);
    try {
      await adminEndpoints.deleteMemory(id);
      setPicked(null);
      await reload();
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="adm-stack--lg">
      <header className="adm-page-head">
        <div className="adm-page-head__lead">
          <h1 className="adm-page-head__title">กำแพงความทรงจำ</h1>
          <p className="adm-page-head__subtitle">
            จัดการรูปภาพที่แสดงบนหน้ากำแพงความทรงจำสาธารณะ — รูปที่ไม่เหมาะสมสามารถลบออกได้ที่นี่
            (ระบบจะลบออกจากระบบจัดเก็บรูปด้วย)
          </p>
        </div>
      </header>

      <div className="adm-panel">
        <div className="adm-filter-bar">
          <select
            className="adm-select"
            value={kind}
            onChange={(e) => setKind(e.target.value as KindFilter)}
          >
            <option value="all">ทุกรูป</option>
            <option value="memory">เฉพาะรูปความทรงจำ</option>
            <option value="penalty">เฉพาะรูปลงโทษ</option>
          </select>
          <span className="adm-table__sub">
            {loading && !data ? 'กำลังโหลด…' : `${items.length} รูป`}
          </span>
        </div>

        {!!error && !data && <div className="adm-empty">โหลดข้อมูลไม่สำเร็จ</div>}

        {!error && items.length === 0 && !loading && (
          <div className="adm-empty">ไม่มีรูปในหมวดนี้</div>
        )}

        {items.length > 0 && (
          <div className="adm-photo-grid">
            {items.map((m) => (
              <button
                key={m.id}
                type="button"
                className="adm-memories__tile adm-photo-tile"
                onClick={() => setPicked(m)}
                style={
                  m.url
                    ? {
                        backgroundImage: `url(${JSON.stringify(m.url)})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }
                    : undefined
                }
              >
                <div className="adm-photo-tile__badge">
                  <Pill tone={m.contextKind === 'penalty' ? 'flame' : 'blue'}>
                    {m.contextKind === 'penalty' ? 'ลงโทษ' : 'ความทรงจำ'}
                  </Pill>
                </div>
                <div className="adm-memories__caption">
                  <strong>{m.uploader.name}</strong>
                  <span>+ {m.counterpart.name}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {picked && (
        <div
          className="adm-memories__modal"
          role="dialog"
          aria-modal="true"
          onClick={() => setPicked(null)}
        >
          <div className="adm-memories__modal-card" onClick={(e) => e.stopPropagation()}>
            <header className="adm-panel__head">
              <h2 className="adm-panel__title">รูป · {picked.id}</h2>
              <button className="adm-link-btn" onClick={() => setPicked(null)}>
                ปิด
              </button>
            </header>
            {picked.url ? (
              <img
                className="adm-memories__hero-img"
                src={picked.url}
                alt="memory"
              />
            ) : (
              <div className="adm-photo-tile adm-memories__hero" />
            )}
            <dl className="adm-memories__meta">
              <div>
                <dt>ผู้อัปโหลด</dt>
                <dd>
                  {picked.uploader.name}{' '}
                  <span className="adm-table__id">{picked.uploader.id}</span>
                </dd>
              </div>
              <div>
                <dt>คู่ในรูป</dt>
                <dd>
                  {picked.counterpart.name}{' '}
                  <span className="adm-table__id">{picked.counterpart.id}</span>
                </dd>
              </div>
              <div>
                <dt>ประเภทรูป</dt>
                <dd>
                  {picked.contextKind === 'penalty' ? 'ลงโทษ' : 'ความทรงจำ'}
                  <span className="adm-table__id"> · {picked.contextId}</span>
                </dd>
              </div>
            </dl>
            <div className="adm-row-actions" style={{ justifyContent: 'flex-end' }}>
              <Button
                color="flame"
                disabled={acting}
                onClick={() => handleDelete(picked.id)}
              >
                ลบรูป
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
