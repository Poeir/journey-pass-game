import { useEffect, useMemo, useRef, useState } from 'react';
import { memoryWallEndpoints, type MemoryWallItem } from '@/api/endpoints';
import './MemoryWallPage.css';
import { WallParticles } from './WallParticles';

const POLL_MS = 10_000;
const MAX_ITEMS = 200;
const ITEM_W = 180;
const ITEM_H = 220;
const CELL_X = 184;
const CELL_Y = 224;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 1.2;
const AUTO_SLIDE_MS = 3000;
const SLIDE_SPEEDS = [0.25, 0.5, 1, 1.25, 1.5, 2] as const;
type SlideSpeed = (typeof SLIDE_SPEEDS)[number];

type HoverState = { item: MemoryWallItem; cx: number; cy: number } | null;

function transformCloudinary(url: string, transform: string): string {
  const marker = '/upload/';
  const idx = url.indexOf(marker);
  if (idx === -1) return url;
  return url.slice(0, idx + marker.length) + transform + '/' + url.slice(idx + marker.length);
}

function clampZoom(z: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
}

// Outward square-spiral grid coordinates centered on (0, 0).
// index 0 → center, then walks ring-by-ring outward (clockwise).
function spiralPos(i: number): { x: number; y: number } {
  if (i <= 0) return { x: 0, y: 0 };
  let r = 1;
  while ((2 * r + 1) * (2 * r + 1) <= i) r++;
  const ringStart = (2 * r - 1) * (2 * r - 1);
  const sideLen = 2 * r;
  const offset = i - ringStart;
  const side = Math.floor(offset / sideLen);
  const along = offset % sideLen;
  switch (side) {
    case 0:
      return { x: r, y: -r + 1 + along };
    case 1:
      return { x: r - 1 - along, y: r };
    case 2:
      return { x: -r, y: r - 1 - along };
    case 3:
      return { x: -r + 1 + along, y: -r };
    default:
      return { x: 0, y: 0 };
  }
}

function rotationFor(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  }
  return ((h % 1200) - 600) / 100;
}

