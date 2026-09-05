import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { lint } from 'markdownlint/promise';
import GithubSlugger from 'github-slugger';
import { unified } from 'unified';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import { visit } from 'unist-util-visit';
import { toString } from 'mdast-util-to-string';
import type { Root as HtmlRoot } from 'hast';
import { curated } from './content/curation';
import {
  frontmatter,
  parser,
  resolveLocal,
  resolveFileTarget,
} from './content/markdown';
import {
  git,
  gitText,
  parseModules,
  readBlobs,
  repositoryDir,
  type GitFile,
} from './content/git';

export interface MarkdownSnapshot {
  files: ReadonlySet<string>;
  markdown: ReadonlyMap<string, string>;
  deferredPrefixes?: readonly string[];
}
export interface MarkdownDiagnostic {
  path: string;
  line: number;
  column: number;
  rule: string;
  message: string;
  context: string;
  severity: 'error' | 'warning';
}
export interface ValidationOptions {
  stylePaths?: ReadonlySet<string>;
}

interface ParsedDocument {
  body: string;
  offset: number;
  anchors: Set<string>;
  links: { url: string; line: number; column: number }[];
}

const lintConfiguration = {
  default: false,
  MD001: true,
  MD005: true,
  MD007: true,
  MD018: true,
  MD019: true,
  MD022: true,
  MD023: true,
  MD025: true,
  MD030: true,
  MD031: true,
  MD032: true,
  MD040: true,
  MD041: true,
  MD046: true,
  MD048: true,
  MD052: true,
  MD053: true,
  MD055: true,
  MD056: true,
  MD058: true,
};

function diagnostic(
  file: string,
  source: string,
  line: number,
  rule: string,
  message: string,
  column = 1,
  severity: 'error' | 'warning' = 'error',
): MarkdownDiagnostic {
  return {
    path: file,
    line,
    column,
    rule,
    message,
    context: source.split(/\r?\n/)[line - 1] ?? '',
    severity,
  };
}

/** Parse inert Markdown/HTML; neither repository code nor Markdown configuration is executed. */
function parseDocument(
  file: string,
  source: string,
  issues: MarkdownDiagnostic[],
): ParsedDocument {
  let body = source.replace(/^\uFEFF/, '');
  try {
    if (
      /^---\r?\n/.test(body) &&
      !/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(body)
    ) {
      throw new Error('Frontmatter requires a closing --- line.');
    }
    body = frontmatter(body).source;
  } catch (error) {
    issues.push(
      diagnostic(
        file,
        source,
        1,
        'NW_FRONTMATTER',
        'Invalid optional frontmatter: ' +
          (error instanceof Error ? error.message : String(error)),
      ),
    );
    // Keep parsing the body for independent link diagnostics after a malformed metadata block.
    body = body.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  }
  const consumed = source.length - body.length;
  const offset = (source.slice(0, consumed).match(/\n/g) ?? []).length;
  const tree = parser.parse(body);
  const anchors = new Set<string>();
  const slugger = new GithubSlugger();
  const links: ParsedDocument['links'] = [];
  visit(tree, 'heading', (node) => {
    anchors.add(slugger.slug(toString(node)));
  });
  // Inspect the parsed HTML tree: this covers inline/raw HTML and reference links equally.
  const html = unified()
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .runSync(tree) as HtmlRoot;
  visit(html, 'element', (node) => {
    for (const key of node.tagName === 'a' ? ['id', 'name'] : ['id']) {
      const value = node.properties[key];
      if (typeof value === 'string') anchors.add(value);
    }
    const value =
      node.tagName === 'a'
        ? node.properties.href
        : node.tagName === 'img'
          ? node.properties.src
          : undefined;
    if (typeof value === 'string')
      links.push({
        url: value,
        line: (node.position?.start.line ?? 1) + offset,
        column: node.position?.start.column ?? 1,
      });
  });
  // Unused reference definitions still contain authored URLs which should resolve.
  const referenced = new Set<string>();
  visit(tree, (node) => {
    if (node.type === 'linkReference' || node.type === 'imageReference')
      referenced.add(node.identifier);
  });
  visit(tree, 'definition', (node) => {
    if (!referenced.has(node.identifier))
      links.push({
        url: node.url,
        line: (node.position?.start.line ?? 1) + offset,
        column: node.position?.start.column ?? 1,
      });
  });
  return { body, offset, anchors, links };
}

