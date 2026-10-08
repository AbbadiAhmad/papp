import { z } from 'zod';

/**
 * Appearance: installable theme packs (`themes/<key>/theme.json`) and the
 * admin-editable menu layout (`system_settings` key `appearance.menu_layout`).
 * Shared by apps/api (validation on read/write) and apps/web (applying them).
 *
 * A theme pack is DATA ONLY (colors, fonts, radius, shell style) — never code
 * — so installing one cannot execute anything and needs no rebuild.
 */

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be a #rrggbb color');
const localizedText = z.object({ ar: z.string().min(1).max(80), en: z.string().min(1).max(80) });
const fontStack = z.string().min(1).max(200).regex(/^[\w\s,"'-]+$/, 'must be a plain font-family list');

export const themePaletteSchema = z.object({
  primary: hexColor,
  primaryContrast: hexColor,
  secondary: hexColor,
  background: hexColor,
  surface: hexColor,
  text: hexColor,
  textMuted: hexColor,
  border: hexColor,
  hero: hexColor,
  headerBg: hexColor,
  headerText: hexColor,
  success: hexColor,
  warning: hexColor,
  error: hexColor,
  info: hexColor,
});

export const themePackSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
  version: z.string().min(1).max(20),
  name: localizedText,
  description: localizedText.optional(),
  /** `sidebar`: today's permanent drawer. `tabs`: top tab bar of menu groups, pages of the active group in a second row. */
  shell: z.enum(['sidebar', 'tabs']),
  radius: z.number().int().min(0).max(32),
  fonts: z.object({ ar: fontStack, en: fontStack }),
  light: themePaletteSchema,
  /** Optional; when absent the theme is light-only. */
  dark: themePaletteSchema.optional(),
});

export type ThemePack = z.infer<typeof themePackSchema>;
export type ThemePalette = z.infer<typeof themePaletteSchema>;

export const MENU_LAYOUT_MAX_GROUPS = 30;
export const MENU_LAYOUT_MAX_ITEMS = 300;
/** Menu entry ids the layout may never hide, so an admin cannot lock themselves out of this editor. */
export const MENU_ALWAYS_VISIBLE_IDS = ['appearance'] as const;

const entryId = z.string().min(1).max(120);
const optionalLocalized = z.object({ ar: z.string().max(80).optional(), en: z.string().max(80).optional() });

export const menuLayoutSchema = z
  .object({
    /** Custom groups, in display order. Entries not listed anywhere keep their default place after these. */
    groups: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9_.-]{1,60}$/),
          label: localizedText.optional(),
          icon: z.string().max(60).optional(),
          itemIds: z.array(entryId).max(MENU_LAYOUT_MAX_ITEMS),
        }),
      )
      .max(MENU_LAYOUT_MAX_GROUPS),
    hidden: z.array(entryId).max(MENU_LAYOUT_MAX_ITEMS),
    /** Per-entry label overrides (group or leaf id -> text per language). */
    labels: z.record(entryId, optionalLocalized),
  })
  .superRefine((layout, ctx) => {
    for (const id of MENU_ALWAYS_VISIBLE_IDS) {
      if (layout.hidden.includes(id)) {
        ctx.addIssue({ code: 'custom', path: ['hidden'], message: `"${id}" can never be hidden` });
      }
    }
    const seen = new Set<string>();
    for (const group of layout.groups) {
      for (const id of group.itemIds) {
        if (seen.has(id)) ctx.addIssue({ code: 'custom', path: ['groups'], message: `entry "${id}" is in more than one group` });
        seen.add(id);
      }
    }
    if (new Set(layout.groups.map((g) => g.id)).size !== layout.groups.length) {
      ctx.addIssue({ code: 'custom', path: ['groups'], message: 'group ids must be unique' });
    }
  });

export type MenuLayout = z.infer<typeof menuLayoutSchema>;

export const EMPTY_MENU_LAYOUT: MenuLayout = { groups: [], hidden: [], labels: {} };
