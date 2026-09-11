import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PassportButton } from '@/design-system/PassportButton';
import { useGame } from '@/game/gameStore';
import { ROUTES } from '@/lib/routes';
import { authEndpoints, devAuthEndpoints, type DevEmployee } from '@/api/endpoints';
import { LanguageToggle } from '@/design-system/LanguageToggle';
import { useT } from '@/lib/i18n';
import asset01 from '../../../assets/asset01.png';
import asset02 from '../../../assets/asset02.png';
import asset03 from '../../../assets/asset03.png';
import asset04 from '../../../assets/asset04.png';
import asset05 from '../../../assets/asset05.png';
import mascot01 from '../../../assets/mascot01.png';
import './WelcomePage.css';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api';
// Strict equality — any other value (unset, "false", "1") leaves the dev UI
// out of the bundle. Backend has the matching DEV_LOGIN_ENABLED gate.
const DEV_LOGIN_ENABLED =
  (import.meta.env.VITE_DEV_LOGIN_ENABLED as string | undefined) === 'true';

function describeLoginError(
  searchParams: URLSearchParams,
  t: (key: string) => string,
): string | null {
  if (searchParams.get('expired') === '1') {
    return t('welcome.sessionExpired');
  }
  const code = searchParams.get('error');
  if (code === 'not_registered') {
    return t('welcome.notRegistered');
  }
  if (code === 'auth_failed') {
    return t('welcome.authFailed');
  }
  return null;
}

export function WelcomePage() {
  const t = useT();
  const [searchParams, setSearchParams] = useSearchParams();
  const error = describeLoginError(searchParams, t);
  const navigate = useNavigate();
  const profile = useGame((s) => s.profile);

  // If the user already has a valid session (hydrated by App.tsx), skip the
  // welcome/login page and go straight to their profile.
  useEffect(() => {
    if (profile) navigate(ROUTES.user, { replace: true });
  }, [profile, navigate]);

  const startSso = () => {
    window.location.assign(`${API_BASE}/auth/azure/login`);
  };

  const dismissError = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('error');
    next.delete('expired');
    setSearchParams(next, { replace: true });
  };

  return (
    <main className="welcome-pass">
      <img
        src={asset01}
        className="welcome-pass__bg"
        alt=""
        aria-hidden="true"
      />

      <header className="welcome-pass__header">
        <span className="sk-hand-b welcome-pass__brand">{t('welcome.brand')}</span>
        <div className="welcome-pass__header-actions">
          <LanguageToggle size="sm" />
          <div className="welcome-pass__badge">
            <img src={asset05} alt="" aria-hidden="true" />
            <span className="sk-hand-b welcome-pass__badge-text">5.5</span>
          </div>
        </div>
      </header>

      {error && (
        <div className="welcome-pass__error" role="alert">
          <span className="welcome-pass__error-text">{error}</span>
          <button
            type="button"
            className="welcome-pass__error-close"
            onClick={dismissError}
            aria-label={t('welcome.dismiss')}
          >
            ×
          </button>
        </div>
      )}

      <section
        className="welcome-pass__card"
        aria-labelledby="welcome-pass-title"
      >
        <img
          src={asset02}
          className="welcome-pass__card-frame"
          alt=""
          aria-hidden="true"
        />

        <div className="welcome-pass__card-body">
          <div className="welcome-pass__ribbon">
            <img src={asset03} alt="" aria-hidden="true" />
            <span className="sk-hand welcome-pass__ribbon-text">
              {t('welcome.invited')}
            </span>
          </div>

          <h1
            id="welcome-pass-title"
            className="sk-hand-b welcome-pass__title"
          >
            {t('welcome.titleLine1')}
            <br />
            {t('welcome.titleLine2')}
          </h1>

          <p className="welcome-pass__lede">
            {t('welcome.ledePrefix')}<strong>{t('welcome.ledeName')}</strong>
            <br />
            {t('welcome.ledeDate')}
          </p>

          <p className="welcome-pass__call">
            {t('welcome.callLine1')}
            <br />
            {t('welcome.callLine2')}
          </p>

          <div className="welcome-pass__seal">
            <img src={asset04} alt="" aria-hidden="true" />
            {/* <span className="sk-hand-b welcome-pass__seal-text">SEALED</span> */}
          </div>
        </div>
      </section>

      <div className="welcome-pass__mascot">
        <img
          src={mascot01}
          className="welcome-pass__mascot-img"
          alt=""
          aria-hidden="true"
        />
        <div className="welcome-pass__mascot-bubble">
          <span className="welcome-pass__mascot-text">
            {t('welcome.mascotBubble')}
          </span>
        </div>
      </div>

      <PassportButton
        block
        className="welcome-pass__cta"
        onClick={startSso}
        aria-label={t('welcome.ctaAria')}
      >
        {t('welcome.cta')}
      </PassportButton>

      {DEV_LOGIN_ENABLED && <DevLoginPanel />}
    </main>
  );
}

