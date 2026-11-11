import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { theme as antdTheme } from 'antd';
import type { ThemeConfig } from 'antd';

const STORAGE_DARK = 'dark-mode';
const STORAGE_ULTRA = 'isUltraDarkThemeEnabled';

function readBool(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === 'true';
}

function applyDom(isDark: boolean, isUltra: boolean) {
  document.body.classList.remove('dark', 'light');
  document.body.classList.add(isDark ? 'dark' : 'light');
  // Native scrollbars read color-scheme, not the body class.
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  if (isUltra) {
    document.documentElement.setAttribute('data-theme', 'ultra-dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  const msg = document.getElementById('message');
  if (msg) {
    msg.classList.remove('dark', 'light');
    msg.classList.add(isDark ? 'dark' : 'light');
  }
}

// module load so the document is in the right theme before React mounts.
// The brand site (vpn.ovix.store) opens light; a saved choice still wins.
const initialDark = readBool(STORAGE_DARK, false);
const initialUltra = readBool(STORAGE_ULTRA, false);
applyDom(initialDark, initialUltra);

// Ovix brand (vpn.ovix.store), mirrored from src/ds/tokens.css. Light fills
// use #C2410C so white 14px text on primary buttons meets AA.
const FONT_BODY = "'Inter Variable', 'Inter', system-ui, sans-serif";
const FONT_MONO = "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace";

const SHARED_TOKENS = {
  fontFamily: FONT_BODY,
  fontFamilyCode: FONT_MONO,
  borderRadius: 10,
  borderRadiusLG: 18,
  borderRadiusSM: 8,
  colorBgLayout: 'transparent',
};

const LIGHT_TOKENS = {
  ...SHARED_TOKENS,
  colorPrimary: '#c2410c',
  colorLink: '#c2410c',
  colorInfo: '#c2410c',
  colorSuccess: '#047857',
  colorWarning: '#b45309',
  colorError: '#b91c1c',
  colorErrorText: '#b91c1c',
  colorSuccessText: '#047857',
  colorText: '#111827',
  colorTextSecondary: '#4b5563',
  colorTextTertiary: '#5f6672',
  colorTextDescription: '#5f6672',
  colorTextPlaceholder: '#6b7280',
  colorBorder: 'rgba(17, 24, 39, 0.14)',
  colorBorderSecondary: 'rgba(17, 24, 39, 0.08)',
  colorBgContainer: '#ffffff',
  colorBgElevated: '#ffffff',
  colorFillSecondary: 'rgba(249, 115, 22, 0.08)',
  boxShadowTertiary: '0 10px 30px -12px rgba(17, 24, 39, 0.12), 0 1px 2px rgba(17, 24, 39, 0.04)',
};

const DARK_TOKENS = {
  ...SHARED_TOKENS,
  colorPrimary: '#fd8e43',
  colorLink: '#fd8e43',
  colorInfo: '#fd8e43',
  colorSuccess: '#34d399',
  colorWarning: '#fbbf24',
  colorError: '#f87171',
  colorText: '#f3f4f6',
  colorTextSecondary: '#9ca3af',
  colorTextTertiary: '#8b93a1',
  colorTextDescription: '#8b93a1',
  colorTextPlaceholder: '#7c8492',
  colorBorder: 'rgba(255, 255, 255, 0.14)',
  colorBorderSecondary: 'rgba(255, 255, 255, 0.08)',
  colorBgBase: '#090a0f',
  colorBgContainer: '#11131d',
  colorBgElevated: '#171a26',
};

const ULTRA_DARK_TOKENS = {
  ...DARK_TOKENS,
  colorBgBase: '#000000',
  colorBgContainer: '#0b0c12',
  colorBgElevated: '#12141c',
};

const LAYOUT_TOKENS = {
  bodyBg: 'transparent',
  headerBg: 'transparent',
  footerBg: 'transparent',
  siderBg: 'transparent',
  triggerBg: 'transparent',
};

const MENU_TOKENS = {
  itemBg: 'transparent',
  subMenuItemBg: 'transparent',
  darkItemBg: 'transparent',
  darkSubMenuItemBg: 'transparent',
  itemBorderRadius: 10,
  itemMarginInline: 10,
};

const STATISTIC_TOKENS = {
  contentFontSize: 26,
  titleFontSize: 12,
};

function componentTokens(isDark: boolean, isUltra: boolean) {
  return {
    Layout: LAYOUT_TOKENS,
    Menu: {
      ...MENU_TOKENS,
      darkPopupBg: isUltra ? '#12141c' : '#171a26',
    },
    Button: {
      primaryShadow: isDark
        ? '0 8px 20px -8px rgba(249, 115, 22, 0.45)'
        : '0 8px 20px -8px rgba(234, 88, 12, 0.55)',
      primaryColor: isDark ? '#111827' : '#ffffff',
      fontWeight: 600,
    },
    Card: { headerFontSize: 16 },
    Table: {
      headerBg: 'transparent',
      headerSplitColor: 'transparent',
      rowHoverBg: isDark ? 'rgba(253, 142, 67, 0.08)' : 'rgba(249, 115, 22, 0.06)',
    },
    Statistic: STATISTIC_TOKENS,
    Tag: { defaultBg: isDark ? '#1b1e2b' : '#eef0f3' },
  };
}

// hashed:false drops the `:where(.css-<hash>)` wrapper antd puts around every
// rule. It costs nothing in specificity — `:where()` contributes zero, so the
// panel's own `.ant-*` overrides still win — and it removes roughly 5,700
// wrappers, 16% of the generated stylesheet, from what the browser has to parse.
//
// cssVar.key pins the CSS-variable scope. Every panel page mounts its own
// ConfigProvider (there is no root one), and without a fixed key each mints a
// fresh useId-derived scope, so navigating re-serialises and re-injects the whole
// token block under a new class instead of reusing the one already in the head.
const SHARED_STYLE_CONFIG = {
  hashed: false,
  cssVar: { key: 'xui' },
} as const;

export function buildAntdThemeConfig(isDark: boolean, isUltra: boolean): ThemeConfig {
  if (!isDark) {
    return {
      ...SHARED_STYLE_CONFIG,
      algorithm: antdTheme.defaultAlgorithm,
      token: LIGHT_TOKENS,
      components: componentTokens(false, false),
    };
  }
  return {
    ...SHARED_STYLE_CONFIG,
    algorithm: antdTheme.darkAlgorithm,
    token: isUltra ? ULTRA_DARK_TOKENS : DARK_TOKENS,
    components: componentTokens(true, isUltra),
  };
}

export function pauseAnimationsUntilLeave(elementId: string): void {
  document.documentElement.setAttribute('data-theme-animations', 'off');
  const el = document.getElementById(elementId);
  if (!el) return;
  const restore = () => {
    document.documentElement.removeAttribute('data-theme-animations');
    el.removeEventListener('mouseleave', restore);
    el.removeEventListener('touchend', restore);
  };
  el.addEventListener('mouseleave', restore);
  el.addEventListener('touchend', restore);
}

interface ThemeContextValue {
  isDark: boolean;
  isUltra: boolean;
  toggleTheme: () => void;
  toggleUltra: () => void;
  antdThemeConfig: ThemeConfig;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState<boolean>(initialDark);
  const [isUltra, setIsUltra] = useState<boolean>(initialUltra);

  useLayoutEffect(() => {
    applyDom(isDark, isUltra);
    localStorage.setItem(STORAGE_DARK, String(isDark));
    localStorage.setItem(STORAGE_ULTRA, String(isUltra));
  }, [isDark, isUltra]);

  const toggleTheme = useCallback(() => setIsDark((v) => !v), []);
  const toggleUltra = useCallback(() => setIsUltra((v) => !v), []);

  const antdThemeConfig = useMemo(() => buildAntdThemeConfig(isDark, isUltra), [isDark, isUltra]);

  const value = useMemo<ThemeContextValue>(
    () => ({ isDark, isUltra, toggleTheme, toggleUltra, antdThemeConfig }),
    [isDark, isUltra, toggleTheme, toggleUltra, antdThemeConfig],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
