import type { Component } from "vue";

import DefaultTheme from "./default";
import ModernTheme from "./modern";

export type ThemeKey = "default" | "modern";

export const defaultThemeKey: ThemeKey = "default";

const themeRegistry: Record<ThemeKey, Component> = {
  default: DefaultTheme,
  modern: ModernTheme,
};

export function resolveTheme(theme?: string): Component {
  if (theme && (theme as ThemeKey) in themeRegistry) {
    return themeRegistry[theme as ThemeKey];
  }
  return themeRegistry[defaultThemeKey];
}

export function getAvailableThemes(): ThemeKey[] {
  return Object.keys(themeRegistry) as ThemeKey[];
}

export default resolveTheme;
