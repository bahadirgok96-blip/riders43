'use strict';
// Riders 43 — bağımlılıksız Node.js sunucusu. Tüm yetkilendirme burada uygulanır.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

const ROLES = { baskan: 'Kulüp Başkanı', teknik: 'Teknik Yönetici', surus_odasi: 'Sürüş Odası Yöneticisi', uye: 'Üye' };
// Yetki tablosu: rol -> izinler. Başkan ile teknik yönetici bilerek ayrı tutulur.
const PERMS = {
  'announcements.manage': ['baskan'],
  'applications.manage': ['baskan'],
  'invites.manage': ['baskan'],
  'meetings.manage': ['baskan', 'surus_odasi'],
  'users.manage': ['teknik'],
  'audit.view': ['teknik'],
};
const CHOICES = ['katiliyorum', 'katilamiyorum', 'belli_degil'];
const h = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const rnd = (n) => crypto.randomBytes(n).toString('base64url');
const eq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const hashPw = (pw) => { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(pw, s, 64).toString('hex'); };
const checkPw = (pw, stored) => { const [s, k] = String(stored).split(':'); return eq(crypto.scryptSync(pw, s, 64).toString('hex'), k); };
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (s, m) => { throw new HttpError(s, m); };

function createApp({ dataDir, prod = false, log = () => {}, rateScale = 1 }) {
  const file = path.join(dataDir, 'db.json');
  const fresh = () => ({ setup: { baskan: { done: false, hash: null, fails: 0 }, teknik: { done: false, hash: null, fails: 0 } },
    users: [], sessions: [], invites: [], announcements: [], meetings: [], rsvps: [], audit: [] });
  let db; try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { db = fresh(); }
  const save = () => { fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 }); fs.writeFileSync(file + '.tmp', JSON.stringify(db), { mode: 0o600 }); fs.renameSync(file + '.tmp', file); };
  const setupTokens = {}; // yalnızca bellekte; diske sadece özeti yazılır
  const rotate = (kind) => { const t = rnd(24); setupTokens[kind] = t; db.setup[kind].hash = h(t); db.setup[kind].fails = 0; save();
    log(`[KURULUM] ${kind === 'baskan' ? 'Kulüp başkanı' : 'Teknik yönetici'} kurulum kodu: ${t}`); };
  for (const k of ['baskan', 'teknik']) if (!db.setup[k].done) rotate(k);
  const audit = (u, action, detail = '') => { db.audit.push({ at: Date.now(), by: u ? u.name : '-', action, detail }); db.audit = db.audit.slice(-500); };

  const str = (v, max, min = 1) => { if (typeof v !== 'string') fail(400, 'Geçersiz veri.'); v = v.trim(); if (v.length < min || v.length > max) fail(400, 'Alan uzunluğu geçersiz.'); return v; };
  const email = (v) => { v = str(v, 120).toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail(400, 'E-posta geçersiz.'); return v; };
  const pass = (v) => { if (typeof v !== 'string' || v.length < 10 || v.length > 200) fail(400, 'Şifre en az 10 karakter olmalı.'); return v; };
  const can = (u, p) => !!u && PERMS[p].includes(u.role);
  const needs = (u, p) => { if (!can(u, p)) fail(403, 'Bu işlem için yetkiniz yok.'); };
  const active = (role) => db.users.filter((u) => u.status === 'active' && u.role === role).length;
  const pub = (u) => ({ id: u.id, name: u.name, role: u.role, roleLabel: ROLES[u.role] });

  function newSession(res, user) {
    const t = rnd(32); db.sessions = db.sessions.filter((s) => s.exp > Date.now());
    db.sessions.push({ hash: h(t), uid: user.id, exp: Date.now() + 7 * 864e5 }); save();
    res.setHeader('Set-Cookie', `r43s=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${7 * 86400}${prod ? '; Secure' : ''}`);
  }
  function sessionUser(req) {
    const m = /(?:^|;\s*)r43s=([\w-]+)/.exec(req.headers.cookie || ''); if (!m) return null;
    const s = db.sessions.find((x) => x.hash === h(m[1]) && x.exp > Date.now()); if (!s) return null;
    const u = db.users.find((x) => x.id === s.uid); return u && u.status === 'active' ? u : null;
  }
  const hits = new Map();
  const limit = (req, max = 20, bucket = 'auth') => { max *= rateScale; const k = bucket + req.socket.remoteAddress, n = Date.now(), e = hits.get(k);
    if (!e || n - e.t > 6e5) return void hits.set(k, { t: n, c: 1 }); if (++e.c > max) fail(429, 'Çok fazla deneme. Biraz sonra tekrar deneyin.'); };

  function setup(kind, b, res, req) {
    limit(req, 10, 'setup');
    const st = db.setup[kind];
    if (st.done) fail(404, 'Bulunamadı.'); // kurulum bir kez kullanılır
    if (typeof b.token !== 'string' || !eq(h(b.token), st.hash || '')) {
      if (++st.fails >= 5) rotate(kind); else save();
      fail(403, 'Kurulum kodu hatalı.');
    }
    const user = { id: rnd(9), name: str(b.name, 80, 2), email: email(b.email), pw: hashPw(pass(b.password)), role: kind, status: 'active', at: Date.now() };
    if (db.users.some((u) => u.email === user.email)) fail(409, 'Bu e-posta zaten kayıtlı.');
    db.users.push(user); st.done = true; st.hash = null; delete setupTokens[kind];
    audit(user, 'ilk-kurulum', kind); save(); newSession(res, user);
    return { user: pub(user) };
  }

  const routes = [];
  const R = (method, re, perm, fn) => routes.push({ method, re: new RegExp('^' + re + '$'), perm, fn });
  // perm: false = herkese açık, true = giriş yapmış aktif üye, 'izin.adı' = o izne sahip rol
  R('GET', '/api/status', false, () => ({ setup: { baskan: !db.setup.baskan.done, teknik: !db.setup.teknik.done } }));
  R('POST', '/api/setup/(baskan|teknik)', false, (c) => setup(c.m[1], c.body, c.res, c.req));
  R('POST', '/api/register', false, (c) => {
    limit(c.req, 10, 'register');
    const code = str(c.body.code, 40), inv = db.invites.find((i) => i.hash === h(code.toUpperCase()));
    if (!inv || inv.usedBy || inv.exp < Date.now()) fail(400, 'Davet kodu geçersiz veya süresi dolmuş.');
    const em = email(c.body.email), name = str(c.body.name, 80, 2), pw = pass(c.body.password);
    if (db.users.some((u) => u.email === em)) fail(409, 'Bu e-posta ile zaten bir başvuru veya hesap var.');
    const u = { id: rnd(9), name, email: em, pw: hashPw(pw), role: 'uye', status: 'pending', at: Date.now() };
    db.users.push(u); inv.usedBy = u.id; audit(u, 'basvuru'); save(); return { ok: true };
  });
  R('POST', '/api/login', false, (c) => {
    limit(c.req, 20, 'login');
    const u = db.users.find((x) => x.email === String(c.body.email || '').trim().toLowerCase());
    const ok = u ? checkPw(String(c.body.password || ''), u.pw) : (checkPw('x', hashPw('y')), false);
    if (!ok) fail(401, 'E-posta veya şifre hatalı.');
    if (u.status === 'pending') fail(403, 'Başvurunuz henüz onaylanmadı.');
    if (u.status !== 'active') fail(403, 'Hesabınız aktif değil.');
    newSession(c.res, u); return { user: pub(u) };
  });
  R('POST', '/api/logout', false, (c) => { const m = /r43s=([\w-]+)/.exec(c.req.headers.cookie || '');
    if (m) { db.sessions = db.sessions.filter((s) => s.hash !== h(m[1])); save(); }
    c.res.setHeader('Set-Cookie', 'r43s=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return { ok: true }; });
  R('GET', '/api/me', true, (c) => ({ user: pub(c.user), perms: Object.keys(PERMS).filter((p) => can(c.user, p)) }));

  R('GET', '/api/announcements', true, () => [...db.announcements].sort((a, b) => b.at - a.at));
  R('POST', '/api/announcements', 'announcements.manage', (c) => {
    const a = { id: rnd(6), title: str(c.body.title, 100), body: str(c.body.body, 2000), by: c.user.name, at: Date.now() };
    db.announcements.push(a); audit(c.user, 'duyuru-ekle', a.title); save(); return a; });
  R('DELETE', '/api/announcements/([\\w-]+)', 'announcements.manage', (c) => {
    db.announcements = db.announcements.filter((a) => a.id !== c.m[1]); audit(c.user, 'duyuru-sil'); save(); return { ok: true }; });

  const meetingView = (m, u) => { const rs = db.rsvps.filter((r) => r.mid === m.id), mgr = can(u, 'meetings.manage');
    const out = { ...m, mine: (rs.find((r) => r.uid === u.id) || {}).choice || null, counts: {} };
    for (const k of CHOICES) { const l = rs.filter((r) => r.choice === k); out.counts[k] = l.length;
      if (mgr) (out.names = out.names || {})[k] = l.map((r) => (db.users.find((x) => x.id === r.uid) || {}).name).filter(Boolean); }
    return out; };
  R('GET', '/api/meetings', true, (c) => [...db.meetings].sort((a, b) => a.when - b.when).map((m) => meetingView(m, c.user)));
  R('POST', '/api/meetings', 'meetings.manage', (c) => {
    const when = Date.parse(c.body.when); if (isNaN(when)) fail(400, 'Tarih geçersiz.');
    const m = { id: rnd(6), title: str(c.body.title, 100), place: str(c.body.place, 120), notes: typeof c.body.notes === 'string' ? c.body.notes.trim().slice(0, 1000) : '', when };
    db.meetings.push(m); audit(c.user, 'toplanti-ekle', m.title); save(); return meetingView(m, c.user); });
  R('DELETE', '/api/meetings/([\\w-]+)', 'meetings.manage', (c) => {
    db.meetings = db.meetings.filter((m) => m.id !== c.m[1]); db.rsvps = db.rsvps.filter((r) => r.mid !== c.m[1]); audit(c.user, 'toplanti-sil'); save(); return { ok: true }; });
  R('PUT', '/api/meetings/([\\w-]+)/rsvp', true, (c) => {
    if (!db.meetings.some((m) => m.id === c.m[1])) fail(404, 'Toplantı bulunamadı.');
    if (!CHOICES.includes(c.body.choice)) fail(400, 'Geçersiz seçenek.');
    db.rsvps = db.rsvps.filter((r) => !(r.mid === c.m[1] && r.uid === c.user.id)); db.rsvps.push({ mid: c.m[1], uid: c.user.id, choice: c.body.choice }); save(); return { ok: true }; });

  R('GET', '/api/members', true, () => db.users.filter((u) => u.status === 'active').map(pub));

  R('GET', '/api/applications', 'applications.manage', () => db.users.filter((u) => u.status === 'pending').map((u) => ({ id: u.id, name: u.name, email: u.email, at: u.at })));
  R('POST', '/api/applications/([\\w-]+)/(approve|reject)', 'applications.manage', (c) => {
    const u = db.users.find((x) => x.id === c.m[1] && x.status === 'pending'); if (!u) fail(404, 'Başvuru bulunamadı.');
    if (c.m[2] === 'approve') u.status = 'active'; else db.users = db.users.filter((x) => x !== u);
    audit(c.user, 'basvuru-' + c.m[2], u.name); save(); return { ok: true }; });
  R('GET', '/api/invites', 'invites.manage', () => db.invites.map((i) => ({ id: i.id, at: i.at, exp: i.exp, used: !!i.usedBy })));
  R('POST', '/api/invites', 'invites.manage', (c) => {
    const days = Math.min(Math.max(parseInt(c.body.days, 10) || 7, 1), 30), code = 'R43-' + rnd(8).toUpperCase().replace(/[-_]/g, 'X');
    db.invites.push({ id: rnd(6), hash: h(code), at: Date.now(), exp: Date.now() + days * 864e5, usedBy: null });
    audit(c.user, 'davet-olustur'); save(); return { code }; }); // kod yalnızca bu yanıtta görünür
  R('DELETE', '/api/invites/([\\w-]+)', 'invites.manage', (c) => { db.invites = db.invites.filter((i) => i.id !== c.m[1]); audit(c.user, 'davet-iptal'); save(); return { ok: true }; });

  R('GET', '/api/admin/users', 'users.manage', () => db.users.map((u) => ({ ...pub(u), email: u.email, status: u.status })));
  R('PUT', '/api/admin/users/([\\w-]+)', 'users.manage', (c) => {
    const u = db.users.find((x) => x.id === c.m[1]); if (!u) fail(404, 'Kullanıcı bulunamadı.');
    if (u.id === c.user.id) fail(400, 'Kendi rolünüzü veya durumunuzu değiştiremezsiniz.');
    const old = { role: u.role, status: u.status };
    if (c.body.role !== undefined) { if (!ROLES[c.body.role]) fail(400, 'Geçersiz rol.'); u.role = c.body.role; }
    if (c.body.status !== undefined) { if (!['active', 'suspended'].includes(c.body.status) || u.status === 'pending') fail(400, 'Geçersiz durum.'); u.status = c.body.status; }
    if ((db.setup.baskan.done && !active('baskan')) || (db.setup.teknik.done && !active('teknik'))) { Object.assign(u, old); fail(400, 'En az bir aktif başkan ve bir teknik yönetici kalmalı.'); }
    if (u.status !== 'active') db.sessions = db.sessions.filter((s) => s.uid !== u.id);
    audit(c.user, 'kullanici-guncelle', `${u.name}: ${u.role}/${u.status}`); save(); return { ok: true }; });
  R('GET', '/api/admin/audit', 'audit.view', () => [...db.audit].reverse().slice(0, 100));

  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  const pubDir = path.join(__dirname, 'public');
  const baseHeaders = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };

  const server = http.createServer((req, res) => {
    for (const [k, v] of Object.entries(baseHeaders)) res.setHeader(k, v);
    const url = new URL(req.url, 'http://x'), p = url.pathname;
    const send = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
    if (!p.startsWith('/api/')) {
      const f = p === '/' ? 'index.html' : p.slice(1);
      if (!['index.html', 'app.js', 'app.css'].includes(f)) { res.writeHead(404); return res.end('Bulunamadı'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f)], 'Cache-Control': 'no-cache' }); return res.end(fs.readFileSync(path.join(pubDir, f)));
    }
    const chunks = []; let size = 0;
    req.on('data', (d) => { size += d.length; if (size > 20000) req.destroy(); else chunks.push(d); });
    req.on('end', () => {
      try {
        const route = routes.map((r) => ({ r, m: r.re.exec(p) })).find((x) => x.m && x.r.method === req.method);
        if (!route) fail(404, 'Bulunamadı.');
        if (req.method !== 'GET') { // CSRF savunması: özel başlık + aynı kaynak
          if (req.headers['x-requested-with'] !== 'r43') fail(403, 'İstek reddedildi.');
          if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) fail(403, 'İstek reddedildi.');
        }
        let body = {}; if (chunks.length) { try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { fail(400, 'Geçersiz JSON.'); } }
        if (typeof body !== 'object' || !body || Array.isArray(body)) fail(400, 'Geçersiz veri.');
        const user = sessionUser(req);
        if (route.r.perm) { if (!user) fail(401, 'Giriş yapmalısınız.'); if (route.r.perm !== true) needs(user, route.r.perm); }
        send(200, route.r.fn({ req, res, body, user, m: route.m }));
      } catch (e) {
        if (e instanceof HttpError) send(e.status, { error: e.message });
        else { log('Hata: ' + e.stack); send(500, { error: 'Sunucu hatası.' }); }
      }
    });
  });
  return { server, setupTokens, db: () => db };
}

module.exports = { createApp, ROLES, PERMS };
if (require.main === module) {
  const app = createApp({ dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'), prod: process.env.NODE_ENV === 'production', log: console.log });
  const port = +process.env.PORT || 3000;
  app.server.listen(port, () => console.log(`Riders 43 çalışıyor: http://localhost:${port}`));
}
