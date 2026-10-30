/* Organization signup and tenancy regression tests. Uses temporary databases only. */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { createService, hashPassword } = require('../server.cjs');
const { fixture } = require('./helpers.cjs');
const password = 'Organization-test-passphrase-123!';
const body = (organization, email) => ({ organization, name: organization + ' Admin', email, password, confirmPassword: password });
const authFrom = response => ({ cookie: response.headers.get('set-cookie').split(';')[0], csrf: response.data.csrf, user: response.data.user });

test('signup creates isolated organizations, not administrators of existing ones', async t => {
  const f = await fixture();
  const request = (url, auth, method = 'GET', data) => f.request('/api' + url, { auth, method, body: data });
  const signup = data => request('/signup', null, 'POST', data);
  const original = (await request('/workspace', f.accounts.admin)).data;
  let a, b;
  try {
    await t.test('login metadata advertises registration without listing organizations', async () => { const r = await request('/session'); assert.equal(r.data.signupEnabled, true); assert.equal(r.data.user, null); assert.ok(!('organizations' in r.data)); });
    await t.test('an authenticated employee cannot use signup to elevate their account', async () => { const r = await request('/signup', f.accounts.employee, 'POST', body('Bad', f.accounts.employee.email)); assert.equal(r.status, 409); assert.equal((await request('/session', f.accounts.employee)).data.user.role, 'employee'); });
    await t.test('signup atomically creates a fresh organization, admin, and protected session', async () => {
      const response = await signup(body('Alpha Labs', 'alpha@organizations.test')); assert.equal(response.status, 201, JSON.stringify(response.data)); a = authFrom(response);
      assert.equal(a.user.role, 'admin'); assert.equal(a.user.organization, 'Alpha Labs'); assert.ok(a.user.organizationId && a.user.organizationId !== 'legacy'); assert.equal(a.user.mustChangePassword, false);
      assert.match(response.headers.get('set-cookie'), /HttpOnly/); assert.match(response.headers.get('set-cookie'), /SameSite=Strict/);
      const d = (await request('/workspace', a)).data; assert.equal(d.employees.length, 1); assert.equal(d.employees[0].email, 'alpha@organizations.test'); assert.equal(d.tickets.length, 0); assert.equal(d.assets.length, 0); assert.equal(d.activity.length, 0); assert.equal(d.settings.organization, 'Alpha Labs');
    });
    await t.test('a second signup has its own org despite overlapping local employee IDs', async () => {
      const response = await signup(body('Beta Systems', 'beta@organizations.test')); assert.equal(response.status, 201); b = authFrom(response);
      assert.notEqual(a.user.organizationId, b.user.organizationId); assert.equal(a.user.employeeId, b.user.employeeId);
      assert.equal((await request('/users', a)).data.users.length, 1); assert.equal((await request('/users', b)).data.users[0].email, 'beta@organizations.test');
    });
    await t.test('duplicate email (including existing employees and case variants) does not create or overwrite an org', async () => {
      const r = await signup(body('Takeover', f.accounts.employee.email.toUpperCase())); assert.equal(r.status, 409);
      const check = new DatabaseSync(f.service.dbPath); try { assert.equal(check.prepare('SELECT count(*) AS n FROM organizations').get().n, 3); } finally { check.close(); }
      assert.equal((await request('/session', f.accounts.employee)).data.user.role, 'employee');
    });
    await t.test('signup rejects caller-selected existing organization IDs and access roles', async () => { const r = await signup({ ...body('Intruder', 'intruder@organizations.test'), organizationId: 'legacy', role: 'admin' }); assert.equal(r.status, 400); });
    await t.test('password confirmation is checked on the server', async () => { const r = await signup({ ...body('Mismatch', 'mismatch@organizations.test'), confirmPassword: 'Different-test-passphrase' }); assert.equal(r.status, 400); assert.match(r.data.error, /match/); });
    await t.test('signup is persistently IP-rate-limited', async () => { const r = await signup(body('Sixth', 'sixth@organizations.test')); assert.equal(r.status, 429); });
    await t.test('existing workspace data, accounts, and history remain unchanged', async () => { const d = (await request('/workspace', f.accounts.admin)).data; assert.deepEqual(d, original); assert.equal((await request('/users', f.accounts.admin)).data.users.length, 5); });
    await t.test('new admins cannot read original tickets, assets, employee IDs, or users', async () => {
      assert.equal((await request('/tickets/IT-1048', a)).status, 404); assert.equal((await request('/assets/AST-001', a)).status, 404); assert.equal((await request('/employees/EMP-006', a)).status, 404);
      const own = (await request('/employees/EMP-001', a)).data.record; assert.equal(own.email, 'alpha@organizations.test');
      assert.equal((await request('/users/' + f.accounts.employee.id, a, 'PATCH', { _version: 2, role: 'admin' })).status, 404);
      assert.equal((await request('/users/' + b.user.id, a, 'PATCH', { _version: 1, disabled: true })).status, 404);
    });
    await t.test('tenant headers/query strings cannot override session organization', async () => { const r = await f.request('/api/workspace?organizationId=legacy', { auth: a, headers: { 'X-Organization-Id': 'legacy' } }); assert.equal(r.data.organizationId, a.user.organizationId); assert.equal(r.data.assets.length, 0); });
    await t.test('settings updates are scoped and cannot transfer organization ownership', async () => {
      assert.equal((await request('/settings', a, 'PATCH', { organization: 'Alpha Renamed' })).status, 200);
      assert.equal((await request('/workspace', b)).data.settings.organization, 'Beta Systems'); assert.equal((await request('/workspace', f.accounts.admin)).data.settings.organization, original.settings.organization);
      assert.equal((await request('/settings', a, 'PATCH', { organizationId: b.user.organizationId })).status, 400);
    });
    let ta, tb;
    await t.test('overlapping ticket IDs have separate content and event histories', async () => {
      ta = (await request('/tickets', a, 'POST', { subject: 'Alpha confidential' })).data.id;
      tb = (await request('/tickets', b, 'POST', { subject: 'Beta confidential' })).data.id;
      assert.equal(ta, tb); assert.equal(ta, 'IT-1001');
      await request('/tickets/' + ta + '/comments', a, 'POST', { text: 'Alpha internal diagnosis', visibility: 'internal' });
      await request('/tickets/' + tb + '/comments', b, 'POST', { text: 'Beta public message' });
      const da = (await request('/tickets/' + ta + '/history', a)).data, db = (await request('/tickets/' + tb + '/history', b)).data;
      assert.ok(!JSON.stringify(da).includes('Beta')); assert.ok(!JSON.stringify(db).includes('Alpha')); assert.ok(da.history.some(h => h.text === 'Alpha internal diagnosis'));
      const dl = (await request('/tickets/IT-1001', f.accounts.admin)).data; assert.ok(!JSON.stringify(dl).includes('confidential'));
    });
    await t.test('ticket mutation changes only the authenticated organization', async () => {
      assert.equal((await request('/tickets/' + ta, a, 'PATCH', { _version: 1, status: 'Resolved' })).status, 200);
      assert.equal((await request('/tickets/' + tb, b)).data.ticket.status, 'Open');
      assert.equal((await request('/tickets/' + ta, a, 'PATCH', { _version: 2, assigneeId: f.accounts.technician.user.employeeId })).status, 400);
    });
    await t.test('notifications and activity never cross organization boundaries', async () => {
      const legacyNotifications = (await request('/notifications', f.accounts.admin)).data;
      assert.ok(!JSON.stringify(legacyNotifications).includes('Alpha')); assert.ok(!JSON.stringify(legacyNotifications).includes('Beta'));
      for (const [auth, other] of [[a, 'Beta'], [b, 'Alpha']]) { assert.ok(!JSON.stringify((await request('/workspace', auth)).data.activity).includes(other)); assert.equal((await request('/notifications', auth)).data.notifications.length, 0); }
    });
    await t.test('user provisioning uses organization-local employee IDs', async () => {
      const employee = { name: 'Alpha Employee', email: 'alpha.employee@organizations.test', role: 'Analyst', department: 'IT', status: 'Active' };
      const ea = (await request('/employees', a, 'POST', employee)).data.id;
      const eb = (await request('/employees', b, 'POST', { ...employee, name: 'Beta Employee', email: 'beta.employee@organizations.test' })).data.id;
      assert.equal(ea, eb);
      assert.equal((await request('/users', a, 'POST', { employeeId: ea, role: 'employee', password })).status, 201);
      assert.equal((await request('/users', b, 'POST', { employeeId: eb, role: 'employee', password })).status, 201);
      assert.ok((await request('/users', a)).data.users.every(u => u.organizationId === a.user.organizationId));
    });
    await t.test('new admin can sign out and sign back in to the same organization', async () => {
      await request('/logout', a, 'POST', {}); assert.equal((await request('/workspace', a)).status, 401);
      a = await f.login('alpha@organizations.test', password);
      assert.equal(a.user.organization, 'Alpha Renamed'); assert.equal((await request('/tickets/' + ta, a)).data.ticket.subject, 'Alpha confidential');
    });
  } finally { await f.close(); }
});

