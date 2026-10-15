'use strict';
// Arayüz yalnızca gösterim içindir; her yetki sunucuda ayrıca denetlenir.
const $ = (s) => document.querySelector(s);
const E = (tag, attrs, ...kids) => { const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) { if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v); }
  for (const c of kids.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c)); return el; };
const api = async (method, url, body) => { const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'r43' }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(d.error || 'İşlem başarısız.'), { status: r.status }); return d; };
const fmt = (t) => new Date(t).toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
const LBL = { katiliyorum: 'Katılacağım', katilamiyorum: 'Katılamayacağım', belli_degil: 'Henüz belli değil' };
let me = null, perms = [], status = { setup: {} };
const note = (box, text, ok) => { box.replaceChildren(E('div', { class: 'msg' + (ok ? ' ok' : ''), role: 'status' }, text)); };

function form(fields, label, onSubmit) {
  const box = E('div'), inputs = {};
  const f = E('form', { novalidate: true, onsubmit: async (e) => { e.preventDefault(); const data = {}; for (const k in inputs) data[k] = inputs[k].value;
    try { await onSubmit(data, box); } catch (x) { note(box, x.message); } } },
    fields.map(([k, lab, type, extra]) => { const i = inputs[k] = E(type === 'area' ? 'textarea' : 'input', { id: 'f-' + k, type: type === 'area' ? null : type, autocomplete: extra || 'off', required: true });
      return [E('label', { for: 'f-' + k }, lab), i]; }), box, E('div', { class: 'row' }, E('button', { class: 'btn', type: 'submit' }, label)));
  return f;
}
async function boot() {
  try { status = await api('GET', '/api/status'); } catch {}
  try { const m = await api('GET', '/api/me'); me = m.user; perms = m.perms; } catch { me = null; perms = []; }
  route();
}
function chrome() {
  $('#who').textContent = me ? `${me.name} · ${me.roleLabel}` : '';
  const items = me ? [['#/', 'Ana sayfa'], ['#/takvim', 'Takvim'], ['#/uyeler', 'Üyeler'], ...(perms.length ? [['#/panel', 'Yönetim']] : [])] : [['#/', 'Ana sayfa'], ['#/giris', 'Giriş'], ['#/kayit', 'Üye ol']];
  const cur = location.hash || '#/'; $('#tabs').replaceChildren(...items.map(([h, t]) => E('a', { href: h, 'aria-current': cur === h ? 'page' : null }, t)));
}
function route() {
  chrome(); const r = (location.hash || '#/').slice(1), app = $('#app'); app.replaceChildren();
  const guard = !me && ['/takvim', '/uyeler', '/panel'].includes(r) ? () => view.giris() : null;
  (guard || view[{ '/': 'home', '/giris': 'giris', '/kayit': 'kayit', '/takvim': 'takvim', '/uyeler': 'uyeler', '/panel': 'panel', '/kurulum': 'kurulum', '/teknik-kurulum': 'teknik' }[r] || 'home'])();
}
addEventListener('hashchange', route);

