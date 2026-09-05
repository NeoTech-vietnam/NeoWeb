import { build } from 'esbuild';
import path from 'node:path';
const output = path.resolve(
  process.argv[2] ??
    '../integration/neolearning/.github/neoweb/check-markdown.mjs',
);
await build({
  entryPoints: ['scripts/check-markdown.ts'],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  minify: true,
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});
console.log(`Trusted standalone validator built: ${output}`);
