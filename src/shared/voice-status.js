(function (root) {
  function status(voice = {}, now = Date.now()) {
    if (!voice.enabled) return { visible: false, text: '', tone: 'idle' };
    if (voice.error) return { visible: true, text: voice.error, tone: 'error' };
    if (voice.feedback && voice.feedback.until > now) return { visible: true, text: voice.feedback.heard ? `«${voice.feedback.heard}» → ${voice.feedback.text}` : voice.feedback.text, heard: voice.feedback.heard, tone: voice.feedback.ok ? 'success' : 'error' };
    if (voice.test) return { visible: true, text: 'Проверка микрофона', tone: 'listening' };
    if (voice.phase === 'processing') return { visible: true, text: 'Распознаю…', tone: 'processing' };
    if (voice.phase === 'listening') return { visible: true, text: 'Слушаю…', tone: 'listening' };
    return { visible: true, text: voice.mode === 'wake' ? 'Жду «Wave / вейв»' : 'Голос: удерживайте клавишу', tone: 'idle' };
  }
  const api = { status }; if (typeof module === 'object' && module.exports) module.exports = api; else root.LibertyVoiceStatus = api;
})(globalThis);
