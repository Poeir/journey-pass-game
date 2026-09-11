import type { ButtonHTMLAttributes, ReactNode } from 'react';
import './Button.css';

type Variant = 'primary' | 'secondary' | 'ghost';
type Color = 'flame' | 'blue' | 'ink';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  color?: Color;
  block?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
}

export function Button({
  variant = 'primary',
  color = 'flame',
  block = false,
  leading,
  trailing,
  children,
  className = '',
  ...rest
}: Props) {
  return (
    <button
      className={`btn btn--${variant} btn--${color} ${block ? 'btn--block' : ''} ${className}`}
      {...rest}
    >
      {leading}
      <span>{children}</span>
      {trailing}
    </button>
  );
}
