import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '@/design-system/Avatar';
import { PassportButton } from '@/design-system/PassportButton';
import { EmployeeRow } from '@/design-system/EmployeeRow';
import { Stamp } from '@/design-system/Stamp';
import { IconCheck, IconClock, IconCrown, IconStar, IconUsers } from '@/design-system/icons';
import {
  selectTeammateDone,
  selectTotal,
  selectTriviaDone,
  useGame,
} from '@/game/gameStore';
import { authEndpoints } from '@/api/endpoints';
import { ROUTES } from '@/lib/routes';
import { useT } from '@/lib/i18n';
import './TimeUpPage.css';

const CONFETTI = Array.from({ length: 26 }).map((_, i) => ({
  left: `${(i * 37 + 5) % 100}%`,
  top: `${(i * 53 + 7) % 100}%`,
  bg:
    i % 4 === 0
      ? '#fff'
      : i % 4 === 1
        ? 'var(--salesbear-sunglow)'
        : i % 4 === 2
          ? 'var(--gf-peach-puff)'
          : 'var(--venio-zircon)',
  rot: (i * 31) % 360,
  round: i % 3 === 0 ? '50%' : '2px',
  size: i % 5 === 0 ? 8 : 6,
  delay: 200 + i * 30,
}));

export function TimeUpPage() {
  const t = useT();
  const navigate = useNavigate();
  const total = useGame(selectTotal);
  const triviaDone = useGame(selectTriviaDone);
  const teamDone = useGame(selectTeammateDone);
  const cards = useGame((s) => s.trivia.cards);
  const stamps = useGame((s) => s.trivia.stamps);
  const leaderSlot = useGame((s) => s.teammate.leaderSlot);
  const slots = useGame((s) => s.teammate.slots);
  const profile = useGame((s) => s.profile);
  const reset = useGame((s) => s.reset);
  const [loggingOut, setLoggingOut] = useState(false);

  const firstName = profile?.name.split(' ')[0] ?? t('result.timeUp.youFallback');

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
  };

  return (
    <div className="timeup">
      <div className="timeup__rays" aria-hidden="true">
        {Array.from({ length: 14 }).map((_, i) => (
          <span
            key={i}
            className="timeup__ray"
            style={{ transform: `rotate(${i * (360 / 14)}deg) translateY(-40%)` }}
          />
        ))}
      </div>

      <div className="timeup__hero">
        <div className="timeup__confetti-field" aria-hidden="true">
          {CONFETTI.map((d, i) => (
            <span
              key={i}
              className="sk-confetti timeup__confetti"
              style={{
                left: d.left,
                top: d.top,
                width: `${d.size}px`,
                height: `${d.size}px`,
                background: d.bg,
                borderRadius: d.round,
                transform: `rotate(${d.rot}deg)`,
                animationDelay: `${d.delay}ms`,
              }}
            />
          ))}
        </div>
        <div className="timeup__emblem-wrap">
          <div className="timeup__emblem" aria-hidden="true">
            <span className="timeup__emblem-icon"><IconClock size={56} /></span>
          </div>
        </div>
        <div className="sk-hand-b timeup__kicker">{t('result.timeUp.kicker')}</div>
        <h1 className="sk-hand-b timeup__title">{t('result.timeUp.title')}</h1>
        <div className="timeup__sub">{t('result.timeUp.collected', { name: firstName })}</div>
        <div className="timeup__scorecard">
          <div className="timeup__score">
            <span className="sk-hand-b timeup__score-num">{total}</span>
            <span className="sk-hand-b timeup__score-slash">/</span>
            <span className="sk-hand-b timeup__score-total">10</span>
          </div>
          <div className="timeup__score-breakdown">
            <span className="timeup__score-chip timeup__score-chip--trivia">
              <IconStar size={14} />
              <span className="sk-hand-b">{triviaDone}/5</span>
            </span>
            <span className="timeup__score-chip timeup__score-chip--team">
              <IconUsers size={14} />
              <span className="sk-hand-b">{teamDone}/5</span>
            </span>
          </div>
        </div>
      </div>

      <div className="timeup__panel timeup__panel--trivia">
        <div className="timeup__panel-head">
          <span className="sk-hand-b timeup__panel-title">{t('result.timeUp.triviaHunter')}</span>
          <span className="sk-hand-b timeup__panel-count">{triviaDone}/5</span>
        </div>
        {cards.length === 0 ? (
          <div className="timeup__empty">{t('result.timeUp.noTrivia')}</div>
        ) : (
          <ul className="timeup__list timeup__list--trivia">
            {cards.map((card) => {
              const target = stamps[card.id];
              const completed = target !== undefined;
              return (
                <EmployeeRow
                  as="li"
                  key={card.id}
                  tone={completed ? 'completed' : 'default'}
                  className="timeup__trivia-row"
                  leading={
                    <Stamp filled={completed}>
                      {completed ? <IconCheck size={16} /> : card.index}
                    </Stamp>
                  }
                >
                  <div className="sk-hand timeup__trivia-tag">{t('result.timeUp.cardLabel', { index: card.index })}</div>
                  <div
                    className={`timeup__trivia-clue ${completed ? 'timeup__trivia-clue--done' : ''}`}
                  >
                    {card.clue}
                  </div>
                  {target && (
                    <div className="sk-hand-b timeup__trivia-target">
                      {t('result.timeUp.targetArrow', { name: target.name })}
                    </div>
                  )}
                </EmployeeRow>
              );
            })}
          </ul>
        )}
      </div>

      <div className="timeup__panel timeup__panel--team">
        <div className="timeup__panel-head">
          <span className="sk-hand-b timeup__panel-title">{t('result.timeUp.findYourTeam')}</span>
          <span className="sk-hand-b timeup__panel-count">{teamDone}/5</span>
        </div>

        <ul className="timeup__list">
          {leaderSlot ? (
            <li
              className="timeup__row timeup__row--leader is-done"
              style={{ animationDelay: '1500ms' }}
            >
              <Avatar initial={leaderSlot.initial} photoUrl={leaderSlot.photoUrl} size={36} tone="blue" />
              <div className="timeup__person">
                <span className="sk-hand-b timeup__person-name">{leaderSlot.name}</span>
                <span className="timeup__person-sub">{leaderSlot.dept}</span>
              </div>
              <span className="timeup__leader-tag">
                <IconCrown size={12} />
                {t('result.timeUp.leaderTag')}
              </span>
            </li>
          ) : (
            <li
              className="timeup__row timeup__row--leader is-empty"
              style={{ animationDelay: '1500ms' }}
            >
              <Stamp size={36}><IconCrown size={18} /></Stamp>
              <span className="timeup__empty-row">{t('result.timeUp.noLeader')}</span>
            </li>
          )}

          {slots.map((slot, i) =>
            slot ? (
              <li
                key={`slot-${i}`}
                className="timeup__row is-done"
                style={{ animationDelay: `${1580 + i * 80}ms` }}
              >
                <Avatar initial={slot.initial} photoUrl={slot.photoUrl} size={36} tone="blue" />
                <div className="timeup__person">
                  <span className="sk-hand-b timeup__person-name">{slot.name}</span>
                  <span className="timeup__person-sub">
                    {slot.dept} · {t('result.timeUp.classOf', { year: slot.year })}
                  </span>
                </div>
              </li>
            ) : (
              <li
                key={`slot-${i}`}
                className="timeup__row is-empty"
                style={{ animationDelay: `${1580 + i * 80}ms` }}
              >
                <Stamp size={36}>{i + 1}</Stamp>
                <span className="timeup__empty-row">{t('result.timeUp.emptySlot')}</span>
              </li>
            ),
          )}
        </ul>
      </div>

      <div className="timeup__cta">
        <PassportButton block onClick={handleLogout} disabled={loggingOut}>
          {loggingOut ? t('result.timeUp.loggingOut') : t('result.timeUp.logOut')}
        </PassportButton>
      </div>
    </div>
  );
}
