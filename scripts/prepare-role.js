'use strict';
// Siapkan satu peran: node scripts/prepare-role.js admin|viewer
// Menimpa www/js/role.js dan capacitor.config.json (appId + nama aplikasi).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const ROLES = {
  admin: { appId: 'com.mixue.sch', appName: 'Mixue Penguasa', file: 'Mixue-Penguasa' },
  viewer: { appId: 'com.mixue.rakyat', appName: 'Mixue Rakyat', file: 'Mixue-Rakyat' },
};
const role = process.argv[2];
if (!ROLES[role]) { console.error('Peran harus admin atau viewer'); process.exit(1); }
const r = ROLES[role];
fs.writeFileSync(path.join(root, 'www/js/role.js'), `window.MIXUE_ROLE = '${role}';\n`);
const cfgPath = path.join(root, 'capacitor.config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
cfg.appId = r.appId; cfg.appName = r.appName;
// Pemeriksa jadwal latar belakang: hanya aktif di Rakyat.
cfg.plugins = Object.assign({}, cfg.plugins, { BackgroundRunner: {
  label: 'com.mixue.rakyat.check', src: 'runners/runner.js', event: 'checkSchedule',
  repeat: true, interval: 15, autoStart: role === 'viewer',
} });
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
console.log('peran', role, '->', r.appName, r.appId);
