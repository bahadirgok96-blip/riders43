'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createApp } = require('../server');

let app, base, dir;
const PW = 'test-parola-12345'; // yalnızca testte üretilen geçici veri
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r43-'));
  app = createApp({ dataDir: dir, rateScale: 50 });
  await new Promise((r) => app.server.listen(0, r));
  base = 'http://127.0.0.1:' + app.server.address().port;
});
after(() => { app.server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function call(method, url, body, cookie) {
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'r43', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie');
  return { status: res.status, data: await res.json().catch(() => ({})), cookie: sc ? sc.split(';')[0] : null };
}
const roles = {};
async function login(email) { const r = await call('POST', '/api/login', { email, password: PW }); assert.equal(r.status, 200); return r.cookie; }

test('kurulum: yanlış kod reddedilir, doğru kodla başkan oluşur, tekrar kullanılamaz', async () => {
  assert.equal((await call('POST', '/api/setup/baskan', { token: 'yanlis', name: 'Ali Veli', email: 'b@test.dev', password: PW })).status, 403);
  const ok = await call('POST', '/api/setup/baskan', { token: app.setupTokens.baskan, name: 'Test Başkan', email: 'b@test.dev', password: PW });
  assert.equal(ok.status, 200); assert.equal(ok.data.user.role, 'baskan'); roles.baskan = ok.cookie;
  const again = await call('POST', '/api/setup/baskan', { token: 'herhangi', name: 'Saldirgan', email: 'x@test.dev', password: PW });
  assert.equal(again.status, 404);
  assert.equal((await call('GET', '/api/status')).data.setup.baskan, false);
});
test('kurulum kodu 5 yanlış denemede yenilenir', async () => {
  const old = app.setupTokens.teknik;
  for (let i = 0; i < 5; i++) await call('POST', '/api/setup/teknik', { token: 'x' + i, name: 'A B', email: 't@test.dev', password: PW });
  assert.notEqual(app.setupTokens.teknik, old);
  assert.equal((await call('POST', '/api/setup/teknik', { token: old, name: 'A B', email: 't@test.dev', password: PW })).status, 403);
});
test('teknik yönetici kurulumu ayrı kodla yapılır', async () => {
  const r = await call('POST', '/api/setup/teknik', { token: app.setupTokens.teknik, name: 'Test Teknik', email: 't@test.dev', password: PW });
  assert.equal(r.status, 200); assert.equal(r.data.user.role, 'teknik'); roles.teknik = r.cookie;
});
test('giriş yapmamış kişi özel verilere erişemez', async () => {
  for (const u of ['/api/me', '/api/announcements', '/api/meetings', '/api/members', '/api/applications', '/api/invites', '/api/admin/users', '/api/admin/audit'])
    assert.equal((await call('GET', u)).status, 401, u);
});
test('davet kodu zorunlu; başvuru onaya kadar giriş yapamaz', async () => {
  assert.equal((await call('POST', '/api/register', { code: 'R43-YOK', name: 'Yeni Uye', email: 'u@test.dev', password: PW })).status, 400);
  const inv = await call('POST', '/api/invites', { days: 3 }, roles.baskan); assert.equal(inv.status, 200);
  assert.equal((await call('POST', '/api/register', { code: inv.data.code, name: 'Yeni Uye', email: 'u@test.dev', password: PW })).status, 200);
  assert.equal((await call('POST', '/api/register', { code: inv.data.code, name: 'Baska Kisi', email: 'z@test.dev', password: PW })).status, 400, 'kod tek kullanımlık');
  assert.equal((await call('POST', '/api/login', { email: 'u@test.dev', password: PW })).status, 403);
  const apps = await call('GET', '/api/applications', null, roles.baskan);
  assert.equal((await call('POST', `/api/applications/${apps.data[0].id}/approve`, {}, roles.baskan)).status, 200);
  roles.uye = await login('u@test.dev');
});
test('yetki ayrımı sunucuda uygulanır', async () => {
  const deny = async (m, u, b, who) => assert.equal((await call(m, u, b, roles[who])).status, 403, `${who} ${m} ${u}`);
  await deny('POST', '/api/announcements', { title: 'a', body: 'b' }, 'uye');
  await deny('POST', '/api/announcements', { title: 'a', body: 'b' }, 'teknik');
  await deny('POST', '/api/invites', {}, 'teknik');
  await deny('GET', '/api/applications', null, 'teknik');
  await deny('GET', '/api/admin/users', null, 'baskan');
  await deny('GET', '/api/admin/audit', null, 'baskan');
  await deny('POST', '/api/meetings', { title: 'a', place: 'b', when: '2030-01-01T10:00' }, 'uye');
  await deny('POST', '/api/meetings', { title: 'a', place: 'b', when: '2030-01-01T10:00' }, 'teknik');
  assert.equal((await call('POST', '/api/announcements', { title: 'Hoş geldiniz', body: 'İlk duyuru' }, roles.baskan)).status, 200);
});
test('sürüş odası yöneticisi yalnızca toplantı yönetir; katılım seçenekleri çalışır', async () => {
  const users = (await call('GET', '/api/admin/users', null, roles.teknik)).data, u = users.find((x) => x.email === 'u@test.dev');
  assert.equal((await call('PUT', '/api/admin/users/' + u.id, { role: 'surus_odasi' }, roles.teknik)).status, 200);
  const so = await login('u@test.dev');
  const m = await call('POST', '/api/meetings', { title: 'Aylık buluşma', place: 'Kütahya', when: '2030-05-01T19:00' }, so);
  assert.equal(m.status, 200);
  assert.equal((await call('POST', '/api/announcements', { title: 'a', body: 'b' }, so)).status, 403);
  assert.equal((await call('POST', '/api/invites', {}, so)).status, 403);
  for (const choice of ['katiliyorum', 'katilamiyorum', 'belli_degil'])
    assert.equal((await call('PUT', `/api/meetings/${m.data.id}/rsvp`, { choice }, roles.baskan)).status, 200);
  assert.equal((await call('PUT', `/api/meetings/${m.data.id}/rsvp`, { choice: 'belki' }, roles.baskan)).status, 400);
  const list = (await call('GET', '/api/meetings', null, roles.baskan)).data[0];
  assert.equal(list.mine, 'belli_degil'); assert.equal(list.counts.katiliyorum, 0);
  assert.equal((await call('GET', '/api/meetings', null, roles.teknik)).data[0].names, undefined, 'isimler yalnızca toplantı yöneticilerine');
});
test('rol/durum kuralları: kendini değiştirme ve son yöneticiyi düşürme engellenir', async () => {
  const users = (await call('GET', '/api/admin/users', null, roles.teknik)).data;
  const me = users.find((x) => x.role === 'teknik'), bsk = users.find((x) => x.role === 'baskan');
  assert.equal((await call('PUT', '/api/admin/users/' + me.id, { role: 'uye' }, roles.teknik)).status, 400);
  assert.equal((await call('PUT', '/api/admin/users/' + bsk.id, { role: 'uye' }, roles.teknik)).status, 400);
  assert.equal((await call('GET', '/api/admin/users', null, roles.teknik)).data.find((x) => x.id === bsk.id).role, 'baskan');
});
test('askıya alınan üyenin oturumu hemen geçersiz olur', async () => {
  const u = (await call('GET', '/api/admin/users', null, roles.teknik)).data.find((x) => x.email === 'u@test.dev');
  const c = await login('u@test.dev');
  assert.equal((await call('PUT', '/api/admin/users/' + u.id, { status: 'suspended' }, roles.teknik)).status, 200);
  assert.equal((await call('GET', '/api/me', null, c)).status, 401);
});
test('CSRF: özel başlık olmadan değişiklik reddedilir; şifre hash olarak saklanır', async () => {
  const res = await fetch(base + '/api/announcements', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: roles.baskan }, body: '{"title":"a","body":"b"}' });
  assert.equal(res.status, 403);
  const raw = fs.readFileSync(path.join(dir, 'db.json'), 'utf8');
  assert.ok(!raw.includes(PW)); assert.ok(!raw.includes(app.setupTokens.baskan || 'yok-token'));
});