/** Validate all links, and lint either all Markdown or only selected changed paths. */
export async function validateMarkdown(
  snapshot: MarkdownSnapshot,
  options: ValidationOptions = {},
): Promise<MarkdownDiagnostic[]> {
  const issues: MarkdownDiagnostic[] = [];
  const parsed = new Map<string, ParsedDocument>();
  const lintSources: Record<string, string> = Object.create(null);
  for (const [file, source] of snapshot.markdown) {
    const local: MarkdownDiagnostic[] = [];
    const document = parseDocument(file, source, local);
    parsed.set(file, document);
    if (!options.stylePaths || options.stylePaths.has(file)) {
      issues.push(...local);
      lintSources[file] = document.body;
      const titles = parser
        .parse(document.body)
        .children.filter((node) => node.type === 'heading' && node.depth === 1);
      if (titles.length === 1 && !/[\p{L}\p{N}]/u.test(toString(titles[0]))) {
        issues.push(
          diagnostic(
            file,
            source,
            (titles[0].position?.start.line ?? 1) + document.offset,
            'NW_TITLE',
            'The H1 must contain a meaningful title.',
          ),
        );
      }
    }
  }
  if (Object.keys(lintSources).length) {
    const results = await lint({
      strings: lintSources,
      config: lintConfiguration,
      noInlineConfig: true,
      frontMatter: null,
    });
    for (const [file, errors] of Object.entries(results)) {
      const document = parsed.get(file)!;
      for (const error of errors) {
        issues.push(
          diagnostic(
            file,
            snapshot.markdown.get(file)!,
            error.lineNumber + document.offset,
            error.ruleNames[0],
            error.ruleDescription +
              (error.errorDetail ? ': ' + error.errorDetail : ''),
            error.errorRange?.[0] ?? 1,
          ),
        );
      }
    }
  }
  const casePaths = new Map<string, string>();
  for (const file of snapshot.files) casePaths.set(file.toLowerCase(), file);
  for (const [file, document] of parsed) {
    const source = snapshot.markdown.get(file)!;
    for (const link of document.links) {
      const push = (
        rule: string,
        message: string,
        severity: 'error' | 'warning' = 'error',
      ) =>
        issues.push(
          diagnostic(
            file,
            source,
            link.line,
            rule,
            message,
            link.column,
            severity,
          ),
        );
      const scheme = link.url.match(/^([a-z][a-z\d+.-]*):/i)?.[1].toLowerCase();
      if (scheme && !['http', 'https', 'mailto', 'tel'].includes(scheme)) {
        push('NW_UNSAFE_LINK', 'Unsupported or unsafe URL scheme: ' + scheme);
        continue;
      }
      let local: ReturnType<typeof resolveLocal>;
      try {
        local = resolveLocal(file, link.url);
      } catch {
        push('NW_UNSAFE_LINK', 'Unsafe or malformed relative URL: ' + link.url);
        continue;
      }
      if (!local) continue;
      const target = resolveFileTarget(local.path, snapshot.files);
      if (!snapshot.files.has(target)) {
        const deferred = snapshot.deferredPrefixes?.find(
          (prefix) => target === prefix || target.startsWith(prefix + '/'),
        );
        if (deferred) {
          push(
            'NW_DEFERRED_LINK',
            'Link validation deferred under uninitialized submodule: ' +
              deferred,
            'warning',
          );
        } else {
          const expected = casePaths.get(target.toLowerCase());
          push(
            'NW_MISSING_LINK',
            expected
              ? 'Link case does not match the Git path. Use: ' + expected
              : 'Missing linked file: ' + target,
          );
        }
        continue;
      }
      if (local.anchor && /\.md$/i.test(target)) {
        const destination = parsed.get(target);
        if (!destination) {
          push(
            'NW_DEFERRED_LINK',
            'Anchor validation deferred for excluded Markdown: ' + target,
            'warning',
          );
        } else if (!destination.anchors.has(local.anchor)) {
          push(
            'NW_MISSING_ANCHOR',
            'Missing heading or HTML anchor: ' + target + '#' + local.anchor,
          );
        }
      }
    }
  }
  return issues.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.line - b.line ||
      a.rule.localeCompare(b.rule),
  );
}

