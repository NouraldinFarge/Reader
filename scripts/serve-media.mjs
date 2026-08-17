import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import process from 'node:process';

const port = Number(process.env.READER_MEDIA_PORT || 4175);
const root = resolve(import.meta.dirname, '..', 'docs', 'media');
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

const server = createServer((request, response) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || '/', 'http://reader-media.local').pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }
  const path = resolve(root, pathname.replace(/^\/+/, ''));
  if ((path !== root && !path.startsWith(`${root}${sep}`)) || !existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404).end('Not found');
    return;
  }
  response.writeHead(200, {
    'Content-Type': mimeTypes[extname(path).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(path).pipe(response);
});

server.listen(port, '127.0.0.1', () =>
  console.log(`Reader media preview is available at http://127.0.0.1:${port}`),
);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
