import type { ReactNode } from 'react';
import buttonBack from '../../assets/button_back.png';
import './PageHeader.css';

type TitleTone = 'ink' | 'flame' | 'blue';
type TitleSize = 'sm' | 'md' | 'lg';
type BackSize = 'sm' | 'md';

interface Props {
  onBack?: () => void;
  title?: ReactNode;
  trailing?: ReactNode;
  titleTone?: TitleTone;
  titleSize?: TitleSize;
  backSize?: BackSize;
  className?: string;
}

export function PageHeader({
  onBack,
  title,
  trailing,
  titleTone = 'ink',
  titleSize = 'md',
  backSize = 'md',
  className = '',
}: Props) {
  return (
    <header className={`page-header ${className}`.trim()}>
      {onBack && (
        <button
          type="button"
          className={`page-header__back page-header__back--${backSize}`}
          onClick={onBack}
          aria-label="Back"
        >
          <img src={buttonBack} alt="" className="page-header__back-icon" />
        </button>
      )}
      {title !== undefined && (
        <div
          className={`sk-hand-b page-header__title page-header__title--${titleSize} page-header__title--${titleTone}`}
        >
          {title}
        </div>
      )}
      {trailing !== undefined && <div className="page-header__trailing">{trailing}</div>}
    </header>
  );
}
