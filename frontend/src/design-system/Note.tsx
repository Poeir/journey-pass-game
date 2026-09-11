import type { HTMLAttributes, ReactNode } from 'react';

interface Props extends HTMLAttributes<HTMLDivElement> {
  rotate?: number;
  children?: ReactNode;
}

export function Note({ rotate = -1.4, style, className = '', children, ...rest }: Props) {
  return (
    <div
      className={`sk-note ${className}`}
      style={{ transform: `rotate(${rotate}deg)`, ...style }}
      {...rest}
    >
      {children}
    </div>
  );
}
