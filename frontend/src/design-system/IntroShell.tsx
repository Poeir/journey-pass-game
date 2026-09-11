import type { ReactNode } from 'react';
import { Button } from './Button';
import { PassportButton } from './PassportButton';
import { IconArrowRight } from './icons';
import { PageHeader } from './PageHeader';
import './IntroShell.css';

type Color = 'flame' | 'blue';

interface Props {
  rootClassName?: string;
  loadingClassName?: string;
  loading?: boolean;
  title: ReactNode;
  titleTone: Color;
  onBack?: () => void;
  illustration: ReactNode;
  copy: ReactNode;
  loadingCopy?: ReactNode;
  ctaLabel: ReactNode;
  ctaColor: Color;
  onCta: () => void;
  hideCtaWhileLoading?: boolean;
}

export function IntroShell({
  rootClassName = '',
  loadingClassName = '',
  loading = false,
  title,
  titleTone,
  onBack,
  illustration,
  copy,
  loadingCopy,
  ctaLabel,
  ctaColor,
  onCta,
  hideCtaWhileLoading = true,
}: Props) {
  const cls = ['intro-shell', rootClassName, loading ? loadingClassName : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div className={cls}>
      <PageHeader onBack={onBack} title={title} titleTone={titleTone} titleSize="md" />
      <div className="intro-shell__illustration">{illustration}</div>
      <div className="intro-shell__copy">
        {loading && loadingCopy !== undefined ? loadingCopy : copy}
      </div>
      <div className="intro-shell__spacer" />
      {(!loading || !hideCtaWhileLoading) &&
        (ctaColor === 'flame' ? (
          <PassportButton block onClick={onCta}>
            <span className="intro-shell__cta-inner">
              {ctaLabel}
              <IconArrowRight size={16} />
            </span>
          </PassportButton>
        ) : (
          <Button block color={ctaColor} onClick={onCta}>
            <span className="intro-shell__cta-inner">
              {ctaLabel}
              <IconArrowRight size={16} />
            </span>
          </Button>
        ))}
    </div>
  );
}
