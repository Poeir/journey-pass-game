import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode';
import { ScanFrame } from '@/design-system/ScanFrame';
import { scanEndpoints } from '@/api/endpoints';
import { useGame } from '@/game/gameStore';
import { useErrorStore } from '@/lib/errorStore';
import { ROUTES } from '@/lib/routes';
import { useT } from '@/lib/i18n';
import { Cooldown } from './Cooldown';
import card02 from '../../../assets/card02.png';
import buttonExit from '../../../assets/button_exit.png';
import './ScannerPage.css';

interface Props {
  mode: 'trivia' | 'teammate';
}

export function ScannerPage({ mode }: Props) {
  const t = useT();
  const navigate = useNavigate();
  const { cardId } = useParams();
  const profile = useGame((s) => s.profile);
  const cards = useGame((s) => s.trivia.cards);
  const currentCard = mode === 'trivia' ? cards.find((c) => c.id === cardId) : undefined;
  const scannerElRef = useRef<HTMLDivElement>(null);
  const qrRef = useRef<Html5Qrcode | null>(null);
  const lastScanRef = useRef<{ payload: string; ts: number } | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualId, setManualId] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualClosing, setManualClosing] = useState(false);
  const [scanning, setScanning] = useState(true);

  function closeManual() {
    setManualClosing(true);
    window.setTimeout(() => {
      setManualOpen(false);
      setManualClosing(false);
      setManualId('');
    }, 200);
  }
  // Use a ref for the gate (no re-render needed on each tick) and a state
  // value only for mounting/unmounting the visible <Cooldown> child.
  const cooldownEndRef = useRef(0);
  const [cooldownEnd, setCooldownEnd] = useState<number | null>(null);

  const startCooldown = useCallback((seconds: number) => {
    const end = Date.now() + seconds * 1000;
    cooldownEndRef.current = end;
    setCooldownEnd(end);
  }, []);
  const clearCooldown = useCallback(() => {
    cooldownEndRef.current = 0;
    setCooldownEnd(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function teardownScanner(scanner: Html5Qrcode) {
      try {
        const state = scanner.getState();
        if (
          state === Html5QrcodeScannerState.SCANNING ||
          state === Html5QrcodeScannerState.PAUSED
        ) {
        await scanner.stop();
        }
      } catch {
        // Ignore stop errors during route transitions/unmount.
      } finally {
        try {
          scanner.clear();
        } catch {
          // no-op
        }
      }
    }

    async function start() {
      try {
        const html5 = new Html5Qrcode('qr-reader');
        qrRef.current = html5;
        await html5.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded) => {
            if (cancelled) return;
            void handleDecoded(decoded);
          },
          () => {}
        );
        if (cancelled) {
          await teardownScanner(html5);
        }
      } catch (err) {
        if (!cancelled) {
          setCameraError((err as Error).message);
        }
      }
    }
    void start();

    return () => {
      cancelled = true;
      const q = qrRef.current;
      qrRef.current = null;
      if (q) {
        void teardownScanner(q);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDecoded(payload: string) {
    if (!scanning || Date.now() < cooldownEndRef.current || !profile) return;
    const last = lastScanRef.current;
    if (last && last.payload === payload && Date.now() - last.ts < 3000) return;
    lastScanRef.current = { payload, ts: Date.now() };
    if (payload === profile.id) {
      useErrorStore.getState().push(t('scanner.ownQr'), 'info');
      startCooldown(3);
      return;
    }
    setScanning(false);
    try {
      const res = await scanEndpoints.scan({
        scanner_id: profile.id,
        scanned_id: payload,
        card_ref: currentCard?.id,
      });
      if (mode === 'trivia') {
        if (res.outcome === 'match' && currentCard) {
          useGame.getState().addTriviaStamp(currentCard.id, res.stamp.target);
          navigate(ROUTES.success(currentCard.id), { state: { target: res.stamp.target } });
        } else if (res.outcome === 'mismatch') {
          useGame.getState().setPenalty({ pairId: res.pair_id, role: 'hunter' });
          navigate(ROUTES.fail(res.pair_id));
        }
      } else {
        if (res.outcome === 'chat') {
          useGame.getState().setChatTarget(res.target);
          navigate(ROUTES.chatConfirm(res.pair_id));
        } else if (res.outcome === 'wrong_year') {
          useErrorStore.getState().push(t('scanner.wrongYear', { name: res.target.name }), 'error');
          startCooldown(3);
          setScanning(true);
        } else if (res.outcome === 'wrong_leader') {
          useErrorStore.getState().push(t('scanner.wrongLeader', { name: res.target.name }), 'error');
          startCooldown(3);
          setScanning(true);
        } else if (res.outcome === 'leader_clash') {
          useErrorStore.getState().push(t('scanner.leaderClash'), 'error');
          startCooldown(3);
          setScanning(true);
        } else if (res.outcome === 'already_added') {
          useErrorStore.getState().push(t('scanner.alreadyAdded', { name: res.target.name }), 'info');
          startCooldown(3);
          setScanning(true);
        } else if (res.outcome === 'leader_full') {
          useErrorStore.getState().push(t('scanner.leaderFull'), 'error');
          startCooldown(3);
          setScanning(true);
        } else if (res.outcome === 'teammate_full') {
          useErrorStore.getState().push(t('scanner.teammateFull'), 'error');
          startCooldown(3);
          setScanning(true);
        }
      }
    } catch (err) {
      console.error(err);
      startCooldown(1);
      setScanning(true);
    }
  }

  return (
    <div className="scanner">
      <header className="scanner__head">
        <button className="scanner__close" onClick={() => navigate(-1)} aria-label={t('scanner.closeAria')}>
          <img src={buttonExit} alt="" className="scanner__close-icon" />
        </button>
        <div className="sk-hand-b scanner__title">
          {mode === 'trivia'
            ? t('scanner.titleTrivia', { index: currentCard?.index ?? '?' })
            : t('scanner.titleTeammate')}
        </div>
        <button
          type="button"
          className="scanner__manual-toggle sk-hand-b"
          onClick={() => setManualOpen(true)}
        >
          {t('scanner.typeId')}
        </button>
      </header>

      <div className="scanner__stage">
        <div id="qr-reader" ref={scannerElRef} className="scanner__camera" />
        <div className="scanner__overlay">
          <ScanFrame size="72%" />
        </div>
        <div className="scanner__hint sk-hand">
          {t('scanner.hint')} <strong>{t('scanner.hintBold')}</strong> {t('scanner.hintTail')}
        </div>
        {cooldownEnd !== null && (
          <Cooldown deadline={cooldownEnd} onDone={clearCooldown} />
        )}
      </div>

      {currentCard && (
        <div className="scanner__card-overlay">
          <div
            className="scanner__overlay-card"
            style={{ '--card-banner': `url(${card02})` } as CSSProperties}
          >
            <div className="sk-hand-b scanner__overlay-clue">{currentCard.clue}</div>
          </div>
        </div>
      )}

      {manualOpen && !cameraError && (
        <div
          className={`scanner__fallback scanner__fallback--manual${
            manualClosing ? ' scanner__fallback--closing' : ''
          }`}
        >
          <div className="scanner__fallback-title ">{t('scanner.manual.title')}</div>
          <p className=" scanner__fallback-msg">
            {t('scanner.manual.msgPrefix')} <strong>{t('scanner.manual.msgBold')}</strong> {t('scanner.manual.msgTail')}
          </p>
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              const id = manualId.trim();
              if (!id) return;
              void handleDecoded(id);
              closeManual();
            }}
          >
            <input
              className="scanner__fallback-input"
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              placeholder={t('scanner.manual.placeholder')}
              autoFocus
            />
            <button type="submit" className="scanner__fallback-submit sk-hand-b">{t('scanner.manual.submit')}</button>
          </form>
          <button
            type="button"
            className="scanner__fallback-cancel"
            onClick={closeManual}
          >
            {t('scanner.manual.cancel')}
          </button>
        </div>
      )}

      {cameraError && (
        <div className="scanner__fallback">
          <div className="scanner__fallback-title sk-hand-b">{t('scanner.cameraError.title')}</div>
          <p className="scanner__fallback-msg">{cameraError}</p>
          <p className="scanner__fallback-msg">
            {t('scanner.manual.msgPrefix')} <strong>{t('scanner.manual.msgBold')}</strong> {t('scanner.manual.msgTail')}
          </p>
          <form
            onSubmit={(ev) => {
              ev.preventDefault();
              if (manualId) void handleDecoded(manualId);
            }}
          >
            <input
              className="scanner__fallback-input"
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              placeholder={t('scanner.manual.placeholder')}
            />
            <button className="scanner__fallback-submit sk-hand-b">{t('scanner.manual.submit')}</button>
          </form>
        </div>
      )}
    </div>
  );
}
