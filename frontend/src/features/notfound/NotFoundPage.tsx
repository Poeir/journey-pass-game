import { useNavigate } from 'react-router-dom';
import { Button } from '@/design-system/Button';
import { Stamp } from '@/design-system/Stamp';
import { IconArrowLeft, IconHelp } from '@/design-system/icons';
import { useGame } from '@/game/gameStore';
import { ROUTES } from '@/lib/routes';
import './NotFoundPage.css';

export function NotFoundPage() {
  const navigate = useNavigate();
  const profile = useGame((s) => s.profile);
  const home = profile ? ROUTES.user : ROUTES.welcome;

  return (
    <div className="notfound">
      <div className="notfound__art" aria-hidden>
        <Stamp size={68}><IconHelp size={36} /></Stamp>
        <div className="sk-hand-b notfound__code">404</div>
      </div>

      <h1 className="sk-hand-b notfound__title">Page not found</h1>
      <p className="notfound__lede">
        The link might be misspelled, or this page has been moved.<br />
        Head back home and keep going on your missions.
      </p>

      <div className="notfound__spacer" />

      <Button block onClick={() => navigate(home)}>
        <span className="notfound__btn-inner">Back to home</span>
      </Button>
      <button className="notfound__back-link sk-hand" onClick={() => navigate(-1)}>
        <IconArrowLeft size={14} /> Go back
      </button>
    </div>
  );
}
