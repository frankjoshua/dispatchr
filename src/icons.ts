// How dispatchr draws its built-in badge icons (the names are the rules', badges.ts), so they read as
// part of the game at any zoom: one stroked path each on a 24 × 24 grid, drawn on the map's canvas and
// as inline SVG in the panels, from the same data. A theme may paint its own art for these names later.

import type { IconName } from './badges';

export interface Icon { label: string; d: string }

/** Every built-in name's art: a name without art does not compile. */
export const ICONS: Record<IconName, Icon> = {
  alert: { label: 'Alert', d: 'M12 3.5L21.5 20H2.5Z M12 9.5V14 M12 17.3v.2' },
  comment: { label: 'Comment', d: 'M4 5h16v10.5h-9l-5 4v-4H4Z' },
  review: { label: 'Review', d: 'M2.5 12C5.5 6.5 18.5 6.5 21.5 12C18.5 17.5 5.5 17.5 2.5 12Z M14.8 12a2.8 2.8 0 1 1-5.6 0a2.8 2.8 0 1 1 5.6 0' },
  merge: { label: 'Merge request', d: 'M8 5a2 2 0 1 1-4 0a2 2 0 1 1 4 0 M8 19a2 2 0 1 1-4 0a2 2 0 1 1 4 0 M20 9a2 2 0 1 1-4 0a2 2 0 1 1 4 0 M6 7v10 M18 11c0 3.5-3 4.5-10.5 6.6' },
  check: { label: 'Done', d: 'M4.5 12.5l5 5L19.5 7' },
  cross: { label: 'Closed', d: 'M6.5 6.5l11 11 M17.5 6.5l-11 11' },
  draft: { label: 'Draft', d: 'M4 20l1-4.5L15.5 5L19 8.5L8.5 19Z M13.5 7l3.5 3.5' },
  running: { label: 'Running', d: 'M8 5.5v13l10.5-6.5Z' },
  clock: { label: 'Waiting', d: 'M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0 M12 7v5.2l3.4 2' },
  bell: { label: 'Bell', d: 'M6 16.5V11a6 6 0 0 1 12 0v5.5l1.8 2H4.2Z M10 21h4' },
  flag: { label: 'Flag', d: 'M5.5 21V3.5 M5.5 4h11.5l-2.5 4l2.5 4H5.5' },
  star: { label: 'Star', d: 'M12 3.2l2.7 5.6l6.1.8l-4.5 4.2l1.1 6.1L12 16.9l-5.4 3l1.1-6.1l-4.5-4.2l6.1-.8Z' },
  lock: { label: 'Locked', d: 'M6 11h12v9.5H6Z M8.5 11V8a3.5 3.5 0 0 1 7 0v3' },
  person: { label: 'Person', d: 'M16 7.5a4 4 0 1 1-8 0a4 4 0 1 1 8 0 M4.5 21c.8-4.5 4-6.5 7.5-6.5s6.7 2 7.5 6.5' },
  artifacts: { label: 'Artifacts', d: 'M5 3h10l4 4v14H5Z M15 3v5h4 M8 12h8 M8 16h6' },
};

const paths = new Map<IconName, Path2D>();

/** Draws a built-in icon centred on (x, y), `size` px across, in `color`. */
export function drawIcon(ctx: CanvasRenderingContext2D, name: IconName, x: number, y: number, size: number, color: string) {
  let p = paths.get(name);
  if (!p) paths.set(name, (p = new Path2D(ICONS[name].d)));
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(p);
  ctx.restore();
}

/** A built-in icon as inline SVG in the current text colour. */
export function iconSvg(name: IconName, size = 14): string {
  return `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[name].d}"/></svg>`;
}
