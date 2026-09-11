import type { ButtonHTMLAttributes } from 'react';
import asset08 from '../../assets/asset08.png';
import './PassportButton.css';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  block?: boolean;
}

export function PassportButton({
  block = false,
  className = '',
  children,
  type = 'button',
  ...rest
}: Props) {
  const cls = [
    'passport-btn',
    block ? 'passport-btn--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button type={type} className={cls} {...rest}>
      <img
        src={asset08}
        className="passport-btn__frame"
        alt=""
        aria-hidden="true"
      />
      <span className="sk-hand-b passport-btn__text">{children}</span>
    </button>
  );
}
