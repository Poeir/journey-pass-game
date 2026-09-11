import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/design-system/Button';
import { InfoPanel } from '@/design-system/InfoPanel';
import { Sheet } from '@/design-system/Sheet';
import { scanEndpoints } from '@/api/endpoints';
import { useGame } from '@/game/gameStore';
import { ROUTES } from '@/lib/routes';
import { usePairSocket } from '@/lib/useWebSocket';
import { PhotoCapture } from '@/lib/PhotoCapture';
import { useT } from '@/lib/i18n';
import fail01 from '../../../assets/fail01.png';
import info01 from '../../../assets/info01.png';
import cardTriviaComplete from '../../../assets/card_trivia_complete.png';
import './FailPenaltyPage.css';

type Party = { id: string; name: string } | null;

export function FailPenaltyPage() {
  const t = useT();
  const navigate = useNavigate();
  const { pairId } = useParams();
  const myId = useGame((s) => s.profile?.id);
  const [proofPhotoUrl, setProofPhotoUrl] = useState<string | null>(null);
  const [hunter, setHunter] = useState<Party>(null);
  const [target, setTarget] = useState<Party>(null);
  const [loaded, setLoaded] = useState(false);
  const [penaltyText, setPenaltyText] = useState<string | null>(null);

  usePairSocket(pairId, {
    'penalty.update': (ev) => {
      if (ev.proofPhotoUrl) setProofPhotoUrl(ev.proofPhotoUrl);
    },
  });

  useEffect(() => {
    if (!pairId) return;
    let off = false;
    scanEndpoints
      .getPenaltyState(pairId)
      .then((res) => {
        if (off) return;
        setProofPhotoUrl(res.proofPhotoUrl);
        setHunter(res.hunter);
        setTarget(res.target);
        setPenaltyText(res.penalty?.text ?? null);
        setLoaded(true);
      })
      .catch(() => {
        if (off) return;
        setLoaded(true);
      });
    return () => {
      off = true;
    };
  }, [pairId]);

  const role: 'hunter' | 'target' | null =
    myId && hunter && target
      ? myId === hunter.id
        ? 'hunter'
        : myId === target.id
          ? 'target'
          : null
      : null;

  const refetch = async () => {
    if (!pairId) return;
    try {
      const res = await scanEndpoints.getPenaltyState(pairId);
      setProofPhotoUrl(res.proofPhotoUrl);
      setHunter(res.hunter);
      setTarget(res.target);
      setPenaltyText(res.penalty?.text ?? null);
    } catch {
      // toast already pushed by api client
    }
  };

  const onUpload = async (file: File) => {
    if (!pairId) return;
    try {
      const res = await scanEndpoints.confirmPenalty(pairId, file);
      setProofPhotoUrl(res.proofPhotoUrl);
    } catch {
      // backend likely rejected role — re-sync to flip UI
      await refetch();
    }
  };

  const onContinue = () => {
    useGame.getState().setPenalty(null);
    // Penalty is trivia-exclusive; loop back to the cards page so the player
    // re-attacks the same (still-unstamped) card without an extra detour.
    navigate(ROUTES.triviaCards);
  };

  if (!loaded || !role) {
    return (
      <div className="fail fail--loading">
        {loaded ? (
          <>
            <div className="fail__notice-title">{t('result.fail.notYours')}</div>
            <div className="fail__notice-sub">
              {t('result.fail.notYoursSub')}
            </div>
          </>
        ) : (
          <div>{t('result.fail.loading')}</div>
        )}
        {loaded && (
          <button
            type="button"
            className="fail__back-link"
            onClick={() => navigate(ROUTES.missions)}
          >
            {t('result.fail.backToMissions')}
          </button>
        )}
      </div>
    );
  }

  const hunterName = hunter?.name ?? null;
  const targetName = target?.name ?? null;
  const penaltyTitle = penaltyText ?? t('result.fail.fallbackPenalty');

  const proofCopy = role === 'hunter'
    ? {
        title: t('result.fail.proofTitleHunter'),
        body: targetName
          ? t('result.fail.proofBodyHunter', { name: targetName })
          : t('result.fail.proofBodyHunterFallback'),
        cta: t('result.fail.proofCta'),
      }
    : {
        title: t('result.fail.proofTitleTarget'),
        body: hunterName
          ? t('result.fail.proofBodyTarget', { name: hunterName })
          : t('result.fail.proofBodyTargetFallback'),
        cta: t('result.fail.proofCta'),
      };

  const proofSheet = (
    <Sheet open={!!proofPhotoUrl} onClose={onContinue} title={proofCopy.title} position="center">
      {proofPhotoUrl && (
        <div className="fail__proof-sheet">
          <img src={proofPhotoUrl} alt="proof" className="fail__proof" />
          <div className="fail__proof-body">{proofCopy.body}</div>
          <Button block color="flame" onClick={onContinue}>
            {proofCopy.cta}
          </Button>
        </div>
      )}
    </Sheet>
  );

  const failStyle = {
    '--fail-bg': `url(${fail01})`,
    '--penalty-banner': `url(${cardTriviaComplete})`,
  } as CSSProperties;

  if (role === 'hunter') {
    return (
      <div className="fail fail--hunter" style={failStyle}>
        <div className="sk-hand-b fail__kicker">{t('result.fail.hunterKicker')}</div>
        <div className="fail__stamp-wrap">
          <img src={info01} alt="" className="fail__stamp-icon" />
        </div>
        <div className="fail__copy">
          <div className="fail__title">{t('result.fail.hunterTitle')}</div>
          <div className="fail__sub">{t('result.fail.hunterSub')}</div>
        </div>
        <InfoPanel
          variant="dark"
          tag={t('result.fail.lightPenaltyTag')}
          title={penaltyTitle}
          hint={
            proofPhotoUrl
              ? t('result.fail.confirmed')
              : targetName
                ? t('result.fail.waitingFor', { name: targetName })
                : t('result.fail.waitingForFallback')
          }
        />
        {!proofPhotoUrl && (
          <div className="fail__waiting-hint">
            {targetName
              ? t('result.fail.waitingHint', { name: targetName })
              : t('result.fail.waitingHintFallback')}
          </div>
        )}
        <div className="fail__spacer" />
        {proofSheet}
      </div>
    );
  }

  return (
    <div className="fail fail--target" style={failStyle}>
      <div className="sk-hand-b fail__kicker fail__kicker--flame">{t('result.fail.targetKicker')}</div>
      <div className="fail__stamp-wrap">
        <img src={info01} alt="" className="fail__stamp-icon" />
      </div>
      <div className="fail__copy">
        <div className="sk-hand-b fail__title">
          {hunterName
            ? t('result.fail.targetTitle', { name: hunterName })
            : t('result.fail.targetTitleFallback')}
        </div>
        <div className="fail__sub">
          {hunterName
            ? t('result.fail.targetSubLine1', { name: hunterName })
            : t('result.fail.targetSubLine1Fallback')}
          <br />{t('result.fail.targetSubLine2')}
        </div>
      </div>
      <InfoPanel
        variant="light"
        tag={t('result.fail.penaltyForTag', { name: hunterName ?? '...' })}
        title={penaltyTitle}
      />
      {!proofPhotoUrl && (
        <PhotoCapture
          label={
            hunterName
              ? t('result.fail.photoLabel', { name: hunterName })
              : t('result.fail.photoLabelFallback')
          }
          ctaIdle={t('result.fail.photoCtaIdle')}
          ctaSubmit={t('result.fail.photoCtaSubmit')}
          ctaSubmitting={t('result.fail.photoCtaSubmitting')}
          onUpload={onUpload}
          color="flame"
        />
      )}
      <div className="fail__spacer" />
      {proofSheet}
    </div>
  );
}
