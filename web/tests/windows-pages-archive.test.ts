import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

const workflow = z
  .object({
    jobs: z.object({
      build: z.object({
        steps: z.array(
          z.object({
            name: z.string(),
            run: z.string().optional(),
            uses: z.string().optional(),
          }),
        ),
      }),
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

it.skipIf(process.platform !== 'win32')(
  'archives Pages with Git Bash and GNU tar even when the WSL alias is first on PATH',
  () => {
    const tempBase = fs.realpathSync(os.tmpdir());
    const root = fs.mkdtempSync(path.join(tempBase, 'neoweb-pages-archive-'));
    try {
      const input = path.join(root, 'site with spaces');
      fs.mkdirSync(input);
      fs.writeFileSync(
        path.join(input, 'index.html'),
        '<h1>Archive fixture</h1>',
      );
      fs.writeFileSync(path.join(input, '.hidden'), 'must not be uploaded');
      const originalPath = process.env.Path ?? process.env.PATH ?? '';
      const env = { ...process.env };
      for (const key of Object.keys(env)) {
        if (key.toLowerCase() === 'path') delete env[key];
      }
      env.Path =
        path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft/WindowsApps') +
        path.delimiter +
        originalPath;
      env.GITHUB_PATH = path.join(root, 'github-path.txt');
      env.INPUT_PATH = input;
      env.RUNNER_TEMP = root;
      const steps = workflow.jobs.build.steps;
      const prepare = steps.findIndex(
        (step) => step.name === 'Prepare Windows Pages archive tools',
      );
      if (prepare >= 0) {
        const setup = spawnSync(
          'pwsh',
          ['-NoProfile', '-NonInteractive', '-Command', steps[prepare].run!],
          { cwd: process.cwd(), env, encoding: 'utf8', windowsHide: true },
        );
        expect(setup.status, setup.stderr).toBe(0);
        const additions = fs
          .readFileSync(env.GITHUB_PATH, 'utf8')
          .trim()
          .split(/\r?\n/)
          .reverse();
        env.Path = additions.join(path.delimiter) + path.delimiter + env.Path;
      }
      // Replay the pinned upload-pages-artifact Windows tar flags, including drive-letter paths.
      const command =
        'tar --dereference --hard-dereference --directory "$INPUT_PATH" -cf "$RUNNER_TEMP\\artifact.tar" --exclude=.git --exclude=.github --exclude=".[^/]*" --force-local .';
      const shell = spawnSync('where.exe', ['bash'], {
        env,
        encoding: 'utf8',
        windowsHide: true,
      })
        .stdout.trim()
        .split(/\r?\n/)[0];
      const archive = spawnSync(
        shell,
        ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', command],
        { env, encoding: 'utf8', windowsHide: true },
      );
      expect(
        archive.status,
        (archive.stdout + archive.stderr).replaceAll('\0', ''),
      ).toBe(0);
      expect(prepare).toBeGreaterThanOrEqual(0);
      expect(prepare).toBeLessThan(
        steps.findIndex((step) =>
          step.uses?.startsWith('actions/upload-pages-artifact@'),
        ),
      );
      const listing = spawnSync(
        shell,
        [
          '--noprofile',
          '--norc',
          '-c',
          'tar --force-local -tf "$RUNNER_TEMP/artifact.tar"',
        ],
        { env, encoding: 'utf8', windowsHide: true },
      );
      expect(listing.status).toBe(0);
      expect(listing.stdout).toContain('./index.html');
      expect(listing.stdout).not.toContain('.hidden');
    } finally {
      if (
        path.dirname(root) !== tempBase ||
        !path.basename(root).startsWith('neoweb-pages-archive-')
      )
        throw new Error('Unexpected fixture directory');
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
