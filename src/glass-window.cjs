const os = require('node:os');
const { palette } = require('./shared/theme.js');

// DWM backdrop materials require Windows 11 22H2. Older Windows and Linux
// retain the same tinted glass design over an opaque, readable fallback.
function glassWindowOptions(surfaceColor, { platform = process.platform, release = os.release() } = {}) {
  const parts = release.split('.').map(Number);
  const native = platform === 'win32' && parts[0] >= 10 && parts[2] >= 22621;
  return native ? { backgroundColor: '#00000000', backgroundMaterial: 'acrylic' } : { backgroundColor: palette(surfaceColor).tokens['--app-bg'] };
}
module.exports = { glassWindowOptions };
