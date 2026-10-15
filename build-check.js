'use strict';
// Üretim derlemesi kontrolü: sözdizimi, testler, gizli anahtar taraması, dist/ paketi.
const { execFileSync } = require('child_process'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'); let bad = 0;
const step = (n, ok, d = '') => { console.log(`${ok ? 'OK  ' : 'HATA'} ${n} ${d}`); if (!ok) bad++; };
for (const f of ['server.js', 'public/app.js']) { try { execFileSync(process.execPath, ['--check', path.join(root, f)]); step('sözdizimi ' + f, true); } catch { step('sözdizimi ' + f, false); } }
try { execFileSync(process.execPath, ['--test', path.join(root, 'test/auth.test.js')], { stdio: 'pipe' }); step('yetki testleri', true); } catch (e) { step('yetki testleri', false, String(e.stdout).slice(-400)); }
const sources = ['server.js', 'public/app.js', 'public/index.html', 'public/app.css'];
const patterns = [/-----BEGIN [A-Z ]*PRIVATE KEY/, /AKIA[0-9A-Z]{16}/, /(password|secret|token|api[_-]?key)\s*[:=]\s*['"][^'"]{8,}['"]/i];
const hits = sources.filter((f) => patterns.some((p) => p.test(fs.readFileSync(path.join(root, f), 'utf8'))));
step('kaynakta gizli anahtar taraması', hits.length === 0, hits.join(','));
const dist = path.join(root, 'dist'); fs.rmSync(dist, { recursive: true, force: true }); fs.mkdirSync(path.join(dist, 'public'), { recursive: true });
fs.copyFileSync(path.join(root, 'server.js'), path.join(dist, 'server.js'));
for (const f of ['index.html', 'app.js', 'app.css']) fs.copyFileSync(path.join(root, 'public', f), path.join(dist, 'public', f));
step('dist/ paketi', fs.existsSync(path.join(dist, 'public/index.html')));
process.exit(bad ? 1 : 0);
