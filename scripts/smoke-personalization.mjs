import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const root = resolve(import.meta.dirname, '..'), require = createRequire(import.meta.url);
const profile = await mkdtemp(join(tmpdir(), 'liberty-personalization-'));
let app;
async function waitState(panel, predicate) { const end = Date.now() + 12000; let last; while (Date.now() < end) { last = await panel.evaluate(() => libertyControl.getState()); if (predicate(last)) return last; await new Promise(resolve => setTimeout(resolve, 50)); } throw Error('Personalization state timeout: ' + JSON.stringify(last?.preferences)); }
try {
  app = await _electron.launch({ executablePath: require('electron'), args: [root, '--disable-gpu', `--user-data-dir=${profile}`] });
  let panel; const deadline = Date.now() + 12000;
  while (!panel && Date.now() < deadline) { panel = app.windows().find(p => p.url().endsWith('/control/index.html')); if (!panel) await new Promise(resolve => setTimeout(resolve,50)); }
  assert.ok(panel); await panel.waitForFunction(() => window.libertyControl && document.getElementById('nickname'), null, { polling: 50, timeout: 12000 });
  await panel.waitForFunction(() => document.visibilityState === 'visible', null, { polling: 50, timeout: 12000 });
  const widget = app.windows().find(p => p.url().endsWith('/renderer/index.html'));
  const errors = []; panel.on('pageerror', e => errors.push(e.message)); widget.on('pageerror', e => errors.push(e.message));
  const action = (name, value) => panel.evaluate(({name,value}) => libertyControl.action(name,value), {name,value});
  assert.equal((await action('preferences', { nickname: 'a'.repeat(13) })).ok, false);
  await panel.locator('#nickname').fill('Свободен1234'); await panel.locator('#nickname-form button').click();
  await waitState(panel, s => s.preferences.nickname === 'Свободен1234');
  await widget.waitForFunction(() => document.querySelector('.signature').textContent === 'Свободен1234', null, { polling: 50, timeout: 12000 });
  const blue = await app.evaluate(({nativeImage}) => { const pixels = Buffer.alloc(16*16*4); for(let i=0;i<pixels.length;i+=4){pixels[i]=230;pixels[i+1]=60;pixels[i+2]=20;pixels[i+3]=255;} return nativeImage.createFromBitmap(pixels,{width:16,height:16}).toDataURL(); });
  const pair = await action('pair'); assert.equal(pair.ok, true);
  const base = 'http://127.0.0.1:16837';
  const request = async (path, body, token) => { const response = await fetch(base + path, { method:'POST', headers:{'Content-Type':'application/json', ...(token?{Authorization:`Bearer ${token}`}:{})}, body:JSON.stringify(body) }); return { status:response.status, data:await response.json() }; };
  const clientId = 'personalization-test-client';
  const paired = await request('/v1/pair',{clientId,code:pair.code,browser:'Chrome'}); assert.equal(paired.status,200); const token = paired.data.token;
  let playing = true;
  const sync = () => request('/v1/sync',{clientId,sources:[{tabId:51,url:'https://open.spotify.com/',title:'Blue track',artist:'Test artist',artwork:blue,playing,duration:180,position:20,capabilities:{playPause:true}}, {tabId:52,url:'https://youtube.com/',title:'Other tab',artist:'Other artist',playing:false,duration:120,position:1,capabilities:{playPause:true}}]},token);
  await sync(); await waitState(panel,s=>s.connected); await action('source',`web:${clientId}:51`);
  await panel.locator('[data-page="appearance"]').click();
  await panel.locator('#color-mode').selectOption('artwork');
  const automatic = await waitState(panel,s=>s.preferences.colorMode==='artwork' && s.effectiveColor!==s.preferences.color);
  assert.equal(automatic.preferences.color,'#ff3045');
  assert.ok(parseInt(automatic.effectiveColor.slice(5,7),16)>parseInt(automatic.effectiveColor.slice(1,3),16));
  await widget.waitForFunction(color=>getComputedStyle(document.documentElement).getPropertyValue('--red').trim()===color,automatic.effectiveColor,{polling:50,timeout:12000});
  await panel.locator('#color-mode').selectOption('manual'); await waitState(panel,s=>s.effectiveColor==='#ff3045');
  for (const compact of [false,true]) {
    await action('preferences',{compact});
    for (const [id,selector] of [['show-artwork','.cover'],['show-artist','#artist'],['show-time','.times']]) {
      await panel.locator('#'+id).uncheck(); await widget.locator(selector).waitFor({state:'hidden'});
      await panel.locator('#'+id).check();
      await widget.locator(selector).waitFor({state:'visible'});
    }
  }
  await action('preferences',{compact:false});
  await panel.locator('[data-page="home"]').click();
  await panel.locator('#snap-enabled').check(); await panel.locator('#edge-margin').fill('24'); await panel.locator('#edge-margin').press('Tab');
  const displays = (await panel.evaluate(()=>libertyControl.getState())).displays;
  await panel.locator('#monitor').selectOption(displays[0].id); await waitState(panel,s=>s.preferences.edgeMargin===24 && s.preferences.monitor===displays[0].id);
  const transferFile = join(profile,'settings-export.json');
  await app.evaluate(({dialog},filename)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:filename});dialog.showOpenDialog=async()=>({canceled:false,filePaths:[filename]});},transferFile);
  await panel.locator('#settings-export').click(); await panel.waitForFunction(()=>document.getElementById('transfer-status').textContent.includes('сохранены'),null,{polling:50,timeout:12000});
  const exported = JSON.parse(await readFile(transferFile,'utf8')); assert.equal(exported.preferences.nickname,'Свободен1234'); assert.ok(!JSON.stringify(exported).includes(token));
  await action('preferences',{nickname:'Другой',color:'#438bff',showTime:false});
  await panel.locator('#settings-import').click(); await waitState(panel,s=>s.preferences.nickname==='Свободен1234' && s.preferences.color==='#ff3045' && s.preferences.showTime);
  await writeFile(transferFile,JSON.stringify({ ...exported,preferences:{...exported.preferences,nickname:'a'.repeat(13)}}));
  assert.equal((await action('import')).ok,false); assert.equal((await panel.evaluate(()=>libertyControl.getState())).preferences.nickname,'Свободен1234');
  // A meter belonging to a different tab must not animate the selected song.
  await request('/v1/level',{clientId,tabId:52,available:true,level:.95},token);
  assert.equal((await panel.evaluate(()=>libertyControl.getState())).audio.available,false);
  await new Promise(resolve=>setTimeout(resolve,25));
  await request('/v1/level',{clientId,tabId:51,available:true,level:.42},token);
  await waitState(panel,s=>s.audio.level===.42);
  assert.equal((await request('/v1/level',{clientId,tabId:51,available:true,level:.9},'wrong-token')).status,401);
  // The minimum real delay is five seconds; keep the paired source alive.
  await action('preferences',{autoHide:true,autoHideDelay:5}); await action('interaction',false);
  playing=false; await sync(); const heartbeat=setInterval(()=>sync().catch(()=>{}),1000);
  try {
    await waitState(panel,s=>s.autoHidden);
    await new Promise(resolve=>setTimeout(resolve,300));
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')).isVisible()),false);
    assert.equal((await panel.evaluate(()=>libertyControl.getState())).audio.available,false);
    playing=true; await sync(); await waitState(panel,s=>!s.autoHidden);
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().endsWith('/renderer/index.html')).isVisible()),true);
    assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getFocusedWindow()?.webContents.getURL().endsWith('/control/index.html')),true,'Playback must not steal focus');
  } finally { clearInterval(heartbeat); }
  await mkdir(join(root,'artifacts'),{recursive:true}); await panel.screenshot({path:join(root,'artifacts/personalization-home.png')});
  await panel.locator('[data-page="appearance"]').click(); await panel.screenshot({path:join(root,'artifacts/personalization-appearance.png')});
  assert.deepEqual(errors,[]);
  await app.close(); app=null;
  const saved=JSON.parse(await readFile(join(profile,'widget.json'),'utf8')); assert.equal(saved.nickname,'Свободен1234'); assert.equal(saved.autoHide,true); assert.equal(saved.edgeMargin,24);
  console.log('PASS: nickname, artwork colors/manual palette, full/compact constructor, monitor/margin, export/import and invalid-file rollback, exact-tab audio routing, real fade/hide/resume, focus and persistence.');
} finally { await app?.close(); await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100}); }
