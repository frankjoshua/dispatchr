// Agent names (GLOSSARY: short name, name plate): listed as the core (coreName), cut to fit with its copy
// number kept (oneLine, splitCopy); the selected agent's, on the map and in the units list, is its whole
// name, broken after non-alphanumeric characters (namePieces, wrapName). On the map, who carries a plate
// and whose goes on top (plateShown, plateRank).

const PIECES = /[\p{L}\p{N}]*[^\p{L}\p{N}]*/gu;
const TRAILING_SEPARATORS = /[^\p{L}\p{N}]+$/u;
/** Kinds of change a branch-style name starts with (Conventional Commits): what kind, not which. */
const KINDS = new Set(['feat', 'fix', 'chore', 'ci', 'perf', 'build', 'docs', 'refactor', 'style', 'test', 'revert']);
/** A tracker's ID: seven or more letters and digits, mixed, at least three digits (`868abcd0j`). */
const isId = (word: string) => word.length >= 7 && /\p{L}/u.test(word) && (word.match(/\p{N}/gu)?.length ?? 0) >= 3;
/** A copy number at the end (`-2`, `_3`): kept through a cut, so an agent and its copy stay apart. */
const COPY = /[^\p{L}\p{N}]\p{N}{1,2}$/u;

/** From this zoom every agent carries its name plate. */
export const NAMES_ZOOM = 0.5;

/** Whether an agent carries its name plate at zoom `z`: at any zoom when loud (looked at, blocked, flashing), working or among the most recent; everyone from NAMES_ZOOM. */
export function plateShown(status: string, loud: boolean, recent: boolean, z: number): boolean {
  return loud || recent || status === 'working' || z >= NAMES_ZOOM;
}

/** Where plates overlap the higher goes on top: loud, then working, then recent; within each, the brighter (`light` 0–1). */
export function plateRank(status: string, loud: boolean, recent: boolean, light: number): number {
  return (loud ? 3 : status === 'working' ? 2 : recent ? 1 : 0) + light / 2;
}

/** A name in the pieces it may break after: each a run of letters and digits and the separators after it. */
export function namePieces(name: string): string[] {
  return (name.match(PIECES) ?? []).filter(Boolean);
}

/** `text` and the copy number it ends with, if any (`strict-metrics-2` → `strict-metrics`, `-2`). */
export function splitCopy(text: string): [string, string] {
  const copy = text.match(COPY)?.[0] ?? '';
  return [text.slice(0, text.length - copy.length), copy];
}

/**
 * The part of a name that tells agents apart: without a leading kind of change (`feat-`, `fix-`, `ci-`…)
 * or a tracker ID (`868abcd0j`), so `fix-ios-screenshot-868abcd6e-2` is `ios-screenshot-2`. A name
 * that would be left with nothing is kept whole.
 */
export function coreName(name: string): string {
  const pieces = namePieces(name);
  const word = (piece: string) => piece.replace(TRAILING_SEPARATORS, '');
  const start = pieces.length > 1 && KINDS.has(word(pieces[0]).toLowerCase()) ? 1 : 0;
  let core = '';
  for (let i = start; i < pieces.length; i++) if (!isId(word(pieces[i]))) core += pieces[i];
  return core.replace(TRAILING_SEPARATORS, '') || name;
}

/**
 * `text` on one line no wider than `max` (by `width`): cut with `…`, on a whole word when that keeps
 * most of the line, a copy number at the end kept after the `…` (`strict-metrics…-2`).
 */
export function oneLine(text: string, max: number, width: (s: string) => number): string {
  if (width(text) <= max) return text;
  const [rest, copy] = splitCopy(text);
  const tail = '…' + copy;
  const chars = [...rest];
  let cut = chars.length;
  while (cut > 1 && width(chars.slice(0, cut).join('') + tail) > max) cut--;
  let head = chars.slice(0, cut).join('');
  const midWord = /[\p{L}\p{N}]/u.test(chars[cut] ?? '');
  const lastBreak = head.search(/[^\p{L}\p{N}][\p{L}\p{N}]*$/u);
  if (midWord && lastBreak > 0 && width(head.slice(0, lastBreak)) >= 0.75 * width(head)) head = head.slice(0, lastBreak);
  return (head.replace(TRAILING_SEPARATORS, '') || head) + tail;
}

/**
 * A name as lines no wider than `max` (by `width`): broken after the non-alphanumeric characters it
 * contains (`feat-port-noise` → `feat-port-` / `noise`), each line as full as it fits. A run with
 * nothing to break at that is wider than a line by itself is cut where it overflows.
 */
export function wrapName(name: string, max: number, width: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const piece of namePieces(name)) {
    if (line && width(line + piece) > max) { lines.push(line.trimEnd()); line = ''; }
    line += piece;
    while (width(line) > max) {
      const chars = [...line];
      let cut = chars.length - 1;
      while (cut > 1 && width(chars.slice(0, cut).join('')) > max) cut--;
      if (cut < 1) break;
      lines.push(chars.slice(0, cut).join(''));
      line = chars.slice(cut).join('');
    }
  }
  if (line.trimEnd()) lines.push(line.trimEnd());
  return lines.length ? lines : [name];
}