export function MemoryWallPage() {
  const [items, setItems] = useState<MemoryWallItem[]>([]);
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [hovered, setHovered] = useState<HoverState>(null);
  const [slideIndex, setSlideIndex] = useState<number | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);
  const [slideSpeed, setSlideSpeed] = useState<SlideSpeed>(1);
  const [outgoing, setOutgoing] = useState<{ item: MemoryWallItem; nonce: number } | null>(null);
  const aliveRef = useRef(true);
  const viewportRef = useRef<HTMLDivElement>(null);
  const centeredRef = useRef(false);
  const slideIndexRef = useRef<number | null>(null);
  const itemsCountRef = useRef(0);
  const slideToRef = useRef<(index: number) => void>(() => {});
  const scrollRafRef = useRef<number | null>(null);
  const lastSlideItemIdRef = useRef<string | null>(null);
  const slideNonceRef = useRef(0);

  useEffect(() => {
    document.documentElement.classList.add('wall-fullscreen');
    return () => {
      document.documentElement.classList.remove('wall-fullscreen');
    };
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      try {
        const { items: latest } = await memoryWallEndpoints.list();
        if (!aliveRef.current) return;
        setError(false);
        setItems((prev) => {
          const seen = new Set<string>();
          const merged: MemoryWallItem[] = [];
          for (const it of [...latest, ...prev]) {
            if (seen.has(it.id)) continue;
            seen.add(it.id);
            merged.push(it);
            if (merged.length >= MAX_ITEMS) break;
          }
          return merged;
        });
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

  // Sort chronologically (oldest first) so the oldest photo anchors the center
  // and new arrivals always appear on the outer ring — the cluster grows
  // outward, the center never shifts.
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [items],
  );

  // Compute canvas size from outermost ring used by current items.
  const maxRing = Math.max(
    1,
    Math.ceil((Math.sqrt(Math.max(1, sortedItems.length)) - 1) / 2),
  );
  const spanX = 2 * maxRing * CELL_X + ITEM_W;
  const spanY = 2 * maxRing * CELL_Y + ITEM_H;
  const canvasW = Math.max(spanX + 600, 1800);
  const canvasH = Math.max(spanY + 600, 1400);

  useEffect(() => {
    if (centeredRef.current || sortedItems.length === 0) return;
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTo({
      left: Math.max(0, (canvasW * zoom - el.clientWidth) / 2),
      top: Math.max(0, (canvasH * zoom - el.clientHeight) / 2),
      behavior: 'auto',
    });
    centeredRef.current = true;
  }, [sortedItems.length, canvasW, canvasH, zoom]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let startScrollX = 0;
    let startScrollY = 0;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
      dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      startScrollX = el.scrollLeft;
      startScrollY = el.scrollTop;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > 4) {
        moved = true;
        el.classList.add('wall--grabbing');
        setHovered(null);
      }
      if (moved) {
        el.scrollLeft = startScrollX - dx;
        el.scrollTop = startScrollY - dy;
      }
    };
    const onUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      el.classList.remove('wall--grabbing');
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1 / 1.08 : 1.08;
      setZoom((z) => clampZoom(z * factor));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  // Warm the browser cache for the next few popup-resolution images so the
  // slideshow doesn't blank-flash while the network fetch is in flight.
  useEffect(() => {
    if (!autoPlay || sortedItems.length === 0) return;
    const cur = slideIndex ?? 0;
    for (let off = 1; off <= 3; off++) {
      const next = (cur + off) % sortedItems.length;
      const img = new Image();
      img.src = transformCloudinary(sortedItems[next].url, 'f_auto,q_auto,w_900');
    }
  }, [autoPlay, slideIndex, sortedItems]);

  // Carousel: when the focused photo changes during autoPlay, snapshot the
  // previous item as "outgoing" so it can animate out while the new one
  // animates in. Cleared 650ms later (matches the slide animation duration).
  useEffect(() => {
    if (!autoPlay) {
      setOutgoing(null);
      lastSlideItemIdRef.current = hovered?.item.id ?? null;
      return;
    }
    if (!hovered) {
      lastSlideItemIdRef.current = null;
      return;
    }
    const lastId = lastSlideItemIdRef.current;
    const curId = hovered.item.id;
    if (!lastId || lastId === curId) {
      lastSlideItemIdRef.current = curId;
      return;
    }
    const prev = sortedItems.find((it) => it.id === lastId);
    lastSlideItemIdRef.current = curId;
    if (!prev) return;
    const nonce = ++slideNonceRef.current;
    setOutgoing({ item: prev, nonce });
    const t = setTimeout(() => {
      setOutgoing((cur) => (cur && cur.nonce === nonce ? null : cur));
    }, 1050);
    return () => clearTimeout(t);
  }, [hovered, autoPlay, sortedItems]);

  const recenter = () => {
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTo({
      left: Math.max(0, (canvasW * zoom - el.clientWidth) / 2),
      top: Math.max(0, (canvasH * zoom - el.clientHeight) / 2),
      behavior: 'smooth',
    });
  };

  const animateScrollTo = (
    el: HTMLDivElement,
    targetX: number,
    targetY: number,
    duration: number,
  ) => {
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    const maxX = Math.max(0, el.scrollWidth - el.clientWidth);
    const maxY = Math.max(0, el.scrollHeight - el.clientHeight);
    const tx = Math.max(0, Math.min(maxX, targetX));
    const ty = Math.max(0, Math.min(maxY, targetY));
    const startX = el.scrollLeft;
    const startY = el.scrollTop;
    const dx = tx - startX;
    const dy = ty - startY;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
    const t0 = performance.now();
    const ease = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      const e = ease(t);
      el.scrollLeft = startX + dx * e;
      el.scrollTop = startY + dy * e;
      if (t < 1) {
        scrollRafRef.current = requestAnimationFrame(step);
      } else {
        scrollRafRef.current = null;
      }
    };
    scrollRafRef.current = requestAnimationFrame(step);
  };

  const slideTo = (index: number) => {
    if (sortedItems.length === 0) return;
    const clamped = Math.max(0, Math.min(sortedItems.length - 1, index));
    const item = sortedItems[clamped];
    const { x, y } = spiralPos(clamped);
    const cardLeft = canvasW / 2 + x * CELL_X;
    const cardTop = canvasH / 2 + y * CELL_Y;
    const el = viewportRef.current;
    if (el) {
      const targetX = cardLeft * zoom - el.clientWidth / 2;
      const targetY = cardTop * zoom - el.clientHeight / 2;
      animateScrollTo(el, targetX, targetY, 900);
      const rect = el.getBoundingClientRect();
      setHovered({
        item,
        cx: rect.left + rect.width / 2,
        cy: rect.top + rect.height / 2,
      });
    }
    setSlideIndex(clamped);
  };

  slideToRef.current = slideTo;
  slideIndexRef.current = slideIndex;
  itemsCountRef.current = sortedItems.length;

  const onPrev = () => {
    setAutoPlay(false);
    if (sortedItems.length === 0) return;
    const cur = slideIndex ?? 0;
    const next = (cur - 1 + sortedItems.length) % sortedItems.length;
    slideTo(next);
  };
  const onNext = () => {
    setAutoPlay(false);
    if (sortedItems.length === 0) return;
    const cur = slideIndex ?? -1;
    const next = (cur + 1) % sortedItems.length;
    slideTo(next);
  };
  const onToggleAutoPlay = () => {
    setAutoPlay((p) => !p);
  };
  const onCycleSpeed = () => {
    setSlideSpeed((cur) => {
      const idx = SLIDE_SPEEDS.indexOf(cur);
      return SLIDE_SPEEDS[(idx + 1) % SLIDE_SPEEDS.length];
    });
  };

  useEffect(() => {
    if (!autoPlay) return;
    if (sortedItems.length === 0) {
      setAutoPlay(false);
      return;
    }
    if (slideIndex === null) {
      slideTo(0);
      return;
    }
    const id = setInterval(() => {
      const total = itemsCountRef.current;
      if (total === 0) return;
      const cur = slideIndexRef.current ?? -1;
      const next = (cur + 1) % total;
      slideToRef.current(next);
    }, AUTO_SLIDE_MS / slideSpeed);
    return () => clearInterval(id);
    // slideIndex intentionally excluded — interval reads latest via refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, sortedItems.length, slideSpeed]);

  const onCardEnter = (e: React.PointerEvent<HTMLElement>, it: MemoryWallItem) => {
    if (e.pointerType === 'touch') return;
    const rect = e.currentTarget.getBoundingClientRect();
    setHovered({ item: it, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 });
  };
  const onCardLeave = (it: MemoryWallItem) => {
    setHovered((h) => (h?.item.id === it.id ? null : h));
  };
  const onCardClick = (e: React.MouseEvent<HTMLElement>, it: MemoryWallItem) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setHovered((h) =>
      h?.item.id === it.id
        ? null
        : { item: it, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 },
    );
  };

  return (
    <div className="wall">
      <WallParticles />
      <header className="wall__head">
        <div className="sk-hand-b wall__title">MEMORY WALL</div>
        <div className="sk-hand wall__sub">@work</div>
      </header>

      {sortedItems.length === 0 && !error && (
        <div className="wall__empty">Waiting for the first memory…</div>
      )}
      {error && sortedItems.length === 0 && (
        <div className="wall__empty">Failed to load photos · Retrying</div>
      )}

      <div className="wall__viewport" ref={viewportRef}>
        <div
          className="wall__sizer"
          style={{ width: `${canvasW * zoom}px`, height: `${canvasH * zoom}px` }}
        >
          <div
            className="wall__canvas"
            style={{
              width: `${canvasW}px`,
              height: `${canvasH}px`,
              transform: `scale(${zoom})`,
            }}
          >
            {sortedItems.map((it, i) => {
              const { x, y } = spiralPos(i);
              const left = canvasW / 2 + x * CELL_X;
              const top = canvasH / 2 + y * CELL_Y;
              const rot = rotationFor(it.id);
              const isActive = hovered?.item.id === it.id;
              return (
                <figure
                  key={it.id}
                  className={`wall-card wall-card--${it.kind}${
                    isActive ? ' wall-card--active' : ''
                  }`}
                  style={
                    {
                      left: `${left}px`,
                      top: `${top}px`,
                      width: `${ITEM_W}px`,
                      height: `${ITEM_H}px`,
                      '--rot': `${rot}deg`,
                      zIndex: i + 1,
                    } as React.CSSProperties
                  }
                  onPointerEnter={(e) => onCardEnter(e, it)}
                  onPointerLeave={() => onCardLeave(it)}
                  onClick={(e) => onCardClick(e, it)}
                >
                  <img
                    src={transformCloudinary(it.url, 'f_auto,q_auto,w_400')}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                  />
                </figure>
              );
            })}
          </div>
        </div>
      </div>

      <div
        className={`wall__backdrop${autoPlay ? ' wall__backdrop--on' : ''}`}
        aria-hidden="true"
      />

      {hovered && (
        <div
          className={`wall__popup${autoPlay ? ' wall__popup--slide' : ''}`}
          style={{ left: `${hovered.cx}px`, top: `${hovered.cy}px` }}
        >
          {autoPlay && outgoing && (
            <img
              key={`out-${outgoing.nonce}`}
              className="wall__popup-img wall__popup-img--out"
              src={transformCloudinary(outgoing.item.url, 'f_auto,q_auto,w_900')}
              alt=""
              decoding="async"
              draggable={false}
            />
          )}
          <img
            key={`in-${hovered.item.id}`}
            className={`wall__popup-img${autoPlay ? ' wall__popup-img--in' : ''}`}
            src={transformCloudinary(hovered.item.url, 'f_auto,q_auto,w_900')}
            alt=""
            decoding="async"
            draggable={false}
          />
        </div>
      )}

      <div className="wall__slide" role="group" aria-label="slide photos">
        <button
          type="button"
          className="wall__slide-btn"
          onClick={onPrev}
          disabled={sortedItems.length === 0}
          aria-label="previous photo"
        >
          ‹
        </button>
        <button
          type="button"
          className={`wall__slide-play${autoPlay ? ' wall__slide-play--on' : ''}`}
          onClick={onToggleAutoPlay}
          disabled={sortedItems.length === 0}
          aria-label={autoPlay ? 'pause slideshow' : 'play slideshow'}
          aria-pressed={autoPlay}
        >
          {autoPlay ? '❚❚' : '▶'}
        </button>
        <button
          type="button"
          className="wall__slide-speed"
          onClick={onCycleSpeed}
          disabled={sortedItems.length === 0}
          aria-label={`slideshow speed ${slideSpeed}×`}
          title="Slideshow speed"
        >
          {slideSpeed}×
        </button>
        <span className="wall__slide-count" aria-live="polite">
          {sortedItems.length === 0
            ? '0 / 0'
            : `${(slideIndex ?? -1) + 1} / ${sortedItems.length}`}
        </span>
        <button
          type="button"
          className="wall__slide-btn"
          onClick={onNext}
          disabled={sortedItems.length === 0}
          aria-label="next photo"
        >
          ›
        </button>
      </div>

      <div className="wall__zoom" role="group" aria-label="zoom">
        <button
          type="button"
          className="wall__zoom-btn"
          onClick={() => setZoom((z) => clampZoom(z / ZOOM_STEP))}
          aria-label="zoom out"
        >
          −
        </button>
        <button
          type="button"
          className="wall__zoom-pct"
          onClick={() => {
            setZoom(1);
            requestAnimationFrame(recenter);
          }}
          aria-label="reset zoom"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className="wall__zoom-btn"
          onClick={() => setZoom((z) => clampZoom(z * ZOOM_STEP))}
          aria-label="zoom in"
        >
          +
        </button>
      </div>
    </div>
  );
}
