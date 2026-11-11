import { isObj } from './data';
import type { Artifact } from './types';

export interface ArtifactView {
  url: string;
  title: string;
  host: string;
  metadata: Record<string, unknown>;
}

function artifactUrl(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > 2048 || !/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function artifactList(value: unknown): Artifact[] {
  const artifacts: Artifact[] = [];
  if (!Array.isArray(value)) return artifacts;
  for (const entry of value) {
    if (!isObj(entry) || typeof entry.url !== 'string' || !artifactUrl(entry.url)) continue;
    const metadata = entry.metadata === undefined ? {} : entry.metadata;
    if (!isObj(metadata)) continue;
    artifacts.push({ url: entry.url, metadata });
  }
  return artifacts;
}

/** When an artifact was last published, from its `updated_at` metadata (ms); null without a readable one. */
function updatedAt(artifact: Artifact): number | null {
  const at = artifact.metadata.updated_at;
  const ms = typeof at === 'string' ? Date.parse(at) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Artifacts as the chooser lists them, most recent first: by their `updated_at` metadata, newest first;
 * then any without one, the last in rostr's list (the most recently added) first.
 */
export function newestFirst(artifacts: readonly Artifact[]): Artifact[] {
  return artifacts
    .map((artifact, i) => ({ artifact, i, at: updatedAt(artifact) }))
    .sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity) || b.i - a.i)
    .map(({ artifact }) => artifact);
}

export function artifactView(artifact: Artifact): ArtifactView {
  const url = artifactUrl(artifact.url);
  if (!url) throw new TypeError('Artifact URL must be absolute HTTP(S)');
  const path = url.pathname.replace(/\/+$/, '');
  let title = path.slice(path.lastIndexOf('/') + 1);
  try {
    title = decodeURIComponent(title);
  } catch {
    // An otherwise valid URL can contain a malformed percent-encoded filename.
  }
  const named = typeof artifact.metadata.title === 'string' ? artifact.metadata.title.trim() : '';
  return { url: artifact.url, title: named || title || url.hostname, host: url.host, metadata: artifact.metadata };
}
