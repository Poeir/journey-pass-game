import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { adminAuthEndpoints } from '@/api/endpoints';
import './AdminLogin.css';

export function AdminLogin() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Match the rest of the admin portal — escape the global #root phone-column
  // frame from styles/global.css. Same trick as AdminShell.
  useEffect(() => {
    document.documentElement.classList.add('admin-fullscreen');
    return () => {
      document.documentElement.classList.remove('admin-fullscreen');
    };
  }, []);

  // Skip the form if already signed in.
  useEffect(() => {
    let cancelled = false;
    adminAuthEndpoints
      .me()
      .then((r) => {
        if (!cancelled && r.isAdmin) navigate('/admin', { replace: true });
      })
      .catch(() => {
        // ignore — render the form
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await adminAuthEndpoints.login(username, password);
      navigate('/admin', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      } else if (err instanceof ApiError && err.status === 429) {
        setError('พยายามมากเกินไป · ลองใหม่ใน 1 นาที');
      } else {
        setError('เข้าสู่ระบบไม่สำเร็จ · ลองอีกครั้ง');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="admin-login">
      <form className="admin-login__card" onSubmit={onSubmit} noValidate>
        <div className="admin-login__brand">
          <div className="admin-login__brand-mark">G5</div>
          <div className="admin-login__brand-text">
            <div className="admin-login__brand-title">Admin Portal</div>
            <div className="admin-login__brand-sub">Journey Pass 5.5</div>
          </div>
        </div>

        <h1 className="admin-login__title">เข้าสู่ระบบผู้ดูแล</h1>
        <p className="admin-login__hint">
          กรุณากรอกชื่อผู้ใช้และรหัสผ่านสำหรับผู้ดูแลระบบ
        </p>

        <label className="admin-login__field">
          <span>ชื่อผู้ใช้</span>
          <input
            type="text"
            value={username}
            autoComplete="username"
            autoFocus
            onChange={(e) => setUsername(e.target.value)}
            disabled={submitting}
            required
          />
        </label>

        <label className="admin-login__field">
          <span>รหัสผ่าน</span>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            required
          />
        </label>

        {error && (
          <div className="admin-login__error" role="alert">
            {error}
          </div>
        )}

        <button
          type="submit"
          className="admin-login__submit"
          disabled={submitting || !username || !password}
        >
          {submitting ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
        </button>
      </form>
    </div>
  );
}
