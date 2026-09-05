import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  git,
  gitText,
  gitRenames,
  inventory,
  readBlobs,
  repositoryDir,
  selectSnapshots,
} from '../scripts/content/git';

interface TreeEntry {
  mode: string;
  type: 'blob' | 'commit';
  hash: string;
}
interface TreeNode {
  entry?: TreeEntry;
  children: Map<string, TreeNode>;
}

const temporaryBase = fs.realpathSync(os.tmpdir());
const temporaryRoots: string[] = [];
let clock = 1_700_000_000;
const fixtureEnvironment = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_COUNT: '0',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'NeoWeb fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'NeoWeb fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
};

function command(
  directory: string,
  arguments_: string[],
  input?: Buffer | string,
) {
  const date = new Date(clock++ * 1000).toISOString();
  return execFileSync('git', ['--git-dir', directory, ...arguments_], {
    input,
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...fixtureEnvironment,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    },
  }).trim();
}
function initialize(directory: string) {
  fs.mkdirSync(path.dirname(directory), { recursive: true });
  execFileSync(
    'git',
    [
      'init',
      '--bare',
      '--quiet',
      '--initial-branch=dev',
      '--template=',
      directory,
    ],
    {
      windowsHide: true,
      env: fixtureEnvironment,
    },
  );
  return directory;
}
function fixture() {
  const root = fs.mkdtempSync(path.join(temporaryBase, 'neoweb-git-test-'));
  temporaryRoots.push(root);
  fixtureEnvironment.GIT_CONFIG_GLOBAL = path.join(root, 'empty.gitconfig');
  fs.writeFileSync(fixtureEnvironment.GIT_CONFIG_GLOBAL, '');
  return { root, gitdir: initialize(path.join(root, 'NeoLearning.git')) };
}
function blob(
  directory: string,
  source: string | Buffer,
  mode = '100644',
): TreeEntry {
  return {
    mode,
    type: 'blob',
    hash: command(directory, ['hash-object', '-w', '--stdin'], source),
  };
}
function pin(sha: string): TreeEntry {
  return { mode: '160000', type: 'commit', hash: sha };
}
function tree(directory: string, entries: Record<string, TreeEntry>) {
  const root: TreeNode = { children: new Map() };
  for (const [filename, entry] of Object.entries(entries)) {
    let node = root;
    for (const part of filename.split('/')) {
      if (!node.children.has(part))
        node.children.set(part, { children: new Map() });
      node = node.children.get(part)!;
    }
    node.entry = entry;
  }
  function write(node: TreeNode): string {
    const rows: string[] = [];
    for (const [name, child] of node.children) {
      const value = child.entry;
      rows.push(
        value
          ? value.mode +
              ' ' +
              value.type +
              ' ' +
              value.hash +
              '\t' +
              name +
              '\0'
          : '040000 tree ' + write(child) + '\t' + name + '\0',
      );
    }
    return command(directory, ['mktree', '-z'], rows.join(''));
  }
  return write(root);
}
function commit(
  directory: string,
  entries: Record<string, TreeEntry>,
  parents: string[] = [],
  message = 'fixture commit',
) {
  return command(directory, [
    '-c',
    'commit.gpgsign=false',
    'commit-tree',
    tree(directory, entries),
    ...parents.flatMap((parent) => ['-p', parent]),
    '-m',
    message,
  ]);
}
function ref(directory: string, name: string, sha: string) {
  command(directory, ['update-ref', name, sha]);
}
function moduleConfig(name: string, modulePath: string, repository: string) {
  return (
    '[submodule "' +
    name +
    '"]\n\tpath = ' +
    modulePath +
    '\n\turl = https://github.com/fixture/' +
    repository +
    '.git\n'
  );
}
function sources(files: ReturnType<typeof inventory>['files']) {
  const cache = new Map<string, Buffer>();
  readBlobs(files, cache);
  return new Map(files.map((file) => [file.path, cache.get(file.blob)!]));
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    const resolved = fs.realpathSync(root);
    if (
      path.dirname(resolved) !== temporaryBase ||
      !path.basename(resolved).startsWith('neoweb-git-test-')
    ) {
      throw new Error(
        'Refusing to remove a path outside the exact generated Git fixture.',
      );
    }
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe('immutable Git snapshot fixtures', () => {
  it('selects 20 dev commits, the main head and peeled releases without duplicate SHAs', () => {
    const { gitdir } = fixture();
    const commits: string[] = [];
    for (let index = 0; index < 25; index++) {
      commits.push(
        commit(
          gitdir,
          { 'note.md': blob(gitdir, '# Revision ' + index + '\n') },
          index ? [commits[index - 1]] : [],
          'revision ' + index,
        ),
      );
    }
    const main = commit(
      gitdir,
      { 'note.md': blob(gitdir, '# Main only\n') },
      [commits[2]],
      'main branch',
    );
    ref(gitdir, 'refs/remotes/origin/dev', commits[24]);
    ref(gitdir, 'refs/remotes/origin/main', main);
    // The local dev branch is intentionally stale; the fetched origin ref is the source of truth.
    ref(gitdir, 'refs/heads/dev', commits[12]);
    ref(gitdir, 'refs/heads/main', main);
    const tag = command(
      gitdir,
      ['mktag'],
      'object ' +
        commits[0] +
        '\ntype commit\ntag release-v1\ntagger NeoWeb fixture <fixture@example.invalid> 1700000000 +0000\n\nRelease\n',
    );
    ref(gitdir, 'refs/tags/release-v1', tag);
    ref(gitdir, 'refs/tags/duplicate-release', commits[0]);
    ref(gitdir, 'refs/tags/current-release', commits[24]);
    const selected = selectSnapshots(gitdir);
    expect(selected.slice(0, 20)).toEqual(commits.slice(5).reverse());
    expect(selected).toHaveLength(22);
    expect(selected).toContain(main);
    expect(selected).toContain(commits[0]);
    expect(new Set(selected).size).toBe(selected.length);
    expect(selectSnapshots(gitdir, 20, 'refs/tags/release-v1')).toEqual([
      commits[0],
    ]);
    expect(repositoryDir(gitdir)).toBe(gitdir.replace(/\\/g, '/'));
  }, 30_000);

  it('preserves topological order across merge branches', () => {
    const { gitdir } = fixture();
    const files = { 'note.md': blob(gitdir, '# Notes\n') };
    const base = commit(gitdir, files, [], 'base');
    const left = commit(gitdir, files, [base], 'left');
    const right = commit(gitdir, files, [base], 'right');
    const merged = commit(gitdir, files, [left, right], 'merge');
    ref(gitdir, 'refs/remotes/origin/dev', merged);
    ref(gitdir, 'refs/remotes/origin/main', base);
    const selected = selectSnapshots(gitdir);
    expect(selected[0]).toBe(merged);
    expect(selected.indexOf(left)).toBeLessThan(selected.indexOf(base));
    expect(selected.indexOf(right)).toBeLessThan(selected.indexOf(base));
    expect(selected.indexOf(merged)).toBeLessThan(selected.indexOf(left));
    expect(selected.indexOf(merged)).toBeLessThan(selected.indexOf(right));
  });

  it('loads the recursively pinned child objects rather than current submodule branches', () => {
    const { gitdir } = fixture();
    const examples = initialize(path.join(gitdir, 'modules', 'examples-store'));
    const esp32 = initialize(path.join(examples, 'modules', 'esp-store'));
    const runtime = initialize(path.join(esp32, 'modules', 'runtime-store'));
    const v1 = commit(runtime, {
      'main/main.c': blob(runtime, '// π\nint answer(void) { return 1; }\n'),
    });
    const v2 = commit(
      runtime,
      {
        'main/main.c': blob(runtime, '// π\nint answer(void) { return 2; }\n'),
      },
      [v1],
    );
    const v3 = commit(
      runtime,
      {
        'main/main.c': blob(
          runtime,
          '// unpinned\nint answer(void) { return 3; }\n',
        ),
      },
      [v2],
    );
    ref(runtime, 'refs/heads/dev', v3);
    const espConfig = blob(
      esp32,
      moduleConfig('runtime-store', 'FreeRTOS', 'Runtime'),
    );
    const esp1 = commit(esp32, { '.gitmodules': espConfig, FreeRTOS: pin(v1) });
    const esp2 = commit(
      esp32,
      { '.gitmodules': espConfig, FreeRTOS: pin(v2) },
      [esp1],
    );
    ref(esp32, 'refs/heads/dev', esp2);
    const examplesConfig = blob(
      examples,
      moduleConfig('esp-store', 'ESP32', 'ESP32'),
    );
    const examples1 = commit(examples, {
      '.gitmodules': examplesConfig,
      ESP32: pin(esp1),
    });
    const examples2 = commit(
      examples,
      { '.gitmodules': examplesConfig, ESP32: pin(esp2) },
      [examples1],
    );
    ref(examples, 'refs/heads/dev', examples2);
    const rootConfig = blob(
      gitdir,
      moduleConfig('examples-store', 'Examples', 'Examples'),
    );
    const root1 = commit(gitdir, {
      '.gitmodules': rootConfig,
      Examples: pin(examples1),
    });
    const root2 = commit(
      gitdir,
      { '.gitmodules': rootConfig, Examples: pin(examples2) },
      [root1],
    );
    ref(gitdir, 'refs/heads/dev', root2);
    const first = inventory(gitdir, root1, 'fixture/NeoLearning');
    const second = inventory(gitdir, root2, 'fixture/NeoLearning');
    const filename = 'Examples/ESP32/FreeRTOS/main/main.c';
    expect(first.pins).toEqual([
      {
        path: 'Examples',
        parentPath: '',
        repository: 'fixture/Examples',
        sha: examples1,
      },
      {
        path: 'Examples/ESP32',
        parentPath: 'Examples',
        repository: 'fixture/ESP32',
        sha: esp1,
      },
      {
        path: 'Examples/ESP32/FreeRTOS',
        parentPath: 'Examples/ESP32',
        repository: 'fixture/Runtime',
        sha: v1,
      },
    ]);
    expect(first.files.find((file) => file.path === filename)).toMatchObject({
      repository: 'fixture/Runtime',
      sha: v1,
      localPath: 'main/main.c',
      gitdir: runtime,
    });
    expect(sources(first.files).get(filename)?.toString()).toContain(
      'return 1',
    );
    expect(sources(second.files).get(filename)?.toString()).toContain(
      'return 2',
    );
    expect(sources(first.files).get(filename)?.toString()).not.toContain(
      'return 3',
    );
    expect(gitText(runtime, ['rev-parse', 'refs/heads/dev'])).toBe(v3);
    expect(gitText(gitdir, ['rev-parse', 'refs/heads/dev'])).toBe(root2);
  }, 30_000);

  it('keeps exact binary, Unicode and newline-delimited blob payloads in a shared cache', () => {
    const { gitdir } = fixture();
    const binary = Buffer.from([0, 10, 13, 255, 128, 1, 0]);
    const text = 'π → λ\n\nA blob-looking line:\n012345 blob 42\n';
    const sha = commit(gitdir, {
      '02_Software/π example.md': blob(gitdir, text),
      '02_Software/copy.md': blob(gitdir, text),
      '02_Software/diagram.png': blob(gitdir, binary),
      '02_Software/empty.md': blob(gitdir, ''),
    });
    const files = inventory(gitdir, sha, 'fixture/NeoLearning').files;
    const cache = new Map<string, Buffer>();
    readBlobs([...files, ...files], cache);
    expect(cache.size).toBe(3);
    expect(
      cache.get(files.find((file) => file.path.endsWith('diagram.png'))!.blob),
    ).toEqual(binary);
    expect(
      cache
        .get(files.find((file) => file.path.endsWith('π example.md'))!.blob)
        ?.toString(),
    ).toBe(text);
    expect(
      cache.get(files.find((file) => file.path.endsWith('empty.md'))!.blob)
        ?.length,
    ).toBe(0);
  });

  it('retains source objects for first-parent additions, removals, modifications and edited renames', () => {
    const { gitdir } = fixture();
    const original =
      Array.from(
        { length: 20 },
        (_, index) => 'int value_' + index + ' = ' + index + ';',
      ).join('\n') + '\n';
    const edited = original.replace('value_10 = 10', 'value_10 = 99');
    const originalBlob = blob(gitdir, original);
    const removedBlob = blob(gitdir, '# Removed source\n');
    const initial = {
      '02_Software/rename-me.c': originalBlob,
      '02_Software/remove.md': removedBlob,
      '02_Software/keep.md': blob(gitdir, '# Initial\n'),
    };
    const base = commit(gitdir, initial, [], 'base');
    const left = commit(
      gitdir,
      {
        ...initial,
        '02_Software/keep.md': blob(gitdir, '# Left first parent\n'),
      },
      [base],
      'left',
    );
    const right = commit(
      gitdir,
      {
        ...initial,
        '02_Software/keep.md': blob(gitdir, '# Right second parent\n'),
      },
      [base],
      'right',
    );
    const merged = commit(
      gitdir,
      {
        '02_Software/renamed.c': blob(gitdir, edited),
        '02_Software/keep.md': blob(gitdir, '# Merged\n'),
        '02_Software/added.md': blob(gitdir, '# Added\n'),
      },
      [left, right],
      'merge',
    );
    const parents = gitText(gitdir, [
      'show',
      '-s',
      '--format=%P',
      merged,
    ]).split(' ');
    expect(parents).toEqual([left, right]);
    const before = inventory(gitdir, parents[0], 'fixture/NeoLearning').files;
    const after = inventory(gitdir, merged, 'fixture/NeoLearning').files;
    const beforeSources = sources(before);
    const afterSources = sources(after);
    expect(gitRenames(before, after).get('02_Software/renamed.c')).toBe(
      '02_Software/rename-me.c',
    );
    expect(beforeSources.get('02_Software/keep.md')?.toString()).toBe(
      '# Left first parent\n',
    );
    expect(beforeSources.get('02_Software/remove.md')?.toString()).toBe(
      '# Removed source\n',
    );
    expect(beforeSources.get('02_Software/rename-me.c')?.toString()).toBe(
      original,
    );
    expect(afterSources.get('02_Software/renamed.c')?.toString()).toBe(edited);
    expect(afterSources.has('02_Software/remove.md')).toBe(false);
    expect(afterSources.get('02_Software/added.md')?.toString()).toBe(
      '# Added\n',
    );
    const changes = git(gitdir, [
      'diff-tree',
      '--no-commit-id',
      '--name-status',
      '-r',
      '-M',
      parents[0],
      merged,
    ]).toString();
    expect(changes).toContain('A\t02_Software/added.md');
    expect(changes).toContain('M\t02_Software/keep.md');
    expect(changes).toContain('D\t02_Software/remove.md');
    expect(changes).toMatch(
      /R\d+\t02_Software\/rename-me\.c\t02_Software\/renamed\.c/,
    );
    expect(gitText(gitdir, ['cat-file', '-p', originalBlob.hash])).toBe(
      original.trim(),
    );
    expect(gitText(gitdir, ['cat-file', '-p', removedBlob.hash])).toBe(
      '# Removed source',
    );
  });

  it('detects edited renames inside a pinned submodule with complete parent paths', () => {
    const { gitdir } = fixture();
    const examples = initialize(path.join(gitdir, 'modules', 'examples-store'));
    const source =
      Array.from(
        { length: 20 },
        (_, index) => 'int helper_' + index + ' = ' + index + ';',
      ).join('\n') + '\n';
    const beforeChild = commit(examples, {
      'main/old helper.c': blob(examples, source),
    });
    const afterChild = commit(
      examples,
      {
        'main/new helper.c': blob(
          examples,
          source.replace('helper_10 = 10', 'helper_10 = 99'),
        ),
      },
      [beforeChild],
    );
    const config = blob(
      gitdir,
      moduleConfig('examples-store', 'Examples', 'Examples'),
    );
    const beforeRoot = commit(gitdir, {
      '.gitmodules': config,
      Examples: pin(beforeChild),
    });
    const afterRoot = commit(
      gitdir,
      { '.gitmodules': config, Examples: pin(afterChild) },
      [beforeRoot],
    );
    const before = inventory(gitdir, beforeRoot, 'fixture/NeoLearning').files;
    const after = inventory(gitdir, afterRoot, 'fixture/NeoLearning').files;
    expect([...gitRenames(before, after)]).toEqual([
      ['Examples/main/new helper.c', 'Examples/main/old helper.c'],
    ]);
  });

  it('never exposes symlink targets as renderable documents or assets', () => {
    const { gitdir } = fixture();
    const sha = commit(gitdir, {
      '02_Software/notes.md': blob(gitdir, '# Safe\n'),
      '02_Software/private.md': blob(
        gitdir,
        '../../private-secret.md',
        '120000',
      ),
    });
    expect(
      inventory(gitdir, sha, 'fixture/NeoLearning').files.map(
        (file) => file.path,
      ),
    ).toEqual(['02_Software/notes.md']);
  });

  it('fails clearly for an uninitialized pinned submodule', () => {
    const { gitdir } = fixture();
    const sha = commit(gitdir, {
      '.gitmodules': blob(
        gitdir,
        moduleConfig('missing-store', 'Examples', 'Examples'),
      ),
      Examples: pin('a'.repeat(40)),
    });
    expect(() => inventory(gitdir, sha, 'fixture/NeoLearning')).toThrow(
      'Missing initialized submodule Examples',
    );
  });

  it('rejects branch labels where an immutable inventory SHA is required', () => {
    const { gitdir } = fixture();
    expect(() => inventory(gitdir, 'dev', 'fixture/NeoLearning')).toThrow(
      'Expected a resolved commit SHA',
    );
  });
});
