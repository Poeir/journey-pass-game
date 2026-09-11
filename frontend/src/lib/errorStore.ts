import { create } from 'zustand';
import { t } from '@/lib/i18n';

export type ToastKind = 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  kind: ToastKind;
}

interface ErrorStore {
  toasts: Toast[];
  push: (message: string, kind?: ToastKind) => void;
  dismiss: (id: string) => void;
}

export const useErrorStore = create<ErrorStore>((set) => ({
  toasts: [],
  push: (message, kind = 'error') =>
    set((s) => ({
      toasts: [
        ...s.toasts,
        { id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, message, kind },
      ],
    })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function describeHttpError(status: number, code?: string): string {
  if (status === 403) return t('errors.forbidden');
  if (status === 404) return code ? t('errors.notFoundCode', { code }) : t('errors.notFound');
  if (status === 400) return code ? t('errors.invalidCode', { code }) : t('errors.invalid');
  if (status === 409) {
    if (code === 'game_ended') return t('errors.gameEnded');
    if (code === 'not_yet_ended') return t('errors.notYetEnded');
    return code ? t('errors.actionFailedCode', { code }) : t('errors.actionFailed');
  }
  if (status >= 500) return t('errors.serverHiccup');
  return code ? t('errors.genericCode', { status, code }) : t('errors.generic', { status });
}
