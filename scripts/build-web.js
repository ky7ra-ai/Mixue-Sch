'use strict';
// Salin file web statis ke www/ (dipakai Capacitor sebagai isi aplikasi).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
['index.html', 'css', 'js'].forEach((name) => {
  fs.cpSync(path.join(root, name), path.join(out, name), { recursive: true });
});
console.log('www/ siap:', fs.readdirSync(out).join(', '));
