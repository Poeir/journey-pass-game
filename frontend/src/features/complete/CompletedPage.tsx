import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { PassportButton } from '@/design-system/PassportButton';
import { Stamp } from '@/design-system/Stamp';
import { useGame } from '@/game/gameStore';
import { completionEndpoints } from '@/api/endpoints';
import { ROUTES } from '@/lib/routes';
import './CompletedPage.css';

export function CompletedPage() {
  const navigate = useNavigate();
  const reset = useGame((s) => s.reset);

  useEffect(() => {
    completionEndpoints.markComplete().catch(() => {
      // Idempotent on the backend — safe to retry on next mount.
    });
  }, []);

  return (
    <div className="complete">
      <div className="complete__rays" aria-hidden="true">
        {Array.from({ length: 16 }).map((_, i) => (
          <span
            key={i}
            className="complete__ray"
            style={{ transform: `rotate(${i * 22.5}deg) translateY(-40%)` }}
          />
        ))}
      </div>
      <div className="sk-hand-b complete__kicker">COMPLETED!</div>
      <h1 className="sk-hand-b complete__title">JOURNEY<br />COMPLETE!</h1>
      <div className="sk-hand complete__sub">10/10 stamps collected 🏆</div>

      <div className="complete__panel">
        <div className="sk-hand-b complete__panel-title">Your passport</div>
        <div className="complete__grid">
          {Array.from({ length: 10 }).map((_, i) => (
            <Stamp key={i} filled size={44}>{i < 5 ? '✓' : '☺'}</Stamp>
          ))}
        </div>
      </div>

      <div className="complete__spacer" />

      <PassportButton
        block
        onClick={() => {
          reset();
          navigate(ROUTES.welcome);
        }}
      >
        See you for the results tonight!
      </PassportButton>
    </div>
  );
}
