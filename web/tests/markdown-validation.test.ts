import { describe, expect, it } from 'vitest';
import {
  introducedDiagnostics,
  parseArguments,
  validateMarkdown,
  type MarkdownSnapshot,
} from '../scripts/check-markdown';

function snapshot(
  documents: Record<string, string>,
  extras: string[] = [],
  deferredPrefixes: string[] = [],
): MarkdownSnapshot {
  return {
    markdown: new Map(Object.entries(documents)),
    files: new Set([...Object.keys(documents), ...extras]),
    deferredPrefixes,
  };
}
const path = '01_Hardware/notes.md';
const target = '01_Hardware/Target.md';

describe('Markdown authoring validation', () => {
  it('accepts GFM tables, language fences, valid frontmatter, and safe HTML', async () => {
    const source =
      '---\ntitle: Notes\nkind: note\nestimatedMinutes: 15\n---\n# Notes\n\n' +
      '| A | B |\n| --- | --- |\n| 1 | 2 |\n\n~~~c\nint x;\n~~~\n\n<p>Safe HTML.</p>\n';
    expect(await validateMarkdown(snapshot({ [path]: source }))).toEqual([]);
  });

  it('requires a meaningful H1, ordered headings, and fenced language labels', async () => {
    const source = '# !!!\n\n### Skipped\n\n~~~\nint x;\n~~~\n';
    const issues = await validateMarkdown(snapshot({ [path]: source }));
    expect(issues.map((issue) => issue.rule)).toEqual(
      expect.arrayContaining(['NW_TITLE', 'MD001', 'MD040']),
    );
  });

  it('reports frontmatter schema failures and retains source line positions after valid frontmatter', async () => {
    const invalid = await validateMarkdown(
      snapshot({ [path]: '---\nestimatedMinutes: -1\n---\n# Notes\n' }),
    );
    expect(invalid.some((issue) => issue.rule === 'NW_FRONTMATTER')).toBe(true);
    const lines = await validateMarkdown(
      snapshot({
        [path]: '---\ntitle: Notes\n---\n# Notes\n\n[Lost](missing.md)\n',
      }),
    );
    expect(lines.find((issue) => issue.rule === 'NW_MISSING_LINK')?.line).toBe(
      6,
    );
  });

  it('rejects unterminated frontmatter without executing or loading repository configuration', async () => {
    const issues = await validateMarkdown(
      snapshot({ [path]: '---\ntitle: Broken\n# Notes\n' }),
    );
    expect(issues.some((issue) => issue.rule === 'NW_FRONTMATTER')).toBe(true);
  });

  it('resolves encoded paths, local fragments, duplicate heading slugs, and explicit HTML anchors', async () => {
    const first =
      '# Notes\n\n[Local](#notes)\n\n[Repeated](Target.md#again-1)\n\n' +
      '[HTML](Target.md#custom-anchor)\n\n[Space](My%20Notes.md#details)\n';
    const second =
      '# Target\n\n## Again\n\n## Again\n\n<a id="custom-anchor"></a>\n';
    const issues = await validateMarkdown(
      snapshot({
        [path]: first,
        [target]: second,
        '01_Hardware/My Notes.md': '# Details\n',
      }),
    );
    expect(issues.filter((issue) => issue.rule.startsWith('NW_'))).toEqual([]);
  });

  it('validates raw HTML links and images, and reference definitions', async () => {
    const source =
      '# Notes\n\n<a href="lost.md">Lost</a>\n\n<img src="lost.png" alt="Lost">\n\n' +
      '[Reference][other]\n\n[other]: other.md\n\n[unused]: unused.md\n';
    const issues = await validateMarkdown(snapshot({ [path]: source }));
    expect(
      issues
        .filter((issue) => issue.rule === 'NW_MISSING_LINK')
        .map((issue) => issue.message),
    ).toEqual(
      expect.arrayContaining([
        'Missing linked file: 01_Hardware/lost.md',
        'Missing linked file: 01_Hardware/lost.png',
        'Missing linked file: 01_Hardware/other.md',
        'Missing linked file: 01_Hardware/unused.md',
      ]),
    );
  });

  it('checks exact Git path casing and exact anchor casing', async () => {
    const source =
      '# Notes\n\n[Wrong](target.md)\n\n[Wrong fragment](Target.md#Target)\n';
    const issues = await validateMarkdown(
      snapshot({ [path]: source, [target]: '# Target\n' }),
    );
    expect(
      issues.find((issue) => issue.rule === 'NW_MISSING_LINK')?.message,
    ).toContain('Link case');
    expect(issues.some((issue) => issue.rule === 'NW_MISSING_ANCHOR')).toBe(
      true,
    );
  });

  it('rejects encoded root escapes, backslashes, malformed escapes, and unsafe schemes', async () => {
    const source =
      '# Notes\n\n[Escape](../../outside.md)\n\n[Encoded](%2e%2e/%2e%2e/outside.md)\n\n' +
      '[Backslash](bad%5Cpath.md)\n\n[Broken](bad%ZZ.md)\n\n<a href="javascript:alert(1)">Unsafe</a>\n';
    const issues = await validateMarkdown(snapshot({ [path]: source }));
    expect(
      issues.filter((issue) => issue.rule === 'NW_UNSAFE_LINK'),
    ).toHaveLength(5);
  });

  it('resolves directory README links and reports uninitialized submodule paths as deferred', async () => {
    const source =
      '# Notes\n\n[Directory](folder/)\n\n[Submodule](../Examples/ESP32/README.md)\n';
    const issues = await validateMarkdown(
      snapshot(
        { [path]: source, '01_Hardware/folder/README.md': '# Folder\n' },
        [],
        ['Examples'],
      ),
    );
    expect(issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(
      issues.find((issue) => issue.rule === 'NW_DEFERRED_LINK')?.severity,
    ).toBe('warning');
  });

  it('tolerates legacy issues after line movement but detects modified broken URLs', async () => {
    const previous = '# Notes\n\n[Legacy](missing.md)\n';
    const base = await validateMarkdown(snapshot({ [path]: previous }));
    const moved = await validateMarkdown(
      snapshot({
        [path]: '# Notes\n\nNew paragraph.\n\n[Legacy](missing.md)\n',
      }),
    );
    expect(introducedDiagnostics(moved, base)).toEqual([]);
    const modified = await validateMarkdown(
      snapshot({ [path]: previous.replace('missing.md', 'another.md') }),
    );
    expect(
      introducedDiagnostics(modified, base).some(
        (issue) => issue.rule === 'NW_MISSING_LINK',
      ),
    ).toBe(true);
  });

  it('does not hide an additional duplicate of a pre-existing error', async () => {
    const base = await validateMarkdown(
      snapshot({ [path]: '# Notes\n\n[Lost](missing.md)\n' }),
    );
    const current = await validateMarkdown(
      snapshot({
        [path]: '# Notes\n\n[Lost](missing.md)\n\n[Lost](missing.md)\n',
      }),
    );
    expect(
      introducedDiagnostics(current, base).filter(
        (issue) => issue.rule === 'NW_MISSING_LINK',
      ),
    ).toHaveLength(1);
  });

  it('detects deleted link targets from otherwise unchanged Markdown', async () => {
    const document = '# Notes\n\n[Target](Target.md)\n';
    const before = await validateMarkdown(
      snapshot({ [path]: document, [target]: '# Target\n' }),
      { stylePaths: new Set() },
    );
    const after = await validateMarkdown(snapshot({ [path]: document }), {
      stylePaths: new Set(),
    });
    expect(
      introducedDiagnostics(after, before).map((issue) => issue.rule),
    ).toContain('NW_MISSING_LINK');
  });

  it('does not allow inline directives to suppress new formatting violations', async () => {
    const source =
      '# Notes\n\n<!-- markdownlint-disable MD040 -->\n\n~~~\ncode\n~~~\n';
    expect(
      (await validateMarkdown(snapshot({ [path]: source }))).some(
        (issue) => issue.rule === 'MD040',
      ),
    ).toBe(true);
  });

  it('rejects malformed tables and undefined references', async () => {
    const source =
      '# Notes\n\n| A | B |\n| --- | --- |\n| 1 | 2 | 3 |\n\n[Missing][undefined]\n';
    expect(
      (await validateMarkdown(snapshot({ [path]: source }))).map(
        (issue) => issue.rule,
      ),
    ).toEqual(expect.arrayContaining(['MD052', 'MD056']));
  });

  it('parses immutable revision options and rejects typos or missing values', () => {
    expect(
      parseArguments([
        '--source',
        '/repo',
        '--baseline',
        'main',
        '--head',
        'dev',
        '--strict',
      ]),
    ).toMatchObject({
      source: '/repo',
      base: 'main',
      head: 'dev',
      strict: true,
    });
    expect(() => parseArguments(['--base'])).toThrow('requires a value');
    expect(() => parseArguments(['--unknown'])).toThrow('Unknown option');
    expect(() =>
      parseArguments(['--base', 'main', '--baseline', 'dev']),
    ).toThrow('Choose one');
  });
});
