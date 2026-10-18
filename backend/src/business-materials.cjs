'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_BYTES = 20 * 1024 * 1024;
const TYPES = Object.freeze({
  '.pdf': { mime: 'application/pdf', filename: 'learning-material.pdf' },
  '.doc': { mime: 'application/msword', filename: 'learning-material.doc' },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', filename: 'learning-material.docx' },
  '.ppt': { mime: 'application/vnd.ms-powerpoint', filename: 'learning-material.ppt' },
  '.pptx': { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', filename: 'learning-material.pptx' },
  '.xls': { mime: 'application/vnd.ms-excel', filename: 'learning-material.xls' },
  '.xlsx': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: 'learning-material.xlsx' }
});

function assert(value, message, code = 'INVALID_INPUT', status = 400) {
  if (value) return;
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function ensureDirectory(directory, create = true) {
  if (create) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  assert(stat.isDirectory() && !stat.isSymbolicLink(), '资料存储目录配置无效', 'STORAGE_UNAVAILABLE', 503);
  if (process.platform !== 'win32') fs.chmodSync(directory, 0o700);
}

async function readLimited(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    assert(size <= MAX_BYTES, '资料不能超过 20 MB', 'BODY_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  assert(size > 0, '请先选择要上传的资料');
  return Buffer.concat(chunks, size);
}

function safeExtension(header) {
  let filename;
  try { filename = decodeURIComponent(header || ''); } catch { assert(false, '文件名编码无效'); }
  assert(filename && filename.length <= 255 && !/[\u0000-\u001f\u007f/\\]/.test(filename), '文件名无效');
  const basename = path.basename(filename.replaceAll('\\', '/'));
  const extension = path.extname(basename).toLowerCase();
  assert(Object.hasOwn(TYPES, extension), '仅支持 PDF、Word、PowerPoint 和 Excel 文件');
  return { extension, basename };
}

function verifyContent(buffer, extension) {
  const isPdf = buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  const isOle = buffer.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  const isZipOffice = buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) && buffer.includes(Buffer.from('[Content_Types].xml'));
  assert(extension === '.pdf' ? isPdf : ['.doc', '.ppt', '.xls'].includes(extension) ? isOle : isZipOffice,
    '文件内容与扩展名不匹配或文件格式不受支持');
}

function createMaterialService({ storeFile, publicOrigin, materialStoreDir }) {
  const directory = path.resolve(materialStoreDir || `${storeFile}.materials`);
  const origin = new URL(publicOrigin).origin;

  async function upload(req, res, actor, store, requestId) {
    assert(req.method === 'POST', '不支持该请求方式', 'METHOD_NOT_ALLOWED', 405);
    assert(/^application\/octet-stream(?:;|$)/i.test(req.headers['content-type'] || ''), '请使用二进制文件上传', 'UNSUPPORTED_MEDIA_TYPE', 415);
    const { extension, basename } = safeExtension(req.headers['x-material-name']);
    const buffer = await readLimited(req);
    verifyContent(buffer, extension);
    ensureDirectory(directory);
    const id = `MAT_${crypto.randomBytes(24).toString('base64url')}`;
    const target = path.join(directory, `${id}${extension}`);
    const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0), 0o600);
    try { fs.writeFileSync(fd, buffer); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    store.audit(actor, 'form.material.upload', 'success', { assetId: id, extension, bytes: buffer.length }, requestId);
    res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Request-Id': requestId, 'Connection': 'close' });
    res.end(JSON.stringify({ id, fileName: basename, url: `${origin}/crm-api/v1/public/formMaterials/${id}` }));
    return true;
  }

  function download(req, res, id, requestId) {
    assert(req.method === 'GET', '不支持该请求方式', 'METHOD_NOT_ALLOWED', 405);
    assert(/^MAT_[A-Za-z0-9_-]{32}$/.test(id), '资料不存在', 'NOT_FOUND', 404);
    try { ensureDirectory(directory, false); } catch { assert(false, '资料不存在', 'NOT_FOUND', 404); }
    const files = fs.readdirSync(directory).filter(name => name.startsWith(id + '.') && Object.hasOwn(TYPES, path.extname(name).toLowerCase()));
    assert(files.length === 1, '资料不存在', 'NOT_FOUND', 404);
    const filename = path.join(directory, files[0]);
    const stat = fs.lstatSync(filename);
    assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= MAX_BYTES, '资料不存在', 'NOT_FOUND', 404);
    const type = TYPES[path.extname(filename).toLowerCase()];
    res.writeHead(200, {
      'Content-Type': type.mime,
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${type.filename}"`,
      'Cache-Control': 'public, max-age=300, immutable',
      'X-Content-Type-Options': 'nosniff',
      'X-Request-Id': requestId,
      'Connection': 'close'
    });
    fs.createReadStream(filename).pipe(res);
    return true;
  }

  return { upload, download, directory };
}

module.exports = { createMaterialService, MAX_BYTES, TYPES, safeExtension, verifyContent };
