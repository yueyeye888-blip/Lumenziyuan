import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile, rename, unlink, stat, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const BASE = '/__host/template-archive';
const MAX_BYTES = 2 * 1024 ** 3;
const locks = new Set();
let manifestWrites = Promise.resolve();
const isOwner = (user, config) => {
  const owner = config.archiveOwnerEmail || String(config.bindings?.RESOURCE_ADMIN_EMAILS || '').split(',')[0];
  return Boolean(owner && user?.email?.trim().toLowerCase() === owner.trim().toLowerCase());
};
const directory = root => path.join(root, 'private-template-archive');
const manifestPath = root => path.join(directory(root), 'catalog.json');
const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(value)); };
async function optionalJson(filename) {
  try { return JSON.parse(await readFile(filename, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function catalog(root, decorate = true) {
  const data = await optionalJson(manifestPath(root)) || { source:'WindX', items:[] };
  if (!Array.isArray(data.items) || data.items.length > 1000) throw new Error('Invalid archive catalog');
  if (!decorate) return data;
  const descriptions = await optionalJson(path.join(directory(root), 'introductions.json'));
  const previews = await optionalJson(path.join(directory(root), 'previews.json'));
  const introductions = new Map((descriptions?.items || []).map(item => [item.id, item]));
  return { ...data, items: data.items.map(item => {
    const details = introductions.get(item.id);
    const picture = previews?.images?.[item.id];
    return { ...item, ...(details ? { displayTitle: details.displayTitle, displayCategory: details.displayCategory, description: details.description, fields: details.fields, sourceUpdatedAt: details.sourceUpdatedAt } : {}), imageUrl: picture ? BASE + '/previews/' + item.id + '?v=' + picture.sha256.slice(0,12) : item.previewUrl };
  }) };
}
async function updateItem(root, id, fields) {
  const operation = manifestWrites.catch(() => {}).then(async () => {
    const data = await catalog(root, false);
    const item = data.items.find(row => row.id === id);
    if (!item) throw new Error('Unknown archive item');
    Object.assign(item, fields);
    const temporary = manifestPath(root) + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(data, null, 2), { flag: 'wx' });
    await rename(temporary, manifestPath(root));
  });
  manifestWrites = operation;
  return operation;
}
function validSignature(extension, bytes) {
  if (extension === 'zip') return bytes[0] === 0x50 && bytes[1] === 0x4b && ((bytes[2] === 3 && bytes[3] === 4) || (bytes[2] === 5 && bytes[3] === 6));
  if (extension === 'pdf') return bytes.toString('ascii', 0, 4) === '%PDF';
  return extension === 'psd' && bytes.toString('ascii', 0, 4) === '8BPS';
}

export function enhanceArchiveHtml(html, user) {
  if (!user?.email || html.includes('data-lumen-archive-loader')) return html;
  return html.replace('</body>', `<script defer data-lumen-archive-loader src="${BASE}/enhance.js"></script></body>`);
}

export async function handlePrivateTemplateArchive(req, res, { root, url, user, allowedOrigins, config = {} }) {
  if (url.pathname !== BASE && !url.pathname.startsWith(BASE + '/')) return false;
  if (!user?.email) { json(res, 401, { error: '请先登录公司账号' }); return true; }
  const suffix = url.pathname.slice(BASE.length);
  if (['GET','HEAD'].includes(req.method) && ['', '/', '/app.js', '/style.css', '/enhance.js'].includes(suffix)) {
    const asset = suffix === '/app.js' ? 'app.js' : suffix === '/enhance.js' ? 'enhance.js' : suffix === '/style.css' ? 'style.css' : 'index.html';
    const content = await readFile(path.join(root, 'template-library-ui', asset));
    const contentType = asset.endsWith('.js') ? 'application/javascript' : asset.endsWith('.css') ? 'text/css' : 'text/html';
    res.writeHead(200, { 'content-type': contentType + '; charset=utf-8', 'content-length': content.length, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; img-src 'self' https://cnd.windx.co.uk; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
    res.end(req.method === 'HEAD' ? undefined : content); return true;
  }
  if (suffix === '/catalog' && req.method === 'GET') {
    const data = await catalog(root);
    json(res, 200, { source: data.source, items: data.items.map(({ localPath, downloadUrl, ...item }) => item) }); return true;
  }
  const previewMatch = suffix.match(/^\/previews\/(windx-\d+)$/);
  if (previewMatch && ['GET','HEAD'].includes(req.method)) {
    const id = previewMatch[1];
    const raw = await catalog(root, false);
    const previews = await optionalJson(path.join(directory(root), 'previews.json'));
    const image = previews?.images?.[id];
    if (!raw.items.some(item => item.id === id) || !image || !new RegExp('^' + id + '\\.(jpg|png|webp)$').test(image.file) || !['image/jpeg','image/png','image/webp'].includes(image.contentType)) { json(res, 404, { error: '对应预览图暂不可用' }); return true; }
    const file = path.join(directory(root), 'previews', image.file);
    const details = await stat(file);
    if (!details.isFile() || details.size !== image.bytes) { json(res, 404, { error: '对应预览图暂不可用' }); return true; }
    res.writeHead(200, { 'content-type': image.contentType, 'content-length': details.size, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff', etag: '"' + image.sha256 + '"' });
    if (req.method === 'HEAD') res.end(); else await pipeline(createReadStream(file), res);
    return true;
  }
  const match = suffix.match(/^\/files\/(windx-\d+)$/);
  if (!match) { json(res, 404, { error: '文件不存在' }); return true; }
  const id = match[1];
  const data = await catalog(root);
  const item = data.items.find(row => row.id === id);
  if (!item) { json(res, 404, { error: '文件不存在' }); return true; }
  if (req.method === 'PUT') {
    if (!isOwner(user,config)) { json(res, 403, { error: '只有管理员可以上传或替换文件' }); return true; }
    if (!allowedOrigins?.has(req.headers.origin) || req.headers['x-lumen-archive-upload'] !== '1') { json(res, 403, { error: '上传来源不匹配' }); return true; }
    if (locks.has(id)) { json(res, 409, { error: '该文件正在归档中' }); return true; }
    if (item.fileStatus === 'archived') { req.resume(); json(res, 200, { ok: true, alreadyArchived: true, sha256: item.sha256, bytes: item.bytes }); return true; }
    const length = Number(req.headers['content-length']);
    const expectedHash = String(req.headers['x-lumen-sha256'] || '').toLowerCase();
    let originalName = ''; try { originalName = decodeURIComponent(String(req.headers['x-lumen-original-name'] || '')); } catch {}
    const extension = originalName.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    if (!Number.isSafeInteger(length) || length < 8 || length > MAX_BYTES || !/^[a-f0-9]{64}$/.test(expectedHash) || !['zip','pdf','psd'].includes(extension) || originalName.length > 200 || /[\/\\\x00-\x1f]/.test(originalName)) { json(res, 400, { error: '文件类型、大小或校验信息无效' }); return true; }
    locks.add(id);
    const files = path.join(directory(root), 'files');
    const file = id + '.' + extension;
    const temporary = path.join(files, file + '.' + randomUUID() + '.part');
    let bytes = 0; let signature = Buffer.alloc(0); const hash = createHash('sha256');
    try {
      await mkdir(files, { recursive: true });
      const meter = new Transform({ transform(chunk, encoding, callback) { bytes += chunk.length; if (bytes > length) return callback(new Error('Unexpected upload size')); if (signature.length < 4) signature = Buffer.concat([signature, chunk]).subarray(0,4); hash.update(chunk); callback(null, chunk); } });
      await pipeline(req, meter, createWriteStream(temporary, { flags: 'wx' }));
      const digest = hash.digest('hex');
      if (bytes !== length || digest !== expectedHash || !validSignature(extension, signature)) { await unlink(temporary); json(res, 422, { error: '文件完整性校验未通过，请重新上传' }); return true; }
      await rename(temporary, path.join(files, file));
      await updateItem(root, id, { file, originalName, bytes, sha256: digest, archivedAt: new Date().toISOString(), fileStatus: 'archived' });
      json(res, 201, { ok: true, id, sha256: digest, bytes });
    } catch (error) {
      await unlink(temporary).catch(() => {});
      if (!res.headersSent && !res.destroyed) json(res, 500, { error: '归档上传失败，请重试' });
      console.error(JSON.stringify({ event: 'private_archive_upload_failed', id, code: error.code || 'upload_failed' }));
    } finally { locks.delete(id); }
    return true;
  }
  if (!['GET','HEAD'].includes(req.method)) { json(res, 405, { error: '不支持此操作' }); return true; }
  if (item.fileStatus !== 'archived' || !new RegExp('^' + id + '\\.(zip|pdf|psd)$').test(item.file || '')) { json(res, 404, { error: '原文件尚未导入' }); return true; }
  const filename = path.join(directory(root), 'files', item.file);
  let details; try { details = await stat(filename); } catch { json(res, 404, { error: '原文件暂时不可用，请联系管理员' }); return true; }
  if (!details.isFile() || details.size !== item.bytes) { json(res, 409, { error: '文件校验信息不匹配，请联系管理员' }); return true; }
  let start = 0; let end = details.size - 1; let status = 200;
  if (req.headers.range) {
    const range = String(req.headers.range).match(/^bytes=(\d*)-(\d*)$/);
    if (range && (range[1] || range[2])) { if (!range[1]) start = Math.max(0, details.size - Number(range[2])); else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); } status = 206; }
    else start = -1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= details.size) { res.writeHead(416, { 'content-range': 'bytes */' + details.size, 'cache-control': 'private, no-store' }); res.end(); return true; }
  }
  const headers = { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${item.file}"; filename*=UTF-8''${encodeURIComponent(item.originalName || item.file)}`, 'content-length': end - start + 1, 'cache-control': 'private, no-store', 'accept-ranges': 'bytes', 'x-content-type-options': 'nosniff', 'x-lumen-sha256': item.sha256, 'content-security-policy': "default-src 'none'; sandbox" };
  if (status === 206) headers['content-range'] = `bytes ${start}-${end}/${details.size}`;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') res.end(); else await pipeline(createReadStream(filename, { start, end }), res);
  return true;
}