const view = {
  home() {
    const app = $('#app');
    app.append(E('section', { class: 'hero' }, E('div', { class: 'big' }, '43'), E('h1', {}, 'Riders 43'), E('p', {}, 'Kütahya motosiklet topluluğu. Duyurular, toplantılar ve üye alanı yalnızca onaylı üyelere açıktır.')));
    if (!me) {
      if (status.setup.baskan) app.append(E('div', { class: 'card' }, E('h3', {}, 'İlk kurulum bekleniyor'), E('p', {}, 'Sunucu konsolundaki kurulum koduyla kulüp başkanı hesabını oluşturun.'), E('a', { class: 'btn', href: '#/kurulum' }, 'Başkan kurulumunu başlat')));
      if (status.setup.teknik) app.append(E('div', { class: 'card' }, E('h3', {}, 'Teknik yönetici kurulumu'), E('p', {}, 'Ayrı bir kurulum koduyla teknik yönetici hesabı oluşturulur.'), E('a', { class: 'btn dark', href: '#/teknik-kurulum' }, 'Teknik yönetici kurulumu')));
      app.append(E('div', { class: 'row' }, E('a', { class: 'btn', href: '#/giris' }, 'Giriş yap'), E('a', { class: 'btn ghost', href: '#/kayit' }, 'Davet koduyla üye ol'))); return; }
    app.append(E('h2', {}, 'Duyurular')); const box = E('div'); app.append(box);
    api('GET', '/api/announcements').then((l) => box.replaceChildren(...(l.length ? l.map((a) => E('article', { class: 'card' }, E('h3', {}, a.title), E('p', {}, a.body), E('div', { class: 'meta' }, `${a.by} · ${fmt(a.at)}`))) : [E('div', { class: 'empty' }, 'Henüz duyuru yok.')])), (e) => note(box, e.message));
  },
  giris() { $('#app').append(E('h2', {}, 'Giriş yap'), form([['email', 'E-posta', 'email', 'username'], ['password', 'Şifre', 'password', 'current-password']], 'Giriş yap', async (d) => { await api('POST', '/api/login', d); location.hash = '#/'; await boot(); })); },
  kayit() { $('#app').append(E('h2', {}, 'Üyelik başvurusu'), E('p', { class: 'meta' }, 'Davet kodu kulüp başkanından alınır. Başvuru onaylandıktan sonra giriş yapabilirsiniz.'),
    form([['code', 'Davet kodu', 'text'], ['name', 'Ad soyad', 'text', 'name'], ['email', 'E-posta', 'email', 'username'], ['password', 'Şifre (en az 10 karakter)', 'password', 'new-password']], 'Başvuruyu gönder', async (d, box) => { await api('POST', '/api/register', d); note(box, 'Başvurunuz alındı. Onaylandığında giriş yapabilirsiniz.', true); })); },
  kurulum() { setupView('baskan', 'Kulüp başkanı kurulumu'); },
  teknik() { setupView('teknik', 'Teknik yönetici kurulumu'); },
  takvim() {
    const app = $('#app'); app.append(E('h2', {}, 'Toplantı takvimi')); const box = E('div'); app.append(box);
    const load = () => api('GET', '/api/meetings').then((l) => box.replaceChildren(...(l.length ? l.map((m) => E('article', { class: 'card' }, E('h3', {}, m.title), E('div', { class: 'meta' }, `${fmt(m.when)} · ${m.place}`), m.notes ? E('p', {}, m.notes) : null,
      E('div', { class: 'row rsvp', role: 'group', 'aria-label': 'Katılım durumu' }, Object.entries(LBL).map(([k, t]) => E('button', { class: 'btn', 'aria-pressed': m.mine === k, onclick: async () => { try { await api('PUT', `/api/meetings/${m.id}/rsvp`, { choice: k }); load(); } catch (e) { note(box, e.message); } } }, t))),
      E('div', { class: 'meta' }, Object.entries(LBL).map(([k, t]) => `${t}: ${m.counts[k]}`).join(' · ')),
      m.names ? E('div', { class: 'meta' }, Object.entries(LBL).map(([k, t]) => `${t}: ${m.names[k].join(', ') || '-'}`).join(' | ')) : null)) : [E('div', { class: 'empty' }, 'Planlanmış toplantı yok.')])), (e) => note(box, e.message));
    load();
  },
  uyeler() { const box = E('div'); $('#app').append(E('h2', {}, 'Üyeler'), box);
    api('GET', '/api/members').then((l) => box.replaceChildren(...l.map((u) => E('div', { class: 'card' }, u.name, E('span', { class: 'tag' + (u.role === 'uye' ? '' : ' red') }, u.roleLabel)))), (e) => note(box, e.message)); },
  panel() {
    const app = $('#app'), has = (p) => perms.includes(p); app.append(E('h1', {}, 'Yönetim'));
    const sec = (title, perm, build) => { if (!has(perm)) return; const box = E('div'); app.append(E('h2', {}, title), box); build(box); };
    sec('Bekleyen başvurular', 'applications.manage', (box) => { const load = () => api('GET', '/api/applications').then((l) => box.replaceChildren(...(l.length ? l.map((a) => E('div', { class: 'card' }, E('strong', {}, a.name), E('div', { class: 'meta' }, `${a.email} · ${fmt(a.at)}`),
      E('div', { class: 'row' }, E('button', { class: 'btn sm', onclick: () => api('POST', `/api/applications/${a.id}/approve`, {}).then(load) }, 'Onayla'), E('button', { class: 'btn sm dark', onclick: () => api('POST', `/api/applications/${a.id}/reject`, {}).then(load) }, 'Reddet')))) : [E('div', { class: 'empty' }, 'Bekleyen başvuru yok.')]))); load(); });
    sec('Davet kodları', 'invites.manage', (box) => { const out = E('div'), list = E('div'); const load = () => api('GET', '/api/invites').then((l) => list.replaceChildren(...l.map((i) => E('div', { class: 'card' }, i.used ? 'Kullanıldı' : i.exp < Date.now() ? 'Süresi doldu' : 'Geçerli', E('span', { class: 'meta' }, ` · son tarih ${fmt(i.exp)}`), E('div', { class: 'row' }, E('button', { class: 'btn sm dark', onclick: () => api('DELETE', '/api/invites/' + i.id).then(load) }, 'İptal et'))))));
      box.append(E('button', { class: 'btn', onclick: async () => { const r = await api('POST', '/api/invites', { days: 7 }); out.replaceChildren(E('p', { class: 'meta' }, 'Kod yalnızca şimdi görünür. 7 gün geçerli, tek kullanımlık:'), E('div', { class: 'code' }, r.code)); load(); } }, 'Yeni davet kodu oluştur'), out, list); load(); });
    sec('Duyuru yönetimi', 'announcements.manage', (box) => { const list = E('div'); const load = () => api('GET', '/api/announcements').then((l) => list.replaceChildren(...l.map((a) => E('div', { class: 'card' }, a.title, E('div', { class: 'row' }, E('button', { class: 'btn sm dark', onclick: () => api('DELETE', '/api/announcements/' + a.id).then(load) }, 'Sil'))))));
      box.append(form([['title', 'Başlık', 'text'], ['body', 'Metin', 'area']], 'Duyuruyu yayınla', async (d, b) => { await api('POST', '/api/announcements', d); note(b, 'Yayınlandı.', true); load(); }), list); load(); });
    sec('Toplantı yönetimi', 'meetings.manage', (box) => { const list = E('div'); const load = () => api('GET', '/api/meetings').then((l) => list.replaceChildren(...l.map((m) => E('div', { class: 'card' }, `${m.title} · ${fmt(m.when)}`, E('div', { class: 'row' }, E('button', { class: 'btn sm dark', onclick: () => api('DELETE', '/api/meetings/' + m.id).then(load) }, 'Sil'))))));
      box.append(form([['title', 'Toplantı adı', 'text'], ['place', 'Yer', 'text'], ['when', 'Tarih ve saat', 'datetime-local']], 'Toplantıyı ekle', async (d, b) => { await api('POST', '/api/meetings', d); note(b, 'Eklendi.', true); load(); }), list); load(); });
    sec('Kullanıcı ve rol yönetimi', 'users.manage', (box) => { const R = { baskan: 'Kulüp Başkanı', teknik: 'Teknik Yönetici', surus_odasi: 'Sürüş Odası Yöneticisi', uye: 'Üye' }; const load = () => api('GET', '/api/admin/users').then((l) => box.replaceChildren(...l.map((u) => {
      const sel = E('select', { 'aria-label': u.name + ' rolü', disabled: u.id === me.id }, Object.entries(R).map(([k, t]) => E('option', { value: k, selected: k === u.role }, t)));
      const go = (body) => api('PUT', '/api/admin/users/' + u.id, body).then(load, (e) => alert(e.message));
      return E('div', { class: 'card' }, E('strong', {}, u.name), E('span', { class: 'tag' }, u.status === 'active' ? 'aktif' : u.status === 'pending' ? 'onay bekliyor' : 'askıda'), E('div', { class: 'meta' }, u.email),
        u.id === me.id ? null : E('div', { class: 'row' }, sel, E('button', { class: 'btn sm', onclick: () => go({ role: sel.value }) }, 'Rolü kaydet'), u.status === 'pending' ? null : E('button', { class: 'btn sm dark', onclick: () => go({ status: u.status === 'active' ? 'suspended' : 'active' }) }, u.status === 'active' ? 'Askıya al' : 'Etkinleştir'))); }))); load(); });
    sec('İşlem kayıtları', 'audit.view', (box) => api('GET', '/api/admin/audit').then((l) => box.replaceChildren(...l.slice(0, 30).map((a) => E('div', { class: 'meta' }, `${fmt(a.at)} · ${a.by} · ${a.action} ${a.detail}`)))));
    app.append(E('div', { class: 'row' }, E('button', { class: 'btn ghost', onclick: async () => { await api('POST', '/api/logout', {}); me = null; location.hash = '#/'; await boot(); } }, 'Çıkış yap')));
  },
};
function setupView(kind, title) {
  if (!status.setup[kind]) { $('#app').append(E('h2', {}, title), E('div', { class: 'msg' }, 'Bu kurulum tamamlanmış ve tekrar kullanılamaz.')); return; }
  $('#app').append(E('h2', {}, title), E('p', { class: 'meta' }, 'Kurulum kodu sunucu konsoluna yazdırılır; kaynak kodda veya bu sayfada bulunmaz.'),
    form([['token', 'Kurulum kodu', 'password'], ['name', 'Ad soyad', 'text', 'name'], ['email', 'E-posta', 'email', 'username'], ['password', 'Şifre (en az 10 karakter)', 'password', 'new-password']], 'Hesabı oluştur', async (d) => { await api('POST', '/api/setup/' + kind, d); location.hash = '#/'; await boot(); }));
}
boot();
