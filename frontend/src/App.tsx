import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { authEndpoints } from './api/endpoints';
import { useGame } from './game/gameStore';

export default function App() {
  useEffect(() => {
    // Always verify/hydrate the session on startup so the frontend reflects
    // backend auth state even when localStorage was cleared or the user
    // returns with a valid cookie but no persisted profile.
    // 401 is handled globally by handleUnauthorized in api/client.ts.
    //
    // Skip on the admin portal — admin doesn't require a game session, and a
    // 401 here would otherwise clear the (possibly fine) game profile when
    // an admin-only user opens /admin.
    const path = window.location.pathname;
    if (path === '/admin' || path.startsWith('/admin/')) return;
    authEndpoints
      .me()
      .then((res) => useGame.getState().setProfile(res))
      .catch(() => {
        // handleUnauthorized already handled any 401 redirect; swallow other errors.
      });
  }, []);

  return <RouterProvider router={router} />;
}
