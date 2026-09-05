import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface GitFile {
  path: string;
  localPath: string;
  blob: string;
  gitdir: string;
  repository: string;
  sha: string;
  mode: string;
}
export interface Pin {
  path: string;
  repository: string;
  sha: string;
  parentPath: string;
}
export function git(
  gitdir: string,
  args: string[],
  input?: Buffer | string,
): Buffer {
  return execFileSync('git', ['--git-dir', gitdir, ...args], {
    input,
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    windowsHide: true,
  });
}
export function gitText(gitdir: string, args: string[]) {
  return git(gitdir, args).toString('utf8').trim();
}
export function repositoryDir(source: string) {
  return execFileSync(
    'git',
    [
      '-c',
      `safe.directory=${path.resolve(source).replace(/\\/g, '/')}`,
      '-C',
      source,
      'rev-parse',
      '--absolute-git-dir',
    ],
    { encoding: 'utf8', windowsHide: true },
  ).trim();
}
export function repoName(url: string) {
  const match = url.match(
    /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/,
  );
  if (!match)
    throw new Error(
      'Submodule repository must be an explicit github.com repository',
    );
  return match[1];
}
export function parseModules(text: string) {
  const result: { name: string; path: string; url: string }[] = [];
  let current: (typeof result)[number] | undefined;
  for (const line of text.split(/\r?\n/)) {
    const section = line.match(/^\s*\[submodule "([^"]+)"\]/);
    if (section) {
      current = { name: section[1], path: '', url: '' };
      result.push(current);
      continue;
    }
    const field = line.match(/^\s*(path|url)\s*=\s*(.*?)\s*$/);
    if (current && field) current[field[1] as 'path' | 'url'] = field[2];
  }
  for (const m of result)
    if (
      !m.path ||
      !m.url ||
      /[\\\0:]/.test(m.name) ||
      m.name.startsWith('/') ||
      /[\\\0:]/.test(m.path) ||
      m.name.split('/').includes('..') ||
      m.path.startsWith('/') ||
      m.path.split('/').includes('..')
    )
      throw new Error('Unsafe .gitmodules path');
  return result;
}
/** Detect edited renames using Git's similarity calculation within each repository. */
export function gitRenames(
  previous: GitFile[],
  current: GitFile[],
): Map<string, string> {
  const result = new Map<string, string>();
  const sources = new Map(
    current.map((f) => [
      f.gitdir + '\0' + f.path.slice(0, -f.localPath.length),
      f,
    ]),
  );
  for (const file of sources.values()) {
    const prefix = file.path.slice(0, -file.localPath.length);
    const before = previous.find(
      (f) =>
        f.gitdir === file.gitdir &&
        f.path.slice(0, -f.localPath.length) === prefix,
    );
    if (!before || before.sha === file.sha) continue;
    const records = git(file.gitdir, [
      'diff-tree',
      '--no-commit-id',
      '-r',
      '--name-status',
      '-z',
      '-M',
      before.sha,
      file.sha,
      '--',
    ])
      .toString('utf8')
      .split('\0');
    for (let i = 0; i < records.length;) {
      const status = records[i++];
      if (!status) break;
      const from = records[i++];
      if (status.startsWith('R') || status.startsWith('C')) {
        const to = records[i++];
        if (status.startsWith('R')) result.set(prefix + to, prefix + from);
      }
    }
  }
  return result;
}
export function selectSnapshots(gitdir: string, limit = 20, only?: string) {
  const resolve = (ref: string) =>
    gitText(gitdir, ['rev-parse', '--verify', `${ref}^{commit}`]);
  if (only) return [resolve(only)];
  const resolveBranch = (name: string) => {
    try {
      return resolve(`refs/remotes/origin/${name}`);
    } catch {
      return resolve(`refs/heads/${name}`);
    }
  };
  const dev = resolveBranch('dev');
  const main = resolveBranch('main');
  const recent = gitText(gitdir, [
    'rev-list',
    '--topo-order',
    `--max-count=${limit}`,
    dev,
  ]).split('\n');
  const tags = gitText(gitdir, ['tag', '--list'])
    .split('\n')
    .filter(Boolean)
    .map((t) => resolve(`refs/tags/${t}`));
  return [...new Set([...recent, main, ...tags])];
}
const treeCache = new Map<string, { files: GitFile[]; pins: Pin[] }>();
export function inventory(
  gitdir: string,
  sha: string,
  repository: string,
  prefix = '',
  depth = 0,
): { files: GitFile[]; pins: Pin[] } {
  if (depth > 10) throw new Error('Submodule recursion exceeds ten levels.');
  const key = `${gitdir}\0${sha}\0${prefix}`;
  const cached = treeCache.get(key);
  if (cached) return cached;
  if (!/^[a-f0-9]{40}$/.test(sha))
    throw new Error('Expected a resolved commit SHA');
  const rows = git(gitdir, ['ls-tree', '-r', '-z', sha])
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  const files: GitFile[] = [];
  const links: { path: string; sha: string }[] = [];
  for (const row of rows) {
    const match = row.match(/^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/);
    if (!match) throw new Error('Malformed Git tree record');
    const [, mode, type, blob, localPath] = match;
    if (type === 'commit') {
      links.push({ path: localPath, sha: blob });
      continue;
    }
    if (mode !== '100644' && mode !== '100755') continue;
    files.push({
      path: prefix + localPath,
      localPath,
      blob,
      gitdir,
      repository,
      sha,
      mode,
    });
  }
  const pins: Pin[] = [];
  if (links.length) {
    const modules = parseModules(
      gitText(gitdir, ['show', `${sha}:.gitmodules`]),
    );
    for (const link of links) {
      const module = modules.find((m) => m.path === link.path);
      if (!module)
        throw new Error(`Gitlink has no .gitmodules entry: ${link.path}`);
      const childdir = path.resolve(gitdir, 'modules', module.name);
      const modulesRoot = path.resolve(gitdir, 'modules') + path.sep;
      if (!childdir.startsWith(modulesRoot) || !fs.existsSync(childdir))
        throw new Error(
          `Missing initialized submodule ${prefix + module.path}; clone recursively first.`,
        );
      const repository = repoName(module.url);
      const childPath = prefix + module.path;
      try {
        git(childdir, ['cat-file', '-e', `${link.sha}^{commit}`]);
      } catch {
        throw new Error(
          `Missing ${repository}@${link.sha}. Fetch full submodule history before building.`,
        );
      }
      pins.push({
        path: childPath,
        repository,
        sha: link.sha,
        parentPath: prefix.replace(/\/$/, ''),
      });
      const child = inventory(
        childdir,
        link.sha,
        repository,
        `${childPath}/`,
        depth + 1,
      );
      files.push(...child.files);
      pins.push(...child.pins);
    }
  }
  const result = { files, pins };
  treeCache.set(key, result);
  return result;
}
export function readBlobs(files: GitFile[], cache: Map<string, Buffer>) {
  const groups = new Map<string, Set<string>>();
  for (const file of files)
    if (!cache.has(file.blob)) {
      const set = groups.get(file.gitdir) ?? new Set();
      set.add(file.blob);
      groups.set(file.gitdir, set);
    }
  for (const [dir, hashes] of groups) {
    const response = git(
      dir,
      ['cat-file', '--batch'],
      [...hashes].join('\n') + '\n',
    );
    let offset = 0;
    while (offset < response.length) {
      const nl = response.indexOf(10, offset);
      const [hash, type, sizeText] = response
        .subarray(offset, nl)
        .toString()
        .split(' ');
      const size = Number(sizeText);
      if (nl < 0 || type !== 'blob' || !Number.isSafeInteger(size) || size < 0)
        throw new Error('Malformed Git batch result');
      cache.set(hash, response.subarray(nl + 1, nl + 1 + size));
      offset = nl + 1 + size + 1;
    }
  }
}
