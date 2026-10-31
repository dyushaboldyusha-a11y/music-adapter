let context, stream, timer, captureTab, generation = 0;
async function stop() {
  generation++; clearInterval(timer); timer = null;
  const tabId = captureTab; captureTab = null;
  const previous = stream; stream = null; previous?.getTracks().forEach(track => track.stop());
  const old = context; context = null; await old?.close().catch(() => {});
  if (tabId !== undefined && tabId !== null) chrome.runtime.sendMessage({ type: 'wave-level', tabId, available: false, level: 0 }).catch(() => {});
}
async function start(message) {
  await stop(); const current = generation;
  const media = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: message.streamId } }, video: false });
  if (current !== generation) { media.getTracks().forEach(track => track.stop()); throw new Error('Запуск отменён'); }
  stream = media; captureTab = message.tabId;
  try {
    context = new AudioContext();
    const source = context.createMediaStreamSource(stream), analyser = context.createAnalyser(); analyser.fftSize = 2048;
    source.connect(analyser); source.connect(context.destination);
    // Capturing a tab disables its direct output. Keep it audible through this
    // context; stopping capture restores the normal browser output automatically.
    await context.resume(); if (context.state !== 'running') throw new Error('Не удалось включить звук вкладки');
    const values = new Float32Array(analyser.fftSize);
    timer = setInterval(() => {
      analyser.getFloatTimeDomainData(values); let level = 0;
      for (const sample of values) level = Math.max(level, Math.abs(sample));
      chrome.runtime.sendMessage({ type: 'wave-level', tabId: captureTab, available: true, level: Math.min(1, level) }).catch(() => stop());
    }, 100);
    stream.getTracks().forEach(track => track.addEventListener('ended', () => stop(), { once: true }));
    context.addEventListener('statechange', () => { if (context?.state === 'suspended') stop(); });
  } catch (error) { await stop(); throw error; }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.tab || sender.url && sender.url !== chrome.runtime.getURL('background.js')) return;
  if (message.type === 'wave:open') { start(message).then(() => respond({ ok: true }), error => respond({ ok: false, error: error.message })); return true; }
  if (message.type === 'wave:close') { stop().then(() => respond({ ok: true })); return true; }
});
