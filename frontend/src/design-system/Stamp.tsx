import type { ReactNode } from 'react';

interface Props {
  filled?: boolean;
  team?: boolean;
  size?: number;
  children?: ReactNode;
}

export function Stamp({ filled = false, team = false, size = 44, children }: Props) {
  const cls = ['sk-stamp'];
  if (filled) cls.push(team ? 'sk-stamp--team' : 'sk-stamp--on');
  return (
    <div
      className={cls.join(' ')}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
    >
      {children ?? (filled ? '✓' : '?')}
    </div>
  );
}