/** Multiset matching preserves old issues when their lines move, without hiding new duplicates. */
export function introducedDiagnostics(
  current: readonly MarkdownDiagnostic[],
  baseline: readonly MarkdownDiagnostic[],
): MarkdownDiagnostic[] {
  const signature = (issue: MarkdownDiagnostic) =>
    JSON.stringify([
      issue.path,
      issue.rule,
      issue.context,
      issue.message,
      issue.severity,
    ]);
  const remaining = new Map<string, number>();
  for (const issue of baseline) {
    const key = signature(issue);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  return current.filter((issue) => {
    const key = signature(issue);
    const count = remaining.get(key) ?? 0;
    if (count) {
      remaining.set(key, count - 1);
      return false;
    }
    return true;
  });
}

export interface GitMarkdownSnapshot extends MarkdownSnapshot {
  sha: string;
  blobs: Map<string, string>;
}

/** Read immutable Git objects. Missing submodule objects produce deferred prefixes; no fetch runs. */
export function readGitSnapshot(
  source: string,
  ref: string,
): GitMarkdownSnapshot {
  const root = repositoryDir(source);
  const sha = gitText(root, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    ref + '^{commit}',
  ]);
  if (!/^[a-f0-9]{40}$/.test(sha))
    throw new Error('Expected an immutable 40-character commit SHA.');
  const files = new Set<string>();
  const blobs = new Map<string, string>();
  const deferredPrefixes: string[] = [];
  const markdownFiles: GitFile[] = [];
  function collect(
    gitdir: string,
    commit: string,
    prefix: string,
    depth: number,
  ) {
    if (depth > 10) throw new Error('Submodule recursion exceeds ten levels.');
    const rows = git(gitdir, ['ls-tree', '-r', '-z', commit])
      .toString('utf8')
      .split('\0')
      .filter(Boolean);
    const gitlinks: { path: string; sha: string }[] = [];
    for (const row of rows) {
      const entry = row.match(/^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/);
      if (!entry) throw new Error('Malformed Git tree entry.');
      const [, mode, type, blob, localPath] = entry;
      const file = prefix + localPath;
      if (type === 'commit') {
        gitlinks.push({ path: localPath, sha: blob });
        continue;
      }
      if (mode !== '100644' && mode !== '100755') continue;
      files.add(file);
      blobs.set(file, blob);
      if (curated(file) && /\.md$/i.test(file)) {
        markdownFiles.push({
          path: file,
          localPath,
          blob,
          gitdir,
          repository: '',
          sha: commit,
          mode,
        });
      }
    }
    if (!gitlinks.length) return;
    const modules = parseModules(
      gitText(gitdir, ['show', commit + ':.gitmodules']),
    );
    for (const link of gitlinks) {
      const module = modules.find((value) => value.path === link.path);
      if (!module)
        throw new Error(
          'Gitlink has no .gitmodules entry: ' + prefix + link.path,
        );
      const child = path.resolve(gitdir, 'modules', module.name);
      if (!child.startsWith(path.resolve(gitdir, 'modules') + path.sep))
        throw new Error('Unsafe submodule directory.');
      if (!fs.existsSync(child)) {
        deferredPrefixes.push(prefix + link.path);
        continue;
      }
      try {
        git(child, ['cat-file', '-e', link.sha + '^{commit}']);
      } catch {
        deferredPrefixes.push(prefix + link.path);
        continue;
      }
      collect(child, link.sha, prefix + link.path + '/', depth + 1);
    }
  }
  collect(root, sha, '', 0);
  const cache = new Map<string, Buffer>();
  readBlobs(markdownFiles, cache);
  const markdown = new Map(
    markdownFiles.map((file) => [
      file.path,
      cache.get(file.blob)!.toString('utf8'),
    ]),
  );
  return { sha, files, markdown, blobs, deferredPrefixes };
}

export function parseArguments(argv: readonly string[]) {
  const result: {
    source: string;
    head: string;
    base?: string;
    strict: boolean;
    help: boolean;
    workingTree: boolean;
  } = {
    source: '.',
    head: 'HEAD',
    strict: false,
    help: false,
    workingTree: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--strict') result.strict = true;
    else if (argument === '--working-tree') result.workingTree = true;
    else if (argument === '--help' || argument === '-h') result.help = true;
    else if (
      ['--source', '--head', '--base', '--baseline'].includes(argument)
    ) {
      const value = argv[++index];
      if (!value || value.startsWith('--'))
        throw new Error(argument + ' requires a value.');
      if (argument === '--source') result.source = value;
      else if (argument === '--head') result.head = value;
      else {
        if (result.base)
          throw new Error('Choose one --base or --baseline revision.');
        result.base = value;
      }
    } else throw new Error('Unknown option: ' + argument);
  }
  return result;
}

function escapeAnnotation(text: string, property = false) {
  let escaped = text
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
  if (property) escaped = escaped.replace(/:/g, '%3A').replace(/,/g, '%2C');
  return escaped;
}

