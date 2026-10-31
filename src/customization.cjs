const { normalizeColor } = require('./shared/theme.js');
const { normalizeBindings } = require('./shared/shortcuts.js');
const EXTRA_DEFAULTS = { nickname: 'Liberty', colorMode: 'manual', autoHide: false, autoHideDelay: 60, snapEnabled: false, edgeMargin: 16, monitor: 'auto', showArtwork: true, showArtist: true, showTime: true, coverPulse: false, rhythmBars: false, beatGlow: false };
function nickname(value) {
  if (typeof value !== 'string') throw new Error('Введите никнейм');
  const text = value.normalize('NFC').trim();
  if (!text || Array.from(text).length > 12 || /[\p{C}<>]/u.test(text)) throw new Error('Никнейм: от 1 до 12 символов без служебных знаков');
  return text;
}
function extras(input = {}) {
  const output = { ...EXTRA_DEFAULTS };
  try { if (input.nickname !== undefined) output.nickname = nickname(input.nickname); } catch {}
  for (const key of ['autoHide', 'snapEnabled', 'showArtwork', 'showArtist', 'showTime', 'coverPulse', 'rhythmBars', 'beatGlow']) if (typeof input[key] === 'boolean') output[key] = input[key];
  if (input.colorMode === 'artwork') output.colorMode = 'artwork';
  if (Number.isFinite(input.autoHideDelay)) output.autoHideDelay = Math.round(Math.max(5, Math.min(600, input.autoHideDelay)));
  if (Number.isFinite(input.edgeMargin)) output.edgeMargin = Math.round(Math.max(0, Math.min(100, input.edgeMargin)));
  if (typeof input.monitor === 'string' && /^(auto|-?\d{1,15})$/.test(input.monitor)) output.monitor = input.monitor;
  return output;
}
function validatePreferences(update, defaults) {
  if (!update || typeof update !== 'object' || Array.isArray(update) || Object.keys(update).some(key => !Object.hasOwn(defaults, key))) throw new Error('Некорректные настройки');
  for (const [key, value] of Object.entries(update)) {
    if (typeof value !== typeof defaults[key] || typeof value === 'number' && !Number.isFinite(value)) throw new Error('Некорректная настройка: ' + key);
  }
  if (Object.hasOwn(update, 'color')) normalizeColor(update.color);
  if (Object.hasOwn(update, 'nickname')) nickname(update.nickname);
  if (Object.hasOwn(update, 'waveMode') && !['audio', 'ambient', 'off'].includes(update.waveMode)) throw new Error('Некорректный режим волны');
  if (Object.hasOwn(update, 'colorMode') && !['manual', 'artwork'].includes(update.colorMode)) throw new Error('Некорректный режим цвета');
  if (Object.hasOwn(update, 'monitor') && !/^(auto|-?\d{1,15})$/.test(update.monitor)) throw new Error('Некорректный монитор');
}
function exportSettings(settings, preferences) {
  const positions = {};
  for (const key of ['bounds', 'compactBounds']) if (settings[key]) positions[key] = cleanBounds(settings[key]);
  return { format: 'liberty-wave-settings', version: 1, preferences: preferences(settings), shortcuts: normalizeBindings(settings.shortcuts), positions };
}
function cleanBounds(value) {
  if (!value || ['x', 'y', 'width', 'height'].some(key => !Number.isFinite(value[key]) || Math.abs(value[key]) > 1000000) || value.width <= 0 || value.height <= 0) throw new Error('Некорректное положение виджета');
  return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Math.round(value[key])]));
}
function importSettings(text, preferences, defaults) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 65536) throw new Error('Файл настроек слишком большой');
  let input; try { input = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('Не удалось прочитать JSON настроек'); }
  if (!input || input.format !== 'liberty-wave-settings' || input.version !== 1 || Object.keys(input).some(key => !['format', 'version', 'preferences', 'shortcuts', 'positions'].includes(key))) throw new Error('Этот файл не является экспортом Liberty Wave');
  validatePreferences(input.preferences, defaults);
  const result = { ...preferences(input.preferences), shortcuts: normalizeBindings(input.shortcuts) };
  if (!input.positions || typeof input.positions !== 'object' || Array.isArray(input.positions)) throw new Error('Некорректные положения');
  for (const key of Object.keys(input.positions)) {
    if (!['bounds', 'compactBounds'].includes(key)) throw new Error('Неизвестное положение');
    result[key] = cleanBounds(input.positions[key]);
  }
  return result;
}
module.exports = { EXTRA_DEFAULTS, extras, nickname, validatePreferences, exportSettings, importSettings };
