export const FONT_SIZES = [12, 16, 20, 28, 36, 48, 64, 96];

/** Step a font size up (dir=1) or down (dir=-1) within FONT_SIZES. */
export function stepFontSize(current: number, dir: 1 | -1): number {
  if (dir === 1) {
    return FONT_SIZES.find((size) => size > current) ?? FONT_SIZES[FONT_SIZES.length - 1];
  }

  return FONT_SIZES.findLast((size) => size < current) ?? FONT_SIZES[0];
}
