import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { pressGlobalKeys } from './send-global-keys.mjs';
const require = createRequire(import.meta.url), { BrowserBridge } = require('../src/browser-bridge.cjs');
const root = resolve(import.meta.dirname, '..'), profile = await mkdtemp(join(tmpdir(),'liberty-tab-wave-'));
const bridge = new BrowserBridge(); let browser;
const levels = []; bridge.on('level', value => levels.push({ ...value, received: Date.now() }));
const wait = async predicate => { const end = Date.now()+12000; while(Date.now()<end){if(await predicate()) return; await new Promise(r=>setTimeout(r,50));} throw Error('Music tab capture did not reach expected state'); };
try {
  await bridge.start();
  const extension = join(profile,'extension'); await cp(join(root,'browser-extension'),extension,{recursive:true});
  // Test-only keyboard invocation grants activeTab exactly like clicking the
  // toolbar action. No additional shortcut is installed in the shipped extension.
  const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
  manifest.commands={_execute_action:{suggested_key:{default:'Ctrl+Shift+Y'}}};
  await writeFile(join(extension,'manifest.json'),JSON.stringify(manifest));
  browser = await chromium.launchPersistentContext(profile,{channel:'chromium',headless:false,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=browser.serviceWorkers()[0]||await browser.waitForEvent('serviceworker'), id=new URL(worker.url()).host;
  const popup=await browser.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.locator('#code').fill(bridge.beginPairing().code); await popup.locator('#pair button').click(); await popup.locator('#pair').waitFor({state:'hidden'}); await popup.close();
  const music=await browser.newPage();
  await music.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><button id="start">Play music</button><script>document.getElementById('start').onclick=async()=>{window.audioContext=new AudioContext();window.oscillator=audioContext.createOscillator();const gain=audioContext.createGain();gain.gain.value=.15;oscillator.connect(gain).connect(audioContext.destination);oscillator.start();await audioContext.resume();navigator.mediaSession.metadata=new MediaMetadata({title:'Captured music',artist:'Fixture'});navigator.mediaSession.playbackState='playing';navigator.mediaSession.setActionHandler('pause',()=>{});};</script>`}));
  await music.goto('https://open.spotify.com/'); await music.locator('#start').click();
  await wait(()=>bridge.sources().some(s=>s.title==='Captured music'));
  await music.bringToFront();
  await pressGlobalKeys(['Control_L','Shift_L','y']);
  const cdp = await browser.browser().newBrowserCDPSession();
  let target; await wait(async()=>{target=(await cdp.send('Target.getTargets')).targetInfos.find(t=>t.url===`chrome-extension://${id}/popup.html`);return !!target;});
  // Chrome action popups are excluded from Playwright's normal page collection.
  // Attach to the actual popup and dispatch a trusted mouse click through CDP.
  const {sessionId}=await cdp.send('Target.attachToTarget',{targetId:target.targetId,flatten:false});
  let commandId=0; const pending=new Map();
  cdp.on('Target.receivedMessageFromTarget',event=>{if(event.sessionId!==sessionId)return;const message=JSON.parse(event.message);if(message.id){const item=pending.get(message.id);if(item){pending.delete(message.id);message.error?item.reject(Error(message.error.message)):item.resolve(message.result);}}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++commandId,timer=setTimeout(()=>{pending.delete(id);reject(Error('Popup CDP command timed out: '+method));},10000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});cdp.send('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})}).catch(error=>{clearTimeout(timer);pending.delete(id);reject(error);});});
  const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true})).result.value;
  await wait(()=>evaluate('!!document.getElementById("wave-start") && !document.getElementById("wave-start").hidden'));
  const point=await evaluate('(()=>{const r=document.getElementById("wave-start").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
  await send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1});
  await wait(async()=>{const text=await evaluate('document.getElementById("status").textContent');if(/invoked|capture|Cannot|недоступ|разреш|Обновите/i.test(text))throw Error(text);return levels.some(v=>v.available&&v.level>.02);});
  const source=bridge.sources().find(s=>s.title==='Captured music').source.id;
  assert.ok(levels.filter(v=>v.available).every(v=>v.sourceId===source));
  const other=await browser.newPage(); await other.setContent('<button id="start">Other sound</button>');
  await other.locator('#start').evaluate(button=>button.onclick=()=>{const c=new AudioContext(),o=c.createOscillator();o.connect(c.destination);o.start();window.otherAudio=c;});
  await other.locator('#start').click(); await music.evaluate(()=>audioContext.suspend());
  const quietAt=Date.now(); await wait(()=>levels.some(v=>v.received>quietAt+500&&v.level<.001));
  await music.evaluate(()=>audioContext.resume()); const resumedAt=Date.now(); await wait(()=>levels.some(v=>v.received>resumedAt&&v.level>.02));
  await worker.evaluate(()=>chrome.runtime.sendMessage({type:'wave:close'}));
  await wait(async()=>!(await worker.evaluate(()=>chrome.tabCapture.getCapturedTabs())).some(t=>t.status==='active'));
  await wait(async()=>(await worker.evaluate(()=>chrome.storage.session.get('waveTab'))).waveTab===undefined);
  console.log('PASS: real user-initiated Chromium tab capture, offscreen analyser, selected-tab-only peaks, unrelated tab rejection, silence/resume and capture stop.');
} finally { await browser?.close(); bridge.stop(); await rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100}); }
