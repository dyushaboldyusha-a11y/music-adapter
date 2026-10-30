const $ = id => document.getElementById(id);
async function refresh() { const s = await chrome.runtime.sendMessage({ type: 'status' }); $('status').textContent = s.error || (s.paired ? `Подключено · вкладок с музыкой: ${s.players}` : 'Откройте меню «…» в виджете и получите код подключения.'); $('pair').hidden = s.paired; $('disconnect').hidden = !s.paired; }
$('pair').addEventListener('submit', async event => { event.preventDefault(); const result = await chrome.runtime.sendMessage({ type: 'pair', code: $('code').value }); if (!result.ok) $('status').textContent = result.error; else await refresh(); });
$('disconnect').addEventListener('click', async () => { await chrome.runtime.sendMessage({ type: 'disconnect' }); await refresh(); });
refresh();
