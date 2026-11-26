import { readFileSync } from 'node:fs';

const assets = new Map([
  ['locale-data.js', 'application/javascript'],
  ['locale-operations.js', 'application/javascript'],
  ['locale.js', 'application/javascript'],
  ['locale.css', 'text/css'],
  ['support-links.js', 'application/javascript'],
  ['support.css', 'text/css'],
  ['catalog-countries.css', 'text/css'],
  ['workspace.css', 'text/css'],
]);
const browserDirectory = new URL('./ui/', import.meta.url);
const localeHead = [...assets.keys()].map(file => file.endsWith('.css')
  ? '<link rel="stylesheet" href="/__host/' + file + '">'
  : '<script defer src="/__host/' + file + '"></script>'
).join('');

export function withLocale(html) {
  return html.toString().replace(/<\/head>/i, localeHead + '</head>');
}

export function serveLocaleAsset(req, res, pathname) {
  const file = pathname.slice('/__host/'.length);
  if (!pathname.startsWith('/__host/') || !assets.has(file)) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end();
    return true;
  }
  const content = readFileSync(new URL(file, browserDirectory));
  res.writeHead(200, {
    'content-type': assets.get(file) + '; charset=utf-8',
    'content-length': content.length,
    'cache-control': 'public, max-age=0, must-revalidate',
    'x-content-type-options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : content);
  return true;
}
