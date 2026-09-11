import { useLanguageStore, type Lang } from './languageStore';
import { en } from './locales/en';
import { th } from './locales/th';

const DICTS: Record<Lang, unknown> = { en, th };

type Vars = Record<string, string | number | null | undefined>;

function lookup(dict: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, dict);
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = vars[k];
    return v === null || v === undefined ? `{${k}}` : String(v);
  });
}

function resolve(lang: Lang, key: string, vars?: Vars): string {
  const primary = lookup(DICTS[lang], key);
  if (typeof primary === 'string') return interpolate(primary, vars);
  if (lang !== 'en') {
    const fallback = lookup(DICTS.en, key);
    if (typeof fallback === 'string') return interpolate(fallback, vars);
  }
  return key;
}

/** Hook for components — re-renders when language changes. */
export function useT() {
  const lang = useLanguageStore((s) => s.lang);
  return (key: string, vars?: Vars) => resolve(lang, key, vars);
}

/** Imperative version for use outside React render (event handlers, stores, mappers). */
export function t(key: string, vars?: Vars): string {
  return resolve(useLanguageStore.getState().lang, key, vars);
}

/** Look up a list value (e.g. random pickers). Falls back to en, then []. */
export function tList(key: string): string[] {
  const lang = useLanguageStore.getState().lang;
  const primary = lookup(DICTS[lang], key);
  if (Array.isArray(primary)) return primary as string[];
  if (lang !== 'en') {
    const fallback = lookup(DICTS.en, key);
    if (Array.isArray(fallback)) return fallback as string[];
  }
  return [];
}
