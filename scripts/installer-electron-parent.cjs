const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { launchPortableInstaller } = require('../src/install-launcher.cjs');
const argument = process.argv.find(value => value.startsWith('--installer-options='));
const options = JSON.parse(Buffer.from(argument.slice('--installer-options='.length), 'base64').toString('utf8'));
const profile = path.join(options.directory, 'electron-profile');
fs.mkdirSync(profile, { recursive: true }); app.setPath('userData', profile);
app.installerStatus = {};
app.whenReady().then(async () => {
  await launchPortableInstaller({ ...options, waitPid: process.pid, hosted: true, noRelaunch: true });
  app.installerStatus = { ready: true };
}).catch(error => { app.installerStatus = { error: error.message }; });
