import type { ReactNode } from 'react';
import './InfoPanel.css';

type Variant = 'dark' | 'light';

interface Props {
  tag: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  variant?: Variant;
  className?: string;
}

export function InfoPanel({ tag, title, hint, variant = 'dark', className = '' }: Props) {
  return (
    <div className={`info-panel info-panel--${variant} ${className}`.trim()}>
      <div className="info-panel__tag">{tag}</div>
      <div className="info-panel__title">{title}</div>
      {hint !== undefined && <div className="info-panel__hint">{hint}</div>}
    </div>
  );
}
