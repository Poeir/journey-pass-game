import { useEffect, useState } from 'react';
import { Button } from '@/design-system/Button';
import { Pill } from '@/design-system/Pill';
import {
  adminEndpoints,
  type AdminPenalty,
  type AdminPhotoPlace,
} from '@/api/endpoints';
import { useAdminData } from './useAdminData';
import './admin.css';
import './AdminSettings.css';

export function AdminSettings() {
  const penaltyData = useAdminData(() => adminEndpoints.listPenalties());
  const placeData = useAdminData(() => adminEndpoints.listPhotoPlaces());
  const penalties = penaltyData.data?.penalties ?? [];
  const places = placeData.data?.places ?? [];

  return (
    <div className="adm-stack--lg">
      <header className="adm-page-head">
        <div className="adm-page-head__lead">
          <h1 className="adm-page-head__title">ตั้งค่าเกม</h1>
          <p className="adm-page-head__subtitle">
            ค่าคงที่ต่างๆ ของเกม — บางส่วนแก้ผ่านหน้านี้ได้ทันที
            บางส่วนต้องให้ทีมเทคนิคปรับให้
          </p>
        </div>
      </header>

      <PenaltySection
        penalties={penalties}
        loading={penaltyData.loading && !penaltyData.data}
        error={!!penaltyData.error && !penaltyData.data}
        reload={penaltyData.reload}
      />

      <PhotoPlaceSection
        places={places}
        loading={placeData.loading && !placeData.data}
        error={!!placeData.error && !placeData.data}
        reload={placeData.reload}
      />

      <ReadOnlySection />
    </div>
  );
}

interface PenaltySectionProps {
  penalties: AdminPenalty[];
  loading: boolean;
  error: boolean;
  reload: () => void;
}

function PenaltySection({ penalties, loading, error, reload }: PenaltySectionProps) {
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [acting, setActing] = useState(false);

  const handleAdd = async () => {
    const text = draft.trim();
    if (!text) return;
    setAdding(true);
    try {
      await adminEndpoints.createPenalty({ text });
      setDraft('');
      await reload();
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (p: AdminPenalty) => {
    const msg =
      p.usedCount > 0
        ? `ลบ "${p.text}"? (เคยใช้ในรอบลงโทษ ${p.usedCount} ครั้ง — ข้อความจะหายจากรอบเก่าด้วย)`
        : `ลบ "${p.text}"?`;
    if (!window.confirm(msg)) return;
    setActing(true);
    try {
      await adminEndpoints.deletePenalty(p.id);
      await reload();
    } finally {
      setActing(false);
    }
  };

  return (
    <section className="adm-panel">
      <header className="adm-panel__head">
        <h2 className="adm-panel__title">รายการบทลงโทษ</h2>
        <span className="adm-table__sub">
          {loading ? 'กำลังโหลด…' : `${penalties.length} รายการ`}
        </span>
      </header>
      <div className="adm-callout adm-callout--info">
        <span className="adm-callout__icon">i</span>
        <span>
          หน้าลงโทษของผู้เล่นจะสุ่มข้อความจากรายการนี้ — เพิ่ม/แก้/ลบที่นี่ได้ทันที
          (รอบที่ใช้ข้อความที่ถูกลบไปแล้วจะแสดงเป็น "ไม่มีข้อความ")
        </span>
      </div>

      {error && <div className="adm-empty">โหลดข้อมูลไม่สำเร็จ</div>}

      {!error && (
        <ol className="adm-settings__penalty-list">
          {penalties.map((p, i) => (
            <PenaltyRow
              key={p.id}
              penalty={p}
              index={i}
              acting={acting}
              onChanged={reload}
              onDelete={() => handleDelete(p)}
            />
          ))}
        </ol>
      )}

      <div className="adm-settings__penalty-add">
        <input
          className="adm-input"
          placeholder="เพิ่มบทลงโทษใหม่…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleAdd();
            }
          }}
          disabled={adding}
        />
        <Button color="ink" disabled={adding || !draft.trim()} onClick={handleAdd}>
          {adding ? 'กำลังเพิ่ม…' : 'เพิ่ม'}
        </Button>
      </div>
    </section>
  );
}

