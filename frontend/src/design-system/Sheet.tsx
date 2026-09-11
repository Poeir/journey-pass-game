import type { ReactNode } from 'react';
import { useEffect } from 'react';
import './Sheet.css';

interface Props {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  position?: 'top' | 'bottom' | 'center';
  size?: 'sm' | 'md' | 'lg';
}

export function Sheet({ open, onClose, title, children, position = 'bottom', size = 'sm' }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={`sheet-root sheet-root--${position}`} role="dialog" aria-modal="true">
      <button className="sheet-backdrop" aria-label="Close" onClick={onClose} />
      <div
        className={`sheet-panel sheet-panel--${position} sheet-panel--${size}`}
        role="document"
      >
        {position === 'bottom' && <div className="sheet-grip" />}
        {title ? (
          <div className="sheet-header">
            <div className="sheet-title">{title}</div>
            <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
          </div>
        ) : null}
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
