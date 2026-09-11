import { Suspense, lazy, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ProgressDock } from './ProgressDock';

const MyQRSheet = lazy(() =>
  import('@/features/qr/MyQRSheet').then((m) => ({ default: m.MyQRSheet })),
);
import { ToastContainer } from '@/design-system/Toast';
import { useGame } from '@/game/gameStore';
import { useUserSocket } from '@/lib/useUserSocket';
import { authEndpoints } from '@/api/endpoints';
import { ROUTES } from '@/lib/routes';
import './GameShell.css';

export function GameShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qrOpen = params.get('qr') === 'open';
  const employeeId = useGame((s) => s.profile?.id);
  const pendingPenalty = useGame((s) => s.pendingPenalty);
  const pendingChat = useGame((s) => s.pendingChat);
  const gameEndedAt = useGame((s) => s.gameEndedAt);
  const reset = useGame((s) => s.reset);
  const [loggingOut, setLoggingOut] = useState(false);
  useUserSocket(employeeId);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await authEndpoints.logout();
    } catch {
      // Server call failed — still clear local state so the user isn't stuck.
    }
    reset();
    navigate(ROUTES.welcome, { replace: true });
    setLoggingOut(false);
  };

  const isWelcome = pathname === '/';
  const isMemoryWall = pathname === '/memory';
  const isRanking = pathname === ROUTES.ranking;
  const isPublicProjector = isMemoryWall || isRanking;
  const isTimeUp = pathname === ROUTES.timeUp;

  useEffect(() => {
    if (!employeeId) return;
    if (isPublicProjector) return;
    let cancelled = false;
    authEndpoints
      .pendingPenalty()
      .then(({ pending }) => {
        if (cancelled) return;
        useGame.getState().setPenalty(pending);
      })
      .catch(() => {
        // Non-fatal — rely on existing store state.
      });
    authEndpoints
      .pendingChat()
      .then(({ pending }) => {
        if (cancelled) return;
        useGame.getState().setPendingChat(pending);
      })
      .catch(() => {
        // Non-fatal — rely on existing store state.
      });
    authEndpoints
      .progress()
      .then((progress) => {
        if (cancelled) return;
        const year = useGame.getState().profile?.year ?? null;
        useGame.getState().hydrateProgress({ ...progress, year });
      })
      .catch(() => {
        // Non-fatal — keep any persisted local state.
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId, isPublicProjector]);

  useEffect(() => {
    if (!gameEndedAt) return;
    if (isWelcome || isPublicProjector || isTimeUp) return;
    navigate(ROUTES.timeUp, { replace: true });
  }, [gameEndedAt, navigate, isWelcome, isPublicProjector, isTimeUp]);

  useEffect(() => {
    if (gameEndedAt) return;
    if (!pendingPenalty) return;
    if (isWelcome || isPublicProjector) return;
    const base = `/result/fail/${pendingPenalty.pairId}`;
    if (!pathname.startsWith(base)) {
      navigate(ROUTES.fail(pendingPenalty.pairId), { replace: true });
    }
  }, [pendingPenalty, gameEndedAt, pathname, navigate, isWelcome, isPublicProjector]);

  // Pull users into /chat/:pairId for the target side of a teammate scan so
  // both sides can complete the chat-confirm without scanning back. Yields
  // priority to pendingPenalty (penalty is mandatory) and to game-end.
  useEffect(() => {
    if (gameEndedAt) return;
    if (pendingPenalty) return;
    if (!pendingChat) return;
    if (isWelcome || isPublicProjector) return;
    const base = `/chat/${pendingChat.pairId}`;
    if (!pathname.startsWith(base)) {
      navigate(ROUTES.chatConfirm(pendingChat.pairId), { replace: true });
    }
  }, [
    pendingChat,
    pendingPenalty,
    gameEndedAt,
    pathname,
    navigate,
    isWelcome,
    isPublicProjector,
  ]);

  const isScanner = /\/scan(\/|$|\?)/.test(pathname);
  // Hide all shell chrome (ProgressDock + FAB) on: scanner (immersive camera),
  // welcome (user not authenticated yet, no "My QR" to show),
  // public projector pages (memory wall, ranking), time-up (game-over takeover).
  // To add more "chrome-free" pages, extend the condition here.
  const hideChrome = isScanner || isWelcome || isPublicProjector || isTimeUp;

  return (
    <div className="shell">
      <ToastContainer />
      <div className="shell__body">
        <Suspense fallback={<div className="shell__route-fallback" role="status" aria-label="Loading" />}>
          <Outlet />
        </Suspense>
      </div>
      {!hideChrome && (
        <ProgressDock
          onShowQR={() => {
            const next = new URLSearchParams(params);
            next.set('qr', 'open');
            setParams(next);
          }}
          onLogout={handleLogout}
          loggingOut={loggingOut}
        />
      )}
      {qrOpen && (
        <Suspense fallback={null}>
          <MyQRSheet
            open={qrOpen}
            onClose={() => {
              const next = new URLSearchParams(params);
              next.delete('qr');
              navigate({ pathname, search: next.toString() }, { replace: true });
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
