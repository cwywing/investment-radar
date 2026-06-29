import { describe, it, expect, beforeEach } from 'vitest';
import { getStoredTheme, applyTheme, getThemeColors, THEME_COLORS } from '../theme';

describe('theme 模块', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('getStoredTheme:无记录默认 dark', () => {
    expect(getStoredTheme()).toBe('dark');
  });

  it('getStoredTheme:localStorage 存 light 则返回 light', () => {
    localStorage.setItem('radar-theme', 'light');
    expect(getStoredTheme()).toBe('light');
  });

  it('applyTheme(light):写 data-theme 并持久化', () => {
    applyTheme('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.getItem('radar-theme')).toBe('light');
  });

  it('applyTheme(dark):移除 data-theme 属性(暗色为默认)', () => {
    applyTheme('light');
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    expect(localStorage.getItem('radar-theme')).toBe('dark');
  });

  it('getThemeColors:两套色板 accent 不同且均为合法 hex', () => {
    const dark = getThemeColors('dark');
    const light = getThemeColors('light');
    expect(dark.accent).toBe(THEME_COLORS.dark.accent);
    expect(light.accent).toBe(THEME_COLORS.light.accent);
    expect(dark.accent).not.toBe(light.accent);
    for (const c of Object.values(dark)) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
    for (const c of Object.values(light)) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
