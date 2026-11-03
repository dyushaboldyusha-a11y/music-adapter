const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createReadStream, createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const { Readable } = require('node:stream');
const assets = require('../build/voice-assets.json');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'artifacts/voice-runtime'), cache = path.join(root, 'artifacts/voice-downloads');
async function hash(filename) { const hash = createHash('sha256'); for await (const bytes of createReadStream(filename)) hash.update(bytes); return hash.digest('hex'); }
async function download(asset) {
  const filename = path.join(cache, asset.name + '.zip');
  try { if (await hash(filename) === asset.sha256) return filename; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = filename + '.' + randomUUID() + '.part';
  try {
    console.log('Downloading verified voice component:', asset.name);
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok || new URL(response.url).protocol !== 'https:') throw Error(`Voice download failed: ${asset.name}, HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }));
    if (await hash(temporary) !== asset.sha256) throw Error('Voice checksum mismatch: ' + asset.name);
    await fs.rename(temporary, filename); return filename;
  } finally { await fs.rm(temporary, { force: true }); }
}
async function main() {
  const runtimes = process.argv.includes('--with-linux') ? ['win-x64', 'linux-x64'] : ['win-x64'];
  const selected = ['model', 'model-en', ...runtimes];
  await fs.mkdir(cache, { recursive: true });
  const stage = path.join(root, 'artifacts/.voice-stage-' + randomUUID());
  await fs.mkdir(stage);
  try {
    const { default: extract } = await import('@electron-internal/extract-zip');
    for (const key of selected) {
      const asset = assets[key], filename = await download(asset), unpack = path.join(stage, 'unpack-' + key);
      await extract(filename, { dir: unpack });
      const from = path.join(unpack, asset.name), destination = path.join(stage, key);
      if (key.startsWith('model')) await fs.rename(from, destination);
      else {
        await fs.mkdir(destination);
        for (const name of await fs.readdir(from)) if (/\.(dll|so)$/.test(name)) await fs.copyFile(path.join(from, name), path.join(destination, name));
      }
      await fs.rm(unpack, { recursive: true });
    }
    await fs.cp(path.join(root, 'licenses/voice'), path.join(stage, 'licenses'), { recursive: true });
    await fs.copyFile(path.join(root, 'src/shared/voice-commands.json'), path.join(stage, 'commands.json'));
    for (const relative of ['model/am/final.mdl', 'model/graph/HCLr.fst', 'model/graph/Gr.fst', 'model-en/am/final.mdl', 'win-x64/libvosk.dll']) await fs.access(path.join(stage, relative));
    const manifest = { format: 'liberty-wave-voice-runtime', version: 1, assets: Object.fromEntries(selected.map(key => [key, assets[key]])) };
    await fs.writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));
    try {
      const old = JSON.parse(await fs.readFile(path.join(output, 'manifest.json'), 'utf8'));
      if (old.format !== manifest.format) throw Error('Refusing to overwrite an unknown voice directory');
      await fs.rm(output, { recursive: true });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rename(stage, output);
    console.log('PASS: offline Russian/English models, command catalog, native libraries and licenses prepared:', output);
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
