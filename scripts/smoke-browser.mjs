import { chromium, _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { pressGlobalKeys } from './send-global-keys.mjs';
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const { services } = require('../browser-extension/services.js');
const appProfile = await mkdtemp(join(tmpdir(), 'liberty-app-'));
const chromeProfile = await mkdtemp(join(tmpdir(), 'liberty-chrome-'));
const extension = join(root, 'browser-extension');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQ0AAAAASUVORK5CYII=';
const wav = Buffer.alloc(44 + 8000 * 60); wav.fill(128, 44);
wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const audioUrl = 'data:audio/wav;base64,' + wav.toString('base64');
let app, browser;
async function waitState(widget, predicate, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const state = await widget.evaluate(() => musicWidget.getState()); if (predicate(state)) return state; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('Desktop player state did not reach the expected value.');
}
try {
  app = await _electron.launch({ executablePath: require('electron'), args: [root, '--disable-gpu', `--user-data-dir=${appProfile}`], timeout: 30000 });
  const widget = await app.firstWindow();
  await widget.waitForFunction(() => !!window.musicWidget);
  await waitState(widget, state => state.browserAvailable === true);
  if (!(await widget.evaluate(() => musicWidget.getState())).interaction) await widget.evaluate(() => musicWidget.toggleInteraction());
  await waitState(widget, state => state.interaction === true);
  await widget.evaluate(() => musicWidget.openShortcuts());
  await waitState(widget, state => state.shortcutEditing);
  assert.equal((await widget.evaluate(() => musicWidget.saveShortcuts({ toggleInteraction: 'F8', playPause: 'F9', next: 'F10', previous: 'F11', volumeUp: 'F5', volumeDown: 'F6', mute: 'F7' }))).ok, true);
  browser = await chromium.launchPersistentContext(chromeProfile, { channel: 'chromium', headless: false, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  const popup = await browser.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const pair = await widget.evaluate(() => musicWidget.beginPairing());
  assert.equal(pair.ok, true);
  await popup.locator('#code').fill(pair.code);
  await popup.locator('#pair button').click();
  try { await popup.locator('#pair').waitFor({ state: 'hidden', timeout: 10000 }); }
  catch { throw new Error('Extension pairing failed: ' + await popup.locator('#status').textContent()); }
  await widget.locator('#close-pair').click();
  const pages = [];
  for (const service of services) {
    const page = await browser.newPage();
    const title = `Fixture ${service.id}`;
    const html = `<!doctype html><html><body><h1>${title}</h1><button id="start">Play</button><div class="audio_page_player_cover" style="background-image:url('${png}')"></div><script>
      window.testActions=[];
      const vk=${service.id === 'vk'};
      const metadata=(suffix='')=>{navigator.mediaSession.metadata=new MediaMetadata({title:${JSON.stringify(title)}+suffix,artist:'Fixture Artist',artwork:vk?[]:[{src:${JSON.stringify(png)}}]});};
      metadata();
      if(!vk){
      navigator.mediaSession.playbackState='playing';
      navigator.mediaSession.setPositionState({duration:258,position:84});
      navigator.mediaSession.setActionHandler('pause',()=>{window.testActions.push('pause');navigator.mediaSession.playbackState='paused';});
      navigator.mediaSession.setActionHandler('play',()=>{window.testActions.push('play');navigator.mediaSession.playbackState='playing';});
      navigator.mediaSession.setActionHandler('nexttrack',()=>{window.testActions.push('next');metadata(' next');});
      navigator.mediaSession.setActionHandler('previoustrack',()=>{window.testActions.push('previous');metadata();});
      navigator.mediaSession.setActionHandler('seekto',event=>{window.testActions.push('seek:'+event.seekTime);navigator.mediaSession.setPositionState({duration:258,position:event.seekTime});});
      }else{
        const audio=window.fixtureAudio=new Audio(${JSON.stringify(audioUrl)});
        audio.addEventListener('pause',()=>window.testActions.push('pause'));
        audio.addEventListener('seeked',()=>window.testActions.push('seek:'+Math.round(audio.currentTime)));
        document.getElementById('start').onclick=()=>audio.play();
        window.fixtureVKPlayer={getCurrentAudio:()=>{const a=[];a[3]=navigator.mediaSession.metadata.title;a[4]='Fixture Artist';a[5]=audio.duration||60;a[14]=${JSON.stringify(png)};return a;},getCurrentProgress:()=>audio.currentTime/(audio.duration||60),isPlaying:()=>!audio.paused,play:()=>audio.play(),pause:()=>audio.pause(),playNext:()=>{window.testActions.push('next');metadata(' next');audio.currentTime=0;},playPrev:()=>{metadata();audio.currentTime=0;},seek:ratio=>{audio.currentTime=ratio*audio.duration;}};
      }
    </script></body></html>`;
    await page.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await page.goto(service.url);
    if (service.id === 'vk') { await page.locator('#start').click(); await page.waitForFunction(() => window.fixtureAudio.readyState >= 3 && !window.fixtureAudio.paused); }
    pages.push(page);
    const state = await waitState(widget, s => s.sources?.some(source => source.provider === service.id && source.id.startsWith('web:')));
    const selected = state.sources.find(source => source.provider === service.id && source.id.startsWith('web:'));
    const result = await widget.evaluate(id => musicWidget.selectSource(id), selected.id);
    assert.equal(result.ok, true);
    await widget.waitForFunction(expected => document.getElementById('title').textContent === expected, title);
    await widget.waitForFunction(() => document.getElementById('artwork').naturalWidth === 1 && !document.getElementById('artwork').hidden);
    if (['spotify', 'vk'].includes(service.id)) {
      await waitState(widget, s => s.duration > 0 && s.playing);
      let previous = Number(await widget.locator('#seek').inputValue()); const first = previous;
      for (let i = 0; i < 12; i++) { await new Promise(resolve => setTimeout(resolve, 200)); const position = Number(await widget.locator('#seek').inputValue()); assert.ok(position >= previous - .01, `${service.id}: backward progress jump`); previous = position; }
      assert.ok(previous - first > 1.5 && previous - first < 4, `${service.id}: playback clock drift`);
    }
    await widget.locator('#play-pause').click();
    await page.waitForFunction(() => window.testActions.includes('pause'), null, { timeout: 15000 });
    await waitState(widget, s => !s.playing);
    const pausedPosition = await widget.locator('#seek').inputValue(); await new Promise(resolve => setTimeout(resolve, 500)); assert.equal(await widget.locator('#seek').inputValue(), pausedPosition);
    if (service.id === 'vk') { await page.evaluate(() => { window.getAudioPlayer = () => window.fixtureVKPlayer; }); await widget.locator('#next').waitFor({ state: 'visible' }); }
    await widget.locator('#next').click();
    await widget.waitForFunction(expected => document.getElementById('title').textContent === expected, title + ' next', { timeout: 15000 });
    const seek = await widget.evaluate(() => musicWidget.command('seek', 42));
    assert.equal(seek.ok, true);
    await page.waitForFunction(() => window.testActions.includes('seek:42'));
    if (service.id !== 'vk') await page.evaluate(async url => { const audio = window.fixtureAudio = new Audio(url); await audio.play(); audio.pause(); }, audioUrl);
    await page.evaluate(() => { window.fixtureAudio.volume = .6; });
    await waitState(widget, s => s.capabilities.volume && Math.abs(s.volume - .6) < .001);
    await widget.locator('#volume').evaluate(el => { el.value = 30; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
    await page.waitForFunction(() => Math.abs(window.fixtureAudio.volume - .3) < .001);
    await waitState(widget, s => Math.abs(s.volume - .3) < .001);
    await widget.locator('#mute').click(); await page.waitForFunction(() => window.fixtureAudio.muted);
    await waitState(widget, s => s.muted);
    await widget.locator('#mute').click(); await page.waitForFunction(() => !window.fixtureAudio.muted);
    await waitState(widget, s => !s.muted);
  }
  const button = widget.locator('#play-pause');
  const box = await button.boundingBox();
  await widget.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await widget.evaluate(() => musicWidget.toggleInteraction());
  await widget.waitForFunction(() => document.body.classList.contains('locked'));
  await widget.mouse.move(1, 1); await widget.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await widget.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const visual = await button.evaluate(el => ({ transform: getComputedStyle(el).transform, pointerEvents: getComputedStyle(el).pointerEvents, inert: el.closest('main').inert }));
  assert.equal(visual.transform, 'none'); assert.equal(visual.pointerEvents, 'none'); assert.equal(visual.inert, true);
  assert.equal((await widget.evaluate(() => musicWidget.selectSource('auto'))).ok, false);
  await pages.at(-1).bringToFront();
  await pressGlobalKeys(['F9']); await waitState(widget, s => s.playing && !s.interaction);
  assert.equal(await pages.at(-1).evaluate(() => window.fixtureAudio.paused), false);
  await pressGlobalKeys(['F9']); await waitState(widget, s => !s.playing && !s.interaction);
  await pressGlobalKeys(['F5']); await waitState(widget, s => Math.abs(s.volume - .35) < .001 && !s.interaction);
  await pressGlobalKeys(['F6']); await waitState(widget, s => Math.abs(s.volume - .3) < .001 && !s.interaction);
  await pressGlobalKeys(['F7']); await waitState(widget, s => s.muted && !s.interaction);
  await pressGlobalKeys(['F7']); await waitState(widget, s => !s.muted && !s.interaction);
  for (const page of pages.slice(0, -1)) assert.equal(await page.evaluate(() => Math.round(window.fixtureAudio.volume * 100)), 30, 'Global volume must not affect another tab');
  const backgroundCounts = await Promise.all(pages.slice(0, -1).map(page => page.evaluate(() => window.testActions.filter(action => action === 'next').length)));
  await pressGlobalKeys(['F11']); await waitState(widget, s => s.title === 'Fixture vk' && !s.interaction);
  await pressGlobalKeys(['F10']); await waitState(widget, s => s.title === 'Fixture vk next' && !s.interaction);
  assert.deepEqual(await Promise.all(pages.slice(0, -1).map(page => page.evaluate(() => window.testActions.filter(action => action === 'next').length))), backgroundCounts);
  await pressGlobalKeys(['F8']); await waitState(widget, s => s.interaction);
  await pages.at(-1).close();
  await waitState(widget, s => !s.connected);
  await widget.evaluate(() => musicWidget.selectSource('auto'));
  await waitState(widget, s => s.connected);
  console.log('PASS: Chromium MV3 ↔ Electron, five service fixtures, stable playback time, paused clock, detached VK Audio, cover transport, VK next/seek, exact routing, global playback hotkeys with VK tab focused and pinned mouse controls.');
} finally {
  await browser?.close(); await app?.close();
  await rm(appProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); await rm(chromeProfile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
