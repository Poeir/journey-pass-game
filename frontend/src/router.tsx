import { lazy } from 'react';
import { createBrowserRouter } from 'react-router-dom';
import { GameShell } from '@/features/shell/GameShell';
import { RequireAuth } from '@/features/auth/RequireAuth';
// WelcomePage is the entry point and also the place we land back on after a
// failed Azure SSO (with ?error=…) or an expired session (?expired=1) — keep
// it eager so the first paint doesn't wait for an extra chunk download.
// (Lighthouse flags this as NO_FCP when the Suspense fallback is empty.)
import { WelcomePage } from '@/features/welcome/WelcomePage';
const UserProfilePage = lazy(() =>
  import('@/features/auth/UserProfilePage').then((m) => ({ default: m.UserProfilePage })),
);
const MissionSelectPage = lazy(() =>
  import('@/features/mission/MissionSelectPage').then((m) => ({ default: m.MissionSelectPage })),
);
const TriviaIntroPage = lazy(() =>
  import('@/features/trivia/TriviaIntroPage').then((m) => ({ default: m.TriviaIntroPage })),
);
const TriviaCardsPage = lazy(() =>
  import('@/features/trivia/TriviaCardsPage').then((m) => ({ default: m.TriviaCardsPage })),
);
const TeammateIntroPage = lazy(() =>
  import('@/features/teammate/TeammateIntroPage').then((m) => ({ default: m.TeammateIntroPage })),
);
const FindTeammatePage = lazy(() =>
  import('@/features/teammate/FindTeammatePage').then((m) => ({ default: m.FindTeammatePage })),
);
const ScannerPage = lazy(() =>
  import('@/features/scanner/ScannerPage').then((m) => ({ default: m.ScannerPage })),
);
const SuccessPage = lazy(() =>
  import('@/features/result/SuccessPage').then((m) => ({ default: m.SuccessPage })),
);
const FailPenaltyPage = lazy(() =>
  import('@/features/result/FailPenaltyPage').then((m) => ({ default: m.FailPenaltyPage })),
);
const ChatConfirmPage = lazy(() =>
  import('@/features/result/ChatConfirmPage').then((m) => ({ default: m.ChatConfirmPage })),
);
const TimeUpPage = lazy(() =>
  import('@/features/result/TimeUpPage').then((m) => ({ default: m.TimeUpPage })),
);
const CompletedPage = lazy(() =>
  import('@/features/complete/CompletedPage').then((m) => ({ default: m.CompletedPage })),
);
const MemoryWallPage = lazy(() =>
  import('@/features/memoryWall/MemoryWallPage').then((m) => ({ default: m.MemoryWallPage })),
);
const RankingPage = lazy(() =>
  import('@/features/ranking/RankingPage').then((m) => ({ default: m.RankingPage })),
);
const NotFoundPage = lazy(() =>
  import('@/features/notfound/NotFoundPage').then((m) => ({ default: m.NotFoundPage })),
);

// Admin portal — its own shell (sidebar layout, no game chrome). Gated by a
// temporary username/password (env ADMIN_USERNAME / ADMIN_PASSWORD) until
// the real role model lands. See frontend/src/features/admin/BACKEND.md.
const AdminShell = lazy(() =>
  import('@/features/admin/AdminShell').then((m) => ({ default: m.AdminShell })),
);
const AdminLogin = lazy(() =>
  import('@/features/admin/AdminLogin').then((m) => ({ default: m.AdminLogin })),
);
const AdminDashboard = lazy(() =>
  import('@/features/admin/AdminDashboard').then((m) => ({ default: m.AdminDashboard })),
);
const AdminPlayers = lazy(() =>
  import('@/features/admin/AdminPlayers').then((m) => ({ default: m.AdminPlayers })),
);
const AdminPlayerDetail = lazy(() =>
  import('@/features/admin/AdminPlayerDetail').then((m) => ({ default: m.AdminPlayerDetail })),
);
const AdminEmployees = lazy(() =>
  import('@/features/admin/AdminEmployees').then((m) => ({ default: m.AdminEmployees })),
);
const AdminTrivia = lazy(() =>
  import('@/features/admin/AdminTrivia').then((m) => ({ default: m.AdminTrivia })),
);
const AdminPairs = lazy(() =>
  import('@/features/admin/AdminPairs').then((m) => ({ default: m.AdminPairs })),
);
const AdminScans = lazy(() =>
  import('@/features/admin/AdminScans').then((m) => ({ default: m.AdminScans })),
);
const AdminChatAnswers = lazy(() =>
  import('@/features/admin/AdminChatAnswers').then((m) => ({ default: m.AdminChatAnswers })),
);
const AdminMemories = lazy(() =>
  import('@/features/admin/AdminMemories').then((m) => ({ default: m.AdminMemories })),
);
const AdminGame = lazy(() =>
  import('@/features/admin/AdminGame').then((m) => ({ default: m.AdminGame })),
);
const AdminSettings = lazy(() =>
  import('@/features/admin/AdminSettings').then((m) => ({ default: m.AdminSettings })),
);

export const router = createBrowserRouter([
  {
    element: <GameShell />,
    children: [
      { path: '/', element: <WelcomePage /> },
      { path: '/memory', element: <MemoryWallPage /> },
      { path: '/ranking', element: <RankingPage /> },
      {
        element: <RequireAuth />,
        children: [
          { path: '/user', element: <UserProfilePage /> },
          { path: '/missions', element: <MissionSelectPage /> },
          { path: '/missions/trivia', element: <TriviaIntroPage /> },
          { path: '/missions/trivia/cards', element: <TriviaCardsPage /> },
          { path: '/missions/trivia/:cardId/scan', element: <ScannerPage mode="trivia" /> },
          { path: '/missions/teammate', element: <TeammateIntroPage /> },
          { path: '/missions/teammate/list', element: <FindTeammatePage /> },
          { path: '/missions/teammate/scan', element: <ScannerPage mode="teammate" /> },
          { path: '/result/success', element: <SuccessPage /> },
          { path: '/result/fail/:pairId', element: <FailPenaltyPage /> },
          { path: '/chat/:pairId', element: <ChatConfirmPage /> },
          { path: '/complete', element: <CompletedPage /> },
          { path: '/time-up', element: <TimeUpPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
  // Login route lives OUTSIDE the AdminShell so it stays reachable without
  // an admin session — AdminShell would otherwise bounce-loop to /admin/login.
  { path: '/admin/login', element: <AdminLogin /> },
  {
    path: '/admin',
    element: <AdminShell />,
    children: [
      { index: true, element: <AdminDashboard /> },
      { path: 'players', element: <AdminPlayers /> },
      { path: 'players/:id', element: <AdminPlayerDetail /> },
      { path: 'employees', element: <AdminEmployees /> },
      { path: 'trivia', element: <AdminTrivia /> },
      { path: 'pairs', element: <AdminPairs /> },
      { path: 'scans', element: <AdminScans /> },
      { path: 'chat-answers', element: <AdminChatAnswers /> },
      { path: 'memories', element: <AdminMemories /> },
      { path: 'game', element: <AdminGame /> },
      { path: 'settings', element: <AdminSettings /> },
    ],
  },
]);
