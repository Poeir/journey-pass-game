import { useEffect, useRef, useState } from 'react';
import { Avatar } from '@/design-system/Avatar';
import { Button } from '@/design-system/Button';
import { Pill } from '@/design-system/Pill';
import { Sheet } from '@/design-system/Sheet';
import {
  adminEndpoints,
  type AdminEmployee,
  type CsvImportResult,
  type EmpeoSyncFilter,
  type EmpeoSyncResult,
} from '@/api/endpoints';
import { ApiError } from '@/api/client';
import { useAdminData } from './useAdminData';
import empeoLogo from '../../../assets/empeo-logo.webp';
import './admin.css';
import './AdminEmployees.css';

function EmpeoLogo({ height = 16 }: { height?: number }) {
  return (
    <img
      src={empeoLogo}
      alt="empeo"
      style={{ height, width: 'auto', verticalAlign: 'middle' }}
    />
  );
}

type RoleFilter = 'all' | 'leaders' | 'members';

export function AdminEmployees() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [filter, setFilter] = useState<RoleFilter>('all');
  const [editing, setEditing] = useState<AdminEmployee | null>(null);
  const [creating, setCreating] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [acting, setActing] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data, loading, error, reload } = useAdminData(
    () => adminEndpoints.listEmployees(debouncedQuery || undefined, filter),
    [debouncedQuery, filter],
  );

  const rows = data?.employees ?? [];

  const handleDelete = async (e: AdminEmployee) => {
    if (!window.confirm(`ลบ ${e.name} (${e.id}) ?`)) return;
    setActing(true);
    try {
      await adminEndpoints.deleteEmployee(e.id);
      await reload();
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="adm-stack--lg">
      <header className="adm-page-head">
        <div className="adm-page-head__lead">
          <h1 className="adm-page-head__title">พนักงาน</h1>
          <p className="adm-page-head__subtitle">
            แหล่งข้อมูลหลักของรายชื่อพนักงาน — แก้ไขได้ทันทีโดยไม่ต้องอัปเดตระบบ
          </p>
        </div>
        <div className="adm-page-head__actions">
          <Button variant="secondary" color="ink" onClick={() => setImporting(true)}>
            นำเข้าจาก CSV
          </Button>
          <Button variant="secondary" color="ink" onClick={() => setSyncing(true)}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              ซิงก์จาก <EmpeoLogo height={14} /> (บริษัท โกไฟว์ จำกัด)
            </span>
          </Button>
          <Button color="flame" onClick={() => setCreating(true)}>
            + เพิ่มพนักงาน
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
              placeholder="ชื่อ, รหัส, แผนก…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            className="adm-select"
            value={filter}
            onChange={(e) => setFilter(e.target.value as RoleFilter)}
          >
            <option value="all">ทั้งหมด</option>
            <option value="leaders">เฉพาะหัวหน้า</option>
            <option value="members">เฉพาะลูกทีม</option>
          </select>
          <span className="adm-table__sub">
            {loading && !data ? 'กำลังโหลด…' : `${rows.length} คน`}
          </span>
        </div>

        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>รหัส</th>
                <th>ชื่อ</th>
                <th>ตำแหน่ง</th>
                <th>แผนก</th>
                <th>ปี</th>
                <th>บทบาท</th>
                <th>คำใบ้สำหรับลูกทีม</th>
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
                rows.map((e) => (
                  <tr key={e.id}>
                    <td className="adm-table__id">{e.id}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Avatar
                          initial={e.name.charAt(0).toUpperCase()}
                          photoUrl={e.photoUrl}
                          size={36}
                          tone={e.isLeader ? 'blue' : 'flame'}
                        />
                        <div>
                          <div className="adm-table__primary">{e.name}</div>
                          {e.nickname && <div className="adm-table__sub">"{e.nickname}"</div>}
                        </div>
                      </div>
                    </td>
                    <td>
                      {e.position ? (
                        e.position
                      ) : (
                        <span className="adm-table__sub">—</span>
                      )}
                    </td>
                    <td>{e.dept}</td>
                    <td>{e.year}</td>
                    <td>
                      {e.isLeader ? <Pill tone="blue">หัวหน้า</Pill> : <Pill>ลูกทีม</Pill>}
                    </td>
                    <td className="adm-employees__clue">
                      {e.leaderClue ? (
                        <span className="adm-table__sub">{e.leaderClue}</span>
                      ) : (
                        <span className="adm-table__sub">—</span>
                      )}
                    </td>
                    <td>
                      <div className="adm-row-actions">
                        <button className="adm-link-btn" onClick={() => setEditing(e)}>
                          แก้ไข
                        </button>
                        <button
                          className="adm-link-btn adm-link-btn--danger"
                          disabled={acting}
                          onClick={() => handleDelete(e)}
                        >
                          ลบ
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              {!error && !loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="adm-empty">
                    ไม่พบพนักงานที่ตรงกับเงื่อนไข
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Sheet
        open={!!editing || creating}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        title={creating ? 'เพิ่มพนักงานใหม่' : `แก้ไข · ${editing?.name ?? ''}`}
        position="center"
        size="lg"
      >
        <EmployeeForm
          employee={editing ?? undefined}
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

      <Sheet
        open={syncing}
        onClose={() => setSyncing(false)}
        title="ซิงก์จาก empeo · บริษัท โกไฟว์ จำกัด"
        position="center"
        size="lg"
      >
        <SyncForm
          onClose={() => setSyncing(false)}
          onDone={() => reload()}
        />
      </Sheet>

      <Sheet
        open={importing}
        onClose={() => setImporting(false)}
        title="นำเข้าพนักงานจากไฟล์ CSV"
        position="center"
        size="lg"
      >
        <CsvImportForm
          onClose={() => setImporting(false)}
          onDone={() => reload()}
        />
      </Sheet>
    </div>
  );
}

function EmployeeForm({
  employee,
  onClose,
  onSaved,
}: {
  employee?: AdminEmployee;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isCreate = !employee;
  const [form, setForm] = useState<Partial<AdminEmployee>>(
    employee ?? {
      id: '',
      name: '',
      dept: '',
      year: new Date().getFullYear(),
      isLeader: false,
    },
  );
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof AdminEmployee>(k: K, v: AdminEmployee[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.id || !form.name || !form.dept) {
      setErr('กรุณากรอก รหัส, ชื่อ และแผนก');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      if (isCreate) {
        await adminEndpoints.createEmployee(form);
      } else {
        const { id, ...rest } = form;
        await adminEndpoints.updateEmployee(employee.id, rest);
        void id;
      }
      onSaved();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'duplicate_email') {
        setErr('อีเมลนี้ถูกใช้กับพนักงานคนอื่นอยู่แล้ว — ใช้อีเมลอื่น');
      } else if (error instanceof ApiError && error.code === 'duplicate_id') {
        setErr('รหัสพนักงานนี้มีอยู่แล้ว');
      } else {
        setErr('บันทึกไม่สำเร็จ — กรุณาลองใหม่');
      }
      console.error(error);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="adm-stack" onSubmit={submit}>
      <div className="adm-form-row">
        <label className="adm-form-row__label">รหัสพนักงาน</label>
        <input
          className="adm-input"
          value={form.id ?? ''}
          onChange={(e) => set('id', e.target.value)}
          placeholder="EMP-1234"
          disabled={!isCreate}
        />
      </div>
      <div className="adm-form-row">
        <label className="adm-form-row__label">ชื่อ-นามสกุล</label>
        <input
          className="adm-input"
          value={form.name ?? ''}
          onChange={(e) => set('name', e.target.value)}
        />
      </div>
      <div className="adm-form-row">
        <label className="adm-form-row__label">ชื่อเล่น</label>
        <input
          className="adm-input"
          value={form.nickname ?? ''}
          onChange={(e) => set('nickname', e.target.value)}
        />
      </div>
      <div className="adm-form-row">
        <label className="adm-form-row__label">ตำแหน่ง</label>
        <input
          className="adm-input"
          value={form.position ?? ''}
          onChange={(e) => set('position', e.target.value || null)}
          placeholder="Software Engineer"
        />
      </div>
      <div className="adm-form-row">
        <div>
          <label className="adm-form-row__label">อีเมล</label>
          <div className="adm-form-row__hint">
            ต้องตรงกับอีเมลที่ Microsoft Azure SSO ส่งคืน — ถ้าไม่ตรงผู้เล่นคนนี้จะ login ไม่ได้
            (เคสที่อีเมลใน empeo กับ Azure ไม่ตรงกัน ให้กรอกอันที่ Azure ใช้)
          </div>
        </div>
        <input
          className="adm-input"
          type="email"
          value={form.email ?? ''}
          onChange={(e) => set('email', e.target.value || null)}
          placeholder="name@example.com"
        />
      </div>
      <div className="adm-form-row">
        <label className="adm-form-row__label">รูปโปรไฟล์ (URL)</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="adm-input"
            type="url"
            value={form.photoUrl ?? ''}
            onChange={(e) => set('photoUrl', e.target.value || null)}
            placeholder="https://..."
            style={{ flex: 1 }}
          />
          {form.photoUrl && (
            <img
              src={form.photoUrl}
              alt=""
              width={40}
              height={40}
              style={{ borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--gray-8)' }}
              referrerPolicy="no-referrer"
            />
          )}
        </div>
      </div>
      <div className="adm-form-row">
        <label className="adm-form-row__label">แผนก</label>
        <input
          className="adm-input"
          value={form.dept ?? ''}
          onChange={(e) => set('dept', e.target.value)}
        />
      </div>
      <div className="adm-form-row">
        <label className="adm-form-row__label">ปีที่เข้าทำงาน</label>
        <input
          className="adm-input"
          type="number"
          value={form.year ?? new Date().getFullYear()}
          onChange={(e) => set('year', Number(e.target.value))}
        />
      </div>
      <div className="adm-form-row">
        <label className="adm-form-row__label">บทบาท</label>
        <label className="adm-employees__check">
          <input
            type="checkbox"
            checked={!!form.isLeader}
            onChange={(e) => set('isLeader', e.target.checked)}
          />
          <span>กำหนดเป็นหัวหน้าทีม</span>
        </label>
      </div>
      {form.isLeader && (
        <div className="adm-form-row">
          <div>
            <label className="adm-form-row__label">คำใบ้สำหรับลูกทีม</label>
            <div className="adm-form-row__hint">
              คำใบ้ที่จะแสดงในหน้าแนะนำภารกิจเพื่อนร่วมทีม ให้ลูกทีมที่ถูกมอบหมายมาเจอหัวหน้าคนนี้
            </div>
          </div>
          <textarea
            className="adm-textarea"
            value={form.leaderClue ?? ''}
            onChange={(e) => set('leaderClue', e.target.value)}
            placeholder="ทีมของเขา standup เสียงดังที่สุด…"
          />
        </div>
      )}
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

// Backend filter is "empty array on an axis = don't filter that axis", so
// unchecking everything in a group means "include all statuses" / "include
// all types" rather than "include none". Default: ทุกสถานะที่ยังทำงานอยู่
// (บรรจุ + ทดลองงาน + รอเริ่มงาน) × ประจำ + ฝึกงาน — covers everyone who
// should plausibly join the event. Excludes พ้นสภาพ (terminated).
const STATUS_OPTIONS: Array<{ id: number; label: string }> = [
  { id: 1, label: 'ทดลองงาน (probation)' },
  { id: 2, label: 'บรรจุ (active)' },
  { id: 4, label: 'รอเริ่มงาน (waiting start)' },
  { id: 3, label: 'พ้นสภาพ (terminated)' },
];
const TYPE_OPTIONS: Array<{ id: number; label: string }> = [
  { id: 2161, label: 'ประจำ (permanent)' },
  { id: 2158, label: 'ฝึกงาน (trainee)' },
  { id: 2159, label: 'ชั่วคราว (temporary)' },
  { id: 2157, label: 'พาร์ทไทม์ (part-time)' },
];

const RANK_PREFIXES = ['O', 'M', 'S', 'T'];

function SyncForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  // Default ติ๊ก: สถานะที่ยังทำงานอยู่จริง (รวมทดลองงาน + รอเริ่มงาน) ×
  // ประจำ + ฝึกงาน. พ้นสภาพถูกตัดออก default เพื่อกัน admin เผลอดึงคนลาออก
  // 700+ คนเข้ามาเต็มเกม
  const [statusIds, setStatusIds] = useState<number[]>([1, 2, 4]);
  const [typeIds, setTypeIds] = useState<number[]>([2161, 2158]);
  const [orgLevel3Text, setOrgLevel3Text] = useState('');
  const [yearMin, setYearMin] = useState('');
  const [yearMax, setYearMax] = useState('');
  const [ranks, setRanks] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<EmpeoSyncResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [redistributing, setRedistributing] = useState(false);
  const [redistributeResult, setRedistributeResult] = useState<{
    totalPlayers: number;
    leaderCount: number;
  } | null>(null);
  const [redistributeErr, setRedistributeErr] = useState<string | null>(null);
  const [redistributeDismissed, setRedistributeDismissed] = useState(false);

  const toggleNumber = (cur: number[], id: number) =>
    cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  const toggleRank = (r: string) =>
    setRanks((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]));

  const buildFilter = (): EmpeoSyncFilter => {
    const base: EmpeoSyncFilter = {};
    if (statusIds.length) base.statusIds = statusIds;
    if (typeIds.length) base.typeIds = typeIds;
    const orgLevel3 = orgLevel3Text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (orgLevel3.length) base.orgLevel3 = orgLevel3;
    const ymin = yearMin ? parseInt(yearMin, 10) : NaN;
    const ymax = yearMax ? parseInt(yearMax, 10) : NaN;
    if (!Number.isNaN(ymin)) base.hiredYearMin = ymin;
    if (!Number.isNaN(ymax)) base.hiredYearMax = ymax;
    if (ranks.length) base.rankPrefixes = ranks;
    return base;
  };

  const submit = async () => {
    setSubmitting(true);
    setErr(null);
    setResult(null);
    setRedistributeResult(null);
    setRedistributeErr(null);
    setRedistributeDismissed(false);
    try {
      const r = await adminEndpoints.syncEmployees(buildFilter());
      setResult(r);
    } catch (e) {
      console.error(e);
      setErr('ซิงก์ไม่สำเร็จ — ตรวจสอบ HR API หรือลองใหม่');
    } finally {
      setSubmitting(false);
    }
  };

  const runRedistribute = async () => {
    setRedistributing(true);
    setRedistributeErr(null);
    try {
      const r = await adminEndpoints.redistributeLeaders();
      setRedistributeResult({ totalPlayers: r.totalPlayers, leaderCount: r.leaderCount });
    } catch (e) {
      console.error(e);
      setRedistributeErr('สุ่มไม่สำเร็จ — ตรวจสอบว่ามีหัวหน้าในระบบหรือยัง');
    } finally {
      setRedistributing(false);
    }
  };

  const promptHasRosterChange =
    !!result && (result.added.length > 0 || result.updated.length > 0);
  const promptOpen =
    promptHasRosterChange && !redistributeDismissed;

  const closePrompt = () => {
    if (redistributing) return;
    setRedistributeDismissed(true);
  };

  const close = () => {
    if (result) onDone();
    onClose();
  };

  return (
    <div className="adm-stack">
      <div className="adm-callout">
        <span className="adm-callout__icon">i</span>
        <div className="adm-stack">
          <div><strong>การซิงก์ทำงานยังไง</strong></div>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li>
              ดึงรายชื่อพนักงานทั้งหมดจากระบบ Empeo ของ <strong>บริษัท โกไฟว์ จำกัด</strong>
              {' '}(เฉพาะ tenant นี้เท่านั้น — บริษัทอื่นในเครือไม่อยู่ใน scope)
            </li>
            <li>เลือกเฉพาะคนที่ตรงกับเงื่อนไขที่ตั้งไว้ด้านล่าง</li>
            <li>เทียบกับรายชื่อในเกมตอนนี้ แล้วแยกเป็น 3 กลุ่ม:
              <ul style={{ margin: '4px 0 0 0', paddingLeft: 18 }}>
                <li><strong>เพิ่มใหม่</strong> — คนที่ Empeo มี แต่ในเกมยังไม่มี → เพิ่มเข้าไป</li>
                <li><strong>อัปเดต</strong> — คนที่อยู่ทั้งสองที่ แต่ข้อมูลไม่ตรง → แก้ให้เหมือนกับ Empeo</li>
                <li><strong>ไม่พบในรายชื่อ Empeo</strong> — คนที่อยู่ในเกมแต่ Empeo ไม่มี → <em>บอกให้รู้เฉย ๆ ไม่มีการลบ</em></li>
              </ul>
            </li>
          </ol>
          <div style={{ marginTop: 4 }}>
            <strong>ข้อมูลที่จะถูกอัปเดตจาก Empeo:</strong> ชื่อ, ชื่อเล่น, ตำแหน่ง, อีเมล, แผนก, ปีเริ่มงาน, รูปโปรไฟล์
          </div>
          <div>
            <strong>ข้อมูลที่ admin ต้องกรอกเอง:</strong> หัวหน้าทีม, คำใบ้หัวหน้าทีม
          </div>
        </div>
      </div>

      <div className="adm-form-row">
        <div>
          <label className="adm-form-row__label">สถานะการจ้าง</label>
          <div className="adm-form-row__hint">เว้นว่างทั้งหมด = ไม่กรองตามสถานะ</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {STATUS_OPTIONS.map((o) => (
            <label key={o.id} className="adm-employees__check">
              <input
                type="checkbox"
                checked={statusIds.includes(o.id)}
                onChange={() => setStatusIds((cur) => toggleNumber(cur, o.id))}
                disabled={submitting}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="adm-form-row">
        <div>
          <label className="adm-form-row__label">ประเภทพนักงาน</label>
          <div className="adm-form-row__hint">เว้นว่างทั้งหมด = ไม่กรองตามประเภท</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {TYPE_OPTIONS.map((o) => (
            <label key={o.id} className="adm-employees__check">
              <input
                type="checkbox"
                checked={typeIds.includes(o.id)}
                onChange={() => setTypeIds((cur) => toggleNumber(cur, o.id))}
                disabled={submitting}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      </div>

      <details className="adm-stack" style={{ padding: '8px 0' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>ตัวกรองเพิ่มเติม</summary>
        <div className="adm-stack" style={{ marginTop: 12 }}>
          <div className="adm-form-row">
            <div>
              <label className="adm-form-row__label">แผนก (organization.level3)</label>
              <div className="adm-form-row__hint">คั่นด้วย comma เช่น "Innovation, IT Development"</div>
            </div>
            <textarea
              className="adm-textarea"
              value={orgLevel3Text}
              onChange={(e) => setOrgLevel3Text(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="adm-form-row">
            <label className="adm-form-row__label">ปีเริ่มงาน (ตั้งแต่)</label>
            <input
              className="adm-input"
              type="number"
              placeholder="2020"
              value={yearMin}
              onChange={(e) => setYearMin(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="adm-form-row">
            <label className="adm-form-row__label">ปีเริ่มงาน (ถึง)</label>
            <input
              className="adm-input"
              type="number"
              placeholder="2026"
              value={yearMax}
              onChange={(e) => setYearMax(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="adm-form-row">
            <label className="adm-form-row__label">Rank prefix</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {RANK_PREFIXES.map((r) => {
                const on = ranks.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => toggleRank(r)}
                    disabled={submitting}
                    style={{
                      padding: '4px 12px',
                      borderRadius: 999,
                      border: '1.5px solid var(--gray-8)',
                      background: on ? 'var(--gf-flame)' : 'transparent',
                      color: on ? 'white' : 'inherit',
                      cursor: 'pointer',
                      font: 'inherit',
                    }}
                  >
                    {r}*
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </details>

      {result && (
        <div className="adm-stack" style={{ borderTop: '1px solid var(--gray-8)', paddingTop: 12 }}>
          <div className="adm-table__sub">ซิงก์เสร็จแล้ว — {new Date(result.fetchedAt).toLocaleTimeString('th-TH')}</div>
          <details open>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
              เพิ่มใหม่ ({result.added.length})
            </summary>
            <ul className="adm-stack" style={{ marginTop: 8 }}>
              {result.added.map((r) => (
                <li key={r.id} className="adm-table__sub">{r.id} · {r.name}</li>
              ))}
            </ul>
          </details>
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
              อัปเดต ({result.updated.length})
            </summary>
            <ul className="adm-stack" style={{ marginTop: 8 }}>
              {result.updated.map((r) => (
                <li key={r.id} className="adm-table__sub">
                  {r.id} · {r.name} — {r.changedFields.join(', ')}
                </li>
              ))}
            </ul>
          </details>
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
              ไม่พบใน API ({result.missingInApi.length})
            </summary>
            <div className="adm-form-row__hint" style={{ marginTop: 4 }}>
              คนเหล่านี้ยังอยู่ใน DB แต่ไม่อยู่ใน API response ตามตัวกรองที่เลือก — ไม่มีการลบอัตโนมัติ
            </div>
            <ul className="adm-stack" style={{ marginTop: 8 }}>
              {result.missingInApi.map((r) => (
                <li key={r.id} className="adm-table__sub">{r.id} · {r.name}</li>
              ))}
            </ul>
          </details>
          {result.errors.length > 0 && (
            <div className="adm-callout adm-callout--danger">
              <span className="adm-callout__icon">!</span>
              <div className="adm-stack">
                <div>มี error {result.errors.length} รายการ:</div>
                <ul>
                  {result.errors.map((e, i) => (
                    <li key={i} className="adm-table__sub">
                      {e.id ? `${e.id}: ` : ''}{e.reason}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

        </div>
      )}

      {err && (
        <div className="adm-callout adm-callout--danger">
          <span className="adm-callout__icon">!</span>
          <span>{err}</span>
        </div>
      )}

      <div className="adm-row-actions" style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" color="ink" type="button" onClick={close}>
          {result ? 'ปิด' : 'ยกเลิก'}
        </Button>
        {!result && (
          <Button color="flame" type="button" onClick={submit} disabled={submitting}>
            {submitting ? 'กำลังซิงก์…' : 'เริ่มซิงก์'}
          </Button>
        )}
      </div>

      <Sheet
        open={promptOpen}
        onClose={closePrompt}
        title={redistributeResult ? 'สุ่มหัวหน้าเรียบร้อย' : 'สุ่มหัวหน้าให้ผู้เล่นเลยไหม?'}
        position="center"
        size="md"
      >
        {redistributeResult ? (
          <div className="adm-stack">
            <div className="adm-callout adm-callout--info">
              <span className="adm-callout__icon">i</span>
              <div className="adm-stack" style={{ gap: 4, flex: 1 }}>
                <strong>
                  มอบหมายให้ {redistributeResult.totalPlayers} คน · ใช้หัวหน้า {redistributeResult.leaderCount} คน
                </strong>
                <span className="adm-table__sub">
                  ผู้เล่นจะเห็นคำใบ้หัวหน้าใหม่ครั้งต่อไปที่เปิดหน้าภารกิจเพื่อนร่วมทีม
                </span>
              </div>
            </div>
            <div className="adm-row-actions" style={{ justifyContent: 'flex-end' }}>
              <Button color="flame" type="button" onClick={closePrompt}>
                ปิด
              </Button>
            </div>
          </div>
        ) : (
          <div className="adm-stack">
            <p style={{ margin: 0 }}>
              พนักงานที่เพิ่งเพิ่มใหม่ยังไม่มีหัวหน้ามอบหมาย —
              ถ้าไม่สุ่มตอนนี้ พอผู้เล่นกลุ่มนั้นเปิดหน้าภารกิจเพื่อนร่วมทีมจะไม่มีคำใบ้หัวหน้าให้ตาม
            </p>
            <p
              className="adm-table__sub"
              style={{ margin: 0, fontStyle: 'italic' }}
            >
              หมายเหตุ: การสุ่มจะเขียนทับหัวหน้าของผู้เล่นทุกคนที่มีอยู่เดิม (ไม่ใช่แค่คนใหม่)
            </p>
            {redistributeErr && (
              <div className="adm-callout adm-callout--danger">
                <span className="adm-callout__icon">!</span>
                <span>{redistributeErr}</span>
              </div>
            )}
            <div className="adm-row-actions" style={{ justifyContent: 'flex-end' }}>
              <Button
                variant="secondary"
                color="ink"
                type="button"
                disabled={redistributing}
                onClick={closePrompt}
              >
                ไว้ทีหลัง
              </Button>
              <Button
                color="flame"
                type="button"
                disabled={redistributing}
                onClick={runRedistribute}
              >
                {redistributing ? 'กำลังสุ่ม…' : 'สุ่มหัวหน้าให้เลย'}
              </Button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}

const CSV_TEMPLATE_HEADERS = [
  'id',
  'name',
  'nickname',
  'position',
  'email',
  'dept',
  'year',
  'isLeader',
  'leaderClue',
  'photoUrl',
] as const;

const CSV_TEMPLATE_SAMPLE_ROWS: string[][] = [
  [
    'EMP-1001',
    'สมชาย ใจดี',
    'ชาย',
    'Software Engineer',
    'somchai@example.com',
    'IT Development',
    '2024',
    'false',
    '',
    '',
  ],
  [
    'EMP-1002',
    'Jane Smith',
    'Jane',
    'Product Manager',
    'jane@example.com',
    'Innovation',
    '2022',
    'true',
    'ชอบดื่มกาแฟดำทุกเช้า',
    '',
  ],
];

function buildTemplateCsv(): string {
  const rows = [CSV_TEMPLATE_HEADERS, ...CSV_TEMPLATE_SAMPLE_ROWS];
  return rows
    .map((r) =>
      r
        .map((cell) =>
          /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell,
        )
        .join(','),
    )
    .join('\n');
}

function downloadTemplate() {
  const csv = '﻿' + buildTemplateCsv(); // BOM for Excel compatibility
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'employees-template.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function CsvImportForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!file) {
      setErr('กรุณาเลือกไฟล์ CSV ก่อน');
      return;
    }
    setSubmitting(true);
    setErr(null);
    setResult(null);
    try {
      const r = await adminEndpoints.importEmployeesCsv(file);
      setResult(r);
    } catch (e) {
      console.error(e);
      if (e instanceof ApiError && e.code) {
        if (e.code.startsWith('csv_missing_columns')) {
          setErr(`ไฟล์ CSV ขาดคอลัมน์ที่จำเป็น (${e.code.replace('csv_missing_columns: ', '')})`);
        } else if (e.code === 'csv_empty_or_header_only') {
          setErr('ไฟล์ CSV ว่างเปล่า หรือมีแค่ header row');
        } else if (e.code === 'missing_csv') {
          setErr('ไม่พบไฟล์ในคำขอ — กรุณาลองเลือกไฟล์ใหม่');
        } else {
          setErr(`นำเข้าไม่สำเร็จ (${e.code})`);
        }
      } else {
        setErr('นำเข้าไม่สำเร็จ — ตรวจสอบไฟล์หรือลองใหม่');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const close = () => {
    if (result) onDone();
    onClose();
  };

  return (
    <div className="adm-stack">
      <div className="adm-callout">
        <span className="adm-callout__icon">i</span>
        <div className="adm-stack">
          <div><strong>การนำเข้า CSV ทำงานยังไง</strong></div>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <li>อ่านแต่ละ row จากไฟล์ CSV ของคุณ</li>
            <li>เทียบ <code>id</code> กับฐานข้อมูล:
              <ul style={{ margin: '4px 0 0 0', paddingLeft: 18 }}>
                <li><strong>ยังไม่มีในระบบ</strong> → เพิ่มเป็นพนักงานใหม่</li>
                <li><strong>มีอยู่แล้ว</strong> → อัปเดตเฉพาะ field ที่ค่าใน CSV ต่างจากเดิม</li>
                <li><strong>row ที่ข้อมูลไม่ครบ / ปีไม่ถูกต้อง</strong> → ข้ามและรายงาน</li>
              </ul>
            </li>
            <li>ไม่มีการลบ — พนักงานที่อยู่ในระบบแต่ไม่ได้อยู่ในไฟล์ CSV จะยังอยู่เหมือนเดิม</li>
          </ol>
          <div style={{ marginTop: 4 }}>
            <strong>คอลัมน์ที่จำเป็น:</strong> <code>id</code>, <code>name</code>, <code>dept</code>, <code>year</code>
          </div>
          <div>
            <strong>คอลัมน์เพิ่มเติม (ใส่หรือไม่ใส่ก็ได้):</strong>{' '}
            <code>nickname</code>, <code>position</code>, <code>email</code>,{' '}
            <code>isLeader</code>, <code>leaderClue</code>, <code>photoUrl</code>
          </div>
          <div className="adm-form-row__hint">
            หัวคอลัมน์ไม่ sensitive case รองรับ synonym ทั้งภาษาไทย/อังกฤษ เช่น{' '}
            <code>Division</code> = <code>dept</code>, <code>ชื่อเล่น</code> = <code>nickname</code>,{' '}
            <code>Employment Date</code> ก็ใช้แทน <code>year</code> ได้ (จะอ่านปีจาก DD/MM/YYYY ให้)
          </div>
          <div>
            <button
              type="button"
              className="adm-link-btn"
              onClick={downloadTemplate}
              disabled={submitting}
            >
              ดาวน์โหลดไฟล์ template
            </button>
          </div>
        </div>
      </div>

      <label className="adm-employees__drop">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(null);
            setErr(null);
          }}
          disabled={submitting}
        />
        {file ? (
          <span>
            <strong>{file.name}</strong> · {(file.size / 1024).toFixed(1)} KB
            <br />
            <span className="adm-table__sub">คลิกเพื่อเปลี่ยนไฟล์</span>
          </span>
        ) : (
          <span>คลิกเพื่อเลือกไฟล์ CSV</span>
        )}
      </label>

      {result && (
        <div className="adm-stack" style={{ borderTop: '1px solid var(--gray-8)', paddingTop: 12 }}>
          <div className="adm-table__sub">
            นำเข้าเสร็จแล้ว — {new Date(result.fetchedAt).toLocaleTimeString('th-TH')} ·
            อ่านทั้งหมด {result.total} row {result.skipped > 0 && `· ข้าม ${result.skipped} row (ไม่มี id)`}
          </div>
          <details open>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
              เพิ่มใหม่ ({result.added.length})
            </summary>
            <ul className="adm-stack" style={{ marginTop: 8 }}>
              {result.added.map((r) => (
                <li key={r.id} className="adm-table__sub">{r.id} · {r.name}</li>
              ))}
            </ul>
          </details>
          <details>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
              อัปเดต ({result.updated.length})
            </summary>
            <ul className="adm-stack" style={{ marginTop: 8 }}>
              {result.updated.map((r) => (
                <li key={r.id} className="adm-table__sub">
                  {r.id} · {r.name} — {r.changedFields.join(', ')}
                </li>
              ))}
            </ul>
          </details>
          {result.errors.length > 0 && (
            <div className="adm-callout adm-callout--danger">
              <span className="adm-callout__icon">!</span>
              <div className="adm-stack">
                <div>มี error {result.errors.length} รายการ:</div>
                <ul>
                  {result.errors.map((e, i) => (
                    <li key={i} className="adm-table__sub">
                      {e.row ? `row ${e.row}` : ''}
                      {e.id ? ` · ${e.id}` : ''}
                      {(e.row || e.id) ? ': ' : ''}
                      {e.reason}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {err && (
        <div className="adm-callout adm-callout--danger">
          <span className="adm-callout__icon">!</span>
          <span>{err}</span>
        </div>
      )}

      <div className="adm-row-actions" style={{ justifyContent: 'flex-end' }}>
        <Button variant="secondary" color="ink" type="button" onClick={close}>
          {result ? 'ปิด' : 'ยกเลิก'}
        </Button>
        {!result && (
          <Button
            color="flame"
            type="button"
            onClick={submit}
            disabled={submitting || !file}
          >
            {submitting ? 'กำลังนำเข้า…' : 'เริ่มนำเข้า'}
          </Button>
        )}
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
