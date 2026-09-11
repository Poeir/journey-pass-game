import { useEffect, useState } from 'react';
import { useGame, selectTotal, selectTriviaDone, selectTeammateDone } from '@/game/gameStore';
import { LanguageToggle } from '@/design-system/LanguageToggle';
import './ProgressDock.css';

interface Props {
  onShowQR: () => void;
  onLogout: () => void;
  loggingOut: boolean;
}

export function ProgressDock({ onShowQR, onLogout, loggingOut }: Props) {
  const profile = useGame((s) => s.profile);
  const trivia = useGame(selectTriviaDone);
  const team = useGame(selectTeammateDone);
  const total = useGame(selectTotal);
  const gameEndedAt = useGame((s) => s.gameEndedAt);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const expired = gameEndedAt !== null;
  const remainingMs = gameEndedAt
    ? 0
    : Math.max(0, new Date(new Date(now).setHours(17, 0, 0, 0)).getTime() - now);
  const totalMinutes = Math.max(0, Math.floor(remainingMs / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  const firstName = profile?.name.split(' ')[0] ?? 'You';

  return (
    <div className="dock">
      <div className="dock__header">
        <span className=" dock__title"><strong>{firstName}</strong>'s Journey</span>
        <div className="dock__header-actions">
          <LanguageToggle size="sm" />
          <button
            className="dock__profile sk-hand-b"
            onClick={onShowQR}
            aria-label="Show my QR code"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <path d="M14 14h3v3h-3zM18 18h3v3h-3zM14 18h2M14 21h2" />
            </svg>
            <span>My QR</span>
          </button>
          <button
            className="dock__logout sk-hand-b"
            onClick={onLogout}
            disabled={loggingOut}
            aria-label={loggingOut ? 'Logging out' : 'Log out'}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span>{loggingOut ? 'Logging out...' : 'Log out'}</span>
          </button>
        </div>
      </div>

      <div className="dock__mission">
        <div className="dock__mission-info">
          <span className="dock__mission-label">Your missions</span>
          <span
            className={`dock__time${expired ? ' dock__time--expired' : ''}`}
            aria-label={
              expired
                ? 'Game time is up'
                : `Time remaining: ${hours} hours ${minutes} minutes`
            }
          >
            {expired
              ? 'Time is up'
              : `${hours}h ${minutes}m left`}
          </span>
        </div>
        <span
          className={`dock__count${total === 0 ? ' dock__count--zero' : ''}`}
          aria-label={`${total} of 10 stamps collected`}
        >
          {total}/10
        </span>
      </div>

      <div className="dock__combo-labels">
        <span className="dock__label">Trivia {trivia}/5</span>
        <span className="dock__label dock__label--blue">Team {team}/5</span>
      </div>
      <div className="dock__combo-bar">
        <div
          className="dock__combo-fill dock__combo-fill--trivia"
          style={{ width: `${(trivia / 10) * 100}%` }}
        />
        <div
          className="dock__combo-fill dock__combo-fill--team"
          style={{
            left: `${(trivia / 10) * 100}%`,
            width: `${(team / 10) * 100}%`,
          }}
        />
        <div className="dock__combo-ticks" aria-hidden>
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
