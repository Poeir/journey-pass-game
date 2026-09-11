import type { ReactNode } from 'react';
import './SectionLabel.css';

type Variant = 'icon' | 'eyebrow';
type IconTone = 'blue' | 'flame' | 'gold' | 'neutral';

interface Props {
  variant?: Variant;
  icon?: ReactNode;
  iconTone?: IconTone;
  children: ReactNode;
  className?: string;
}

export function SectionLabel({
  variant,
  icon,
  iconTone = 'blue',
  children,
  className = '',
}: Props) {
  const resolved: Variant = variant ?? (icon ? 'icon' : 'eyebrow');
  return (
    <div className={`section-label section-label--${resolved} ${className}`.trim()}>
      {icon && (
        <span className={`section-label__icon section-label__icon--${iconTone}`}>
          {icon}
        </span>
      )}
      <span className="section-label__text">{children}</span>
    </div>
  );
}
