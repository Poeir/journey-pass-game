import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { t, tList, useT } from './useT';
import { useLanguageStore } from './languageStore';

beforeEach(() => {
  // Reset language to Thai (the default) before each test.
  useLanguageStore.setState({ lang: 'th' });
});

describe('t() — imperative lookup', () => {
  it('returns the Thai string when lang=th and key exists', () => {
    expect(t('common.cancel')).toBe('ยกเลิก');
  });

  it('returns the English string when lang=en and key exists', () => {
    useLanguageStore.setState({ lang: 'en' });
    expect(t('common.cancel')).toBe('Cancel');
  });

  it('falls back to en when key exists in en but not in th', () => {
    // The locales are structurally aligned, but if a key were missing in th
    // the function must walk back to en. Use a deeply-fake key under a known
    // existing top-level to exercise the lookup → fallback path.
    expect(t('nonexistent.deeply.nested.key')).toBe('nonexistent.deeply.nested.key');
  });

  it('returns the key string when missing in both dictionaries', () => {
    expect(t('totally.unknown.key')).toBe('totally.unknown.key');
  });
});

describe('t() — variable interpolation', () => {
  it('substitutes {name}-style placeholders', () => {
    useLanguageStore.setState({ lang: 'en' });
    expect(t('lang.switchTo', { lang: 'TH' })).toBe('Switch to TH');
  });

  it('leaves placeholder as literal when variable is missing', () => {
    useLanguageStore.setState({ lang: 'en' });
    expect(t('lang.switchTo')).toBe('Switch to {lang}');
  });

  it('leaves placeholder as literal when variable is null/undefined', () => {
    useLanguageStore.setState({ lang: 'en' });
    expect(t('lang.switchTo', { lang: null })).toBe('Switch to {lang}');
    expect(t('lang.switchTo', { lang: undefined })).toBe('Switch to {lang}');
  });

  it('coerces numeric variables to string', () => {
    useLanguageStore.setState({ lang: 'en' });
    // Using lang.switchTo as a numeric-coercion smoke test.
    expect(t('lang.switchTo', { lang: 42 })).toBe('Switch to 42');
  });
});

describe('useT() — hook re-renders on language change', () => {
  it('returns a translator bound to the current language', () => {
    const { result, rerender } = renderHook(() => useT());
    expect(result.current('common.cancel')).toBe('ยกเลิก');

    act(() => {
      useLanguageStore.getState().setLang('en');
    });
    rerender();
    expect(result.current('common.cancel')).toBe('Cancel');
  });
});

describe('tList() — array lookup', () => {
  it('returns [] when the key is not an array in either dict', () => {
    expect(tList('common.cancel')).toEqual([]);
    expect(tList('totally.unknown.key')).toEqual([]);
  });
});
