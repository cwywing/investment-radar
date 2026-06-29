// 主题色:CSS 变量驱动 UI 外壳;此处同步一份供 JS 渲染的图表/雷达 SVG 使用。
// 切主题时 App 会把对应 colors 传给 Radar / AssetDetail,确保写死颜色也跟随切换。

export type Theme = 'dark' | 'light';

export interface ThemeColors {
  bg: string;
  bgPanel: string;
  bgElevated: string;
  border: string;
  borderSoft: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
}

export const THEME_COLORS: Record<Theme, ThemeColors> = {
  dark: {
    bg: '#050b14',
    bgPanel: '#0a1628',
    bgElevated: '#0f1f36',
    border: '#1b3050',
    borderSoft: '#142540',
    text: '#e2e8f0',
    textDim: '#8aa0bd',
    textFaint: '#5a7090',
    accent: '#2dd4bf',
  },
  light: {
    bg: '#f4f6fb',
    bgPanel: '#ffffff',
    bgElevated: '#eef2f9',
    border: '#cdd8ea',
    borderSoft: '#e3e9f3',
    text: '#1a2433',
    textDim: '#5a6b80',
    textFaint: '#8190a6',
    accent: '#0d9488',
  },
};

const STORAGE_KEY = 'radar-theme';

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'light') root.dataset.theme = 'light';
  else delete root.dataset.theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* 忽略隐私模式等写入失败 */
  }
}

export function getThemeColors(theme: Theme): ThemeColors {
  return THEME_COLORS[theme];
}
