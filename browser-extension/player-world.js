(() => {
  const api = globalThis.LibertyServices;
  const service = api?.fromUrl(location.href);
  if (!service || window.__libertyPlayerInstalled) return;
  window.__libertyPlayerInstalled = true;
  const handlers = new Map();
  const trackedMedia = new Set(), buffering = new WeakSet();
  const vk = service.id === 'vk' ? globalThis.LibertyVK?.create(window) : null;
  const sampleOrigin = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let sequence = 0, timelineEpoch = 0;
  let positionState = null, positionAt = 0, positionPlaying = false, positionRate = 1;
  const session = navigator.mediaSession;
  if (session) {
    try {
      const setHandler = session.setActionHandler.bind(session);
      session.setActionHandler = (action, handler) => { setHandler(action, handler); handler ? handlers.set(action, handler) : handlers.delete(action); };
      if (session.setPositionState) {
        const setPosition = session.setPositionState.bind(session);
        session.setPositionState = value => { setPosition(value); positionState = value ? { ...value } : null; positionAt = performance.now(); positionPlaying = session.playbackState === 'playing'; positionRate = value?.playbackRate ?? 1; queueMicrotask(publish); };
      }
    } catch { /* DOM media controls remain available if a browser seals this API. */ }
  }
  function remember(media) {
    if (!media || typeof media.play !== 'function' || trackedMedia.has(media)) return;
    if (trackedMedia.size >= 16) trackedMedia.delete([...trackedMedia].find(el => el.paused || el.ended) || trackedMedia.values().next().value);
    trackedMedia.add(media);
    for (const name of ['play', 'pause', 'playing', 'waiting', 'stalled', 'seeked', 'durationchange', 'ratechange', 'loadedmetadata', 'ended', 'volumechange']) media.addEventListener(name, () => {
      if (name === 'waiting' || name === 'stalled') buffering.add(media);
      if (name === 'playing' || name === 'play') buffering.delete(media);
      if (name === 'seeked') timelineEpoch++;
      publish();
    });
  }
  // VK and other web players may use new Audio() elements outside the document.
  // Preserve native constructors/methods while observing those media elements.
  try {
    const proto = globalThis.HTMLMediaElement?.prototype;
    if (proto) for (const name of ['play', 'pause']) {
      const native = proto[name];
      proto[name] = function (...args) { remember(this); return Reflect.apply(native, this, args); };
    }
    if (typeof window.Audio === 'function') {
      window.Audio = new Proxy(window.Audio, { construct(target, args, newTarget) { const media = Reflect.construct(target, args, newTarget); remember(media); return media; } });
    }
  } catch { /* Existing Media Session handlers and DOM controls still work. */ }
  function element(selectors = []) { for (const selector of selectors) { const el = document.querySelector(selector); if (el) return el; } return null; }
  function button(selectors) { const el = element(selectors); return el && !el.disabled && el.getAttribute('aria-disabled') !== 'true' && !el.classList.contains('disabled') && el.getClientRects().length ? el : null; }
  function mediaElement() {
    return [...new Set([...document.querySelectorAll('audio,video'), ...trackedMedia])].filter(el => el.currentSrc || el.src).sort((a, b) => Number(!b.paused && !b.muted) - Number(!a.paused && !a.muted) || (b.readyState || 0) - (a.readyState || 0))[0];
  }
  function snapshot() {
    const media = mediaElement(), metadata = session?.metadata, vkState = vk?.snapshot();
    if (!metadata?.title && !media && !positionState && !vkState) return null;
    const playing = media ? !media.paused && !media.ended : typeof vkState?.playing === 'boolean' ? vkState.playing : session?.playbackState === 'playing';
    const duration = Number.isFinite(media?.duration) ? media.duration : Number.isFinite(positionState?.duration) ? positionState.duration : vkState?.duration || 0;
    const playbackRate = media ? buffering.has(media) ? 0 : media.playbackRate ?? 1 : positionState?.playbackRate ?? 1;
    const now = performance.now();
    if (positionState && (playing !== positionPlaying || playbackRate !== positionRate)) {
      positionState.position = (positionState.position || 0) + (positionPlaying ? (now - positionAt) / 1000 * positionRate : 0);
      positionAt = now; positionPlaying = playing; positionRate = playbackRate;
    }
    const position = media ? media.currentTime || 0 : Number.isFinite(vkState?.position) ? vkState.position : (positionState?.position || 0) + (playing ? (now - positionAt) / 1000 * playbackRate : 0);
    let artworkUrl = metadata?.artwork?.find(a => a.src)?.src || '';
    const cover = element(service.cover);
    if (!artworkUrl && cover) artworkUrl = cover.currentSrc || cover.src || getComputedStyle(cover).backgroundImage.match(/url\(["']?(.+?)["']?\)/)?.[1] || '';
    if (!artworkUrl) artworkUrl = vkState?.artworkUrl || '';
    if (!artworkUrl && service.id === 'youtube') {
      const id = new URL(location.href).searchParams.get('v');
      if (/^[\w-]{11}$/.test(id || '')) artworkUrl = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    }
    try { artworkUrl = new URL(artworkUrl, location.href).href; } catch { artworkUrl = ''; }
    const text = selectors => element(selectors)?.textContent?.trim() || '';
    return {
      title: metadata?.title || vkState?.title || text(service.title) || document.title.replace(/\s[-–|]\s(YouTube|Spotify|SoundCloud).*$/i, '').slice(0, 200),
      artist: metadata?.artist || vkState?.artist || text(service.artist) || service.name,
      album: metadata?.album || '', artworkUrl, playing, duration, position: Math.max(0, Math.min(duration, position)), live: media?.duration === Infinity,
      volume: media ? media.volume : vkState?.volume ?? null, muted: media ? media.muted : vkState?.muted === true,
      sampledAt: Date.now(), sampleOrigin, sampleSequence: ++sequence, playbackRate, timelineEpoch,
      capabilities: { playPause: !!media || !!button(service.play) || handlers.has(playing ? 'pause' : 'play') || !!vkState?.capabilities.playPause, next: handlers.has('nexttrack') || !!button(service.next) || !!vkState?.capabilities.next, previous: handlers.has('previoustrack') || !!button(service.previous) || !!vkState?.capabilities.previous, seek: duration > 0 && (handlers.has('seekto') || !!media?.seekable?.length || !!vkState?.capabilities.seek), shuffle: false, repeat: false, volume: !!media || !!vkState?.capabilities.volume, mute: !!media || !!vkState?.capabilities.mute }
    };
  }
  function publish() { window.postMessage({ channel: 'liberty-player-v1', type: 'state', state: snapshot() }, location.origin); }
  async function command(action, value) {
    const state = snapshot();
    if (!state?.capabilities[action]) throw new Error('Эта команда недоступна во вкладке');
    const media = mediaElement();
    const nativeAction = action === 'playPause' ? state.playing ? 'pause' : 'play' : ({ next: 'nexttrack', previous: 'previoustrack', seek: 'seekto' })[action];
    if (action === 'volume' && media) { if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Некорректная громкость'); media.volume = value; if (value > 0) media.muted = false; }
    else if (action === 'mute' && media) { if (typeof value !== 'boolean') throw new Error('Некорректное состояние звука'); media.muted = value; }
    else if (handlers.has(nativeAction)) await handlers.get(nativeAction)({ action: nativeAction, ...(action === 'seek' ? { seekTime: Math.max(0, Math.min(state.duration, Number(value))), fastSeek: false } : {}) });
    else if (action === 'seek' && media && Number.isFinite(value)) media.currentTime = Math.max(0, Math.min(state.duration, value));
    else if (action === 'playPause' && media) { if (state.playing) media.pause(); else await media.play(); }
    else if (vk?.snapshot()?.capabilities[action]) await vk.command(action, value);
    else {
      const target = button(service[action === 'playPause' ? 'play' : action]);
      if (!target) throw new Error('Кнопка плеера недоступна');
      target.click();
    }
    if (action === 'seek') timelineEpoch++;
    publish();
  }
  window.addEventListener('message', async event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'liberty-player-v1') return;
    const data = event.data;
    if (data.type === 'refresh') { publish(); return; }
    if (data.type !== 'command' || !['playPause', 'next', 'previous', 'seek', 'volume', 'mute'].includes(data.command) || typeof data.id !== 'string') return;
    try { await command(data.command, data.value); window.postMessage({ channel: 'liberty-player-v1', type: 'result', id: data.id, ok: true }, location.origin); }
    catch (error) { window.postMessage({ channel: 'liberty-player-v1', type: 'result', id: data.id, ok: false, error: error.message }, location.origin); }
  });
  for (const event of ['play', 'pause', 'ended', 'durationchange', 'seeked']) document.addEventListener(event, e => { remember(e.target); publish(); }, true);
  document.addEventListener('visibilitychange', publish);
  setInterval(publish, 1000);
  publish();
})();
