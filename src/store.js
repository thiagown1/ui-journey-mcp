import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { digest, id, snapshotSchema } from './schema.js';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const MAX_JSON = 4 * 1024 * 1024;
export function validatePng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 1024 * 1024 || bytes.length < 33 ||
      bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR')
    throw new Error('Invalid or oversized PNG');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || width > 1600 || !height || height > 1200) throw new Error('PNG viewport exceeds limits');
  let offset = 8, hasData = false, ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    if (offset + length + 12 > bytes.length) throw new Error('Truncated PNG');
    if (type === 'IDAT') hasData = true;
    offset += length + 12;
    if (type === 'IEND') { ended = length === 0 && offset === bytes.length; break; }
  }
  if (!hasData || !ended) throw new Error('Incomplete PNG');
  return { width, height };
}
export async function readBounded(file, limit = MAX_JSON) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new Error('Expected a bounded regular file');
  const bytes = await fs.readFile(file);
  if (bytes.length > limit) throw new Error('File grew beyond size limit');
  return bytes;
}
export async function readJson(file) { return JSON.parse((await readBounded(file)).toString('utf8')); }

// Immutable content-addressed records: a completed record never points at a
// partial image. Link is an atomic create-if-absent, including concurrent imports.
async function putImmutable(file, bytes) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, bytes, { flag: 'wx', mode: 0o600 });
  try {
    await fs.link(temp, file);
  } catch (error) {
    if (error.code !== 'EEXIST' || !(await readBounded(file)).equals(bytes)) throw error;
  } finally { await fs.unlink(temp); }
}

export class EvidenceStore {
  constructor(root) { this.root = path.resolve(root); }
  async directory(project, kind, create = false) {
    id.parse(project);
    let current = this.root;
    for (const segment of ['', project, kind].filter(s => s !== undefined)) {
      if (segment) current = path.join(current, segment);
      if (create) await fs.mkdir(current, { recursive: true, mode: 0o700 });
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Store directories must not be symlinks');
    }
    return current;
  }
  async put(input, images = new Map()) {
    const snapshot = snapshotSchema.parse(input);
    const blobDir = await this.directory(snapshot.project, 'images', true);
    for (const obs of snapshot.observations) if (obs.image) {
      const bytes = images.get(obs.image) ?? await readBounded(path.join(blobDir, `${obs.image}.png`), 1024 * 1024);
      const dimensions = validatePng(bytes);
      if (hash(bytes) !== obs.image) throw new Error('Image digest mismatch');
      if (dimensions.width !== snapshot.viewport.width || dimensions.height !== snapshot.viewport.height) throw new Error('Image does not match declared viewport');
      await putImmutable(path.join(blobDir, `${obs.image}.png`), bytes);
    }
    const bytes = Buffer.from(JSON.stringify(snapshot));
    if (bytes.length > MAX_JSON) throw new Error('Snapshot exceeds size limit');
    const recordId = hash(bytes);
    const recordDir = await this.directory(snapshot.project, 'records', true);
    await putImmutable(path.join(recordDir, `${recordId}.json`), bytes);
    return { recordId, ...snapshot };
  }
  async list(project) {
    let dir;
    try { dir = await this.directory(project, 'records'); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const files = (await fs.readdir(dir)).filter(f => /^[a-f0-9]{64}\.json$/.test(f));
    if (files.length > 10000) throw new Error('Store exceeds 10000 records per project; partition or archive it');
    const records = []; let totalBytes = 0;
    for (const file of files.sort()) {
      const bytes = await readBounded(path.join(dir, file));
      totalBytes += bytes.length;
      if (totalBytes > 64 * 1024 * 1024) throw new Error('Project exceeds 64 MiB of snapshot metadata; partition or archive it');
      if (hash(bytes) !== file.slice(0, 64)) throw new Error('Corrupt snapshot digest');
      const record = snapshotSchema.parse(JSON.parse(bytes.toString('utf8')));
      if (record.project !== project) throw new Error('Snapshot project mismatch');
      records.push({ recordId: file.slice(0, 64), ...record });
    }
    return records;
  }
  async image(project, imageDigest) {
    digest.parse(imageDigest);
    const records = await this.list(project);
    if (!records.some(r => r.observations.some(o => o.image === imageDigest))) throw new Error('Image is not referenced by this project');
    const dir = await this.directory(project, 'images');
    const bytes = await readBounded(path.join(dir, `${imageDigest}.png`), 1024 * 1024);
    validatePng(bytes);
    if (hash(bytes) !== imageDigest) throw new Error('Corrupt image digest');
    return bytes;
  }
}
