/**
 * Copies a picked file into memory right away. On phones (notably iOS Safari) the `File` an <input type="file"> hands
 * out can stop being readable once the input is reset or the picker view is gone, so a two-step flow (preview now,
 * upload again on confirm) must keep its own copy.
 */
export async function toStableFile(picked: File): Promise<File> {
  try {
    const bytes = await picked.arrayBuffer();
    return new File([bytes], picked.name, { type: picked.type, lastModified: picked.lastModified });
  } catch {
    return picked;
  }
}

/** Excel files by extension AND type: iOS/Android pickers grey out files when only an extension is given. */
export const EXCEL_ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Visually hidden but still a real, focusable control (a `display: none` input cannot be opened by every mobile browser). */
export const VISUALLY_HIDDEN_INPUT = { position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden', clip: 'rect(0 0 0 0)', pointerEvents: 'none' } as const;
