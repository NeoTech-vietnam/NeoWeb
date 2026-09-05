import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CatalogSchema,
  SnapshotSchema,
  BlobSchema,
} from '../lib/content-schema';
const output = path.resolve(process.argv[2] ?? 'dist/client');
let bytes = 0;
let count = 0;
const secretPatterns = [
  /gh[pousr]_[A-Za-z0-9_]{30,}/,
  /github_pat_[A-Za-z0-9_]{40,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
async function walk(dir: string) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink in release: ${file}`);
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', 'server'].includes(entry.name))
        throw new Error(`Private build directory in release: ${file}`);
      await walk(file);
    } else {
      const stat = await fs.stat(file);
      bytes += stat.size;
      count++;
      if (/\.(html|js|json|css|txt)$/.test(entry.name)) {
        const text = await fs.readFile(file, 'utf8');
        if (secretPatterns.some((p) => p.test(text)))
          throw new Error(`Possible credential in release: ${file}`);
      }
    }
  }
}
await fs.access(path.join(output, 'index.html'));
await walk(output);
if (bytes > 750 * 1024 * 1024)
  throw new Error(
    `Release exceeds 750 MB (${(bytes / 1024 / 1024).toFixed(1)} MB).`,
  );
const catalog = CatalogSchema.parse(
  JSON.parse(
    await fs.readFile(path.join(output, 'content/catalog.json'), 'utf8'),
  ),
);
const hashes = new Set<string>();
for (const meta of catalog.snapshots) {
  const snapshot = SnapshotSchema.parse(
    JSON.parse(
      await fs.readFile(
        path.join(output, 'content/snapshots', `${meta.sha}.json`),
        'utf8',
      ),
    ),
  );
  for (const d of snapshot.documents) hashes.add(d.contentHash);
  for (const e of snapshot.exercises) {
    hashes.add(e.promptHash);
    e.hintHashes.forEach((h) => hashes.add(h));
  }
  for (const c of snapshot.changes) {
    if (c.beforeHash) hashes.add(c.beforeHash);
    if (c.afterHash) hashes.add(c.afterHash);
  }
}
for (const hash of hashes)
  BlobSchema.parse(
    JSON.parse(
      await fs.readFile(
        path.join(output, 'content/blobs', `${hash}.json`),
        'utf8',
      ),
    ),
  );
console.log(
  `Release verified: ${catalog.snapshots.length} snapshots, ${hashes.size} content blobs, ${count} files, ${(bytes / 1024 / 1024).toFixed(1)} MB; no detected secrets or unsafe output paths.`,
);
