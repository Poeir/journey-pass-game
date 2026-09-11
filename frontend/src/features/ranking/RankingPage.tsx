import { useEffect, useRef, useState } from 'react';
import {
  rankingEndpoints,
  type RankingDoneRow,
  type RankingPendingRow,
} from '@/api/endpoints';
import './RankingPage.css';

const POLL_MS = 10_000;
const MEDALS = ['🥇', '🥈', '🥉'];

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatRelative(iso: string | null, nowMs: number): string {
  if (!iso) return 'not started';
  const t = new Date(iso).getTime();
  const diffSec = Math.max(0, Math.round((nowMs - t) / 1000));
  if (diffSec < 30) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return formatTime(iso);
}

export function RankingPage() {
  const [done, setDone] = useState<RankingDoneRow[]>([]);
  const [pending, setPending] = useState<RankingPendingRow[]>([]);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const aliveRef = useRef(true);

  useEffect(() => {
    document.documentElement.classList.add('ranking-fullscreen');
    return () => {
      document.documentElement.classList.remove('ranking-fullscreen');
    };
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      try {
        const data = await rankingEndpoints.list();
        if (!aliveRef.current) return;
        setError(false);
        setDone(data.done);
        setPending(data.pending);
        setLoaded(true);
      } catch {
        if (aliveRef.current) setError(true);
      }
    };
    const start = () => {
      if (intervalId) return;
      tick();
      intervalId = setInterval(tick, POLL_MS);
    };
    const stop = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      aliveRef.current = false;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Re-tick "X minutes ago" labels every 30s without waiting for the next poll.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const total = done.length + pending.length;
  const finishedAllCount = done.filter((r) => r.done >= r.total).length;
  const timeoutCount = done.length - finishedAllCount;

  return (
    <div className="ranking">
      <header className="ranking__head">
        <div className="ranking__live" aria-label="live">
          <span className="ranking__live-dot" />
          LIVE
        </div>
        <div className="sk-hand-b ranking__title">
          {/* <span className="ranking__title-icon" aria-hidden="true"></span> */}
          RANKING
        </div>
        <div className="sk-hand ranking__sub">@work</div>
        {loaded && (
          <div className="ranking__counter">
            <strong className="ranking__counter-num">{finishedAllCount}</strong>
            <span className="ranking__counter-sep">/ {total} players</span>
            {timeoutCount > 0 && (
              <span className="ranking__counter-timeout"> · Time out {timeoutCount}</span>
            )}
          </div>
        )}
      </header>

      {!loaded && !error && (
        <div className="ranking__empty">Loading…</div>
      )}
      {error && !loaded && (
        <div className="ranking__empty">Failed to load · Retrying</div>
      )}

      {loaded && (
        <div className="ranking__board">
          <section className="ranking__col ranking__col--done">
            <h2 className="ranking__col-title">
              <span className="ranking__col-dot ranking__col-dot--done" />
              Finished
              <span className="ranking__col-count">{done.length}</span>
            </h2>
            {done.length === 0 ? (
              <p className="ranking__col-empty">No one has finished yet</p>
            ) : (
              <ol className="ranking__list">
                {done.map((row, i) => {
                  const finishedAll = row.done >= row.total;
                  const remaining = Math.max(0, row.total - row.done);
                  const isPodium = finishedAll && i < 3;
                  const rowClasses = [
                    'ranking__row',
                    'ranking__row--done',
                    !finishedAll ? 'ranking__row--timeout' : '',
                    isPodium ? `ranking__row--podium ranking__row--podium-${i + 1}` : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <li
                      key={row.id}
                      className={rowClasses}
                      style={{ animationDelay: `${Math.min(i, 10) * 60}ms` }}
                    >
                      <span className="ranking__rank">
                        {finishedAll ? (
                          isPodium ? (
                            <span className="ranking__medal" aria-hidden="true">
                              {MEDALS[i]}
                            </span>
                          ) : (
                            i + 1
                          )
                        ) : (
                          '–'
                        )}
                      </span>
                      <span className="ranking__name">
                        {row.name}
                        <span className="ranking__dept">
                          {row.dept} · updated {formatRelative(row.updatedAt, nowMs)}
                        </span>
                      </span>
                      {finishedAll ? (
                        <span className="ranking__time">{formatTime(row.completedAt)}</span>
                      ) : (
                        <span
                          className="ranking__timeout-badge"
                          title={`${row.done}/${row.total}`}
                        >
                          Time out · {remaining} <strong>left</strong>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>

          <section className="ranking__col ranking__col--pending">
            <h2 className="ranking__col-title">
              <span className="ranking__col-dot ranking__col-dot--pending" />
              Playing
              <span className="ranking__col-count">{pending.length}</span>
            </h2>
            {pending.length === 0 ? (
              <p className="ranking__col-empty">Everyone has finished! 🎉</p>
            ) : (
              <ul className="ranking__list">
                {pending.map((row, idx) => {
                  const remaining = Math.max(0, row.total - row.done);
                  const pct =
                    row.total > 0
                      ? Math.max(0, Math.min(100, Math.round((row.done / row.total) * 100)))
                      : 0;
                  return (
                    <li
                      key={row.id}
                      className="ranking__row ranking__row--pending"
                      style={{ animationDelay: `${Math.min(idx, 10) * 60}ms` }}
                    >
                      <span className="ranking__name">
                        <span className="ranking__name-text">{row.name}</span>
                        <span className="ranking__progress" aria-hidden="true">
                          <span
                            className="ranking__progress-fill"
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                        <span className="ranking__dept">
                          {row.dept} · updated {formatRelative(row.updatedAt, nowMs)}
                        </span>
                      </span>
                      <span className="ranking__remaining" title={`${row.done}/${row.total}`}>
                        <strong>{remaining}</strong> quests left
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
