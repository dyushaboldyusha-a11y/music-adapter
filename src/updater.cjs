const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const REPOSITORY = 'dyushaboldyusha-a11y/music-adapter';
const API_URL = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const MAX_DOWNLOAD = 512 * 1024 * 1024;
const HOSTS = new Set(['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-production-release-asset-2e65be.s3.amazonaws.com']);
function versionParts(value) { const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value || ''); const parts = match?.slice(1).map(Number); return parts?.every(Number.isSafeInteger) ? parts : null; }
function isNewer(candidate, current) {
  const a = versionParts(candidate), b = versionParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function releaseAsset(release, name, version) {
  const asset = release.assets?.find(item => item.name === name && item.state === 'uploaded');
  if (!asset) throw new Error('В релизе пока нет всех файлов обновления. Попробуйте позднее');
  const expected = `https://github.com/${REPOSITORY}/releases/download/${release.tag_name}/${name}`;
  if (asset.browser_download_url !== expected || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_DOWNLOAD) throw new Error('Некорректные файлы GitHub-релиза');
  return { name, url: expected, size: asset.size, version };
}
async function smallBody(response, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of Readable.fromWeb(response.body)) {
    size += chunk.length; if (size > limit) throw new Error('Слишком большой ответ сервера обновлений');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
async function fileHash(filename) { const hash = createHash('sha256'); for await (const chunk of createReadStream(filename)) hash.update(chunk); return hash.digest('hex'); }
async function validateExecutable(filename) {
  const file = await fs.open(filename, 'r');
  try {
    const header = Buffer.alloc(64); const { bytesRead } = await file.read(header, 0, 64, 0);
    if (bytesRead !== 64 || header.toString('ascii', 0, 2) !== 'MZ') throw new Error('Скачанный файл не является Windows-приложением');
    const offset = header.readUInt32LE(60), signature = Buffer.alloc(4);
    if (offset < 64 || offset > 1024 * 1024) throw new Error('Некорректный заголовок обновления');
    await file.read(signature, 0, 4, offset);
    if (!signature.equals(Buffer.from([80, 69, 0, 0]))) throw new Error('Некорректный формат обновления');
  } finally { await file.close(); }
}

class AppUpdater extends EventEmitter {
  constructor({ currentVersion, directory, supported = false, fetch = globalThis.fetch, launchInstaller }) {
    super(); this.directory = directory; this.fetch = fetch; this.launchInstaller = launchInstaller;
    this.state = { phase: 'idle', currentVersion, version: null, supported, downloaded: 0, total: 0, error: null };
    this.release = null; this.readyFile = null; this.controller = null;
  }
  snapshot() { return { ...this.state, ready: !!this.readyFile }; }
  update(changes) { Object.assign(this.state, changes); this.emit('state', this.snapshot()); }
  fail(error) { this.update({ phase: 'error', error: error.message || 'Не удалось получить обновление' }); return { ok: false, error: this.state.error }; }
  busy() { return ['checking', 'downloading', 'installing'].includes(this.state.phase); }
  async request(url, signal) {
    for (let redirects = 0; redirects < 6; redirects++) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !HOSTS.has(parsed.hostname) || parsed.username || parsed.password) throw new Error('Недопустимый адрес сервера обновлений');
      let response;
      try { response = await this.fetch(url, { redirect: 'manual', credentials: 'omit', signal, headers: { 'User-Agent': 'Liberty-Wave', Accept: parsed.hostname === 'api.github.com' ? 'application/vnd.github+json' : 'application/octet-stream' } }); }
      catch { throw new Error(signal?.aborted ? 'Загрузка отменена или истекло время ожидания' : 'Нет соединения с GitHub. Попробуйте позднее'); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location) throw new Error('Некорректный ответ GitHub'); url = new URL(location, url).href; continue;
      }
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(response.status === 403 || response.status === 429 ? 'GitHub временно ограничил запросы. Попробуйте позднее' : 'Не удалось скачать файлы с GitHub'); }
      return response;
    }
    throw new Error('Слишком много перенаправлений GitHub');
  }
  async check() {
    if (this.busy()) return { ok: false, error: 'Обновление уже выполняется' };
    this.update({ phase: 'checking', error: null });
    try {
      const response = await this.request(API_URL, AbortSignal.timeout(20000));
      const release = JSON.parse(await smallBody(response, 2 * 1024 * 1024));
      if (release.draft || release.prerelease || !versionParts(release.tag_name)) throw new Error('GitHub вернул неподходящий релиз');
      if (!isNewer(release.tag_name, this.state.currentVersion)) { this.release = null; this.readyFile = null; this.update({ phase: 'current', version: null }); return { ok: true }; }
      const version = release.tag_name.replace(/^v/, '');
      const exe = releaseAsset(release, `Liberty-Wave-${version}-Windows.exe`, version);
      const sums = releaseAsset(release, 'SHA256SUMS.txt', version);
      if (sums.size > 65536) throw new Error('Некорректный файл контрольных сумм');
      this.release = { version, exe, sums };
      if (this.readyFile?.version !== version) this.readyFile = null;
      this.update({ phase: this.readyFile ? 'ready' : 'available', version, downloaded: 0, total: exe.size }); return { ok: true };
    } catch (error) { return this.fail(error); }
  }
  async download() {
    if (this.busy() || !this.release) return { ok: false, error: 'Сначала проверьте обновления' };
    const release = this.release; let partial;
    this.controller = new AbortController();
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(10 * 60 * 1000)]);
    this.update({ phase: 'downloading', error: null, downloaded: 0, total: release.exe.size });
    try {
      const checksums = await smallBody(await this.request(release.sums.url, signal), 65536);
      const expected = checksums.split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(line)).find(line => line?.[2] === release.exe.name)?.[1]?.toLowerCase();
      if (!expected) throw new Error('В релизе нет контрольной суммы приложения');
      await fs.mkdir(this.directory, { recursive: true });
      partial = path.join(this.directory, `${randomUUID()}.part`);
      const response = await this.request(release.exe.url, signal);
      const hash = createHash('sha256'); let size = 0, lastReport = 0;
      const progress = new Transform({ transform: (chunk, encoding, callback) => {
        size += chunk.length;
        if (size > release.exe.size || size > MAX_DOWNLOAD) { callback(new Error('Размер скачанного обновления не совпадает с релизом')); return; }
        hash.update(chunk);
        if (Date.now() - lastReport > 100) { lastReport = Date.now(); this.update({ downloaded: size }); }
        callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(partial, { flags: 'wx' }), { signal });
      if (size !== release.exe.size || hash.digest('hex') !== expected) throw new Error('Контрольная сумма обновления не совпала. Установка отменена');
      await validateExecutable(partial);
      const filename = path.join(this.directory, `Liberty-Wave-${release.version}-${randomUUID()}.exe`);
      await fs.rename(partial, filename); partial = null;
      if (this.readyFile) await fs.rm(this.readyFile.filename, { force: true });
      this.readyFile = { filename, sha256: expected, version: release.version };
      this.update({ phase: 'ready', downloaded: size }); return { ok: true };
    } catch (error) { return this.fail(signal.aborted ? new Error('Загрузка отменена или истекло время ожидания') : error); }
    finally { if (partial) await fs.rm(partial, { force: true }).catch(() => {}); this.controller = null; }
  }
  cancel() { this.controller?.abort(); }
  async install() {
    if (this.busy() || !this.readyFile) return { ok: false, error: 'Сначала скачайте обновление' };
    if (!this.state.supported || !this.launchInstaller) return { ok: false, error: 'Установка доступна в переносимой Windows-версии Liberty Wave' };
    this.update({ phase: 'installing', error: null });
    try {
      let valid = false;
      try { valid = await fileHash(this.readyFile.filename) === this.readyFile.sha256; } catch {}
      if (!valid) {
        const invalid = this.readyFile; this.readyFile = null;
        await fs.rm(invalid.filename, { force: true }).catch(() => {});
        throw new Error('Скачанный файл изменился. Скачайте обновление заново');
      }
      await this.launchInstaller({ ...this.readyFile }); return { ok: true };
    } catch (error) { return this.fail(error); }
  }
  stop() { this.cancel(); }
}
module.exports = { AppUpdater, API_URL, isNewer, fileHash };
