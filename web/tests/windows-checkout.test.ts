import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const relativeFile =
  '02_Software/02_Programming-Fundamentals/01_Algorithms-and-Data-Structures/02_practice/03_data_structures/02_contiguous_vs_linked_structures/1480_running_sum_of_1d_array/1480_running_sum_of_1d_array.c';
const temporaryBase = fs.realpathSync(os.tmpdir());
const roots: string[] = [];
const workflow = z
  .object({
    jobs: z.object({
      build: z.object({ env: z.record(z.string(), z.string()).optional() }),
    }),
  })
  .parse(
    parse(
      fs.readFileSync(
        new URL('../../.github/workflows/pages.yml', import.meta.url),
        'utf8',
      ),
    ),
  );

afterEach(() => {
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== temporaryBase ||
      !path.basename(root).startsWith('neoweb-longpath-')
    )
      throw new Error('Refusing to remove an unexpected fixture directory');
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function checkout(environment: Record<string, string>) {
  const root = fs.mkdtempSync(
    path.join(temporaryBase, 'neoweb-longpath-runner-workspace-'),
  );
  roots.push(root);
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '0',
    ...environment,
  };
  const git = (args: string[], input?: string) =>
    spawnSync('git', args, {
      cwd: root,
      env,
      input,
      encoding: 'utf8',
      windowsHide: true,
    });
  expect(git(['init', '--quiet']).status).toBe(0);
  const blob = git(
    ['hash-object', '-w', '--stdin'],
    '// Checkout fixture only.\n',
  );
  expect(blob.status).toBe(0);
  expect(
    git([
      'update-index',
      '--add',
      '--cacheinfo',
      `100644,${blob.stdout.trim()},${relativeFile}`,
    ]).status,
  ).toBe(0);
  expect(path.join(root, relativeFile).length).toBeGreaterThan(260);
  const result = git(['checkout-index', '--all']);
  return { result, exists: fs.existsSync(path.join(root, relativeFile)) };
}

describe.skipIf(process.platform !== 'win32')(
  'Windows runner deep checkout',
  () => {
    it('reproduces the reported filename-too-long failure without long-path support', () => {
      const { result } = checkout({
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.longpaths',
        GIT_CONFIG_VALUE_0: 'false',
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Filename too long');
    });

    it('checks out the same deep curriculum path using the publication job environment', () => {
      const { result, exists } = checkout(workflow.jobs.build.env ?? {});
      expect(result.stderr).not.toContain('Filename too long');
      expect(result.status).toBe(0);
      expect(exists).toBe(true);
    });
  },
);
