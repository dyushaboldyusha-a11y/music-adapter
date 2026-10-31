const { layoutForDisplays } = require('./window-state.cjs');

// Display coordinates are Electron DIPs, including when Windows changes DPI or
// a game switches the physical display mode. Never mix them with raw pixels.
function watchDisplays(window, screen, { getScale, getSize, getPreferences, shouldShow = () => true, onLayout, delay = 150 }) {
  let timer;
  let disposed = false;
  function restore(reset = false, saved = window.getBounds()) {
    if (disposed || window.isDestroyed()) return;
    const displays = reset ? [screen.getPrimaryDisplay()] : screen.getAllDisplays();
    if (!displays.length) return;
    const layout = layoutForDisplays(reset ? null : saved, displays, getScale(), getSize?.(), getPreferences?.());
    window.setBounds(layout.bounds);
    window.webContents.setZoomFactor(layout.scale);
    window.setAlwaysOnTop(true, 'screen-saver');
    if (!window.isVisible() && shouldShow()) window.showInactive();
    window.moveTop(); // Raise the widget without taking keyboard focus from a game.
    onLayout(layout);
    return layout;
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => restore(), delay);
  }
  function metrics(_event, _display, changed) {
    if (changed.some(key => ['bounds', 'workArea', 'scaleFactor', 'rotation'].includes(key))) schedule();
  }
  screen.on('display-metrics-changed', metrics);
  screen.on('display-added', schedule);
  screen.on('display-removed', schedule);
  return {
    restore,
    dispose() {
      disposed = true; clearTimeout(timer);
      screen.removeListener('display-metrics-changed', metrics);
      screen.removeListener('display-added', schedule);
      screen.removeListener('display-removed', schedule);
    }
  };
}
module.exports = { watchDisplays };
