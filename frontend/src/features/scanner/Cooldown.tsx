import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';

interface Props {
  deadline: number;
  onDone: () => void;
}

export function Cooldown({ deadline, onDone }: Props) {
  const t = useT();
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
  );

  useEffect(() => {
    setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining <= 0) onDone();
    };
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [deadline, onDone]);

  if (secondsLeft <= 0) return null;
  return (
    <div className="scanner__cooldown" role="status" aria-live="polite">
      <div className="scanner__cooldown-label">{t('scanner.cooldownLabel')}</div>
      <div className="sk-hand-b scanner__cooldown-count" key={secondsLeft}>
        {secondsLeft}
      </div>
    </div>
  );
}
