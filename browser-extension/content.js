(() => {
  const pending = new Map();
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'liberty-player-v1') return;
    const data = event.data;
    if (data.type === 'state') chrome.runtime.sendMessage({ type: 'player-state', state: data.state }).catch(() => {});
    if (data.type === 'result' && pending.has(data.id)) { const item = pending.get(data.id); clearTimeout(item.timer); pending.delete(data.id); item.respond({ ok: data.ok === true, error: String(data.error || '').slice(0, 200) }); }
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type !== 'player-command') return;
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); respond({ ok: false, error: 'Плеер во вкладке не ответил' }); }, 3500);
    pending.set(id, { timer, respond });
    window.postMessage({ channel: 'liberty-player-v1', type: 'command', id, command: message.command, value: message.value }, location.origin);
    return true;
  });
  window.postMessage({ channel: 'liberty-player-v1', type: 'refresh' }, location.origin);
})();
