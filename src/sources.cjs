const { services } = require('../browser-extension/services.js');
const PROVIDERS = new Map(services.map(s => [s.id, s]));
function descriptor(input) {
  if (!input || typeof input.id !== 'string' || !/^[\w:.-]{1,200}$/.test(input.id)) return null;
  const provider = PROVIDERS.has(input.provider) ? input.provider : 'browser';
  return { id: input.id, provider, name: PROVIDERS.get(provider)?.name || String(input.name || 'Браузер').slice(0, 80), appId: typeof input.appId === 'string' ? input.appId.slice(0, 300) : '', kind: input.kind === 'app' ? 'app' : 'browser', browser: String(input.browser || '').slice(0, 40), playing: input.playing === true, current: input.current === true, title: String(input.title || '').slice(0, 200) };
}
function label(source) { return source ? `${source.name} · ${source.kind === 'app' ? 'приложение' : source.provider === 'browser' ? 'браузер' : source.browser || 'браузер'}` : 'Выберите источник'; }
module.exports = { PROVIDERS, descriptor, label };
