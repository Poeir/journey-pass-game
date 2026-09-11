import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IntroShell } from '@/design-system/IntroShell';
import { useGame } from '@/game/gameStore';
import { missionEndpoints } from '@/api/endpoints';
import { ROUTES } from '@/lib/routes';
import { useT } from '@/lib/i18n';
import './TriviaIntroPage.css';

export function TriviaIntroPage() {
  const t = useT();
  const navigate = useNavigate();
  const markTriviaIntroSeen = useGame((s) => s.markTriviaIntroSeen);
  const startTrivia = useGame((s) => s.startTrivia);
  const [shuffling, setShuffling] = useState(false);

  useEffect(() => {
    // Only skip if the user has both seen the intro AND already drawn cards.
    // Skipping when cards is empty would loop back through TriviaCardsPage.
    const s = useGame.getState();
    if (s.triviaIntroSeen && s.trivia.cards.length > 0) {
      navigate(ROUTES.triviaCards, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!shuffling) return;
    const t = setTimeout(() => navigate(ROUTES.triviaCards), 1500);
    return () => clearTimeout(t);
  }, [shuffling, navigate]);

  const handleStart = async () => {
    if (useGame.getState().trivia.cards.length === 0) {
      try {
        const { cards } = await missionEndpoints.startTrivia();
        startTrivia(cards);
      } catch {
        return;
      }
    }
    markTriviaIntroSeen();
    setShuffling(true);
  };

  const illustration = (
    <div className="tintro__deck" aria-hidden>
      {[-10, -3, 4, 11].map((r, i) => (
        <div
          key={i}
          className="sk-trivia-card tintro__card"
          style={{
            ['--r' as any]: `${r}deg`,
            ['--ty' as any]: `${i * -2}px`,
            background: i === 3 ? 'var(--gf-seashell)' : '#fff',
          }}
        >
          <div className="sk-hand tintro__card-tag">{t('trivia.intro.cardTag', { n: i + 1 })}</div>
          <div className="sk-hand-b tintro__card-qm">{t('trivia.intro.cardQm')}</div>
        </div>
      ))}
    </div>
  );

  return (
    <IntroShell
      rootClassName="tintro"
      loadingClassName="tintro--shuffle"
      loading={shuffling}
      title={t('trivia.intro.title')}
      titleTone="flame"
      onBack={() => navigate(-1)}
      illustration={illustration}
      copy={
        <>
          <b>{t('trivia.intro.howToPlay')}</b> {t('trivia.intro.copyLine1Prefix')} <b style={{ color: 'var(--gf-flame)' }}>{t('trivia.intro.copyLine1Highlight')}</b> {t('trivia.intro.copyLine1Suffix')}<br />
          {t('trivia.intro.copyLine2Prefix')} <b>{t('trivia.intro.copyLine2Bold')}</b> {t('trivia.intro.copyLine2Suffix')}<br />
          <br />
          <b style={{ color: 'var(--gf-flame)' }}>{t('trivia.intro.rightPerson')}</b> · {t('trivia.intro.rightPersonResult')}<br />
          <b style={{ color: '#c98a00' }}>{t('trivia.intro.wrongPerson')}</b> · {t('trivia.intro.wrongPersonResult')}<br />
        </>
      }
      loadingCopy={<span style={{ color: 'var(--gf-flame)' }}>{t('trivia.intro.shuffling')}</span>}
      ctaLabel={t('trivia.intro.cta')}
      ctaColor="flame"
      onCta={handleStart}
    />
  );
}
