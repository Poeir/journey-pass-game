import { useLanguageStore, type Lang } from '@/lib/i18n';
import './LanguageToggle.css';

interface Props {
  className?: string;
  size?: 'sm' | 'md';
}

const LABEL: Record<Lang, string> = {
  th: 'TH',
  en: 'EN',
};

export function LanguageToggle({ className = '', size = 'md' }: Props) {
  const lang = useLanguageStore((s) => s.lang);
  const setLang = useLanguageStore((s) => s.setLang);
  const next: Lang = lang === 'th' ? 'en' : 'th';

  return (
    <button
      type="button"
      className={`lang-toggle lang-toggle--${size} ${className}`.trim()}
      aria-label={`Switch language to ${next === 'th' ? 'Thai' : 'English'}`}
      onClick={() => setLang(next)}
    >
      {LABEL[lang]}
    </button>
  );
}
