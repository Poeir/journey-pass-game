import { Suspense, useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { adminAuthEndpoints } from '@/api/endpoints';
import './AdminShell.css';

interface NavItem {
  to: string;
  label: string;
  icon: JSX.Element;
  end?: boolean;
}

type AuthState = 'checking' | 'authed' | 'unauthed';

const NAV: NavItem[] = [
  { to: '/admin', label: 'แดชบอร์ด', end: true, icon: iconHome() },
  { to: '/admin/players', label: 'ผู้เล่น', icon: iconUsers() },
  { to: '/admin/employees', label: 'พนักงาน', icon: iconUser() },
  { to: '/admin/trivia', label: 'การ์ดคำถาม', icon: iconCard() },
  { to: '/admin/pairs', label: 'คู่ลงโทษ', icon: iconLink() },
  { to: '/admin/scans', label: 'บันทึกการสแกน', icon: iconList() },
  { to: '/admin/chat-answers', label: 'คำตอบจากแชท', icon: iconChat() },
  { to: '/admin/memories', label: 'กำแพงความทรงจำ', icon: iconImage() },
  { to: '/admin/game', label: 'ควบคุมเกม', icon: iconClock() },
  { to: '/admin/settings', label: 'ตั้งค่า', icon: iconCog() },
];

// Public-facing pages — opened in a new tab so the admin doesn't lose
// their context. Useful for spot-checking what players / projectors see
// without juggling separate browser windows.
interface ExternalNavItem {
  to: string;
  label: string;
  icon: JSX.Element;
}
const EXTERNAL_NAV: ExternalNavItem[] = [
  { to: '/', label: 'หน้าเข้าเกม', icon: iconPlay() },
  { to: '/memory', label: 'กำแพงความทรงจำ (จอ)', icon: iconImage() },
  { to: '/ranking', label: 'อันดับ (จอ)', icon: iconTrophy() },
];

export function AdminShell() {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [auth, setAuth] = useState<AuthState>('checking');

  // Break out of the global #root "phone column" frame defined in
  // styles/global.css. Same pattern as RankingPage / MemoryWallPage.
  useEffect(() => {
    document.documentElement.classList.add('admin-fullscreen');
    return () => {
      document.documentElement.classList.remove('admin-fullscreen');
    };
  }, []);

  // Verify the admin session before rendering the shell. Bounce to the
  // login page if the cookie's `isAdmin` flag is missing/false. The api
  // client is configured to NOT auto-redirect on 401 from /admin/* paths
  // (see api/client.ts handleUnauthorized) — that bouncing is our job.
  useEffect(() => {
    let cancelled = false;
    adminAuthEndpoints
      .me()
      .then((r) => {
        if (cancelled) return;
        if (r.isAdmin) setAuth('authed');
        else {
          setAuth('unauthed');
          navigate('/admin/login', { replace: true });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setAuth('unauthed');
        navigate('/admin/login', { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function onLogout() {
    try {
      await adminAuthEndpoints.logout();
    } catch {
      // even if the logout call fails (network), drop the local state
    }
    setAuth('unauthed');
    navigate('/admin/login', { replace: true });
  }

  if (auth !== 'authed') {
    return (
      <div className="admin-shell">
        <div className="admin-shell__main">
          <main className="admin-shell__content">
            <div className="admin-shell__loading">
              {auth === 'checking' ? 'กำลังตรวจสอบสิทธิ์…' : 'กำลังพาไปหน้าเข้าสู่ระบบ…'}
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-shell">
      <aside className={`admin-shell__nav ${navOpen ? 'admin-shell__nav--open' : ''}`}>
        <div className="admin-shell__brand">
          <div className="admin-shell__brand-mark">G5</div>
          <div className="admin-shell__brand-text">
            <div className="admin-shell__brand-title">Admin Portal</div>
            <div className="admin-shell__brand-sub">Journey Pass 5.5</div>
          </div>
        </div>

        <nav className="admin-shell__nav-list" aria-label="Admin navigation">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `admin-shell__nav-item ${isActive ? 'admin-shell__nav-item--active' : ''}`
              }
              onClick={() => setNavOpen(false)}
            >
              <span className="admin-shell__nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}

          <div className="admin-shell__nav-section">ดูหน้าผู้เล่น</div>
          {EXTERNAL_NAV.map((item) => (
            <a
              key={item.to}
              href={item.to}
              target="_blank"
              rel="noopener noreferrer"
              className="admin-shell__nav-item admin-shell__nav-item--external"
              onClick={() => setNavOpen(false)}
            >
              <span className="admin-shell__nav-icon">{item.icon}</span>
              <span>{item.label}</span>
              <span className="admin-shell__nav-external" aria-hidden="true">↗</span>
            </a>
          ))}
        </nav>

        <div className="admin-shell__nav-foot">
          <div className="admin-shell__user">
            <span className="admin-shell__user-avatar">A</span>
            <span className="admin-shell__user-text">
              <span className="admin-shell__user-name">Admin</span>
              <span className="admin-shell__user-email">เข้าสู่ระบบแล้ว</span>
            </span>
          </div>
          <button
            type="button"
            className="admin-shell__logout"
            onClick={onLogout}
          >
            ออกจากระบบ
          </button>
        </div>
      </aside>

      {navOpen && (
        <button
          type="button"
          className="admin-shell__nav-backdrop"
          aria-label="ปิดเมนู"
          onClick={() => setNavOpen(false)}
        />
      )}

      <div className="admin-shell__main">
        <button
          type="button"
          className="admin-shell__menu-btn"
          aria-label="เปิดเมนู"
          onClick={() => setNavOpen((v) => !v)}
        >
          <span className="admin-shell__menu-bar" />
          <span className="admin-shell__menu-bar" />
          <span className="admin-shell__menu-bar" />
        </button>
        <main className="admin-shell__content">
          <Suspense fallback={<div className="admin-shell__loading">กำลังโหลด…</div>}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

// --- inline SVG icons (no external image assets) ---
function svg(children: JSX.Element) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
function iconHome() {
  return svg(
    <>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </>,
  );
}
function iconUsers() {
  return svg(
    <>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>,
  );
}
function iconUser() {
  return svg(
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>,
  );
}
function iconCard() {
  return svg(
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 9h10M7 13h6" />
    </>,
  );
}
function iconLink() {
  return svg(
    <>
      <path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </>,
  );
}
function iconList() {
  return svg(
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <circle cx="4" cy="6" r="1" />
      <circle cx="4" cy="12" r="1" />
      <circle cx="4" cy="18" r="1" />
    </>,
  );
}
function iconChat() {
  return svg(
    <>
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </>,
  );
}
function iconImage() {
  return svg(
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </>,
  );
}
function iconClock() {
  return svg(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>,
  );
}
function iconPlay() {
  return svg(
    <>
      <polygon points="5 3 19 12 5 21 5 3" />
    </>,
  );
}
function iconTrophy() {
  return svg(
    <>
      <path d="M6 9H4a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1h3" />
      <path d="M18 9h2a2 2 0 0 0 2-2V5a1 1 0 0 0-1-1h-3" />
      <path d="M6 4h12v8a6 6 0 0 1-12 0V4z" />
      <path d="M9 22h6" />
      <path d="M12 18v4" />
    </>,
  );
}
function iconCog() {
  return svg(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.7-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.7.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.7 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.7.3h.1a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5h.1a1.6 1.6 0 0 0 1.7-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.7V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </>,
  );
}