interface PenaltyRowProps {
  penalty: AdminPenalty;
  index: number;
  acting: boolean;
  onChanged: () => void;
  onDelete: () => void;
}

function PenaltyRow({ penalty, index, acting, onChanged, onDelete }: PenaltyRowProps) {
  const [text, setText] = useState(penalty.text);
  const [saving, setSaving] = useState(false);

  // Resync local state if the upstream row changes (e.g. after a successful save
  // that returns a new shape, or another tab edits the same row).
  useEffect(() => {
    setText(penalty.text);
  }, [penalty.text]);

  const dirty = text.trim() !== penalty.text && text.trim().length > 0;

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      await adminEndpoints.updatePenalty(penalty.id, { text: text.trim() });
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="adm-settings__penalty-row">
      <span className="adm-settings__penalty-idx">{index + 1}</span>
      <input
        className="adm-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void save();
          }
          if (e.key === 'Escape') {
            setText(penalty.text);
          }
        }}
        disabled={saving || acting}
      />
      <div className="adm-row-actions">
        {penalty.usedCount > 0 && (
          <Pill tone="ink" title={`เคยใช้ ${penalty.usedCount} ครั้ง`}>
            ใช้ {penalty.usedCount}×
          </Pill>
        )}
        {dirty && !saving && (
          <button type="button" className="adm-link-btn" onClick={save}>
            บันทึก
          </button>
        )}
        {saving && <span className="adm-table__sub">กำลังบันทึก…</span>}
        <button
          type="button"
          className="adm-link-btn adm-link-btn--danger"
          onClick={onDelete}
          disabled={saving || acting}
        >
          ลบ
        </button>
      </div>
    </li>
  );
}

interface PhotoPlaceSectionProps {
  places: AdminPhotoPlace[];
  loading: boolean;
  error: boolean;
  reload: () => void;
}

function PhotoPlaceSection({ places, loading, error, reload }: PhotoPlaceSectionProps) {
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [acting, setActing] = useState(false);

  const handleAdd = async () => {
    const text = draft.trim();
    if (!text) return;
    setAdding(true);
    try {
      await adminEndpoints.createPhotoPlace({ text });
      setDraft('');
      await reload();
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (p: AdminPhotoPlace) => {
    if (!window.confirm(`ลบ "${p.text}"?`)) return;
    setActing(true);
    try {
      await adminEndpoints.deletePhotoPlace(p.id);
      await reload();
    } finally {
      setActing(false);
    }
  };

  return (
    <section className="adm-panel">
      <header className="adm-panel__head">
        <h2 className="adm-panel__title">ตำแหน่งถ่ายรูป</h2>
        <span className="adm-table__sub">
          {loading ? 'กำลังโหลด…' : `${places.length} ตำแหน่ง`}
        </span>
      </header>
      <div className="adm-callout adm-callout--info">
        <span className="adm-callout__icon">i</span>
        <span>
          ระบบจะสุ่มแสดงคำแนะนำตำแหน่งถ่ายรูปในหน้าสำเร็จก่อนผู้เล่นถ่ายรูปความทรงจำ —
          ลบได้อิสระ ถ้ารายการว่าง ระบบจะใช้รายการสำรองภายในแอปแทน
        </span>
      </div>

      {error && <div className="adm-empty">โหลดข้อมูลไม่สำเร็จ</div>}

      {!error && (
        <ol className="adm-settings__penalty-list">
          {places.map((p, i) => (
            <PhotoPlaceRow
              key={p.id}
              place={p}
              index={i}
              acting={acting}
              onChanged={reload}
              onDelete={() => handleDelete(p)}
            />
          ))}
        </ol>
      )}

      <div className="adm-settings__penalty-add">
        <input
          className="adm-input"
          placeholder="เพิ่มตำแหน่งถ่ายรูปใหม่…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleAdd();
            }
          }}
          disabled={adding}
        />
        <Button color="ink" disabled={adding || !draft.trim()} onClick={handleAdd}>
          {adding ? 'กำลังเพิ่ม…' : 'เพิ่ม'}
        </Button>
      </div>
    </section>
  );
}

