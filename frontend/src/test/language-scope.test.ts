import { afterEach, describe, expect, it, vi } from 'vitest';

describe('English-only language', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('ignores a language cookie left behind by 3x-ui', async () => {
    vi.resetModules();
    const utils = await import('@/utils');
    const cookies = new Map<string, string>([
      ['lang', 'fa-IR'],
      ['subLang', 'ru-RU'],
    ]);
    vi.spyOn(utils.CookieManager, 'getCookie').mockImplementation(
      (name) => cookies.get(name) ?? '',
    );
    vi.stubGlobal('window', { navigator: { language: 'fa-IR' }, location: { reload: vi.fn() } });

    const { readyI18n } = await import('@/i18n/react');
    const i18n = await readyI18n();

    expect(i18n.language).toBe('en-US');
    expect(utils.LanguageManager.getLanguage()).toBe('en-US');
  });

  it('does not resolve the language for empty or invalid dates', async () => {
    const utils = await import('@/utils');
    const getLanguage = vi.spyOn(utils.LanguageManager, 'getLanguage').mockReturnValue('en-US');

    expect(utils.IntlUtil.formatDate(null)).toBe('');
    expect(utils.IntlUtil.formatDate(undefined)).toBe('');
    expect(utils.IntlUtil.formatDate('not-a-date')).toBe('');
    expect(getLanguage).not.toHaveBeenCalled();
  });
});
