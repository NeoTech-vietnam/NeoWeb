import { describe, it, expect } from 'vitest';
import {
  parseRoadmap,
  slug,
  renderMarkdown,
  exerciseSections,
  resolveLocal,
  frontmatter,
} from '../scripts/content/markdown';
import { curated, textFile, imageFile } from '../scripts/content/curation';
import { parseModules } from '../scripts/content/git';
import { href, parseRoute } from '../lib/routes';
describe('roadmap and content boundary', () => {
  it('uses Learning Resources descendants only and separates C from C++', () => {
    const topics = parseRoadmap(
      '# Roadmap\n\n## Other\n\n### Ignore\n\n## 📚 Learning Resources\n\n### ✳️ Programming Languages\n\n#### 🔵 C\n\nC description.\n\n#### 🔵 C++\n\n## History\n\n### Ignore again',
    );
    expect(topics.map((t) => t.id)).toEqual([
      'programming-languages',
      'c',
      'c-plus-plus',
    ]);
    expect(topics[1].parentId).toBe('programming-languages');
  });
  it('cleans invisible characters and symbols consistently', () => {
    expect(slug('🔵 ‌Basic Protocols')).toBe('basic-protocols');
  });
  it('blocks tools, binaries and vendor documentation', () => {
    expect(curated('.agents/secret.md')).toBe(false);
    expect(textFile('02_Software/topic/03_resources/vendor.md')).toBe(false);
    expect(
      textFile('02_Software/topic/01_learning/02_documentation/import.md'),
    ).toBe(false);
    expect(textFile('02_Software/02_practice/example.c')).toBe(true);
    expect(imageFile('02_Software/topic/image.png')).toBe(true);
    expect(imageFile('02_Software/topic/active.svg')).toBe(false);
  });
  it('keeps only allowed metadata', () => {
    expect(() =>
      frontmatter('---\ntitle: Test\nunknown: true\n---\n# Test'),
    ).toThrow();
    expect(frontmatter('---\ntitle: Test\n---\n# Test').metadata.title).toBe(
      'Test',
    );
  });
  it('resolves relative paths and fragments without allowing traversal', () => {
    expect(resolveLocal('a/b.md', '../c.md#title')).toEqual({
      path: 'c.md',
      anchor: 'title',
    });
    expect(() => resolveLocal('a.md', '../../secret.md')).toThrow();
    expect(resolveLocal('a.md', 'https://example.com')).toBeNull();
  });
  it('rewrites document links without tying shared HTML to a snapshot', async () => {
    const r = await renderMarkdown(
      '# Test\n\n[Other](b.md#section)\n\n![Diagram](diagram.png)',
      'a.md',
      new Set(['a.md', 'b.md']),
      new Map([['diagram.png', 'content/assets/abc.png']]),
    );
    expect(r.html).toContain('data-document-path="b.md"');
    expect(r.html).toContain('data-document-anchor="section"');
    expect(r.outbound).toEqual(['b.md']);
    expect(r.html).toContain('content/assets/abc.png');
  });
  it('removes executable HTML and preserves explicit anchors, math and mermaid', async () => {
    const r = await renderMarkdown(
      '# Safe\n\n<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n<a id="safe-anchor"></a>\n\n[Bad](javascript:alert(1))\n\n$x^2$\n\n```mermaid\ngraph TD; A-->B\n```',
      'a.md',
      new Set(['a.md']),
      new Map(),
    );
    expect(r.html).not.toContain('<script');
    expect(r.html).not.toContain('onerror');
    expect(r.html).not.toContain('javascript:');
    expect(r.html).toContain('id="safe-anchor"');
    expect(r.html).toContain('katex');
    expect(r.html).toContain('language-mermaid');
  });
  it('splits Cornell sections across irregular heading levels', () => {
    const sections = exerciseSections(
      '# Cornell\n\n### Problem Description\nThink.\n\n### Cue Column\nQuestion?\n\n### Notes Section\n\n## Strategy A\nAnswer.\n\n## Edge Cases\nEmpty.',
    );
    expect(sections.prompt).not.toContain('Answer.');
    expect(sections.hints).toHaveLength(3);
    expect(sections.hints[1]).toContain('Answer.');
    expect(exerciseSections('# A\nPlain note').hints).toEqual([]);
  });
  it('rejects unsafe recursive submodule config', () => {
    expect(
      parseModules(
        '[submodule "Examples"]\n path = Examples\n url = git@github.com:NeoTech-vietnam/NeoExamples.git',
      )[0].path,
    ).toBe('Examples');
    expect(() =>
      parseModules(
        '[submodule "../escape"]\n path = x\n url = https://github.com/a/b.git',
      ),
    ).toThrow();
  });
  it('round trips bookmark paths without dropping snapshot or anchors', () => {
    const route = {
      view: 'document' as const,
      snapshot: 'a'.repeat(40),
      path: '02_C++/a b.md',
      anchor: 'section-2',
    };
    expect(parseRoute(href(route))).toMatchObject(route);
  });
});
