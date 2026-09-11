import type { HTMLAttributes, ReactNode } from 'react';
import './Pill.css';

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'plain' | 'flame' | 'ink' | 'blue';
  children?: ReactNode;
}

export function Pill({ tone = 'plain', className = '', children, ...rest }: Props) {
  return (
    <span className={`pill pill--${tone} ${className}`} {...rest}>
      {children}
    </span>
  );
}
