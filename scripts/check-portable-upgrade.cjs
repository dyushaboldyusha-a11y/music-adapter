const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { createHash, randomUUID } = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { chromium } = require('playwright');
const run = promisify(execFile), root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts/upgrade-061-062');
const repository = 'dyushaboldyusha-a11y/music-adapter';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function poll(label, read, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await read(); if (value) return value; await sleep(200); }
  throw Error('Timeout: ' + label);
}
async function json(filename) { try { return JSON.parse((await fs.readFile(filename, 'utf8')).replace(/^\uFEFF/, '')); } catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; } }
async function exists(filename) { try { await fs.stat(filename); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function hash(filename) { const value = createHash('sha256'); for await (const bytes of createReadStream(filename)) value.update(bytes); return value.digest('hex'); }
async function freePort() { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
async function state(panel, predicate) {
  return poll('application state', async () => {
    const value = await panel.evaluate(() => libertyControl.getState());
    if (value.updates?.phase === 'error') throw Error(value.updates.error);
    return predicate(value) ? value : null;
  }, 180000);
}
async function launch(executable) {
  const port = await freePort();
  const child = spawn(executable, [`--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1', '--disable-gpu'], { stdio: 'ignore' });
  child.on('error', error => { child.launchError = error; });
  await poll('portable application debugging endpoint', async () => {
    if (child.launchError) throw child.launchError;
    if (child.exitCode !== null) throw Error(`Portable launcher exited (${child.exitCode})`);
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) })).ok; } catch { return false; }
  });
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const panel = await poll('desktop control window', async () => browser.contexts().flatMap(context => context.pages()).find(page => page.url().endsWith('/control/index.html')));
  await panel.waitForFunction(() => !!window.libertyControl, null, { polling: 50 });
  return { child, browser, panel };
}
async function quit(instance) {
  await instance.panel.evaluate(() => libertyControl.action('quit')).catch(() => {});
  await poll('portable launcher exit', async () => instance.child.exitCode !== null, 30000);
  await instance.browser.close().catch(() => {});
}
async function download(panel) {
  await panel.locator('[data-page="updates"]').click();
  await panel.locator('#update-check').click();
  const available = await state(panel, value => value.updates.phase === 'available');
  assert.equal(available.updates.version, '0.6.2');
  await panel.locator('#update-download').click();
  await state(panel, value => value.updates.phase === 'ready');
}
(async () => {
  assert.equal(process.platform, 'win32', 'Full portable upgrades require Windows');
  await fs.mkdir(output, { recursive: true });
  const assets = {};
  for (const version of ['0.6.1', '0.6.2']) {
    const directory = path.join(output, 'assets', version), name = `Liberty-Wave-${version}-Windows.exe`;
    await fs.mkdir(directory, { recursive: true });
    await run('gh', ['release', 'download', `v${version}`, '--repo', repository, '--pattern', name, '--pattern', 'SHA256SUMS.txt', '--dir', directory], { timeout: 180000 });
    const lines = (await fs.readFile(path.join(directory, 'SHA256SUMS.txt'), 'utf8')).split(/\r?\n/).map(line => /^([a-f0-9]{64})\s+\*?(.+?)\s*$/i.exec(line));
    const expected = lines.find(line => line?.[2] === name)?.[1];
    assert.ok(expected, 'Official checksum must exist');
    const filename = path.join(directory, name); assert.equal(await hash(filename), expected);
    assets[version] = { filename, sha256: expected, size: (await fs.stat(filename)).size };
  }
  const profile = path.join(process.env.APPDATA, 'music-adapter'), marker = path.join(profile, '.upgrade-test-owner');
  assert.equal(await exists(profile), false, 'Do not touch an existing application profile');
  const owner = randomUUID(), fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'liberty-five-upgrades-'));
  const specPath = path.join(fixture, 'processes.json'), helper = path.join(__dirname, 'portable-process.ps1');
  const report = { from: '0.6.1', to: '0.6.2', assets, scenarios: [], complete: false };
  const scenarios = [
    { name: 'normal', compact: false, scale: 1, color: '#ffffff' },
    { name: 'compact', compact: true, scale: 1, color: '#fff5dc' },
    { name: 'half-scale', compact: false, scale: .5, color: '#ffffff' },
    { name: 'unicode-path', folder: 'Загрузки с пробелами', compact: false, scale: 1.25, color: '#22d3ee' },
    { name: 'cached-retry', compact: true, scale: .75, color: '#ffffff', retry: true }
  ];
  const writeReport = () => fs.writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  try {
    for (const [index, scenario] of scenarios.entries()) {
      const result = { name: scenario.name, pass: false }; report.scenarios.push(result);
      let current, old;
      const directory = path.join(fixture, scenario.folder || scenario.name), target = path.join(directory, 'Liberty-Wave-0.6.1-Windows.exe'), replacement = path.join(directory, 'Liberty-Wave-0.6.2-Windows.exe');
      await fs.mkdir(directory); await fs.copyFile(assets['0.6.1'].filename, target);
      await fs.mkdir(profile, { recursive: true }); await fs.writeFile(marker, owner);
      const preferences = { compact: scenario.compact, scale: scenario.scale, color: scenario.color, nickname: `Upgrade${index + 1}`, shortcuts: { toggleInteraction: 'Num3' } };
      await fs.writeFile(path.join(profile, 'widget.json'), JSON.stringify(preferences));
      await fs.writeFile(specPath, JSON.stringify({ paths: [target, replacement], target: replacement, profile }));
      const probe = async cleanup => {
        const response = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-SpecPath', specPath, ...(cleanup ? ['-Cleanup'] : [])], { encoding: 'utf8', timeout: 30000 });
        return cleanup ? null : JSON.parse(response.stdout.replace(/^\uFEFF/, '').trim() || 'null');
      };
      const cache = path.join(profile, 'updates');
      const cachedExecutables = async () => (await fs.readdir(cache)).filter(name => /^Liberty-Wave-0\.6\.2-[a-f0-9-]+\.exe$/i.test(name));
      try {
        old = current = await launch(target);
        assert.equal((await current.panel.evaluate(() => libertyControl.getState())).version, '0.6.1');
        await download(current.panel);
        let files = await cachedExecutables(); assert.equal(files.length, 1);
        const downloaded = path.join(cache, files[0]); assert.equal(await hash(downloaded), assets['0.6.2'].sha256);
        if (scenario.retry) {
          const modified = (await fs.stat(downloaded)).mtimeMs;
          await quit(current); current = await launch(target);
          await download(current.panel); files = await cachedExecutables();
          assert.deepEqual(files, [path.basename(downloaded)]); assert.equal((await fs.stat(downloaded)).mtimeMs, modified);
          result.cacheReusedAfterRestart = true;
        }
        await current.panel.screenshot({ path: path.join(output, `${index + 1}-before-install.png`) });
        await current.panel.locator('#update-install').click();
        const status = await poll('successful installation status', async () => {
          const value = await json(path.join(cache, 'last-install.json'));
          if (['failed', 'launch-failed'].includes(value?.phase)) throw Error(value.error);
          return value?.ok === true ? value : null;
        }, 120000);
        assert.equal(status.newPath.toLowerCase(), replacement.toLowerCase());
        await poll('old executable removal', async () => !await exists(target));
        assert.equal(await hash(replacement), assets['0.6.2'].sha256);
        result.automaticRelaunch = await poll('automatically relaunched 0.6.2 main process with visible window', () => probe(false), 90000);
        await sleep(1000);
        assert.equal((await probe(false))?.mainPid, result.automaticRelaunch.mainPid, 'New application must remain running');
        await poll('staged and backup file cleanup', async () => !(await fs.readdir(directory)).some(name => /\.(pending|backup)\.exe$/i.test(name)) && !await exists(downloaded));
        // Automatic restart is already proven above. Reopen with a test-only CDP
        // flag to inspect the actual updated UI and persisted settings as well.
        await probe(true); await current.browser.close().catch(() => {}); await sleep(750);
        current = await launch(replacement);
        const updated = await current.panel.evaluate(() => libertyControl.getState());
        assert.equal(updated.version, '0.6.2');
        for (const key of ['compact', 'scale', 'color', 'nickname']) assert.equal(updated.preferences[key], preferences[key], key);
        assert.equal(updated.shortcuts.bindings.toggleInteraction, 'num3');
        const widget = current.browser.contexts().flatMap(context => context.pages()).find(page => page.url().endsWith('/renderer/index.html'));
        await widget.waitForFunction(compact => document.body.classList.contains('locked') && document.body.classList.contains('compact') === compact, scenario.compact, { polling: 50 });
        const viewport = await widget.evaluate(() => { const card = document.getElementById('widget').getBoundingClientRect(); return { width: innerWidth, height: innerHeight, right: card.right, bottom: card.bottom }; });
        assert.ok(Math.abs(viewport.width - (scenario.compact ? 500 : 620)) <= 2 && Math.abs(viewport.height - (scenario.compact ? 144 : 270)) <= 2, JSON.stringify(viewport));
        assert.ok(viewport.right <= viewport.width + 1 && viewport.bottom <= viewport.height + 1);
        await current.panel.screenshot({ path: path.join(output, `${index + 1}-updated.png`) });
        await quit(current); current = null;
        result.viewport = viewport; result.settingsPreserved = true; result.sameFolderVersionedReplacement = true; result.cacheAndStagingCleaned = true; result.sha256 = assets['0.6.2'].sha256; result.pass = true;
        console.log(`PASS ${index + 1}/5: ${scenario.name} — real 0.6.1 portable app, download, install, automatic visible 0.6.2 restart, settings and cleanup.`);
      } catch (error) {
        result.error = error.stack || String(error); console.error(`FAIL ${index + 1}/5: ${scenario.name}: ${result.error}`);
        for (const name of ['last-install.json', 'installer-start.log', 'installer-ready.json']) {
          try { await fs.copyFile(path.join(cache, name), path.join(output, `${index + 1}-${name.replace('.json', '.log')}`)); } catch {}
        }
      } finally {
        await probe(true).catch(error => { result.cleanupError = error.message; });
        await current?.browser.close().catch(() => {}); await old?.browser.close().catch(() => {});
        assert.equal(await fs.readFile(marker, 'utf8'), owner, 'Only remove the test-owned profile');
        await fs.rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
        await writeReport();
      }
    }
    report.complete = true; await writeReport();
    assert.equal(report.scenarios.filter(item => item.pass).length, 5, 'Every portable upgrade must pass');
  } finally {
    await writeReport(); await fs.rm(fixture, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
