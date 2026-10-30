(function (root) {
  const DEFAULT_BINDINGS = Object.freeze({ toggleInteraction: 'Control+Shift+8', playPause: 'Control+Shift+Space' });
  const ACTIONS = Object.freeze({ toggleInteraction: 'Управление виджетом', playPause: 'Пауза / продолжить' });
  const modifiers = new Map([['control', 'Control'], ['ctrl', 'Control'], ['alt', 'Alt'], ['shift', 'Shift'], ['super', 'Super'], ['meta', 'Super'], ['win', 'Super']]);
  const namedKeys = ['Space', 'Tab', 'Enter', 'Escape', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right', 'Plus', 'MediaPlayPause', 'MediaStop', 'MediaNextTrack', 'MediaPreviousTrack', 'VolumeUp', 'VolumeDown', 'VolumeMute', 'numdec', 'numadd', 'numsub', 'nummult', 'numdiv'];
  const names = new Map(namedKeys.map(key => [key.toLowerCase(), key]));
  const punctuation = new Set(['-', '=', '[', ']', '\\', ';', "'", ',', '.', '/', '`']);
  const codes = { Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Tab: 'Tab', Escape: 'Escape', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', NumpadDecimal: 'numdec', NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`', MediaPlayPause: 'MediaPlayPause', MediaStop: 'MediaStop', MediaTrackNext: 'MediaNextTrack', MediaTrackPrevious: 'MediaPreviousTrack', AudioVolumeUp: 'VolumeUp', AudioVolumeDown: 'VolumeDown', AudioVolumeMute: 'VolumeMute' };
  const reserved = new Set(['Alt+Tab', 'Alt+F4', 'Control+Alt+Delete', 'Control+Shift+Escape', 'Super+L', 'Super+Tab']);
  function normalizeAccelerator(value) {
    if (typeof value !== 'string' || value.length > 80) throw new Error('Некорректное сочетание клавиш');
    if (!value.trim()) return '';
    const parts = value.split('+').map(part => part.trim());
    const rawKey = parts.pop();
    let key = names.get(rawKey.toLowerCase());
    if (/^[a-z0-9]$/i.test(rawKey) || /^F([1-9]|1[0-9]|2[0-4])$/i.test(rawKey)) key = rawKey.toUpperCase();
    if (/^num[0-9]$/i.test(rawKey)) key = rawKey.toLowerCase();
    if (punctuation.has(rawKey)) key = rawKey;
    if (!key) throw new Error('Выберите букву, цифру, F-клавишу или сочетание с Ctrl, Alt, Shift, Win');
    const mods = parts.map(part => modifiers.get(part.toLowerCase()));
    if (mods.some(mod => !mod) || new Set(mods).size !== mods.length) throw new Error('Некорректные модификаторы сочетания');
    const result = [...['Control', 'Alt', 'Shift', 'Super'].filter(mod => mods.includes(mod)), key].join('+');
    if (reserved.has(result)) throw new Error('Это системное сочетание. Выберите другое');
    return result;
  }
  function normalizeBindings(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 2 || Object.keys(input).some(key => !Object.hasOwn(ACTIONS, key))) throw new Error('Некорректные настройки горячих клавиш');
    const bindings = Object.fromEntries(Object.keys(ACTIONS).map(key => [key, normalizeAccelerator(input[key])]));
    if (!bindings.toggleInteraction) throw new Error('Назначьте клавишу управления виджетом');
    if (bindings.toggleInteraction === bindings.playPause) throw new Error('Для двух действий нужны разные сочетания');
    return bindings;
  }
  function readBindings(input) { try { return normalizeBindings({ ...DEFAULT_BINDINGS, ...input }); } catch { return { ...DEFAULT_BINDINGS }; } }
  function fromEvent(event) {
    let key = codes[event.code];
    if (/^Key[A-Z]$/.test(event.code || '')) key = event.code.slice(3);
    if (/^Digit[0-9]$/.test(event.code || '')) key = event.code.slice(5);
    if (/^Numpad[0-9]$/.test(event.code || '')) key = 'num' + event.code.slice(6);
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code || '')) key = event.code;
    if (!key) return null;
    return normalizeAccelerator([event.ctrlKey && 'Control', event.altKey && 'Alt', event.shiftKey && 'Shift', event.metaKey && 'Super', key].filter(Boolean).join('+'));
  }
  function format(value) { return value ? value.split('+').map(part => ({ Control: 'Ctrl', Super: 'Win', Space: 'Пробел', numdec: 'Num .', numadd: 'Num +', numsub: 'Num −', nummult: 'Num ×', numdiv: 'Num /' })[part] || part.replace(/^num(\d)$/, 'Num $1')).join('+') : 'Не назначено'; }
  const api = { DEFAULT_BINDINGS, ACTIONS, normalizeAccelerator, normalizeBindings, readBindings, fromEvent, format };
  if (typeof module !== 'undefined') module.exports = api;
  root.LibertyShortcuts = api;
})(globalThis);