export async function runCli(argv = process.argv.slice(2)): Promise<number> {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(
      'Usage: check-markdown --source <repo> [--working-tree | --head <revision>] [--base <revision>] [--strict]\n' +
        '--baseline is an alias for --base. Without a base, report the existing baseline without failing;\n' +
        '--strict fails for every current error. Candidate files and configuration are never executed.',
    );
    return 0;
  }
  const head = options.workingTree
    ? readWorkingSnapshot(options.source)
    : readGitSnapshot(options.source, options.head);
  const base = options.base
    ? readGitSnapshot(options.source, options.base)
    : undefined;
  const changed = base
    ? new Set(
        [...head.markdown.keys()].filter(
          (file) => head.blobs.get(file) !== base.blobs.get(file),
        ),
      )
    : undefined;
  const current = await validateMarkdown(head, {
    stylePaths: options.strict ? undefined : changed,
  });
  const baseline =
    base && !options.strict
      ? await validateMarkdown(base, { stylePaths: changed })
      : [];
  const introduced =
    base && !options.strict
      ? introducedDiagnostics(current, baseline)
      : current;
  const shouldFail = Boolean(base || options.strict);
  const shown = shouldFail ? introduced : current;
  for (const issue of shown.slice(0, 200)) {
    const level = shouldFail ? issue.severity : 'warning';
    if (process.env.GITHUB_ACTIONS === 'true') {
      console.log(
        '::' +
          level +
          ' file=' +
          escapeAnnotation(issue.path, true) +
          ',line=' +
          issue.line +
          ',col=' +
          issue.column +
          ',title=' +
          escapeAnnotation(issue.rule, true) +
          '::' +
          escapeAnnotation(issue.message),
      );
    } else {
      console.log(
        issue.path +
          ':' +
          issue.line +
          ':' +
          issue.column +
          ' ' +
          level +
          ' ' +
          issue.rule +
          ' ' +
          issue.message,
      );
    }
  }
  if (shown.length > 200)
    console.log('Additional diagnostics omitted: ' + (shown.length - 200));
  const errors = introduced.filter(
    (issue) => issue.severity === 'error',
  ).length;
  console.log(
    'Markdown: ' +
      head.markdown.size +
      ' documents, ' +
      (changed?.size ?? head.markdown.size) +
      ' styled, ' +
      errors +
      (shouldFail
        ? ' introduced/current errors'
        : ' baseline errors (non-blocking)') +
      ', ' +
      head.deferredPrefixes!.length +
      ' deferred submodules.',
  );
  return shouldFail && errors ? 1 : 0;
}
/** Local authoring checks include saved, uncommitted files; CI always selects immutable --head. */
export function readWorkingSnapshot(source: string): GitMarkdownSnapshot {
  const root = path.resolve(source);
  const files = new Set<string>();
  const markdown = new Map<string, string>();
  const blobs = new Map<string, string>();
  const deferredPrefixes: string[] = [];
  function collect(directory: string, prefix: string, depth: number) {
    if (depth > 10) throw new Error('Submodule recursion exceeds ten levels.');
    const gitdir = repositoryDir(directory);
    const names = git(gitdir, [
      '--work-tree',
      directory,
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '-z',
    ])
      .toString('utf8')
      .split('\0')
      .filter(Boolean);
    for (const name of names) {
      const target = path.resolve(directory, name);
      if (!target.startsWith(directory + path.sep))
        throw new Error('Unsafe working-tree path');
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(target);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      files.add(prefix + name);
      if (curated(prefix + name) && /\.md$/i.test(name)) {
        const bytes = fs.readFileSync(target);
        markdown.set(prefix + name, bytes.toString('utf8'));
        blobs.set(
          prefix + name,
          createHash('sha1')
            .update(`blob ${bytes.length}\0`)
            .update(bytes)
            .digest('hex'),
        );
      }
    }
    const modulePath = path.join(directory, '.gitmodules');
    if (fs.existsSync(modulePath))
      for (const module of parseModules(fs.readFileSync(modulePath, 'utf8'))) {
        const child = path.resolve(directory, module.path);
        if (!child.startsWith(directory + path.sep))
          throw new Error('Unsafe working submodule path');
        if (
          fs.existsSync(path.join(child, '.git')) &&
          !fs.lstatSync(child).isSymbolicLink()
        )
          collect(child, prefix + module.path + '/', depth + 1);
        else deferredPrefixes.push(prefix + module.path);
      }
  }
  collect(root, '', 0);
  return { sha: 'working-tree', files, markdown, blobs, deferredPrefixes };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  runCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
