import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { LanguageManager } from '@/utils';
import enUS from '../../../internal/web/translation/en-US.json';

export async function readyI18n() {
  const active = LanguageManager.getLanguage();
  await i18next.use(initReactI18next).init({
    lng: active,
    fallbackLng: active,
    resources: { [active]: { translation: enUS } },
    interpolation: { escapeValue: false, prefix: '{', suffix: '}' },
    returnNull: false,
  });
  return i18next;
}

export { i18next as i18n };
