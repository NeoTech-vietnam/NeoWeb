import fs from 'node:fs/promises';
import path from 'node:path';

// Vinext nests an export under basePath. Pages supplies that mount point itself,
// so deploy the contents at the artifact root while retaining prefixed URLs.
const base =
  process.env.NEOWEB_BASE_PATH ??
  (process.env.GITHUB_REPOSITORY
    ? '/' + process.env.GITHUB_REPOSITORY.split('/')[1]
    : '');
if (base) {
  if (!/^\/[A-Za-z0-9_.-]+$/.test(base) || base.includes('..'))
    throw new Error('Invalid Pages base path');
  const root = path.resolve('dist/client');
  const nested = path.resolve(root, base.slice(1));
  if (path.dirname(nested) !== root)
    throw new Error('Export path escapes artifact root');
  try {
    await fs.access(path.join(nested, 'index.html'));
  } catch {
    throw new Error('Expected base-path static export is missing');
  }
  for (const entry of await fs.readdir(nested)) {
    const destination = path.join(root, entry);
    try {
      await fs.access(destination);
      throw new Error(`Refusing to overwrite export entry ${entry}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await fs.rename(path.join(nested, entry), destination);
  }
  await fs.rmdir(nested);
  console.log(`Prepared ${base}/ for GitHub Pages at dist/client.`);
}
