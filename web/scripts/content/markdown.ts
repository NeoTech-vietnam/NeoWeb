import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, {
  defaultSchema,
  type Options as SanitizeSchema,
} from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import GithubSlugger from 'github-slugger';
import { visit } from 'unist-util-visit';
import { toString } from 'mdast-util-to-string';
import { parse as parseYaml } from 'yaml';
import path from 'node:path';
import type { Root as MdRoot } from 'mdast';
import type { Root as HtmlRoot } from 'hast';
import { FrontmatterSchema, type TopicRecord } from '../../lib/content-schema';

export const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
export function frontmatter(source: string) {
  const match = source.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return {
    source: match ? source.slice(match[0].length) : source,
    metadata: FrontmatterSchema.parse(match ? (parseYaml(match[1]) ?? {}) : {}),
  };
}
export function cleanTitle(text: string) {
  return text
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200B-\u200D]/gu, '')
    .replace(/^\s*[✳❓🔵]+\s*/u, '')
    .trim();
}
export function slug(text: string): string {
  return cleanTitle(text)
    .toLowerCase()
    .replace(/c\+\+/g, 'c-plus-plus')
    .replace(/&/g, ' and ')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
export function resolveLocal(
  from: string,
  url: string,
): { path: string; anchor: string } | null {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url)) return null;
  const [pathname, fragment = ''] = url.split('#');
  const decoded = decodeURIComponent(pathname.split('?')[0]);
  if (decoded.includes('\\') || decoded.includes('\0'))
    throw new Error(`Unsafe path: ${url}`);
  const resolved = path.posix.normalize(
    decoded
      ? decoded.startsWith('/')
        ? decoded.slice(1)
        : path.posix.join(path.posix.dirname(from), decoded)
      : from,
  );
  if (resolved === '..' || resolved.startsWith('../'))
    throw new Error(`Path escapes content root: ${url}`);
  return { path: resolved, anchor: decodeURIComponent(fragment) };
}
export function headings(source: string) {
  const tree = parser.parse(frontmatter(source).source);
  const slugs = new GithubSlugger();
  const result: { id: string; text: string; depth: number }[] = [];
  visit(tree, 'heading', (node) =>
    result.push({
      id: slugs.slug(toString(node)),
      text: toString(node),
      depth: node.depth,
    }),
  );
  return result;
}
export function resolveFileTarget(
  target: string,
  files: ReadonlySet<string>,
): string {
  if (files.has(target)) return target;
  const directory = target === '.' ? '' : target.replace(/\/$/, '') + '/';
  return (
    [directory + 'README.md', directory + 'index.md'].find((p) =>
      files.has(p),
    ) ?? target
  );
}
export function parseRoadmap(source: string): TopicRecord[] {
  const tree = parser.parse(source);
  const all: TopicRecord[] = [];
  let active = false;
  const stack: TopicRecord[] = [];
  const gh = new GithubSlugger();
  const seen = new Set<string>();
  for (const node of tree.children) {
    if (node.type === 'heading') {
      const title = cleanTitle(toString(node));
      const anchor = gh.slug(toString(node));
      if (node.depth === 2) {
        active = title === 'Learning Resources';
        stack.length = 0;
        continue;
      }
      if (!active || node.depth < 3) continue;
      while (stack.length && stack.at(-1)!.depth >= node.depth) stack.pop();
      const simple = slug(title);
      const id = seen.has(simple) ? `${stack.at(-1)?.id}-${simple}` : simple;
      seen.add(id);
      const topic: TopicRecord = {
        id,
        title,
        parentId: stack.at(-1)?.id ?? null,
        depth: node.depth,
        description: '',
        roadmapAnchor: anchor,
        resources: [],
        documents: [],
        exercises: [],
        prerequisites: [],
      };
      all.push(topic);
      stack.push(topic);
    } else if (active && stack.length) {
      const topic = stack.at(-1)!;
      if (node.type === 'paragraph' && !topic.description)
        topic.description = toString(node);
      visit(node, 'link', (link) => {
        if (/^https?:\/\//.test(link.url))
          topic.resources.push({ title: toString(link), url: link.url });
      });
    }
  }
  if (!all.length)
    throw new Error('Roadmap Learning Resources headings were not found.');
  return all;
}
const schema: SanitizeSchema = {
  ...defaultSchema,
  clobberPrefix: '',
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'id'],
    a: [
      ...(defaultSchema.attributes?.a ?? []),
      'id',
      'dataDocumentPath',
      'dataDocumentAnchor',
      'dataUnavailable',
    ],
    img: [...(defaultSchema.attributes?.img ?? []), 'dataAssetPath'],
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ['className', /^language-./],
    ],
  },
};
export async function renderMarkdown(
  source: string,
  from: string,
  files: Set<string>,
  assetUrls: Map<string, string>,
) {
  const { source: body } = frontmatter(source);
  const outbound = new Set<string>();
  const assets = new Set<string>();
  const errors: string[] = [];
  const slugs = new GithubSlugger();
  const renderer = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(() => (tree: MdRoot) => {
      visit(tree, 'heading', (node) => {
        node.data = {
          ...node.data,
          hProperties: { id: slugs.slug(toString(node)) },
        };
      });
    })
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(() => (tree: HtmlRoot) => {
      visit(tree, 'element', (node) => {
        if (
          node.tagName === 'a' &&
          typeof node.properties.name === 'string' &&
          !node.properties.id
        )
          node.properties.id = node.properties.name;
        if (node.tagName === 'a' && typeof node.properties.href === 'string') {
          const url = node.properties.href;
          try {
            const local = resolveLocal(from, url);
            if (!local) return;
            const target = resolveFileTarget(local.path, files);
            if (files.has(target)) {
              outbound.add(target);
              node.properties.dataDocumentPath = target;
              node.properties.dataDocumentAnchor = local.anchor;
              node.properties.href = '#';
            } else if (assetUrls.has(target)) {
              node.properties.href = assetUrls.get(target)!;
            } else {
              node.properties.dataUnavailable = 'true';
              node.properties.href = '#';
              errors.push(`Unpublished link: ${url}`);
            }
          } catch (error) {
            delete node.properties.href;
            errors.push(String(error));
          }
        }
        if (node.tagName === 'img' && typeof node.properties.src === 'string') {
          try {
            const local = resolveLocal(from, node.properties.src);
            if (local) {
              assets.add(local.path);
              const url = assetUrls.get(local.path);
              if (url) node.properties.src = url;
              else {
                delete node.properties.src;
                errors.push(`Missing image: ${local.path}`);
              }
            }
          } catch (error) {
            delete node.properties.src;
            errors.push(String(error));
          }
        }
      });
    })
    .use(rehypeSanitize, schema)
    .use(rehypeKatex, { throwOnError: false, trust: false })
    .use(rehypeHighlight, { detect: false, ignoreMissing: true })
    .use(rehypeStringify);
  return {
    html: String(await renderer.process(body)),
    outbound: [...outbound],
    assets: [...assets],
    errors,
  };
}

export function exerciseSections(source: string) {
  const body = frontmatter(source).source;
  if (!/###\s+Cue Column/i.test(body)) return { prompt: body, hints: [] };
  const cue = body.search(/^###\s+Cue Column/im);
  const notes = body.search(/^###\s+Notes Section/im);
  const edge = body.search(/^##\s+(Common Failure|Edge Cases)/im);
  return {
    prompt: body.slice(0, cue),
    hints: [
      body.slice(cue, notes < 0 ? undefined : notes),
      notes >= 0 ? body.slice(notes, edge < 0 ? undefined : edge) : '',
      edge >= 0 ? body.slice(edge) : '',
    ].filter(Boolean),
  };
}