// ─── Dev-only login panel ─────────────────────────────────────────────────
// Only rendered when VITE_DEV_LOGIN_ENABLED === 'true'. Lets a developer pick
// any seeded employee and skip Azure SSO. The backend gate (DEV_LOGIN_ENABLED)
// must match — calls 404 otherwise. Production builds should not have this
// env var set, so this whole subtree dead-code-eliminates.

function DevLoginPanel() {
  const t = useT();
  const navigate = useNavigate();
  const setProfile = useGame((s) => s.setProfile);
  const [open, setOpen] = useState(false);
  const [employees, setEmployees] = useState<DevEmployee[] | null>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lazy-load the roster the first time the panel opens so the welcome page
  // doesn't pay the cost when the dev hits SSO instead.
  const handleToggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && employees === null) {
      try {
        setLoading(true);
        const res = await devAuthEndpoints.listEmployees();
        setEmployees(res.employees);
      } catch {
        setError(t('welcome.dev.loadFailed'));
      } finally {
        setLoading(false);
      }
    }
  };

  const filtered = useMemo(() => {
    if (!employees) return [];
    const q = query.trim().toLowerCase();
    if (!q) return employees.slice(0, 25);
    return employees
      .filter(
        (e) =>
          e.id.toLowerCase().includes(q) ||
          e.name.toLowerCase().includes(q) ||
          e.dept.toLowerCase().includes(q),
      )
      .slice(0, 25);
  }, [employees, query]);

  const loginAs = async (employeeId: string) => {
    setError(null);
    setLoading(true);
    try {
      await devAuthEndpoints.login(employeeId);
      const profile = await authEndpoints.me();
      setProfile(profile);
      navigate(ROUTES.user, { replace: true });
    } catch {
      setError(t('welcome.dev.loginFailed'));
      setLoading(false);
    }
  };

  return (
    <section className="welcome-pass__dev" aria-label={t('welcome.dev.sectionAria')}>
      <button
        type="button"
        className="welcome-pass__dev-toggle"
        onClick={handleToggle}
        aria-expanded={open}
      >
        {open ? t('welcome.dev.close') : t('welcome.dev.open')}
      </button>
      {open && (
        <div className="welcome-pass__dev-body">
          <p className="welcome-pass__dev-hint">
            {t('welcome.dev.hint')}
            <code> DEV_LOGIN_ENABLED</code> {t('welcome.dev.hintBackend')}{' '}
            <code>VITE_DEV_LOGIN_ENABLED</code> {t('welcome.dev.hintFrontend')}
          </p>
          <input
            type="search"
            className="welcome-pass__dev-search"
            placeholder={t('welcome.dev.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            disabled={loading || employees === null}
          />
          {loading && <p className="welcome-pass__dev-status">{t('welcome.dev.loading')}</p>}
          {error && (
            <p className="welcome-pass__dev-status welcome-pass__dev-status--err">
              {error}
            </p>
          )}
          <ul className="welcome-pass__dev-list">
            {filtered.map((emp) => (
              <li key={emp.id}>
                <button
                  type="button"
                  className="welcome-pass__dev-row"
                  onClick={() => loginAs(emp.id)}
                  disabled={loading}
                >
                  <span className="welcome-pass__dev-row-name">
                    {emp.name}
                    {emp.isLeader && (
                      <span className="welcome-pass__dev-leader">{t('welcome.dev.leaderBadge')}</span>
                    )}
                  </span>
                  <span className="welcome-pass__dev-row-meta">
                    {emp.id} · {emp.dept} · {emp.year}
                  </span>
                </button>
              </li>
            ))}
            {employees !== null && filtered.length === 0 && !loading && (
              <li className="welcome-pass__dev-status">{t('welcome.dev.noMatches')}</li>
            )}
          </ul>
        </div>
      )}
    </section>
  );
}
