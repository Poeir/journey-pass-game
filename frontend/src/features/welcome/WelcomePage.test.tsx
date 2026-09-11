import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WelcomePage } from './WelcomePage';
import { useGame } from '@/game/gameStore';
import { useLanguageStore } from '@/lib/i18n/languageStore';
import { th } from '@/lib/i18n/locales/th';

// Mock API endpoints so dev-login panel doesn't make real fetch calls.
vi.mock('@/api/endpoints', () => ({
  authEndpoints: { me: vi.fn() },
  devAuthEndpoints: {
    listEmployees: vi.fn().mockResolvedValue({ employees: [] }),
    login: vi.fn(),
  },
}));

// Mock the asset imports — Vite normally resolves them to URLs, vitest passes
// them through as opaque strings. Mocking keeps the tests independent of the
// vite-image-optimizer plugin's behaviour in the test environment.
vi.mock('../../assets/asset01.png', () => ({ default: 'asset01.png' }));
vi.mock('../../assets/asset02.png', () => ({ default: 'asset02.png' }));
vi.mock('../../assets/asset03.png', () => ({ default: 'asset03.png' }));
vi.mock('../../assets/asset04.png', () => ({ default: 'asset04.png' }));
vi.mock('../../assets/asset05.png', () => ({ default: 'asset05.png' }));
vi.mock('../../assets/mascot01.png', () => ({ default: 'mascot01.png' }));

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <WelcomePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useLanguageStore.setState({ lang: 'th' });
  useGame.getState().reset();
});

describe('WelcomePage — error banners (Thai default)', () => {
  it('renders no banner when there is no error/expired query', () => {
    renderAt('/');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the auth-failed banner for ?error=auth_failed', () => {
    renderAt('/?error=auth_failed');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(th.welcome.authFailed);
  });

  it('renders the not-registered banner for ?error=not_registered', () => {
    renderAt('/?error=not_registered');
    expect(screen.getByRole('alert')).toHaveTextContent(th.welcome.notRegistered);
  });

  it('renders the session-expired banner for ?expired=1', () => {
    renderAt('/?expired=1');
    expect(screen.getByRole('alert')).toHaveTextContent(th.welcome.sessionExpired);
  });

  it('ignores unknown error codes (no banner)', () => {
    renderAt('/?error=something_we_dont_recognize');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('dismiss button removes the banner', () => {
    renderAt('/?error=auth_failed');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    const dismiss = screen.getByLabelText(th.welcome.dismiss);
    fireEvent.click(dismiss);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('WelcomePage — language switch', () => {
  it('switches banner copy to English when lang=en', () => {
    useLanguageStore.setState({ lang: 'en' });
    renderAt('/?expired=1');
    const alert = screen.getByRole('alert');
    // Sanity: at least it isn't the Thai string anymore.
    expect(alert).not.toHaveTextContent(th.welcome.sessionExpired);
    expect(alert.textContent?.length).toBeGreaterThan(0);
  });
});

describe('WelcomePage — CTA button', () => {
  it('shows the SSO call-to-action button', () => {
    renderAt('/');
    // The CTA carries the localized aria-label; just verify a button exists.
    const cta = screen.getByLabelText(th.welcome.ctaAria);
    expect(cta).toBeInTheDocument();
  });
});
