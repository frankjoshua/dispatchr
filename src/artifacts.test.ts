import { describe, expect, it } from 'vitest';
import { artifactList, artifactView, newestFirst } from './artifacts';
import type { Artifact } from './types';

describe('artifactList', () => {
  it('has no artifacts for an older agent or a non-list field', () => {
    for (const value of [undefined, null, {}, 'https://example.test/report']) expect(artifactList(value)).toEqual([]);
  });

  it('excludes unsafe protocols, relative links and malformed URLs', () => {
    const urls = [
      'javascript:alert(1)',
      'data:text/html,<h1>Report</h1>',
      'file:///tmp/report.html',
      'ftp://example.test/report',
      'mailto:viewer@example.test',
      '/report.html',
      '//example.test/report',
      'https:example.test/report',
      'https://',
      'https://[broken/report',
      '',
    ];
    expect(artifactList(urls.map((url) => ({ url, metadata: {} })))).toEqual([]);
    expect(artifactList([
      { url: 'http://example.test/report', metadata: {} },
      { url: 'HTTPS://example.test/report', metadata: {} },
    ])).toHaveLength(2);
  });

  it('excludes malformed records and metadata, and defaults omitted metadata to an empty object', () => {
    const url = 'https://example.test/report';
    expect(artifactList([
      null,
      'report',
      [],
      {},
      { url: 4, metadata: {} },
      ...[null, [], 'title', 7, false].map((metadata) => ({ url, metadata })),
    ])).toEqual([]);
    expect(artifactList([{ url, metadata: {} }])).toEqual([{ url, metadata: {} }]);
    expect(artifactList([{ url }])).toEqual([{ url, metadata: {} }]);
  });

  it('preserves input order, duplicate URLs and complete opaque nested metadata', () => {
    const metadata = {
      title: 'Report',
      review: { approved: false, comments: [{ body: 'Keep this', line: 12 }] },
      values: [null, true, 2.5, { arbitrary: ['nested'] }],
    };
    const entries = [
      { url: 'https://example.test/z', metadata },
      { url: 'https://example.test/a', metadata: { kind: 'text' } },
      { url: 'https://example.test/z', metadata: { revision: 2 } },
    ];
    const artifacts = artifactList(entries);
    expect(artifacts).toEqual(entries);
    expect(artifacts[0].metadata).toBe(metadata);
  });
});

describe('newestFirst', () => {
  const art = (name: string, updated_at?: unknown): Artifact => ({ url: `https://example.test/${name}`, metadata: updated_at === undefined ? {} : { updated_at } });
  const names = (list: Artifact[]) => list.map((a) => a.url.slice(a.url.lastIndexOf('/') + 1));

  it('puts the most recently updated first, wherever rostr lists it', () => {
    expect(names(newestFirst([
      art('first', '2026-10-10T12:00:00Z'),
      art('republished', '2026-10-13T12:31:47.713520+00:00'),
      art('middle', '2026-10-11T16:29:05Z'),
    ]))).toEqual(['republished', 'middle', 'first']);
  });

  it('lists those without a readable time after, the last added first; ties keep the later one first', () => {
    expect(names(newestFirst([art('a'), art('dated', '2026-10-10T00:00:00Z'), art('b', 'yesterday'), art('c', 7)]))).toEqual(['dated', 'c', 'b', 'a']);
    expect(names(newestFirst([art('x', '2026-10-10T00:00:00Z'), art('y', '2026-10-10T00:00:00Z')]))).toEqual(['y', 'x']);
  });

  it('leaves the list it is given alone', () => {
    const list = [art('a'), art('b')];
    newestFirst(list);
    expect(names(list)).toEqual(['a', 'b']);
  });
});

describe('artifactView', () => {
  it('uses a nonblank metadata title and preserves the opaque metadata and URL', () => {
    const metadata = { title: '  Release report  ', nested: { state: ['ready'] } };
    const artifact: Artifact = { url: 'https://example.test:8443/reports/other.html?version=2#summary', metadata };
    expect(artifactView(artifact)).toEqual({
      url: artifact.url,
      title: 'Release report',
      host: 'example.test:8443',
      metadata,
    });
    expect(artifactView(artifact).metadata).toBe(metadata);
  });

  it('falls back to the decoded last pathname part for absent or malformed titles', () => {
    for (const title of [undefined, '', ' \t ', null, 5, false, {}, ['Title']]) {
      expect(artifactView({ url: 'https://example.test/reports/Release%20notes%20%E2%9C%93.html/?download=1#top', metadata: { title } }).title).toBe('Release notes ✓.html');
    }
  });

  it('uses the hostname for a URL without a pathname title', () => {
    expect(artifactView({ url: 'https://example.test:8443/?title=Report#Title', metadata: {} }).title).toBe('example.test');
  });

  it('keeps a filename whose percent encoding cannot be decoded', () => {
    expect(artifactView({ url: 'https://example.test/report%ZZ.html', metadata: {} }).title).toBe('report%ZZ.html');
  });

  it('never exposes an unsafe URL even when called without normalization', () => {
    expect(() => artifactView({ url: 'javascript:alert(1)', metadata: {} })).toThrow(TypeError);
  });
});
