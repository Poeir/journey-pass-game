import { useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmployeeRow } from '@/design-system/EmployeeRow';
import { PageHeader } from '@/design-system/PageHeader';
import { Sheet } from '@/design-system/Sheet';
import { Stamp } from '@/design-system/Stamp';
import { useGame, selectCurrentTriviaCardId } from '@/game/gameStore';
import { ROUTES } from '@/lib/routes';
import { useT } from '@/lib/i18n';
import { IconArrowLeft, IconCheck, IconChevronRight, IconLock } from '@/design-system/icons';
import info01 from '../../../assets/info01.png';
import cardTriviaComplete from '../../../assets/card_trivia_complete.png';
import './TriviaCardsPage.css';

export function TriviaCardsPage() {
  const t = useT();
  const navigate = useNavigate();
  const cards = useGame((s) => s.trivia.cards);
  const stamps = useGame((s) => s.trivia.stamps);
  const currentCardId = useGame(selectCurrentTriviaCardId);
  const [helpOpen, setHelpOpen] = useState(false);

  if (cards.length === 0) {
    return (
      <div className="tcards tcards--empty">
        <p className="tcards__empty-title">{t('trivia.cards.emptyTitle')}</p>
        <p className="tcards__empty-sub">{t('trivia.cards.emptySub')}</p>
        <button onClick={() => navigate(ROUTES.triviaIntro)} className="sk-hand-b tcards__empty-btn">
          <IconArrowLeft size={16} /> {t('trivia.cards.goDraw')}
        </button>
      </div>
    );
  }

  const done = Object.keys(stamps).length;

  return (
    <div
      className="tcards"
      style={{ '--card-trivia-bg': `url(${cardTriviaComplete})` } as CSSProperties}
    >
      <PageHeader
        onBack={() => navigate(ROUTES.missions)}
        title={t('trivia.cards.title')}
        titleTone="flame"
        titleSize="sm"
        trailing={
          <div className="tcards__head-trailing">
            <span className="tcards__count">{done}/5</span>
            <button
              type="button"
              className="tcards__help-btn"
              onClick={() => setHelpOpen(true)}
              aria-label={t('trivia.cards.helpAria')}
            >
              <img src={info01} alt="" className="tcards__help-icon" />
            </button>
          </div>
        }
      />

      <ul className="tcards__list">
        {cards.map((card) => {
          const completed = stamps[card.id] !== undefined;
          const isOpen = !completed && card.id === currentCardId;
          const isLocked = !completed && !isOpen;
          const rowClass = [
            'tcards__row',
            isOpen ? 'tcards__row--open' : '',
            isLocked ? 'tcards__row--locked' : '',
          ].filter(Boolean).join(' ');
          return (
            <EmployeeRow
              as="li"
              key={card.id}
              tone={completed ? 'completed' : 'default'}
              className={rowClass}
              onClick={isOpen ? () => navigate(ROUTES.triviaScan(card.id)) : undefined}
              leading={
                <Stamp filled={completed}>
                  {completed ? <IconCheck size={16} /> : isLocked ? <IconLock size={14} /> : card.index}
                </Stamp>
              }
              trailing={isOpen ? <div className="tcards__row-arrow"><IconChevronRight /></div> : undefined}
            >
              <div className="sk-hand tcards__row-tag">{t('trivia.cards.cardLabel', { index: card.index })}</div>
              <div
                className={[
                  'tcards__row-clue',
                  completed ? 'tcards__row-clue--done' : '',
                  isLocked ? 'tcards__row-clue--locked' : '',
                ].filter(Boolean).join(' ')}
              >
                {isLocked ? t('trivia.cards.lockedClue') : card.clue}
              </div>
            </EmployeeRow>
          );
        })}
      </ul>

      <p className="tcards__hint">{t('trivia.cards.hint')}</p>

      <Sheet
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        position="center"
        title={t('trivia.cards.helpTitle')}
      >
        <div className="tcards__help-body">
          <p>
            <b>{t('trivia.cards.helpP1Prefix')}</b> {t('trivia.cards.helpP1Mid1')}{' '}
            <b style={{ color: 'var(--gf-flame)' }}>{t('trivia.cards.helpP1Highlight')}</b>{t('trivia.cards.helpP1Mid2')}
            <b>{t('trivia.cards.helpP1OneAtATime')}</b>{t('trivia.cards.helpP1Suffix')}
            <br />
            {t('trivia.cards.helpP1Line2Prefix')} <b>{t('trivia.cards.helpP1Line2Bold')}</b> {t('trivia.cards.helpP1Line2Suffix')}
          </p>
          <p>
            <b style={{ color: 'var(--gf-flame)' }}>{t('trivia.cards.helpP2RightPerson')}</b> · {t('trivia.cards.helpP2RightPersonResult')}
            <br />
            <b style={{ color: '#c98a00' }}>{t('trivia.cards.helpP2WrongPerson')}</b> · {t('trivia.cards.helpP2WrongPersonResult')}
          </p>
          <p className="tcards__help-tip">
            {t('trivia.cards.helpTip')}
          </p>
        </div>
      </Sheet>
    </div>
  );
}
