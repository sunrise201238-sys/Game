import enUS from '@i18n/en-US.json';
import zhTW from '@i18n/zh-TW.json';

type LocaleKey = 'en-US' | 'zh-TW';

type Dictionary = Record<string, string>;

const dictionaries: Record<LocaleKey, Dictionary> = {
  'en-US': enUS,
  'zh-TW': zhTW,
};

const FALLBACK_LOCALE: LocaleKey = 'en-US';

export class I18n {
  private locale: LocaleKey;

  constructor(initialLocale?: string) {
    const preferred = normalize(initialLocale ?? getStoredLocale() ?? navigator.language);
    this.locale = preferred;
  }

  setLocale(locale: LocaleKey) {
    this.locale = locale;
    localStorage.setItem('locale', locale);
  }

  toggleLocale() {
    this.setLocale(this.locale === 'en-US' ? 'zh-TW' : 'en-US');
  }

  t(key: string, params?: Record<string, string | number>): string {
    const dict = dictionaries[this.locale] ?? dictionaries[FALLBACK_LOCALE];
    const template = dict[key] ?? key;
    if (!params) return template;
    return Object.entries(params).reduce((acc, [name, value]) => {
      return acc.replace(new RegExp(`{${name}}`, 'g'), String(value));
    }, template);
  }

  getLocale(): LocaleKey {
    return this.locale;
  }
}

function normalize(locale: string | undefined): LocaleKey {
  if (locale?.toLowerCase().startsWith('zh')) {
    return 'zh-TW';
  }
  return 'en-US';
}

function getStoredLocale(): LocaleKey | null {
  const stored = localStorage.getItem('locale');
  return stored === 'zh-TW' ? 'zh-TW' : stored === 'en-US' ? 'en-US' : null;
}
