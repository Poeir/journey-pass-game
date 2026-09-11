import { useEffect, useState, type CSSProperties } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Avatar } from '@/design-system/Avatar';
import { PassportButton } from '@/design-system/PassportButton';
import { Card } from '@/design-system/Card';
import { InfoPanel } from '@/design-system/InfoPanel';
import { Pill } from '@/design-system/Pill';
import { useGame, selectIsComplete, selectTotal, selectLastTeammateSlot } from '@/game/gameStore';
import type { Employee } from '@/types/game';
import { completionEndpoints, memoryEndpoints, photoPlaceEndpoints } from '@/api/endpoints';
import { ROUTES } from '@/lib/routes';
import { PhotoCapture } from '@/lib/PhotoCapture';
import { useT, tList } from '@/lib/i18n';
import success01 from '../../../assets/success01.png';
import card04 from '../../../assets/card04.png';
import './SuccessPage.css';

function pickRandom<T>(list: T[]): T | null {
  if (list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

export function SuccessPage() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const total = useGame(selectTotal);
  const done = useGame(selectIsComplete);
  const mission = useGame((s) => s.mission);
  const lastRef = params.get('ref');
  const isLeader = params.get('role') === 'leader';
  const target = (location.state as { target?: Employee } | null)?.target;
  const slot = useGame(selectLastTeammateSlot);
  const leaderSlot = useGame((s) => s.teammate.leaderSlot);
  const profileId = useGame((s) => s.profile?.id);
  // Cross-page WS signal: scanner uploaded the shared photo. Used by the
  // target side to flip out of the "waiting" state without a refetch.
  const pairMemoryPhoto = useGame((s) => s.pairMemoryPhoto);

  // Teammate flow: who am I on this pair (hunter = scanner, target = scannee)
  // and who is the counterpart? Authoritative from /memories/pair/:pairId
  // because chatTarget/slot lookups can lag behind admin overrides or
  // year-mismatch silent skips.
  const isTeammate = mission === 'teammate';
  const [pairRole, setPairRole] = useState<'hunter' | 'target' | null>(null);
  const [pairCounterpart, setPairCounterpart] = useState<Employee | null>(null);

  // The pair's shared photo. `sharedPhoto` is only set when SOMEONE ELSE
  // uploaded — if I uploaded it myself I keep the normal "saved" affordance.
  const [sharedPhoto, setSharedPhoto] = useState<{
    url: string;
    uploaderId: string;
    uploaderName: string;
  } | null>(null);

  useEffect(() => {
    if (!isTeammate || !lastRef) return;
    let cancelled = false;
    memoryEndpoints
      .getForPair(lastRef)
      .then(({ role, counterpart, photo }) => {
        if (cancelled) return;
        setPairRole(role);
        setPairCounterpart(counterpart);
        if (!photo) return;
        if (profileId && photo.uploaderId === profileId) return;
        setSharedPhoto({
          url: photo.url,
          uploaderId: photo.uploaderId,
          uploaderName: photo.uploaderName,
        });
      })
      .catch(() => {
        // Non-fatal — fall back to default rendering. The page is still
        // usable; the user just won't see the role-aware affordances.
      });
    return () => {
      cancelled = true;
    };
  }, [isTeammate, lastRef, profileId]);

  // Live-update sharedPhoto when the scanner uploads while the target is
  // sitting on this page. The signal is set by useUserSocket on the
  // memory.captured WS frame.
  useEffect(() => {
    if (!pairMemoryPhoto || pairMemoryPhoto.pairId !== lastRef) return;
    if (profileId && pairMemoryPhoto.uploaderId === profileId) return;
    setSharedPhoto({
      url: pairMemoryPhoto.url,
      uploaderId: pairMemoryPhoto.uploaderId,
      uploaderName: pairMemoryPhoto.uploaderName,
    });
  }, [pairMemoryPhoto, lastRef, profileId]);

  // For teammate flow, prefer the authoritative counterpart from the pair
  // endpoint over the store-derived slot — the store can lag during the
  // wait-for-both window or silent skip.
  const person = isTeammate
    ? pairCounterpart ?? (isLeader ? leaderSlot : slot)
    : target ?? (isLeader ? leaderSlot : slot);

  // Hunter (scanner) takes the photo for both. Target sits in a "waiting"
  // state until the upload lands. Trivia flow keeps the existing 1:1
  // upload behavior — pairRole stays null there so this branch falls
  // through.
  const isTeammateTargetWaiting = isTeammate && pairRole === 'target' && !sharedPhoto;
  const canUploadMemory =
    !!(person && lastRef && mission) && !sharedPhoto && pairRole !== 'target';

  // Photo place comes from the admin-managed PhotoPlace table (fetched
  // once on mount). Fall back to the i18n list if the API errors or the
  // table is empty so the hint never silently disappears.
  const [photoPlace, setPhotoPlace] = useState<string | null>(null);
  useEffect(() => {
    if (!canUploadMemory) return;
    let cancelled = false;
    photoPlaceEndpoints
      .list()
      .then((res) => {
        if (cancelled) return;
        const fromApi = pickRandom(res.places.map((p) => p.text));
        if (fromApi) {
          setPhotoPlace(fromApi);
          return;
        }
        const fallback = pickRandom(tList('result.success.photoPlaces'));
        if (fallback) setPhotoPlace(fallback);
      })
      .catch(() => {
        if (cancelled) return;
        const fallback = pickRandom(tList('result.success.photoPlaces'));
        if (fallback) setPhotoPlace(fallback);
      });
    return () => {
      cancelled = true;
    };
  }, [canUploadMemory]);

  const [memorySaved, setMemorySaved] = useState(false);
  const onUploadMemory = async (file: File) => {
    if (!canUploadMemory || !person || !lastRef || !mission) return;
    const contextKind = mission === 'teammate' ? 'teammate' : 'trivia';
    await memoryEndpoints.upload(file, contextKind, lastRef, person.id);
  };
  // Continue button is gated on memory being resolved — either the user
  // uploaded their own (hunter / trivia), the user is the target and the
  // scanner's upload landed (sharedPhoto set), or the user uploaded a
  // teammate-other-side trivia memory.
  const memoryPending =
    (canUploadMemory && !memorySaved) || isTeammateTargetWaiting;

  const confettiCount = isLeader ? 28 : 14;
  const confettiDots = Array.from({ length: confettiCount }).map((_, i) => ({
    left: `${(i * 13) % 100}%`,
    top: `${(i * 19) % 100}%`,
    bg:
      i % 3 === 0 ? '#fff8d6' : i % 3 === 1 ? '#ffd54a' : '#ffae00',
    rot: i * 27,
    round: i % 3 ? 2 : '50%',
  }));

  const stars = Array.from({ length: 22 }).map((_, i) => ({
    left: `${(i * 41 + 7) % 100}%`,
    top: `${(i * 67 + 11) % 100}%`,
    size: ((i * 7) % 3) + 3,
    delay: (i % 7) * 0.45,
    duration: 2.6 + ((i * 13) % 10) * 0.18,
  }));

  return (
    <div
      className={`success${isLeader ? ' success--leader' : ''}`}
      style={
        {
          '--success-bg': `url(${success01})`,
          '--card-bg': `url(${card04})`,
        } as CSSProperties
      }
    >
      <div className="success__banner">
        <div className="success__stars" aria-hidden="true">
          {stars.map((s, i) => (
            <span
              key={i}
              className="success__star"
              style={{
                left: s.left,
                top: s.top,
                width: `${s.size}px`,
                height: `${s.size}px`,
                animationDelay: `${s.delay}s`,
                animationDuration: `${s.duration}s`,
              }}
            />
          ))}
        </div>
        {confettiDots.map((d, i) => (
          <span
            key={i}
            className="sk-confetti"
            style={{
              left: d.left,
              top: d.top,
              background: d.bg,
              transform: `rotate(${d.rot}deg)`,
              borderRadius: d.round === '50%' ? '50%' : `${d.round}px`,
              animationDelay: `${i * 35}ms`,
            }}
          />
        ))}
        {isLeader ? (
          <>
            <div className="success__banner-crown" aria-hidden>👑</div>
            <div className="sk-hand-b success__banner-kicker">{t('result.success.legendary')}</div>
            <div className="sk-hand-b success__banner-title">{t('result.success.leaderFound')}</div>
          </>
        ) : (
          <>
            <div className="sk-hand-b success__banner-kicker">{t('result.success.match')}</div>
            <div className="sk-hand-b success__banner-title">{t('result.success.thatsTheOne')}</div>
          </>
        )}
      </div>

      <div className="success__body">
        <p className="success__lede">
          {isLeader
            ? t('result.success.ledeLeader')
            : mission === 'teammate' ? t('result.success.ledeTeammate') : t('result.success.ledeTrivia')}
        </p>

        {person && (
          <Card sketch>
            <div className="success__person">
              <Avatar initial={person.initial} photoUrl={person.photoUrl} size={52} tone={mission === 'teammate' ? 'blue' : 'flame'} />
              <div>
                <div className="sk-hand-b success__person-name">{person.name}</div>
                <div className="success__person-sub">
                  {person.dept}
                  {mission === 'teammate' ? ` · ${t('result.success.classOf', { year: person.year })}` : ''}
                </div>
              </div>
            </div>
            <div className="success__divider" />
            <div className="success__stamp-line">{t('result.success.stampLine', { total })}</div>
          </Card>
        )}

        {sharedPhoto ? (
          <Card sketch tone="sky" className="success__shared">
            <div className="success__shared-meta">
              <Pill tone="blue">{t('result.success.sharedMemoryTag')}</Pill>
              <span className="success__shared-by">
                {t('result.success.sharedMemoryBy', { name: sharedPhoto.uploaderName })}
              </span>
            </div>
            <img
              src={sharedPhoto.url}
              alt=""
              className="success__shared-img"
              loading="lazy"
            />
            <p className="success__shared-note">{t('result.success.sharedMemoryNote')}</p>
          </Card>
        ) : isTeammateTargetWaiting ? (
          <Card sketch tone="sky" className="success__waiting-photo">
            <div className="success__waiting-spinner" aria-hidden="true">
              <span /><span /><span />
            </div>
            <div className="sk-hand-b success__waiting-title">
              {t('result.success.waitingPhotoTitle', {
                name: person?.name ?? t('result.chat.fallbackName'),
              })}
            </div>
            <p className="success__waiting-hint">
              {t('result.success.waitingPhotoHint', {
                name: person?.name ?? t('result.chat.fallbackName'),
              })}
            </p>
          </Card>
        ) : (
          <>
            {canUploadMemory && photoPlace && (
              <InfoPanel
                variant="light"
                tag={t('result.success.photoSpotTag')}
                title={photoPlace}
                hint={t('result.success.photoSpotHint')}
              />
            )}

            {canUploadMemory && (
              <div className="success__memory">
                <PhotoCapture
                  label={t('result.success.memoryLabel')}
                  ctaIdle={t('result.success.memoryCtaIdle')}
                  ctaSubmit={t('result.success.memoryCtaSubmit')}
                  onUpload={onUploadMemory}
                  onDone={() => setMemorySaved(true)}
                  color={mission === 'teammate' ? 'blue' : 'flame'}
                />
              </div>
            )}
          </>
        )}

        <div className="success__spacer" />

        <div className="success__actions">
          {memoryPending && (
            <div className="success__memory-hint">{t('result.success.memoryHint')}</div>
          )}
          <PassportButton
            block
            disabled={memoryPending}
            onClick={() => {
              if (done) {
                completionEndpoints.markComplete().catch(() => {
                  // Idempotent — CompletedPage will retry on mount.
                });
                navigate(ROUTES.complete, { replace: true });
                return;
              }
              navigate(mission === 'teammate' ? ROUTES.teammate : ROUTES.triviaCards);
            }}
          >
            {memoryPending ? t('result.success.photoRequired') : done ? t('result.success.finish') : t('result.success.next')}
          </PassportButton>
        </div>
      </div>
    </div>
  );
}
