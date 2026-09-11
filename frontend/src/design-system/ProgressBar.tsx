interface Props {
  value: number;
  max: number;
  striped?: boolean;
  color?: string;
  ticks?: boolean;
}

export function ProgressBar({ value, max, striped = false, color, ticks = false }: Props) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const cls = ['sk-bar'];
  if (striped) cls.push('sk-bar--striped');
  return (
    <div className={cls.join(' ')}>
      {ticks && max > 1 && (
        <div className="sk-bar__ticks" aria-hidden>
          {Array.from({ length: max }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      )}
      <div
        className="sk-bar__fill"
        style={{ right: `${100 - pct}%`, ...(color ? { background: color } : {}) }}
      />
    </div>
  );
}
