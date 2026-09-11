import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useGame } from '@/game/gameStore';
import { ROUTES } from '@/lib/routes';
import { authEndpoints } from '@/api/endpoints';

export function RequireAuth() {
  const profile = useGame((s) => s.profile);
  const setProfile = useGame((s) => s.setProfile);
  // After Azure SSO the backend redirects to /user with a `jp_sess` cookie,
  // but `gameStore.profile` is still null (no client-side login call ran).
  // Try to hydrate from /me once before bouncing to the welcome page.
  const [bootstrapping, setBootstrapping] = useState(profile === null);

  useEffect(() => {
    if (profile || !bootstrapping) return;
    let cancelled = false;
    authEndpoints
      .me()
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
      })
      .catch(() => {
        // 401 is handled globally by api/client.ts (redirect to /?expired=1).
        // Other errors fall through and the Navigate below sends us home.
      })
      .finally(() => {
        if (cancelled) return;
        setBootstrapping(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile, bootstrapping, setProfile]);

  if (profile) return <Outlet />;
  if (bootstrapping) return null;
  return <Navigate to={ROUTES.welcome} replace />;
}
