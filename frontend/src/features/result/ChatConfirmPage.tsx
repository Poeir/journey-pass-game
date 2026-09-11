import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '@/design-system/Avatar';
import { Button } from '@/design-system/Button';
import { Card } from '@/design-system/Card';
import { PageHeader } from '@/design-system/PageHeader';
import { SectionLabel } from '@/design-system/SectionLabel';
import { authEndpoints, chatEndpoints } from '@/api/endpoints';
import { useGame } from '@/game/gameStore';
import type { Employee } from '@/types/game';
import { ROUTES } from '@/lib/routes';
import { useT } from '@/lib/i18n';
import './ChatConfirmPage.css';

export function ChatConfirmPage() {
  const t = useT();
  const navigate = useNavigate();
  const { pairId } = useParams();
  // Counterpart can come from three places (used as the initial render before
  // the authoritative getQuestion fetch resolves):
  //   - chatTarget: scanner-side handoff from ScannerPage
  //   - pendingChat: target-side hydrate from /me/pending-chat or WS
  //   - the GET /chat/:pairId/question response (always wins)
  const chatTarget = useGame((s) => s.chatTarget);
  const pendingChat = useGame((s) => s.pendingChat);
  // Cross-page WS signal: the OTHER side just submitted the second answer.
  // If it matches our pairId we're done waiting and can navigate.
  const chatBothAnsweredFor = useGame((s) => s.chatBothAnsweredFor);

  const initialCounterpart =
    chatTarget ?? (pendingChat && pendingChat.pairId === pairId ? pendingChat.counterpart : null);

  const [counterpart, setCounterpart] = useState<Employee | null>(initialCounterpart);
  const [question, setQuestion] = useState<string | null>(null);
  const [questionError, setQuestionError] = useState(false);
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [questionAttempt, setQuestionAttempt] = useState(0);
  // Per-side answer flags. Hydrated from getQuestion on mount; updated
  // optimistically on submit / via the chat.both_answered WS signal.
  const [myAnswered, setMyAnswered] = useState(false);
  const [theirAnswered, setTheirAnswered] = useState(false);

  useEffect(() => {
    if (!pairId) return;
    let cancelled = false;
    setQuestionError(false);
    const timeoutId = window.setTimeout(() => {
      if (!cancelled && question === null) setQuestionError(true);
    }, 8000);
    chatEndpoints
      .getQuestion(pairId)
      .then((res) => {
        if (cancelled) return;
        setQuestion(res.question);
        setCounterpart(res.counterpart);
        setMyAnswered(res.myAnswered);
        setTheirAnswered(res.theirAnswered);
        setQuestionError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setQuestionError(true);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairId, questionAttempt]);

  const navigateToSuccess = (target: Employee) => {
    // Target-side (auto-redirected via WS) never went through MissionSelect,
    // so `mission` may still be 'trivia' from an earlier flow. Force it
    // before SuccessPage reads it for routing + memory contextKind.
    useGame.getState().setMission('teammate');
    useGame.getState().setChatTarget(null);
    useGame.getState().setPendingChat(null);
    useGame.getState().setChatBothAnswered(null);
    useGame.getState().setPairMemoryPhoto(null);
    if (pairId) {
      const base = ROUTES.success(pairId);
      navigate(target.isLeader ? `${base}&role=leader` : base);
    }
  };

  // Refresh local progress (slots) once both answered — backend added them
  // atomically when the second answer landed.
  const finalizeAndNavigate = (target: Employee) => {
    authEndpoints
      .progress()
      .then((progress) => {
        const year = useGame.getState().profile?.year ?? null;
        useGame.getState().hydrateProgress({ ...progress, year });
      })
      .catch(() => {
        // Non-fatal — SuccessPage will read what's in the store, and the
        // next GameShell hydrate will catch up.
      })
      .finally(() => {
        navigateToSuccess(target);
      });
  };

  // WS-driven release: the other side wrote their answer while we were
  // waiting. Navigate as soon as we observe the signal for our pair.
  useEffect(() => {
    if (!pairId || !counterpart) return;
    if (chatBothAnsweredFor !== pairId) return;
    if (!myAnswered) {
      // Race: we got the signal before our own submit landed locally. Just
      // mark the other side as answered; our finish() will navigate next.
      setTheirAnswered(true);
      return;
    }
    finalizeAndNavigate(counterpart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatBothAnsweredFor, pairId, counterpart, myAnswered]);

  const finish = async () => {
    if (!answer.trim() || !pairId || submitting || !counterpart) return;
    setSubmitting(true);
    let result;
    try {
      result = await chatEndpoints.confirmTeammate(pairId, answer.trim());
    } catch {
      setSubmitting(false);
      return;
    }
    setMyAnswered(true);
    if (result.bothAnswered) {
      // Either we were the second submitter, or the WS signal arrived first
      // and we finally matched it — either way we navigate now. The backend
      // wrote both slots in the same transaction; refetch progress to pick
      // them up before SuccessPage renders.
      finalizeAndNavigate(counterpart);
      return;
    }
    // First submitter: stay on the page in waiting state. The
    // chat.both_answered WS event will release us when the other side
    // finishes. Re-enable submitting so the UI can update.
    setSubmitting(false);
  };

  const targetName = counterpart?.name ?? t('result.chat.fallbackName');
  const isWaitingForThem = myAnswered && !theirAnswered;
  const showTheirsReady = theirAnswered && !myAnswered;

  return (
    <div className="chat">
      <PageHeader
        onBack={() => (isWaitingForThem ? undefined : navigate(-1))}
        title={t('result.chat.title')}
        titleSize="sm"
        backSize="sm"
      />

      {isWaitingForThem ? (
        <>
          <p className="chat__sub">
            <strong>{t('result.chat.waitingTitle', { name: targetName })}</strong>
          </p>
          {counterpart && (
            <Card sketch tone="sky" className="chat__target">
              <Avatar initial={counterpart.initial} photoUrl={counterpart.photoUrl} tone="blue" size={40} />
              <div className="chat__target-main">
                <div className="sk-hand-b chat__target-name">{counterpart.name}</div>
                <div className="chat__target-dept">{counterpart.dept} · {t('result.chat.classOf', { year: counterpart.year })}</div>
              </div>
            </Card>
          )}
          <Card sketch tone="sky" className="chat__waiting">
            <div className="chat__waiting-spinner" aria-hidden="true">
              <span /><span /><span />
            </div>
            <p className="chat__waiting-hint">
              {t('result.chat.waitingHint', { name: targetName })}
            </p>
          </Card>
        </>
      ) : (
        <>
          <p className="chat__sub">
            {t('result.chat.sub', { name: targetName })}
          </p>

          {counterpart && (
            <Card sketch tone="sky" className="chat__target">
              <Avatar initial={counterpart.initial} photoUrl={counterpart.photoUrl} tone="blue" size={40} />
              <div className="chat__target-main">
                <div className="sk-hand-b chat__target-name">{counterpart.name}</div>
                <div className="chat__target-dept">{counterpart.dept} · {t('result.chat.classOf', { year: counterpart.year })}</div>
              </div>
            </Card>
          )}

          {showTheirsReady && (
            <p className="chat__theirs-ready">
              {t('result.chat.theirsReadyHint', { name: targetName })}
            </p>
          )}

          <SectionLabel variant="eyebrow">{t('result.chat.questionLabel')}</SectionLabel>
          <Card sketch tone="sky" className="chat__question ">
            {question ? (
              question
            ) : questionError ? (
              <div className="chat__question-error">
                <div>{t('result.chat.questionLoadError')}</div>
                <button
                  type="button"
                  className="chat__retry"
                  onClick={() => {
                    setQuestion(null);
                    setQuestionError(false);
                    setQuestionAttempt((n) => n + 1);
                  }}
                >
                  {t('result.chat.retry')}
                </button>
              </div>
            ) : (
              t('result.chat.questionLoading')
            )}
          </Card>

          <SectionLabel variant="eyebrow">{t('result.chat.answerLabel', { name: targetName })}</SectionLabel>
          <textarea
            className="chat__input"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={t('result.chat.answerPlaceholder', { name: targetName })}
            rows={3}
            autoFocus
          />

          <div className="chat__spacer" />

          <div className="chat__cta">
            <Button block color="blue" disabled={!answer.trim() || submitting || !counterpart} onClick={finish}>
              {submitting ? t('result.chat.saving') : t('result.chat.done')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
