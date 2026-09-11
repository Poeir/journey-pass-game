import { useEffect } from 'react';
import { useErrorStore, type Toast } from '@/lib/errorStore';
import './Toast.css';

export function ToastContainer() {
  const toasts = useErrorStore((s) => s.toasts);
  const dismiss = useErrorStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4500);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className={`toasts__item toasts__item--${toast.kind}`}>
      <span className="toasts__message">{toast.message}</span>
      <button className="toasts__close" onClick={onDismiss} aria-label="Dismiss">
        ✕
      </button>
    </div>
  );
}
