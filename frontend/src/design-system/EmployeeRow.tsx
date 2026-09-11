import type { KeyboardEvent, ReactNode } from 'react';
import './EmployeeRow.css';

type Variant = 'solid' | 'dashed' | 'leader';
type Tone = 'default' | 'filled-blue' | 'unread-flame' | 'completed';

interface Props {
  leading?: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
  variant?: Variant;
  tone?: Tone;
  className?: string;
  onClick?: () => void;
  as?: 'div' | 'li';
  role?: string;
  tabIndex?: number;
  onKeyDown?: (ev: KeyboardEvent) => void;
  ariaLabel?: string;
}

export function EmployeeRow({
  leading,
  trailing,
  children,
  variant = 'solid',
  tone = 'default',
  className = '',
  onClick,
  as = 'div',
  role,
  tabIndex,
  onKeyDown,
  ariaLabel,
}: Props) {
  const cls = [
    'emp-row',
    `emp-row--${variant}`,
    `emp-row--tone-${tone}`,
    onClick ? 'emp-row--clickable' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  const commonProps = {
    className: cls,
    onClick,
    role,
    tabIndex,
    onKeyDown,
    'aria-label': ariaLabel,
  };
  const inner = (
    <>
      {leading !== undefined && <div className="emp-row__leading">{leading}</div>}
      <div className="emp-row__body">{children}</div>
      {trailing !== undefined && <div className="emp-row__trailing">{trailing}</div>}
    </>
  );
  if (as === 'li') {
    return <li {...commonProps}>{inner}</li>;
  }
  return <div {...commonProps}>{inner}</div>;
}
