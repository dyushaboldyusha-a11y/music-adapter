const $ = id => document.getElementById(id);
async function refresh() { const s = await chrome.runtime.sendMessage({ type: 'status' }); $('status').textContent = s.error || (s.paired ? `Подключено · вкладок с музыкой: ${s.players}` : 'Откройте Liberty Wave → «Источники» и получите код подключения.'); $('pair').hidden = s.paired; $('disconnect').hidden = !s.paired; $('wave-start').hidden = !s.paired; $('wave-stop').hidden = s.waveTab === null; $('wave-help').hidden = !s.paired; }
let waveBusy = false;
$('wave-start').addEventListener('click', async () => {
  if (waveBusy) return; waveBusy = true; $('wave-start').disabled = true;
  try { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }); const result = await chrome.runtime.sendMessage({ type: 'wave-start', tabId: tab.id, streamId }); if (!result.ok) throw new Error(result.error); await refresh(); }
  catch (error) { $('status').textContent = error.message || 'Разрешите звук музыкальной вкладки'; }
  finally { waveBusy = false; $('wave-start').disabled = false; }
});
$('wave-stop').addEventListener('click', async () => { await chrome.runtime.sendMessage({ type: 'wave-stop' }); await refresh(); });
$('pair').addEventListener('submit', async event => { event.preventDefault(); const result = await chrome.runtime.sendMessage({ type: 'pair', code: $('code').value }); if (!result.ok) $('status').textContent = result.error; else await refresh(); });
$('disconnect').addEventListener('click', async () => { await chrome.runtime.sendMessage({ type: 'disconnect' }); await refresh(); });
refresh();
