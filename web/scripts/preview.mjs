import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

// Preview the exact Pages artifact, without starting an SSR application server.
const root = path.resolve('dist/client');
const base = process.env.NEOWEB_BASE_PATH ?? '';
if (base && (!/^\/[A-Za-z0-9_.-]+$/.test(base) || base.includes('..')))
  throw new Error('Invalid preview base path');
const port = Number(process.env.PORT ?? 4175);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};
await fs.access(path.join(root, 'index.html'));
http
  .createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405).end();
        return;
      }
      const pathname = decodeURIComponent(
        new URL(request.url, 'http://localhost').pathname,
      );
      if (pathname === base && base) {
        response.writeHead(302, { Location: base + '/' }).end();
        return;
      }
      if (
        !pathname.startsWith(base + '/') ||
        pathname.includes('\\') ||
        pathname.includes('\0')
      ) {
        response.writeHead(404).end();
        return;
      }
      const relative = pathname.slice(base.length + 1);
      const file = path.resolve(root, relative || 'index.html');
      if (!file.startsWith(root + path.sep)) {
        response.writeHead(404).end();
        return;
      }
      const data = await fs.readFile(file);
      response.writeHead(200, {
        'Content-Type': types[path.extname(file)] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch {
      response.writeHead(404).end('Not found');
    }
  })
  .listen(port, '127.0.0.1', () =>
    console.log(`Static preview: http://127.0.0.1:${port}${base}/`),
  );
