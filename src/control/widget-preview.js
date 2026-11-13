(function (root) {
  function create() {
    const $ = id => document.getElementById(id), palette = document.querySelector('.palette-card');
    const studio = document.createElement('div'); studio.className = 'appearance-studio';
    palette.before(studio);
    const settings = document.createElement('div'); settings.className = 'appearance-settings'; studio.append(settings);
    while (studio.nextSibling) settings.append(studio.nextSibling);
    const panel = document.createElement('details'); panel.className = 'widget-preview-panel'; panel.setAttribute('aria-label', 'Предпросмотр виджета');
    panel.innerHTML = `<summary class="widget-preview-heading"><strong>Предпросмотр</strong><span aria-hidden="true">⌄</span></summary><div class="widget-preview-content"><div class="widget-preview-tabs" role="group" aria-label="Вариант предпросмотра"><button id="preview-full" type="button" aria-pressed="true">Полный</button><button id="preview-compact" type="button" aria-pressed="false">Компактный</button></div><div id="widget-preview-viewport"><iframe id="widget-preview-frame" src="../renderer/index.html?preview=1" title="Образец виджета" tabindex="-1" inert></iframe></div><output id="widget-preview-size"></output><p class="widget-preview-note" id="widget-preview-note">Изменения оформления сразу видны здесь.</p></div>`;
    const narrow = matchMedia('(max-width:900px)'); panel.open = !narrow.matches;
    studio.append(panel);
    const frame = $('widget-preview-frame'), viewport = $('widget-preview-viewport');
    let state, colors, compact = false, active = false, onScreen = true, loaded = false, animation;
    const started = performance.now(), reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const visible = () => active && onScreen && panel.open && !document.hidden;
    function post(type, value) { if (loaded) frame.contentWindow.postMessage({ type, ...value }, '*'); }
    function dimensions() {
      const rhythm = state?.preferences?.rhythmBars === true;
      return [compact ? 500 : 620, compact ? 144 + (rhythm ? 20 : 0) : 270 + (rhythm ? 30 : 0)];
    }
    function fit() {
      if (!state || !viewport.clientWidth) return;
      const [width, height] = dimensions(), scale = state.preferences.scale || 1;
      const factor = Math.min(.72, viewport.clientWidth / 620) * scale;
      const fitted = Math.min(factor, viewport.clientWidth / width);
      frame.style.width = `${width}px`; frame.style.height = `${height}px`;
      frame.style.transform = `scale(${fitted})`; frame.style.left = `${Math.max(0,(viewport.clientWidth - width * fitted) / 2)}px`;
      viewport.style.height = `${Math.ceil(height * fitted)}px`;
      $('widget-preview-size').textContent = `${Math.round(scale * 100)}% · ${Math.round(width * scale)} × ${Math.round(height * scale)}`;
    }
    function syncAnimation() {
      clearInterval(animation); animation = null;
      const preferences = state?.preferences || {};
      if (visible() && state && !state.connected && !reduced.matches && (preferences.waveMode === 'audio' || preferences.coverPulse || preferences.rhythmBars || preferences.beatGlow) && preferences.waveIntensity > 0) {
        animation = setInterval(() => {
          const t = performance.now() / 1000;
          post('liberty:preview-level', { level: { available: true, level: .16 + .7 * Math.max(0, Math.sin(t * 6.4)) ** 4 } });
        }, preferences.waveEconomy ? 83 : 66);
      }
    }
    function send() {
      if (!state) return;
      fit();
      const sample = !state.connected, preferences = { ...state.preferences, compact, ...(colors ? { color: colors.color, surfaceColor: colors.surfaceColor } : {}) };
      const value = Object.fromEntries(['connected', 'title', 'artist', 'album', 'artwork', 'demo', 'playing', 'muted', 'position', 'duration', 'volume', 'live', 'playbackRate', 'sampledAt', 'sampleOrigin', 'sampleSequence', 'timelineEpoch', 'shuffle', 'repeat', 'source', 'capabilities'].map(key => [key, state[key]]));
      value.shortcuts = { active: { toggleInteraction: state.shortcuts?.active?.toggleInteraction || [] } };
      if (sample) Object.assign(value, { connected: true, title: 'Название трека', artist: 'Исполнитель', artwork: null, demo: true, playing: true, muted: false, position: 88 + (performance.now() - started) / 1000 % 170, duration: 258, volume: .65, live: false, source: { id: 'preview:sample', name: 'Предпросмотр', kind: 'app' }, capabilities: { playPause: true, previous: true, next: true, shuffle: true, repeat: true, seek: true, volume: true, mute: true } });
      post('liberty:preview-state', { state: { ...value, preferences, effectiveColor: colors?.color || state.effectiveColor, compact, autoHidden: !visible(), interaction: true, voice: { enabled: false } } });
      $('widget-preview-note').textContent = sample ? 'Демонстрация без запуска музыки.' : 'Текущий трек. Кнопки образца не управляют музыкой.';
      $('preview-full').setAttribute('aria-pressed', String(!compact)); $('preview-compact').setAttribute('aria-pressed', String(compact));
      syncAnimation();
    }
    $('preview-full').addEventListener('click', () => { compact = false; send(); });
    $('preview-compact').addEventListener('click', () => { compact = true; send(); });
    root.addEventListener('liberty:theme-preview', event => {
      const changed = colors?.color !== event.detail.color || colors?.surfaceColor !== event.detail.surfaceColor;
      colors = event.detail; if (changed && visible()) send();
    });
    frame.addEventListener('load', () => { loaded = true; send(); });
    panel.addEventListener('toggle', send);
    narrow.addEventListener('change', () => { panel.open = !narrow.matches; });
    new ResizeObserver(fit).observe(viewport);
    new IntersectionObserver(entries => { onScreen = entries[0].isIntersecting; send(); }).observe(panel);
    document.addEventListener('visibilitychange', send); reduced.addEventListener('change', send);
    root.addEventListener('pagehide', () => clearInterval(animation), { once: true });
    return { update(next) { state = next; if (visible()) send(); }, setActive(value) { active = value; send(); }, level(value) { if (visible() && state?.connected) post('liberty:preview-level', { level: value }); } };
  }
  root.LibertyWidgetPreview = { create };
})(globalThis);
