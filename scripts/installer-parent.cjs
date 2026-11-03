// Test fixture: this is the actual process that creates the installer and exits.
const { spawn } = require('node:child_process');
const { launchPortableInstaller } = require('../src/install-launcher.cjs');
process.once('message', async options => {
  try {
    await launchPortableInstaller({ ...options, waitPid: process.pid, spawn: (file, args, config) => spawn(file, [...args, '-NoRelaunch'], config) });
    process.send({ ready: true });
    process.once('message', () => process.exit(0));
  } catch (error) { process.send({ error: error.message }); process.exit(1); }
});