interface PhotoPlaceRowProps {
  place: AdminPhotoPlace;
  index: number;
  acting: boolean;
  onChanged: () => void;
  onDelete: () => void;
}

function PhotoPlaceRow({ place, index, acting, onChanged, onDelete }: PhotoPlaceRowProps) {
  const [text, setText] = useState(place.text);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setText(place.text);
  }, [place.text]);

  const dirty = text.trim() !== place.text && text.trim().length > 0;

  const save = async () => {
    if (!dirty) return;
    setSaving(true);
    try {
      await adminEndpoints.updatePhotoPlace(place.id, { text: text.trim() });
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  return (
    <li className="adm-settings__penalty-row">
      <span className="adm-settings__penalty-idx">{index + 1}</span>
      <input
        className="adm-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void save();
          }
          if (e.key === 'Escape') {
            setText(place.text);
          }
        }}
        disabled={saving || acting}
      />
      <div className="adm-row-actions">
        {dirty && !saving && (
          <button type="button" className="adm-link-btn" onClick={save}>
            บันทึก
          </button>
        )}
        {saving && <span className="adm-table__sub">กำลังบันทึก…</span>}
        <button
          type="button"
          className="adm-link-btn adm-link-btn--danger"
          onClick={onDelete}
          disabled={saving || acting}
        >
          ลบ
        </button>
      </div>
    </li>
  );
}

function ReadOnlySection() {
  return (
    <section className="adm-panel">
      <header className="adm-panel__head">
        <h2 className="adm-panel__title">ค่าคงที่อื่นๆ (อ่านอย่างเดียว)</h2>
        <span className="adm-table__sub">ตั้งค่าตายตัวในระบบ — แก้ผ่านหน้านี้ไม่ได้</span>
      </header>
      <div className="adm-callout adm-callout--info">
        <span className="adm-callout__icon">i</span>
        <span>
          ค่าเหล่านี้เป็นค่าออกแบบเกมที่ตั้งครั้งเดียวต่ออีเวนต์
          การเปลี่ยนกลางเกมจะทำให้ผู้เล่นที่เก็บครบจำนวนเดิมอยู่แล้วสับสน —
          หากต้องการเปลี่ยน กรุณาแจ้งทีมเทคนิค
        </span>
      </div>
      <div className="adm-form-row">
        <div>
          <label className="adm-form-row__label">จำนวนการ์ดใบไขปริศนาต่อคน</label>
          <div className="adm-form-row__hint">
            จำนวนการ์ดที่ระบบสุ่มให้ผู้เล่นแต่ละคนในภารกิจใบไขปริศนา
          </div>
        </div>
        <code className="adm-game__readonly">5</code>
      </div>
      <div className="adm-form-row">
        <div>
          <label className="adm-form-row__label">จำนวนเพื่อนร่วมทีมที่ต้องการ</label>
          <div className="adm-form-row__hint">
            จำนวนลูกทีม (ไม่นับหัวหน้า) ที่ต้องเก็บให้ครบเพื่อจบเกม
          </div>
        </div>
        <code className="adm-game__readonly">5</code>
      </div>
      <div className="adm-form-row">
        <div>
          <label className="adm-form-row__label">ช่องหัวหน้า (โบนัส)</label>
          <div className="adm-form-row__hint">
            ฟีเจอร์เปิดถาวร — ผู้เล่นจะเห็นช่องหัวหน้าทุกคน
            จะเก็บหรือไม่ก็ได้ (ไม่นับรวมในจำนวนภารกิจ)
          </div>
        </div>
        <Pill tone="flame">เปิด</Pill>
      </div>
    </section>
  );
}
