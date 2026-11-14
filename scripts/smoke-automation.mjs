import { _electron } from 'playwright';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url), root = resolve(import.meta.dirname, '..');
const profile = await mkdtemp(join(tmpdir(), 'liberty-automation-'));
let app;
async function launch() {
  app = await _electron.launch({ executablePath: require('electron'), args: [root, '--demo', '--disable-gpu', `--user-data-dir=${profile}`] });
  const widget = await app.firstWindow();
  await widget.waitForFunction(() => !!window.musicWidget);
  await widget.evaluate(() => musicWidget.openControls('home'));
  const deadline = Date.now() + 10000;
  while (!app.windows().some(page => page.url().endsWith('/control/index.html')) && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
  const control = app.windows().find(page => page.url().endsWith('/control/index.html'));
  assert.ok(control); await control.waitForFunction(() => !!window.libertyControl && !!document.getElementById('profile-form'));
  return { control, widget, action: (name, value) => control.evaluate(({ name, value }) => libertyControl.action(name, value), { name, value }) };
}
try {
  let { control, action, widget } = await launch();
  assert.equal(await control.locator('#voice-enabled').isChecked(), false);
  assert.equal(await control.locator('#voice-enabled').isDisabled(), process.platform !== 'win32');
  assert.equal(await control.locator('#voice-microphone').count(), 1);
  assert.equal(await control.locator('#microphone-test').isDisabled(), process.platform !== 'win32');
  assert.equal(await control.locator('#microphone-level').getAttribute('aria-label'), 'Уровень сигнала микрофона');
  await control.waitForFunction(() => document.querySelectorAll('.voice-command-group').length === 8);
  await control.locator('#voice-commands summary').click();
  assert.equal(await control.locator('#voice-commands').getAttribute('open'), '');
  assert.equal(await control.locator('.voice-command-group p[lang="ru"]').count(), 8);
  assert.equal(await control.locator('.voice-command-group p[lang="en"]').count(), 8);
  for (const phrase of ['skip', 'next', 'back', 'unmute', 'дальше', 'назад', 'прибавь громкость']) {
    assert.ok((await control.locator('#voice-command-groups').innerText()).includes(phrase), `Missing visible synonym: ${phrase}`);
  }
  assert.match(await control.locator('#voice-commands').innerText(), /пожалуйста.*please/);
  await control.locator('#voice-commands summary').click();
  assert.equal(await control.locator('#voice-mode').inputValue(), 'wake');
  assert.equal((await control.evaluate(() => libertyControl.getState())).shortcuts.bindings.voiceHold, '');
  await control.locator('#voice-mode').selectOption('hold');
  await control.waitForFunction(async () => (await libertyControl.getState()).automation.mode === 'hold');
  await control.locator('#voice-mode').selectOption('wake');
  await control.waitForFunction(async () => (await libertyControl.getState()).automation.mode === 'wake');
  assert.equal((await action('voiceMode', 'invalid')).ok, false);
  await widget.evaluate(() => detachState());
  const showVoice = voice => widget.evaluate(voice => update({ ...state, voice }), voice);
  for (const phase of ['waiting', 'listening', 'processing']) {
    await showVoice({ enabled: true, mode: 'wake', phase });
    assert.equal(await widget.locator('#voice-indicator').count(), 0, 'Voice activity must not add a label or badge to the widget');
    assert.equal(await widget.locator('#key-hint').count(), 0, 'The pin instruction must not return during voice activity');
  }
  assert.equal((await action('command', { command: 'volume', value: .3 })).ok, true);
  await widget.evaluate(async () => update(await bridge.getState()));
  await showVoice({ enabled: true, mode: 'wake', phase: 'recognized', feedback: { text: 'Громкость 30%', heard: 'вейв громкость тридцать процентов', ok: true, until: Date.now() + 4000 } });
  assert.equal(await widget.locator('#voice-indicator').count(), 0, 'Recognized commands must remain free of overlay labels');
  assert.equal((await control.evaluate(() => libertyControl.getState())).volume, .3, 'Removing voice labels must not disable player commands');
  await showVoice({ enabled: true, mode: 'hold', phase: 'waiting' });
  assert.equal(await widget.locator('#voice-indicator').count(), 0, 'Hold mode must not restore the old voice instruction');
  await showVoice({ enabled: true, mode: 'wake', error: 'Ошибка распознавания' });
  assert.equal(await widget.locator('#voice-indicator').count(), 0, 'Voice errors belong in settings, not on the widget');
  const caption = await widget.evaluate(() => ({ actual: document.getElementById('source-name').textContent, expected: state.source?.name || 'Ожидание плеера' }));
  assert.equal(caption.actual, caption.expected, 'The widget source caption must not append application/browser labels');
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await widget.screenshot({ path: join(root, 'artifacts/voice-without-widget-labels.png') });
  await showVoice({ enabled: false });
  assert.equal(await widget.locator('#voice-indicator').count(), 0);
  await widget.evaluate(async () => { bridge.onState(update); update(await bridge.getState()); });
  const captureStart = await control.evaluate(() => libertyControl.getState());
  if (process.platform !== 'win32') assert.equal((await action('microphoneTest', true)).ok, false);
  assert.equal((await action('microphone', '../invalid')).ok, false);
  assert.equal((await control.evaluate(() => libertyControl.getState())).title, captureStart.title, 'Microphone actions must not change the track');
  for (const id of ['voice-enabled', 'profiles-enabled']) {
    const geometry = await control.locator('#' + id).evaluate(input => {
      const bounds = input.getBoundingClientRect(), row = input.closest('label');
      return { width: bounds.width, height: bounds.height, row: getComputedStyle(row).display };
    });
    assert.deepEqual(geometry, { width: 34, height: 20, row: 'flex' }, `${id}: switch must not inherit text-field width or block-label layout`);
  }
  await mkdir(join(root, 'artifacts'), { recursive: true });
  await control.locator('#voice-enabled').locator('xpath=../..').screenshot({ path: join(root, 'artifacts/voice-controls.png') });
  assert.equal((await action('preferences', { compact: true, scale: .75 })).ok, true);
  await control.locator('#profile-name').fill('Моя игра'); await control.locator('#profile-exe').fill('GAME.exe');
  await control.locator('#profile-form button').click();
  await control.waitForFunction(async () => (await libertyControl.getState()).appProfiles.items.length === 1);
  const saved = await control.evaluate(async () => (await libertyControl.getState()).appProfiles);
  assert.equal(saved.items[0].executable, 'game.exe'); assert.equal(saved.items[0].preferences.compact, true); assert.equal(saved.items[0].preferences.scale, .75);
  assert.equal((await action('profiles', { enabled: true, items: [...saved.items, saved.items[0]] })).ok, false);
  assert.equal((await action('profiles', { enabled: false, items: [{ ...saved.items[0], executable: '../game.exe' }] })).ok, false);
  assert.equal((await action('preferences', { compact: false, scale: 1 })).ok, true);
  await control.locator('[data-page="shortcuts"]').click();
  assert.equal(await control.locator('#bind-voiceHold').count(), 1);
  const bindings = await control.evaluate(async () => (await libertyControl.getState()).shortcuts.bindings);
  assert.equal((await action('shortcuts', { ...bindings, voiceHold: 'Control+Alt+F7' })).ok, true);
  await app.close(); app = null;
  const file = JSON.parse(await readFile(join(profile, 'widget.json'), 'utf8'));
  assert.equal(file.appProfiles.items[0].preferences.scale, .75); assert.equal(file.scale, 1);
  assert.equal(file.shortcuts.voiceHold, 'Control+Alt+F7'); assert.equal(file.voiceMode, 'wake');
  ({ control, action } = await launch());
  const restored = await control.evaluate(() => libertyControl.getState());
  assert.equal(restored.automation.mode, 'wake');
  assert.equal(restored.appProfiles.items.length, 1); assert.equal(restored.appProfiles.enabled, false);
  assert.equal(restored.preferences.scale, 1); assert.equal(restored.shortcuts.bindings.voiceHold, 'Control+Alt+F7');
  await control.getByRole('button', { name: 'Удалить профиль Моя игра' }).click();
  await control.waitForFunction(async () => (await libertyControl.getState()).appProfiles.items.length === 0);
  console.log('PASS: real Electron profile editor, exact EXE normalization, validation rollback, profile/base separation, wake/hold modes and commands without widget voice/kind/pin labels, hold binding, deletion and restart persistence. No microphone opened.');
} finally { await app?.close(); await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
