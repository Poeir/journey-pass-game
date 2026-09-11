import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '@/design-system/Avatar';
import { PassportButton } from '@/design-system/PassportButton';
import { Card } from '@/design-system/Card';
import { useGame } from '@/game/gameStore';
import { ROUTES } from '@/lib/routes';
import { authEndpoints } from '@/api/endpoints';
import card04 from '../../../assets/card04.png';
import './LoginPage.css';

interface CriteriaLetterProps {
  open: boolean;
  onClose: () => void;
  criteria: string[];
}

function CriteriaLetter({ open, onClose, criteria }: CriteriaLetterProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const baseDelay = 0.55;
  const chipStep = 0.12;
  const postscriptDelay = baseDelay + criteria.length * chipStep + 0.15;
  const actionDelay = postscriptDelay + 0.25;

  return (
    <div
      className="letter-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="criteria-letter-title"
    >
      <button className="letter-backdrop" aria-label="Close" onClick={onClose} />
      <div
        className="letter-paper"
        style={{ '--paper-bg': `url(${card04})` } as CSSProperties}
      >
        <h2 id="criteria-letter-title" className="sk-hand-b letter-title">
          Please remember these
        </h2>
        <p className="letter-sub">
          — These are the things people remember about you —
        </p>
        <ul className="letter-chips" aria-live="polite">
          {criteria.map((c, i) => (
            <li
              key={c}
              className="letter-chip"
              style={{ animationDelay: `${baseDelay + i * chipStep}s` }}
            >
              {c}
            </li>
          ))}
        </ul>
        <p
          className="letter-postscript sk-hand"
          style={{ animationDelay: `${postscriptDelay}s` }}
        >
          Read this once. Then carry it with you...
        </p>
        <div className="letter-action" style={{ animationDelay: `${actionDelay}s` }}>
          <PassportButton block onClick={onClose}>
            I'll remember
          </PassportButton>
        </div>
      </div>
    </div>
  );
}

export function UserProfilePage() {
  const navigate = useNavigate();
  const profile = useGame((s) => s.profile);
  const profileCriteriaSeen = useGame((s) => s.profileCriteriaSeen);
  const markProfileCriteriaSeen = useGame((s) => s.markProfileCriteriaSeen);
  const [criteria, setCriteria] = useState<string[] | null>(null);

  useEffect(() => {
    if (!profile) return;
    if (profileCriteriaSeen) return;
    let cancelled = false;
    authEndpoints
      .criteria()
      .then(({ criteria }) => {
        if (cancelled) return;
        const seen = new Set<string>();
        const deduped: string[] = [];
        for (const c of criteria) {
          const label = c.trim();
          if (label && !seen.has(label)) {
            seen.add(label);
            deduped.push(label);
          }
        }
        setCriteria(deduped);
      })
      .catch(() => {
        if (cancelled) return;
        setCriteria([]);
      });
    return () => {
      cancelled = true;
    };
  }, [profile, profileCriteriaSeen]);

  const showCriteriaSheet =
    !profileCriteriaSeen && criteria !== null && criteria.length > 0;
  const closeCriteriaSheet = () => {
    markProfileCriteriaSeen();
  };

  if (!profile) {
    navigate(ROUTES.welcome, { replace: true });
    return null;
  }

  const tenure = 2026 - profile.year;
  const isFreshHire = tenure <= 0;
  const subParts = [profile.position, profile.dept].filter((s): s is string => Boolean(s && s.trim()));
  if (!isFreshHire) subParts.push(`${tenure} yrs`);
  const subLine = subParts.join(' · ');

  return (
    <div
      className="login login--profile"
      style={{ '--paper-bg': `url(${card04})` } as CSSProperties}
    >
      <div className="login__paper">

      <h1 className="sk-hand-b login__greeting" style={{ marginTop: 10 }}>
        Hello {profile.nickname || profile.name.split(' ')[0]}!
      </h1>
      <p style={{ marginTop: 0 }}>
        Welcome to the 5.5 event!
      </p>

      <Card sketch className="login__card">
        <div className="login__profile-row">
          <Avatar initial={profile.initial} photoUrl={profile.photoUrl} size={56} />
          <div className="login__profile-meta">
            <div className="sk-hand-b login__name">
              {profile.name}
              {profile.nickname ? <span className="login__nickname"> ({profile.nickname})</span> : null}
            </div>
            {subLine ? <div className="login__sub">{subLine}</div> : null}
          </div>
        </div>
        <div className="login__stats">
          <div className="login__stat">
            <div className="login__stat-label">Class of</div>
            <div className="sk-hand-b login__stat-val">{profile.year}</div>
          </div>
          <div className="login__stat">
            <div className="login__stat-label">Employee ID</div>
            <div className="sk-hand-b login__stat-val">{profile.id}</div>
          </div>
        </div>
      </Card>

      <Card sketch tone="sky" className="login__criteria">
        <div className="login__criteria-title">
          {isFreshHire
            ? 'Your first year here is about to begin'
            : `${tenure} ${tenure === 1 ? 'year' : 'years'} on the journey`}
        </div>
        <p className="login__criteria-desc">
          {isFreshHire
            ? 'Your first step starts here. The stories you build from now on will become the things people remember about you.'
            : 'Along the way, you have gathered so much — awards, big moments, and the little details that make you, you. Each one is a thread in the story you are still writing. Today, you add another.'}
        </p>
      </Card>

      <div className="login__spacer" />

      <div className="login__cta-sticky">
        <PassportButton block onClick={() => navigate(ROUTES.missions)}>
          Go to Missions
        </PassportButton>
      </div>
      </div>

      <CriteriaLetter
        open={showCriteriaSheet}
        onClose={closeCriteriaSheet}
        criteria={criteria ?? []}
      />
    </div>
  );
}
