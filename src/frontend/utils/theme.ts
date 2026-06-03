import { SIMPLE_ICONS } from "../icons-data";
import { SUBCAT_DISPLAY_NAMES, DEFAULT_ICON } from "../../shared/constants";

const categoryColors: Record<string, string> = {};

export function getCategoryColor(cat: string): string {
  if (!categoryColors[cat]) {
    const h = Math.floor(Math.random() * 360);
    const s = Math.floor(Math.random() * 20) + 40; // 40% - 60% saturation
    const l = Math.floor(Math.random() * 15) + 35; // 35% - 50% lightness
    categoryColors[cat] = `hsl(${h}, ${s}%, ${l}%)`;
  }
  return categoryColors[cat];
}

export const SINGLE_ICON_CATEGORIES: string[] = [];

export const ICONS: Record<string, string> = {
  rtos: SIMPLE_ICONS["cat:rtos"] || "",
  mcu: SIMPLE_ICONS["cat:mcu"] || "",
  markup: SIMPLE_ICONS["cat:markup"] || "",
  toolchain: SIMPLE_ICONS["cat:toolchain"] || ""
};

export function formatSubcategory(sub: string): string {
  const key = sub.trim().toLowerCase();
  if (SUBCAT_DISPLAY_NAMES[key]) {
    return SUBCAT_DISPLAY_NAMES[key];
  }
  if (key.length === 0) return '';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function getKeywordIcon(keyword: string): string {
  const key = keyword.toLowerCase();
  if (key === 'c' || key === 'rust' || key === 'python') {
    return SIMPLE_ICONS[`cat:${key}`] || DEFAULT_ICON;
  }
  return SIMPLE_ICONS[key] || DEFAULT_ICON;
}

export function getCategoryIcon(cat: string): string {
  return ICONS[cat] || DEFAULT_ICON;
}
