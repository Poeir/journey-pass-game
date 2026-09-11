import type { HTMLAttributes, ReactNode } from 'react';
import './Card.css';

interface Props extends HTMLAttributes<HTMLDivElement> {
  tone?: 'plain' | 'peach' | 'sky' | 'ink' | 'cream';
  sketch?: boolean;
  children?: ReactNode;
}

export function Card({
  tone = 'plain',
  sketch = false,
  className = '',
  children,
  ...rest
}: Props) {
  return (
    <div
      className={`card card--${tone} ${sketch ? 'card--sketch' : ''} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
