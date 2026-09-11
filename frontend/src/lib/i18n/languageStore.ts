import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Lang = 'th' | 'en';

interface LanguageStore {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

export const useLanguageStore = create<LanguageStore>()(
  persist(
    (set) => ({
      lang: 'th',
      setLang: (lang) => set({ lang }),
    }),
    { name: 'jp_lang', version: 1 },
  ),
);
