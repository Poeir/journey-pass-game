import { useEffect, useRef } from 'react';
import './WallParticles.css';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  opacity: number;
  twinkleSpeed: number;
  twinklePhase: number;
}

const SOFT_COLORS = [
  'rgba(201, 69, 34, 0.50)',   // deep-flame
  'rgba(255, 200, 160, 0.65)', // warm peach
  'rgba(255, 255, 255, 0.75)', // white sparkle
  'rgba(240, 160, 80, 0.55)',  // amber glow
  'rgba(220, 120, 60, 0.45)',  // muted orange
];

const PARTICLE_COUNT = 60;

function createParticle(canvasW: number, canvasH: number, index: number): Particle {
  const size = 1.5 + Math.random() * 4;
  return {
    x: Math.random() * canvasW,
    y: Math.random() * canvasH,
    vx: (Math.random() - 0.5) * 0.25,
    vy: -0.06 - Math.random() * 0.20,
    size,
    color: SOFT_COLORS[index % SOFT_COLORS.length],
    opacity: 0.35 + Math.random() * 0.65,
    twinkleSpeed: 0.006 + Math.random() * 0.016,
    twinklePhase: Math.random() * Math.PI * 2,
  };
}

function drawParticle(ctx: CanvasRenderingContext2D, p: Particle, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = p.color;

  if (p.size > 3.5) {
    ctx.shadowBlur = 10;
    ctx.shadowColor = p.color;
  }

  ctx.beginPath();

  if (p.size < 2.5) {
    // small → simple circle
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
  } else {
    // larger → 8-pointed star / sparkle
    const s = p.size;
    const inner = s * 0.38;
    const points = 4;
    for (let i = 0; i < points * 2; i++) {
      const angle = (i * Math.PI) / points - Math.PI / 2;
      const r = i % 2 === 0 ? s : inner;
      const x = p.x + Math.cos(angle) * r;
      const y = p.y + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  ctx.fill();
  ctx.restore();
}

export function WallParticles() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let particles: Particle[] = [];
    let cssW = 0;
    let cssH = 0;

    const init = () => {
      const dpr = window.devicePixelRatio || 1;
      cssW = canvas.clientWidth;
      cssH = canvas.clientHeight;
      if (cssW === 0 || cssH === 0) return;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      particles = Array.from({ length: PARTICLE_COUNT }, (_, i) =>
        createParticle(cssW, cssH, i),
      );
    };

    const tick = () => {
      ctx.clearRect(0, 0, cssW, cssH);

      for (const p of particles) {
        p.twinklePhase += p.twinkleSpeed;
        const twinkle = 0.5 + 0.5 * Math.sin(p.twinklePhase);
        const alpha = p.opacity * (0.35 + 0.65 * twinkle);

        p.x += p.vx;
        p.y += p.vy;

        // wrap around edges
        if (p.x < -10) p.x = cssW + 10;
        if (p.x > cssW + 10) p.x = -10;
        if (p.y < -10) p.y = cssH + 10;
        if (p.y > cssH + 10) p.y = 0;

        drawParticle(ctx, p, alpha);
      }

      animId = requestAnimationFrame(tick);
    };

    init();
    tick();

    const ro = new ResizeObserver(() => init());
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="wall__particles"
      aria-hidden="true"
    />
  );
}