import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IntroShell } from '@/design-system/IntroShell';
import { useGame, formatYearGroup } from '@/game/gameStore';
import { ROUTES } from '@/lib/routes';
import { useT } from '@/lib/i18n';
import './TeammateIntroPage.css';

export function TeammateIntroPage() {
  const t = useT();
  const navigate = useNavigate();
  const markTeammateIntroSeen = useGame((s) => s.markTeammateIntroSeen);
  const profile = useGame((s) => s.profile);
  const year = useGame((s) => s.teammate.year);
  const leaderClue = useGame((s) => s.teammate.leaderClue);
  const [matching, setMatching] = useState(false);
  const isSelfLeader = profile?.isLeader === true;

  useEffect(() => {
    if (useGame.getState().teammateIntroSeen) {
      navigate(ROUTES.teammate, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!matching) return;
    const t = setTimeout(() => navigate(ROUTES.teammate), 1500);
    return () => clearTimeout(t);
  }, [matching, navigate]);

  const handleStart = () => {
    markTeammateIntroSeen();
    setMatching(true);
  };

  const illustration = (
    <div className="mintro__deck" aria-hidden>
      <div className="mintro__slot mintro__slot--leader">
        <div className="mintro__slot-crown">👑</div>
      </div>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className={`mintro__slot mintro__slot--member mintro__slot--m${i + 1}`}>
          <span className="mintro__slot-q">?</span>
        </div>
      ))}
      <div className="mintro__pulse" aria-hidden />
      <div className="mintro__pulse mintro__pulse--2" aria-hidden />
    </div>
  );

  return (
    <IntroShell
      rootClassName="mintro"
      loadingClassName="mintro--matching"
      loading={matching}
      title={t('teammate.intro.title')}
      titleTone="blue"
      onBack={() => navigate(-1)}
      illustration={illustration}
      copy={
        <>
          <b>{t('teammate.intro.howToPlay')}</b> {t('teammate.intro.copyLine1Prefix')} <b style={{ color: 'var(--venio-bluetiful)' }}>{t('teammate.intro.copyLine1Highlight')}</b> {t('teammate.intro.copyLine1Suffix')}<br />
          {isSelfLeader ? (
            <>
              <b style={{ color: '#c98a00' }}>{t('teammate.intro.selfLeaderLine1')}</b> {t('teammate.intro.selfLeaderLine1Suffix')}<br />
              <b style={{ color: '#c98a00' }}>{t('teammate.intro.selfLeaderLine2')}</b> {t('teammate.intro.selfLeaderLine2Suffix')}<br />
            </>
          ) : (
            <>
              <b style={{ color: '#c98a00' }}>{t('teammate.intro.nonSelfLeaderLine1Prefix')}</b> {t('teammate.intro.nonSelfLeaderLine1Mid1')} <b>{t('teammate.intro.nonSelfLeaderLine1Bold')}</b> {t('teammate.intro.nonSelfLeaderLine1Suffix')}<br />
            </>
          )}
          <br />
          <b style={{ color: 'var(--venio-bluetiful)' }}>{t('teammate.intro.membersLine1Prefix')}</b> {t('teammate.intro.membersLine1Mid')} <b>{formatYearGroup(year)}</b> {t('teammate.intro.membersLine1Suffix')}<br />
          <b style={{ color: 'var(--gf-flame)' }}>{t('teammate.intro.specialRule')}</b> {t('teammate.intro.specialRuleMid1')} <b>{t('teammate.intro.specialRuleBold1')}</b> {t('teammate.intro.specialRuleMid2')} <b>{t('teammate.intro.specialRuleBold2')}</b><br />
          {t('teammate.intro.perPersonScan')}<br />
          {!isSelfLeader && leaderClue && (
            <>
              <br />
              <b style={{ color: '#c98a00' }}>{t('teammate.intro.yourLeaderClue')}</b><br />
              <span style={{ fontStyle: 'italic' }}>{leaderClue}</span>
            </>
          )}
        </>
      }
      loadingCopy={<span style={{ color: 'var(--venio-bluetiful)' }}>{t('teammate.intro.starting')}</span>}
      ctaLabel={t('teammate.intro.cta')}
      ctaColor="blue"
      onCta={handleStart}
    />
  );
}