test('signup validation and operator policy on a fresh server', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-signup-validation-'));
  let service = createService({ dataDir });
  const start = () => new Promise(r => service.server.listen(0, '127.0.0.1', r));
  const signup = async data => { const response = await fetch(service.origin() + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: service.origin() }, body: JSON.stringify(data) }); return { status: response.status, data: await response.json() }; };
  try {
    await start();
    for (const [label, overrides] of [['blank organization', { organization: '  ' }], ['oversized organization', { organization: 'a'.repeat(61) }], ['invalid email', { email: 'not-an-email' }], ['short password', { password: 'short', confirmPassword: 'short' }]]) await t.test(label + ' is rejected with no partial organization', async () => { const r = await signup({ ...body('Validation', 'validation@organizations.test'), ...overrides }); assert.equal(r.status, 400); const db = new DatabaseSync(service.dbPath); try { assert.equal(db.prepare('SELECT count(*) n FROM organizations').get().n, 0); } finally { db.close(); } });
    await t.test('first organization can be created in the browser without terminal init', async () => { const r = await signup(body('First Organization', 'first@organizations.test')); assert.equal(r.status, 201); });
    await t.test('operator can disable new signups without affecting existing logins', async () => { await service.close(); service = createService({ dataDir, signupEnabled: false }); await start(); const metadata = await (await fetch(service.origin() + '/api/session')).json(); assert.equal(metadata.signupEnabled, false); const r = await signup(body('Closed', 'closed@organizations.test')); assert.equal(r.status, 403); const login = await fetch(service.origin() + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: service.origin() }, body: JSON.stringify({ email: 'first@organizations.test', password }) }); assert.equal(login.status, 200); });
  } finally { await service.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('existing v2 database migrates atomically without losing accounts, sessions, or history', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-v2-migration-'));
  const dbPath = path.join(dataDir, 'nexus.sqlite');
  const seed = require('../data.js').seed();
  const cookie = 'old-session-token-' + crypto.randomUUID(), csrf = 'old-csrf';
  const hash = await hashPassword(password);
  const old = new DatabaseSync(dbPath);
  old.exec(`CREATE TABLE workspace(id INTEGER PRIMARY KEY CHECK(id=1),json TEXT NOT NULL);
    CREATE TABLE users(id TEXT PRIMARY KEY,employee_id TEXT UNIQUE NOT NULL,email TEXT UNIQUE NOT NULL,role TEXT NOT NULL,hash TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0,must_change INTEGER NOT NULL DEFAULT 1,version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL,touched INTEGER NOT NULL);
    CREATE TABLE ticket_events(id INTEGER PRIMARY KEY AUTOINCREMENT,ticket_id TEXT NOT NULL,actor_id TEXT NOT NULL,actor_name TEXT NOT NULL,kind TEXT NOT NULL,text TEXT NOT NULL,visibility TEXT NOT NULL,time TEXT NOT NULL);
    CREATE TABLE notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL REFERENCES users(id),event_id INTEGER NOT NULL REFERENCES ticket_events(id),read_at TEXT);`);
  old.prepare('INSERT INTO workspace VALUES(1,?)').run(JSON.stringify({ ...seed, version: 2, counters: { IT: 1048, EMP: 24, AST: 32 } }));
  old.prepare('INSERT INTO users(id,employee_id,email,role,hash,must_change) VALUES(?,?,?,?,?,0)').run('existing-admin', 'EMP-001', seed.employees[0].email, 'admin', hash);
  old.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(crypto.createHash('sha256').update(cookie).digest('hex'), 'existing-admin', csrf, Date.now() + 3600000, Date.now());
  old.prepare('INSERT INTO ticket_events VALUES(1,?,?,?,?,?,?,?)').run('IT-1048', 'existing-admin', 'Alex Morgan', 'comment', 'Existing historical comment', 'public', new Date().toISOString());
  old.prepare('INSERT INTO notifications VALUES(1,?,?,NULL)').run('existing-admin', 1);
  old.close();
  let service;
  try {
    service = createService({ dataDir }); await new Promise(r => service.server.listen(0, '127.0.0.1', r));
    const get = async url => { const r = await fetch(service.origin() + '/api' + url, { headers: { Cookie: `nexus_session=${cookie}` } }); assert.equal(r.status, 200); return r.json(); };
    await t.test('original records and password hash survive migration', async () => { const db = new DatabaseSync(dbPath); try { assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3); assert.equal(db.prepare('SELECT hash FROM users').get().hash, hash); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []); } finally { db.close(); } const d = await get('/workspace'); assert.equal(d.organizationId, 'legacy'); assert.equal(d.tickets.length, 48); assert.equal(d.assets.length, 32); });
    await t.test('original cookie session still identifies the same administrator', async () => { const s = await get('/session'); assert.equal(s.user.id, 'existing-admin'); assert.equal(s.user.organizationId, 'legacy'); assert.equal(s.csrf, csrf); });
    await t.test('history and notification IDs/read state are preserved', async () => { const h = await get('/tickets/IT-1048'); assert.equal(h.history[0].text, 'Existing historical comment'); const n = await get('/notifications'); assert.equal(n.notifications[0].id, 1); assert.equal(n.notifications[0].read, false); });
    await t.test('pre-migration backup is private and contains the old schema', async () => { const backup = fs.readdirSync(dataDir).find(n => n.startsWith('before-organizations-')); assert.ok(backup); assert.equal(fs.statSync(path.join(dataDir, backup)).mode & 0o777, 0o600); const db = new DatabaseSync(path.join(dataDir, backup)); try { assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='workspace'").get()); } finally { db.close(); } });
    await t.test('restart is idempotent and does not remigrate or duplicate records', async () => { await service.close(); service = createService({ dataDir }); const db = new DatabaseSync(dbPath); try { assert.equal(db.prepare('SELECT count(*) n FROM organizations').get().n, 1); assert.equal(db.prepare('SELECT count(*) n FROM ticket_events').get().n, 1); } finally { db.close(); } assert.equal(fs.readdirSync(dataDir).filter(n => n.startsWith('before-organizations-')).length, 1); });
  } finally { if (service) await service.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});
