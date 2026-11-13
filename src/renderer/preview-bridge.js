(function (root) {
  if (root.parent === root || new URLSearchParams(location.search).get('preview') !== '1') return;
  let current = null;
  const states = new Set(), levels = new Set();
  const subscribe = (listeners, callback) => { listeners.add(callback); return () => listeners.delete(callback); };
  const disabled = async () => ({ ok: false, error: 'Это предпросмотр виджета' });
  root.libertyPreviewBridge = {
    getState: async () => current,
    onState: callback => subscribe(states, callback),
    onAudioLevel: callback => subscribe(levels, callback),
    command: disabled,
    openControls: disabled
  };
  root.addEventListener('message', event => {
    if (event.source !== root.parent || !event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'liberty:preview-state' && event.data.state) {
      current = event.data.state;
      for (const callback of states) callback(current);
      root.parent.postMessage({ type: 'liberty:preview-rendered' }, '*');
    } else if (event.data.type === 'liberty:preview-level') {
      for (const callback of levels) callback(event.data.level);
    }
  });
  document.body.classList.add('widget-preview-document');
})(globalThis);
