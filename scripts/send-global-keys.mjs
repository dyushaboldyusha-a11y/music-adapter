import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
export async function pressGlobalKeys(keys) {
  if (process.platform === 'linux') {
    await run('python3', ['-c', `
import ctypes as c, ctypes.util, json, sys
x = c.CDLL(ctypes.util.find_library('X11'))
t = c.CDLL(ctypes.util.find_library('Xtst'))
x.XOpenDisplay.argtypes = [c.c_char_p]; x.XOpenDisplay.restype = c.c_void_p
x.XStringToKeysym.argtypes = [c.c_char_p]; x.XStringToKeysym.restype = c.c_ulong
x.XKeysymToKeycode.argtypes = [c.c_void_p, c.c_ulong]; x.XKeysymToKeycode.restype = c.c_ubyte
x.XSync.argtypes = [c.c_void_p, c.c_int]; x.XCloseDisplay.argtypes = [c.c_void_p]
t.XTestFakeKeyEvent.argtypes = [c.c_void_p, c.c_uint, c.c_int, c.c_ulong]
d = x.XOpenDisplay(None)
if not d: raise RuntimeError('X display unavailable')
codes = [x.XKeysymToKeycode(d, x.XStringToKeysym(key.encode())) for key in json.loads(sys.argv[1])]
if not all(codes): raise RuntimeError('Unknown test key')
for key in codes: t.XTestFakeKeyEvent(d, key, 1, 20)
for key in reversed(codes): t.XTestFakeKeyEvent(d, key, 0, 20)
x.XSync(d, 0); x.XCloseDisplay(d)
`, JSON.stringify(keys)], { timeout: 10000 });
  } else if (process.platform === 'win32') {
    const map = { F8: 0x77, F9: 0x78, Control_L: 0x11, Alt_L: 0x12, Shift_L: 0x10 };
    if (keys.some(key => !map[key])) throw new Error('Unsupported Windows test key');
    const codes = keys.map(key => map[key]);
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type 'using System; using System.Runtime.InteropServices; public static class LibertyTestKeys { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }'; foreach ($key in @(${codes.join(',')})) { [LibertyTestKeys]::keybd_event($key, 0, 0, [UIntPtr]::Zero) }; foreach ($key in @(${codes.toReversed().join(',')})) { [LibertyTestKeys]::keybd_event($key, 0, 2, [UIntPtr]::Zero) }`], { timeout: 10000 });
  } else throw new Error('Global key smoke test requires Windows or X11');
}
