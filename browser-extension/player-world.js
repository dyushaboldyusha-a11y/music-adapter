(() => {
  const api = globalThis.LibertyServices;
  const service = api?.fromUrl(location.href);
  if (!service || window.__libertyPlayerInstalled) return;
  window.__libertyPlayerInstalled = true;
  const handlers = new Map();
  let positionState = null, positionAt = 0;
  const session = navigator.mediaSession;
  if (session) {
    try {
      const setHandler = session.setActionHandler.bind(session);
      session.setActionHandler = (action, handler) => { setHandler(action, handler); handler ? handlers.set(action, handler) : handlers.delete(action); };
      if (session.setPositionState) {
        const setPosition = session.setPositionState.bind(session);
        session.setPositionState = value => { setPosition(value); positionState = value ? { ...value } : null; positionAt = performance.now(); queueMicrotask(publish); };
      }
    } catch { /* DOM media controls remain available if a browser seals this API. */ }
  }
  function element(selectors = []) { for (const selector of selectors) { const el = document.querySelector(selector); if (el) return el; } return null; }
  function button(selectors) { const el = element(selectors); return el && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.classList.contains('disabled') && el.getClientRects().length ? el : null; }
  function mediaElement() {
    return [...document.querySelectorAll('audio,video')].filter(el => el.currentSrc || el.src).sort((a, b) => Number(!b.paused && !b.muted) - Number(!a.paused && !a.muted) || (b.readyState || 0) - (a.readyState || 0))[0];
  }
  function snapshot() {
    const media = mediaElement(), metadata = session?.metadata;
    if (!metadata?.title && !media && !positionState) return null;
    const playing = media ? !media.paused && !media.ended : session?.playbackState === 'playing';
    const duration = Number.isFinite(media?.duration) ? media.duration : Number.isFinite(positionState?.duration) ? positionState.duration : 0;
    const position = media ? media.currentTime || 0 : (positionState?.position || 0) + (playing ? (performance.now() - positionAt) / 1000 * (positionState?.playbackRate || 1) : 0);
    let artworkUrl = metadata?.artwork?.find(a => a.src)?.src || '';
    const cover = element(service.cover);
    if (!artworkUrl && cover) artworkUrl = cover.currentSrc || cover.src || getComputedStyle(cover).backgroundImage.match(/url\(["']?(.+?)["']?\)/)?.[1] || '';
    if (!artworkUrl && service.id === 'youtube') {
      const id = new URL(location.href).searchParams.get('v');
      if (/^[\w-]{11}$/.test(id || '')) artworkUrl = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    }
    try { artworkUrl = new URL(artworkUrl, location.href).href; } catch { artworkUrl = ''; }
    const text = selectors => element(selectors)?.textContent?.trim() || '';
    return {
      title: metadata?.title || text(service.title) || document.title.replace(/\s[-–|]\s(YouTube|Spotify|SoundCloud).*$/i, '').slice(0, 200),
      artist: metadata?.artist || text(service.artist) || service.name,
      album: metadata?.album || '', artworkUrl, playing, duration, position: Math.max(0, Math.min(duration, position)), live: media?.duration === Infinity,
      capabilities: { playPause: !!media || !!button(service.play) || handlers.has(playing ? 'pause' : 'play'), next: handlers.has('nexttrack') || !!button(service.next), previous: handlers.has('previoustrack') || !!button(service.previous), seek: duration > 0 && (handlers.has('seekto') || !!media?.seekable?.length), shuffle: false, repeat: false }
    };
  }
  function publish() { window.postMessage({ channel: 'liberty-player-v1', type: 'state', state: snapshot() }, location.origin); }
  async function command(action, value) {
    const state = snapshot();
    if (!state?.capabilities[action]) throw new Error('Эта команда недоступна во вкладке');
    const media = mediaElement();
    const nativeAction = action === 'playPause' ? state.playing ? 'pause' : 'play' : ({ next: 'nexttrack', previous: 'previoustrack', seek: 'seekto' })[action];
    if (handlers.has(nativeAction)) await handlers.get(nativeAction)({ action: nativeAction, ...(action === 'seek' ? { seekTime: Math.max(0, Math.min(state.duration, Number(value))), fastSeek: false } : {}) });
    else if (action === 'seek' && media && Number.isFinite(value)) media.currentTime = Math.max(0, Math.min(state.duration, value));
    else if (action === 'playPause' && media) { if (state.playing) media.pause(); else await media.play(); }
    else {
      const target = button(service[action === 'playPause' ? 'play' : action]);
      if (!target) throw new Error('Кнопка плеера недоступна');
      target.click();
    }
    publish();
  }
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'liberty-player-v1') return;
    const data = event.data;
    if (data.type === 'refresh') { publish(); return; }
    if (data.type !== 'command' || !['playPause', 'next', 'previous', 'seek'].includes(data.command) || typeof data.id !== 'string') return;
    try { await command(data.command, data.value); window.postMessage({ channel: 'liberty-player-v1', type: 'result', id: data.id, ok: true }, location.origin); }
    catch (error) { window.postMessage({ channel: 'liberty-player-v1', type: 'result', id: data.id, ok: false, error: error.message }, location.origin); }
  });
  for (const event of ['play', 'pause', 'ended', 'durationchange', 'seeked']) document.addEventListener(event, publish, true);
  document.addEventListener('visibilitychange', publish);
  setInterval(publish, 1000);
  publish();
})();
