import { describe, it, expect, beforeEach } from 'vitest';
import { useErrorStore, describeHttpError } from './errorStore';
import { useLanguageStore } from './i18n/languageStore';

beforeEach(() => {
  useErrorStore.setState({ toasts: [] });
  useLanguageStore.setState({ lang: 'en' });
});

describe('useErrorStore — push / dismiss', () => {
  it('push adds a toast with a unique id and the given message', () => {
    useErrorStore.getState().push('something failed');
    const toasts = useErrorStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('something failed');
    expect(toasts[0].kind).toBe('error'); // default kind
    expect(toasts[0].id).toBeTruthy();
  });

  it('two pushes produce distinct toast ids', () => {
    useErrorStore.getState().push('a');
    useErrorStore.getState().push('b');
    const ids = useErrorStore.getState().toasts.map((t) => t.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('push accepts an explicit `info` kind', () => {
    useErrorStore.getState().push('FYI', 'info');
    expect(useErrorStore.getState().toasts[0].kind).toBe('info');
  });

  it('dismiss removes only the toast with the matching id', () => {
    useErrorStore.getState().push('a');
    useErrorStore.getState().push('b');
    const ids = useErrorStore.getState().toasts.map((t) => t.id);
    useErrorStore.getState().dismiss(ids[0]);
    const remaining = useErrorStore.getState().toasts;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(ids[1]);
  });

  it('dismiss with an unknown id is a no-op (does not throw)', () => {
    useErrorStore.getState().push('a');
    expect(() => useErrorStore.getState().dismiss('does-not-exist')).not.toThrow();
    expect(useErrorStore.getState().toasts).toHaveLength(1);
  });
});

describe('describeHttpError — status → human-readable copy', () => {
  it('403 → forbidden message', () => {
    expect(describeHttpError(403)).toMatch(/permission/i);
  });

  it('404 without code → generic not-found', () => {
    expect(describeHttpError(404)).toMatch(/not found/i);
  });

  it('404 with code → includes the code', () => {
    expect(describeHttpError(404, 'pair_missing')).toMatch(/pair_missing/);
  });

  it('400 → invalid request', () => {
    expect(describeHttpError(400)).toMatch(/invalid/i);
  });

  it('409 with code=game_ended → "Time is up" copy', () => {
    expect(describeHttpError(409, 'game_ended')).toMatch(/time is up/i);
  });

  it('409 with code=not_yet_ended → "not closing time yet" copy', () => {
    expect(describeHttpError(409, 'not_yet_ended')).toMatch(/closing/i);
  });

  it('5xx → server hiccup message', () => {
    expect(describeHttpError(500)).toMatch(/server/i);
    expect(describeHttpError(503)).toMatch(/server/i);
  });

  it('unmapped status returns generic copy with the status number', () => {
    expect(describeHttpError(418)).toMatch(/418/);
  });
});
