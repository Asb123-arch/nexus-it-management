/* Nexus: server-side authorization is the security boundary, never hidden UI controls.
 * Each admin signup owns a NEW isolated organization, never an existing workspace.
 * Organization context comes from the authenticated user, not request IDs/headers.
 * Node 24 + SQLite. Sessions/passwords are not stored in browser localStorage.
 * Admins: all records/accounts. Managers: own department tickets/people and its assets
 * plus available inventory. Technicians: assigned/own tickets and read-only inventory.
 * Employees: own tickets and only their assigned materials (no inventory counts/costs).
 */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const scrypt = promisify(crypto.scrypt);
const D = require('./data.js');
const ROLES = ['admin', 'manager', 'technician', 'employee'];
const STATUSES = ['Open', 'In progress', 'Waiting on employee', 'Resolved', 'Closed'];
const now = () => new Date().toISOString();
const token = () => crypto.randomBytes(32).toString('base64url');
const digest = s => crypto.createHash('sha256').update(s).digest('hex');
class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
function demand(condition, status = 403, message = 'You do not have permission to do this.') { if (!condition) throw new ApiError(status, message); }
function text(value, max = 160, required = true) { demand(typeof value === 'string', 400, 'Invalid text field.'); const v = value.trim(); demand(v.length <= max && (!required || v.length > 0), 400, `Text must contain ${required ? '1' : '0'}–${max} characters.`); return v; }
function email(value) { const v = text(value, 254).toLowerCase(); demand(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 400, 'Enter a valid email address.'); return v; }
function choice(value, list) { demand(list.includes(value), 400, 'Invalid selection.'); return value; }
function keys(body, allowed) { demand(body && typeof body === 'object' && !Array.isArray(body), 400, 'Expected a JSON object.'); demand(Object.keys(body).every(k => allowed.includes(k)), 400, 'Unexpected or protected field.'); }
function equal(a, b) { const aa = Buffer.from(String(a)), bb = Buffer.from(String(b)); return aa.length === bb.length && crypto.timingSafeEqual(aa, bb); }
let activeHashes = 0;
async function derive(password, salt) {
  demand(activeHashes < 4, 429, 'Sign-in is busy. Please try again shortly.');
  activeHashes++;
  try { return await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }); }
  finally { activeHashes--; }
}
async function hashPassword(password) {
  demand(typeof password === 'string' && password.length >= 12 && password.length <= 128 && password.trim().length >= 12, 400, 'Use a password or passphrase of 12–128 characters.');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = await derive(password, salt);
  return `scrypt$32768$${salt}$${hash.toString('hex')}`;
}
async function verifyPassword(password, encoded) {
  const [, , salt, expected] = encoded.split('$');
  const computed = await derive(String(password).slice(0, 128), salt);
  return equal(computed.toString('hex'), expected);
}
function createService(options = {}) {
  // Public signup is for a new organization only; operators can close registration.
  const signupEnabled = options.signupEnabled ?? process.env.NEXUS_ALLOW_SIGNUP !== 'false';
  const directory = options.dataDir || process.env.NEXUS_DATA_DIR || path.join(__dirname, '.private');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); fs.chmodSync(directory, 0o700);
  const dbPath = path.join(directory, 'nexus.sqlite');
  const sql = new DatabaseSync(dbPath); fs.chmodSync(dbPath, 0o600);
  sql.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  if (sql.prepare('PRAGMA user_version').get().user_version < 3) {
    // Back up a populated v2 database before the atomic tenant-schema migration.
    if (sql.prepare("SELECT name FROM sqlite_master WHERE name='users'").get() && sql.prepare('SELECT id FROM users LIMIT 1').get()) {
      const backup = path.join(directory, `before-organizations-${Date.now()}-${crypto.randomUUID()}.sqlite`);
      sql.prepare('VACUUM INTO ?').run(backup); fs.chmodSync(backup, 0o600);
    }
    sql.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;');
    try {
    sql.exec(`
    CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, employee_id TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, role TEXT NOT NULL, hash TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, must_change INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires INTEGER NOT NULL, touched INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS throttle (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until_ms INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS ticket_events (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id TEXT NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, visibility TEXT NOT NULL, time TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id), event_id INTEGER NOT NULL REFERENCES ticket_events(id), read_at TEXT);
    CREATE INDEX IF NOT EXISTS event_ticket ON ticket_events(ticket_id,id);
    CREATE INDEX IF NOT EXISTS notification_user ON notifications(user_id,id);
    CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON ticket_events BEGIN SELECT RAISE(ABORT,'History is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON ticket_events BEGIN SELECT RAISE(ABORT,'History is append-only'); END;
    CREATE TABLE organizations (id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE users_v3 (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), employee_id TEXT NOT NULL, email TEXT COLLATE NOCASE UNIQUE NOT NULL, role TEXT NOT NULL, hash TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, must_change INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1, UNIQUE(organization_id,employee_id));
    ALTER TABLE ticket_events ADD COLUMN organization_id TEXT NOT NULL DEFAULT 'legacy';
    CREATE INDEX event_organization ON ticket_events(organization_id,ticket_id,id);`);
    const legacy = sql.prepare('SELECT json FROM workspace WHERE id=1').get();
    if (legacy) { const d = JSON.parse(legacy.json); d.organizationId = 'legacy'; sql.prepare('INSERT INTO organizations VALUES(?,?)').run('legacy', JSON.stringify(d)); }
    sql.exec(`INSERT INTO users_v3 SELECT id,'legacy',employee_id,email,role,hash,disabled,must_change,version FROM users;
      DROP TABLE users; ALTER TABLE users_v3 RENAME TO users; DROP TABLE workspace;`);
    demand(sql.prepare('PRAGMA foreign_key_check').all().length === 0, 500, 'Organization migration failed referential-integrity checks.');
    sql.exec('PRAGMA user_version=3; COMMIT;');
    } catch (error) { sql.exec('ROLLBACK'); sql.close(); throw error; }
    sql.exec('PRAGMA foreign_keys=ON;');
  }
  // No default tenant: callers must supply the server-owned organization context.
  const getWorkspace = organizationId => { demand(typeof organizationId === 'string', 500, 'Missing organization context.'); const row = sql.prepare('SELECT json FROM organizations WHERE id=?').get(organizationId); demand(row, 401, 'Organization not found.'); return JSON.parse(row.json); };
  const putWorkspace = d => { demand(typeof d.organizationId === 'string', 500, 'Missing organization context.'); return sql.prepare('INSERT INTO organizations(id,json) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(d.organizationId, JSON.stringify(d)); };
  const transaction = fn => { sql.exec('BEGIN IMMEDIATE'); try { const result = fn(); sql.exec('COMMIT'); return result; } catch (err) { sql.exec('ROLLBACK'); throw err; } };
  const allUsers = organizationId => { demand(typeof organizationId === 'string', 500, 'Missing organization context.'); return sql.prepare('SELECT * FROM users WHERE organization_id=?').all(organizationId); };
  const userById = id => sql.prepare('SELECT * FROM users WHERE id=?').get(id);
  const person = (d, id) => d.employees.find(e => e.id === id);
  const department = (d, u) => person(d, u.employee_id)?.department;
  const isLead = u => ['admin', 'manager'].includes(u.role);
  const canTicket = (d, u, t) => !!t && (u.role === 'admin' || (u.role === 'manager' && t.department === department(d, u)) || t.requesterId === u.employee_id || (u.role === 'technician' && t.assigneeId === u.employee_id));
  const canManageTicket = (d, u, t) => u.role === 'admin' || (u.role === 'manager' && t.department === department(d, u));
  const canWork = (d, u, t) => canManageTicket(d, u, t) || (u.role === 'technician' && t.assigneeId === u.employee_id);
  const canAsset = (d, u, a) => !!a && (u.role === 'admin' || u.role === 'technician' || (u.role === 'manager' && (a.status === 'Available' || person(d, a.assigneeId)?.department === department(d, u))) || (a.assigneeId === u.employee_id && a.status === 'Assigned'));
  const publicUser = (d, u) => ({ id: u.id, organizationId: u.organization_id, organization: d.settings.organization, employeeId: u.employee_id, email: u.email, role: u.role, name: person(d, u.employee_id)?.name || 'User', department: department(d, u), mustChangePassword: !!u.must_change });
  const assetView = (u, a) => u.role === 'employee' ? { id: a.id, name: a.name, model: a.model, category: a.category, serial: a.serial, assigneeId: a.assigneeId } : a;
  function scoped(d, u) {
    demand(d.organizationId === u.organization_id, 403, 'Organization access denied.');
    const tickets = d.tickets.filter(t => !t.archived && canTicket(d, u, t));
    const employees = d.employees.filter(e => u.role === 'admin' || (u.role === 'manager' && e.department === department(d, u)) || e.id === u.employee_id);
    const ids = new Set(tickets.flatMap(t => [t.requesterId, t.assigneeId]));
    const directory = d.employees.filter(e => ids.has(e.id) || e.id === u.employee_id).map(e => ({ id: e.id, name: e.name }));
    const assignees = isLead(u) ? allUsers(d.organizationId).filter(a => !a.disabled && ['admin', 'technician'].includes(a.role) && person(d, a.employee_id)?.status === 'Active').map(a => ({ id: a.employee_id, name: person(d, a.employee_id).name })) : [];
    const activity = sql.prepare("SELECT * FROM ticket_events WHERE organization_id=? AND kind!='comment' ORDER BY id DESC LIMIT 500").all(u.organization_id).filter(e => {
      const t = d.tickets.find(t => t.id === e.ticket_id); return canTicket(d, u, t) && !t.archived && (u.role !== 'employee' || e.visibility === 'public');
    }).slice(0, 100).map(e => ({ id: String(e.id), type: 'ticket', recordId: e.ticket_id, text: `${e.actor_name}: ${e.text}`, time: e.time }));
    return { version: 3, organizationId: d.organizationId, employees, directory, assignees, tickets, assets: d.assets.filter(a => canAsset(d, u, a)).map(a => assetView(u, a)), activity, settings: d.settings,
      permissions: { manageEmployees: u.role === 'admin', manageAssets: isLead(u), manageUsers: u.role === 'admin', viewEmployees: isLead(u), viewReports: isLead(u), inventory: u.role !== 'employee' } };
  }
  function event(d, actor, ticket, kind, message, visibility = 'public') {
    demand(d.organizationId === actor.organization_id, 403, 'Organization access denied.');
    const record = sql.prepare('INSERT INTO ticket_events(organization_id,ticket_id,actor_id,actor_name,kind,text,visibility,time) VALUES(?,?,?,?,?,?,?,?)').run(d.organizationId, ticket.id, actor.id, person(d, actor.employee_id)?.name || 'Administrator', kind, message, visibility, now());
    for (const recipient of allUsers(d.organizationId)) {
      if (recipient.id === actor.id || recipient.disabled || !canTicket(d, recipient, ticket) || (visibility === 'internal' && recipient.role === 'employee')) continue;
      if (recipient.role === 'admin' || recipient.role === 'manager' || [ticket.requesterId, ticket.assigneeId].includes(recipient.employee_id)) sql.prepare('INSERT INTO notifications(user_id,event_id) VALUES(?,?)').run(recipient.id, record.lastInsertRowid);
    }
  }
  function notifications(d, u) {
    return sql.prepare('SELECT n.id AS notification_id,n.read_at,e.* FROM notifications n JOIN ticket_events e ON n.event_id=e.id WHERE n.user_id=? AND e.organization_id=? ORDER BY n.id DESC LIMIT 200').all(u.id, u.organization_id).filter(e => {
      const t = d.tickets.find(t => t.id === e.ticket_id); return canTicket(d, u, t) && (!t.archived || u.role === 'admin') && (u.role !== 'employee' || e.visibility === 'public');
    }).map(e => ({ id: Number(e.notification_id), ticketId: e.ticket_id, text: `${e.actor_name}: ${e.kind === 'comment' ? 'Added a ' + (e.visibility === 'internal' ? 'team note' : 'comment') : e.text}`, time: e.time, read: !!e.read_at }));
  }
  const conflict = (record, body) => demand(Number.isInteger(body._version) && body._version === record._version, 409, 'This record changed. Refresh it before saving again.');
  function nextId(d, prefix, collection) { const n = Math.max(d.counters[prefix] || 0, ...d[collection].map(r => Number(r.id.split('-')[1]) || 0)) + 1; d.counters[prefix] = n; return `${prefix}-${String(n).padStart(3, '0')}`; }
  function ensureAssignable(d, id) { if (!id) return; demand(allUsers(d.organizationId).some(u => u.employee_id === id && !u.disabled && ['technician', 'admin'].includes(u.role)) && person(d, id)?.status === 'Active', 400, 'Assign tickets to an active technician or administrator in your organization.'); }
  function ticketPatch(d, u, t, body) {
    demand(canTicket(d, u, t), 404, 'Ticket not found.'); conflict(t, body);
    demand(canWork(d, u, t));
    const lead = canManageTicket(d, u, t);
    keys(body, lead ? ['_version', 'subject', 'description', 'priority', 'category', 'status', 'assigneeId', 'requesterId'] : ['_version', 'status']);
    const before = { ...t };
    for (const key of ['subject', 'description']) if (key in body) t[key] = text(body[key], key === 'description' ? 4000 : 160, key === 'subject');
    if ('priority' in body) t.priority = choice(body.priority, D.enums.priority);
    if ('category' in body) t.category = choice(body.category, D.enums.ticketCategory);
    if ('requesterId' in body) demand(body.requesterId === t.requesterId, 400, 'The original requester cannot be changed.');
    if ('assigneeId' in body) { const id = text(body.assigneeId, 100, false); ensureAssignable(d, id); if (id !== t.assigneeId) { t.assigneeId = id; t.assignmentStatus = id ? 'Assigned' : 'Unassigned'; t.acceptedAt = null; } }
    if ('status' in body) { t.status = choice(body.status, STATUSES); demand(t.status !== 'In progress' || !!t.assigneeId, 400, 'Assign a technician before starting work.'); }
    t.resolvedAt = ['Resolved', 'Closed'].includes(t.status) ? t.resolvedAt || now() : null;
    const labels = { subject: 'Subject', description: 'Description', priority: 'Priority', category: 'Category', status: 'Status', assigneeId: 'Assignment' };
    for (const [key, label] of Object.entries(labels)) if (before[key] !== t[key]) {
      const val = v => key === 'assigneeId' ? person(d, v)?.name || 'Unassigned' : v;
      event(d, u, t, key === 'assigneeId' ? 'assignment' : 'update', key === 'description' ? 'Description updated' : `${label}: ${val(before[key])} → ${val(t[key])}`);
    }
    t.updatedAt = now(); t._version++;
  }
  function throttle(key, max, interval) {
    const time = Date.now(); sql.prepare('DELETE FROM throttle WHERE until_ms<?').run(time);
    const row = sql.prepare('SELECT * FROM throttle WHERE key=?').get(key);
    demand(!row || row.count < max, 429, 'Too many attempts. Please try again later.');
    sql.prepare('INSERT INTO throttle(key,count,until_ms) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, time + interval);
  }
  const dummyHash = `scrypt$32768$${'0'.repeat(32)}$${'0'.repeat(128)}`;
  const sessionIdle = options.idleMs || 30 * 60 * 1000, sessionMax = options.sessionMs || 8 * 60 * 60 * 1000;
  function authenticate(req) {
    const cookie = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('nexus_session='))?.split('=')[1];
    if (!cookie) return null;
    const session = sql.prepare('SELECT * FROM sessions WHERE hash=?').get(digest(cookie));
    if (!session) return null;
    const u = userById(session.user_id);
    if (!u || u.disabled || session.expires <= Date.now() || session.touched < Date.now() - sessionIdle) { sql.prepare('DELETE FROM sessions WHERE hash=?').run(session.hash); return null; }
    // Background notification/session polling must not keep an idle session alive.
    if (!['/api/notifications', '/api/session'].includes(req.url.split('?')[0])) sql.prepare('UPDATE sessions SET touched=? WHERE hash=?').run(Date.now(), session.hash);
    return { user: u, session };
  }
  const configuredOrigin = options.origin || process.env.NEXUS_ORIGIN;
  if (configuredOrigin) { const parsed = new URL(configuredOrigin); demand(parsed.origin === configuredOrigin && ['http:', 'https:'].includes(parsed.protocol), 500, 'NEXUS_ORIGIN must be an exact HTTP(S) origin.'); }
  let server;
  const origin = () => configuredOrigin || `http://127.0.0.1:${server.address()?.port || 4173}`;
  function cookie(res, value, expired = false) { res.setHeader('Set-Cookie', `nexus_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${expired ? 0 : Math.floor(sessionMax / 1000)}${origin().startsWith('https:') ? '; Secure' : ''}`); }
  function respond(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
  async function readJSON(req) {
    demand((req.headers['content-type'] || '').split(';')[0] === 'application/json', 415, 'Use application/json.');
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; demand(size <= 32768, 413, 'Request too large.'); chunks.push(chunk); }
    try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); keys(body, Object.keys(body)); return body; }
    catch (e) { if (e instanceof ApiError) throw e; throw new ApiError(400, 'Invalid JSON.'); }
  }
  async function route(req, res) {
    const url = new URL(req.url, origin()), p = url.pathname, method = req.method;
    // Reject DNS rebinding and cross-origin writes; no CORS headers are granted.
    demand(req.headers.host === new URL(origin()).host, 403, 'Unexpected host. Use the configured workspace URL.');
    if (!['GET', 'HEAD'].includes(method)) demand(req.headers.origin === origin() && !['cross-site'].includes(req.headers['sec-fetch-site']), 403, 'Same-origin requests are required.');
    if (!p.startsWith('/api/')) {
      demand(['GET', 'HEAD'].includes(method), 405, 'Method not allowed.');
      // Explicit allowlist: no SQLite, backups, source server, tests, or exported data.
      const staticFiles = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/client-data.js': 'client-data.js', '/styles.css': 'styles.css', '/auth.css': 'auth.css' };
      demand(Object.hasOwn(staticFiles, p), 404, 'Not found.');
      const filename = staticFiles[p]; const mime = filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'text/html';
      res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8` }); return res.end(method === 'HEAD' ? '' : fs.readFileSync(path.join(__dirname, filename)));
    }
    const auth = authenticate(req);
    if (auth) { res.setHeader('X-Nexus-Account', auth.user.id); res.setHeader('X-Nexus-Organization', auth.user.organization_id); }
    if (p === '/api/session' && method === 'GET') return respond(res, 200, auth ? { user: publicUser(getWorkspace(auth.user.organization_id), auth.user), csrf: auth.session.csrf, signupEnabled } : { user: null, configured: !!sql.prepare('SELECT id FROM users LIMIT 1').get(), signupEnabled });
    if (p === '/api/signup' && method === 'POST') {
      demand(signupEnabled, 403, 'Organization signup is disabled. Contact the server administrator.');
      demand(!auth, 409, 'Sign out before creating a separate organization.');
      throttle('signup-ip:' + req.socket.remoteAddress, 5, 60 * 60 * 1000);
      const body = await readJSON(req); keys(body, ['organization', 'name', 'email', 'password', 'confirmPassword']);
      const organization = text(body.organization, 60), name = text(body.name, 100), address = email(body.email);
      demand(typeof body.confirmPassword === 'string' && body.password === body.confirmPassword, 400, 'Passwords do not match.');
      throttle('signup-email:' + digest(address), 3, 60 * 60 * 1000);
      const hash = await hashPassword(body.password);
      const raw = token(), csrf = token();
      const created = transaction(() => {
        // Duplicate check and all writes share one transaction; races leave no orphan org.
        demand(!sql.prepare('SELECT id FROM users WHERE email=?').get(address), 409, 'Unable to register this email. Sign in or contact your administrator.');
        const organizationId = crypto.randomUUID(), userId = crypto.randomUUID();
        const founder = { id: 'EMP-001', name, email: address, role: 'IT Administrator', department: 'IT', status: 'Active', createdAt: now(), _version: 1 };
        const d = { version: 3, organizationId, employees: [founder], tickets: [], assets: [], activity: [], settings: { organization, compact: false }, counters: { EMP: 1, IT: 1000, AST: 0 } };
        putWorkspace(d);
        sql.prepare('INSERT INTO users(id,organization_id,employee_id,email,role,hash,must_change) VALUES(?,?,?,?,?,?,0)').run(userId, organizationId, founder.id, address, 'admin', hash);
        sql.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(digest(raw), userId, csrf, Date.now() + sessionMax, Date.now());
        return { d, user: userById(userId) };
      });
      res.setHeader('X-Nexus-Account', created.user.id); res.setHeader('X-Nexus-Organization', created.user.organization_id);
      cookie(res, raw); return respond(res, 201, { user: publicUser(created.d, created.user), csrf });
    }
    if (p === '/api/login' && method === 'POST') {
      throttle('ip:' + req.socket.remoteAddress, 50, 15 * 60 * 1000);
      const body = await readJSON(req); keys(body, ['email', 'password']);
      const login = email(body.email); throttle('login:' + digest(login), 8, 15 * 60 * 1000);
      demand(typeof body.password === 'string' && body.password.length <= 128, 401, 'Invalid email or password.');
      const candidate = sql.prepare('SELECT * FROM users WHERE email=?').get(login);
      const verified = await verifyPassword(body.password, candidate?.hash || dummyHash);
      // Re-read after scrypt awaits: a concurrent admin may have disabled/reset this user.
      const u = candidate && userById(candidate.id);
      demand(u && verified && !u.disabled && equal(u.hash, candidate.hash), 401, 'Invalid email or password.');
      const raw = token(), csrf = token();
      transaction(() => { if (auth) sql.prepare('DELETE FROM sessions WHERE hash=?').run(auth.session.hash); sql.prepare('DELETE FROM sessions WHERE expires<? OR touched<?').run(Date.now(), Date.now() - sessionIdle); sql.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(digest(raw), u.id, csrf, Date.now() + sessionMax, Date.now()); sql.prepare('DELETE FROM throttle WHERE key=?').run('login:' + digest(login)); });
      res.setHeader('X-Nexus-Account', u.id); res.setHeader('X-Nexus-Organization', u.organization_id);
      cookie(res, raw); return respond(res, 200, { user: publicUser(getWorkspace(u.organization_id), u), csrf });
    }
    demand(auth, 401, 'Please sign in to continue.');
    let u = auth.user;
    const body = ['POST', 'PATCH', 'DELETE'].includes(method) ? await readJSON(req) : {};
    const freshAuth = authenticate(req);
    demand(freshAuth, 401, 'Your session is no longer active.');
    u = freshAuth.user;
    if (!['GET', 'HEAD'].includes(method)) demand(equal(req.headers['x-csrf-token'] || '', auth.session.csrf), 403, 'Invalid CSRF token. Reload and try again.');
    if (p === '/api/logout' && method === 'POST') { sql.prepare('DELETE FROM sessions WHERE hash=?').run(auth.session.hash); cookie(res, '', true); return respond(res, 200, { ok: true }); }
    if (p === '/api/password' && method === 'POST') {
      keys(body, ['currentPassword', 'newPassword']); throttle('password:' + u.id, 8, 15 * 60 * 1000);
      demand(typeof body.currentPassword === 'string' && await verifyPassword(body.currentPassword, u.hash), 400, 'Current password is incorrect.');
      demand(body.newPassword !== body.currentPassword, 400, 'Choose a different password.');
      const hash = await hashPassword(body.newPassword);
      transaction(() => { const fresh = userById(u.id); demand(fresh && !fresh.disabled && fresh.hash === u.hash, 409, 'Account changed. Sign in again.'); sql.prepare('UPDATE users SET hash=?,must_change=0,version=version+1 WHERE id=?').run(hash, u.id); sql.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id); });
      cookie(res, '', true); return respond(res, 200, { ok: true, message: 'Password changed. Sign in again on each device.' });
    }
    demand(!u.must_change, 403, 'Change your temporary password before accessing workspace data.');
    if (p === '/api/workspace' && method === 'GET') return respond(res, 200, scoped(getWorkspace(u.organization_id), u));
    if (p === '/api/notifications' && method === 'GET') return respond(res, 200, { notifications: notifications(getWorkspace(u.organization_id), u) });
    if (p === '/api/notifications/read' && method === 'POST') { keys(body, ['id']); if (body.id === 'all') sql.prepare('UPDATE notifications SET read_at=? WHERE user_id=?').run(now(), u.id); else { demand(Number.isInteger(body.id), 400, 'Invalid notification ID.'); sql.prepare('UPDATE notifications SET read_at=? WHERE id=? AND user_id=?').run(now(), body.id, u.id); } return respond(res, 200, { ok: true }); }
    if (p === '/api/users' && method === 'GET') { demand(u.role === 'admin'); const d = getWorkspace(u.organization_id); return respond(res, 200, { users: allUsers(u.organization_id).map(a => ({ ...publicUser(d, a), disabled: !!a.disabled, _version: a.version })) }); }
    if (p === '/api/users' && method === 'POST') {
      demand(u.role === 'admin'); keys(body, ['employeeId', 'role', 'password']);
      const hash = await hashPassword(body.password);
      const result = transaction(() => {
        demand(authenticate(req)?.user.role === 'admin');
        const d = getWorkspace(u.organization_id), e = person(d, body.employeeId); demand(e && e.status === 'Active', 400, 'Select an active employee.');
        demand(!allUsers(u.organization_id).some(a => a.employee_id === e.id) && !sql.prepare('SELECT id FROM users WHERE email=?').get(e.email.toLowerCase()), 409, 'Unable to create a login for this employee or email.');
        const id = crypto.randomUUID(); sql.prepare('INSERT INTO users(id,organization_id,employee_id,email,role,hash) VALUES(?,?,?,?,?,?)').run(id, u.organization_id, e.id, email(e.email), choice(body.role, ROLES), hash); return id;
      }); return respond(res, 201, { id: result });
    }
    const userMatch = p.match(/^\/api\/users\/([^/]+)$/);
    if (userMatch && method === 'PATCH') {
      demand(u.role === 'admin'); keys(body, ['_version', 'role', 'disabled', 'password']);
      if ('disabled' in body) demand(typeof body.disabled === 'boolean', 400, 'Invalid account status.');
      const hash = body.password ? await hashPassword(body.password) : null;
      transaction(() => {
        demand(authenticate(req)?.user.role === 'admin');
        const target = userById(userMatch[1]); demand(target && target.organization_id === u.organization_id, 404, 'Account not found.'); conflict({ _version: target.version }, body);
        const role = 'role' in body ? choice(body.role, ROLES) : target.role, disabled = 'disabled' in body ? Number(body.disabled) : target.disabled;
        demand(target.id !== u.id || (!disabled && role === 'admin' && !hash), 400, 'Use your profile to change your password. You cannot disable or demote your own administrator account.');
        demand(target.role !== 'admin' || (role === 'admin' && !disabled) || allUsers(u.organization_id).some(a => a.id !== target.id && a.role === 'admin' && !a.disabled), 400, 'At least one active administrator is required in this organization.');
        sql.prepare('UPDATE users SET role=?,disabled=?,hash=?,must_change=?,version=version+1 WHERE id=?').run(role, disabled, hash || target.hash, hash ? 1 : target.must_change, target.id);
        sql.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
        if (disabled || !['admin', 'technician'].includes(role)) {
          const d = getWorkspace(u.organization_id); for (const t of d.tickets.filter(t => !t.archived && t.assigneeId === target.employee_id && !['Resolved', 'Closed'].includes(t.status))) { t.assigneeId = ''; t.assignmentStatus = 'Unassigned'; t.acceptedAt = null; if (t.status === 'In progress') t.status = 'Open'; t._version++; t.updatedAt = now(); event(d, u, t, 'assignment', 'Assignment cleared because the technician account changed'); } putWorkspace(d);
        }
      }); return respond(res, 200, { ok: true });
    }
    if (p === '/api/settings' && method === 'PATCH') { demand(u.role === 'admin'); keys(body, ['organization', 'compact']); transaction(() => { const d = getWorkspace(u.organization_id); if ('organization' in body) d.settings.organization = text(body.organization, 60); if ('compact' in body) { demand(typeof body.compact === 'boolean', 400); d.settings.compact = body.compact; } putWorkspace(d); }); return respond(res, 200, { ok: true }); }
    const match = p.match(/^\/api\/(tickets|employees|assets)(?:\/([\w-]+))?(?:\/(comments|accept|reopen|history))?$/);
    demand(match, 404, 'Not found.');
    const [, type, id, sub] = match;
    if (method === 'GET') {
      const d = getWorkspace(u.organization_id), view = scoped(d, u);
      if (!id) return respond(res, 200, { [type]: view[type] });
      const r = d[type].find(r => r.id === id);
      demand(type === 'tickets' ? canTicket(d, u, r) && (!r.archived || u.role === 'admin') : type === 'assets' ? canAsset(d, u, r) : view.employees.some(e => e.id === id), 404, 'Record not found.');
      if (type === 'tickets') { const history = sql.prepare('SELECT id,actor_name AS actor,kind,text,visibility,time FROM ticket_events WHERE ticket_id=? AND organization_id=? ORDER BY id ASC').all(id, u.organization_id).filter(e => u.role !== 'employee' || e.visibility === 'public'); return respond(res, 200, { ticket: r, history, permissions: { edit: canWork(d, u, r) && !r.archived, assign: canManageTicket(d, u, r) && !r.archived, accept: ['admin', 'technician'].includes(u.role) && r.assigneeId === u.employee_id && r.assignmentStatus === 'Assigned' && !r.archived, comment: !r.archived, internal: u.role !== 'employee', reopen: r.requesterId === u.employee_id && ['Resolved', 'Closed'].includes(r.status) && !r.archived } }); }
      return respond(res, 200, { record: type === 'assets' ? assetView(u, r) : r });
    }
    const result = transaction(() => {
      const d = getWorkspace(u.organization_id), r = id && d[type].find(r => r.id === id);
      if (id) demand(r, 404, 'Record not found.');
      if (type === 'tickets') {
        if (id) { demand(canTicket(d, u, r), 404, 'Ticket not found.'); demand(!r.archived, 409, 'This ticket is archived.'); }
        if (!id && method === 'POST') {
          keys(body, ['subject', 'description', 'requesterId', 'assigneeId', 'priority', 'category', 'status']);
          const requesterId = body.requesterId || u.employee_id;
          demand(requesterId === u.employee_id || (isLead(u) && person(d, requesterId) && (u.role === 'admin' || person(d, requesterId).department === department(d, u))));
          demand(person(d, requesterId)?.status === 'Active', 400, 'Select an active requester.');
          demand(isLead(u) || ((!body.assigneeId) && (!body.status || body.status === 'Open')));
          const assigneeId = body.assigneeId || ''; ensureAssignable(d, assigneeId);
          const t = { id: nextId(d, 'IT', 'tickets'), subject: text(body.subject), description: text(body.description || '', 4000, false), requesterId, department: person(d, requesterId).department, assigneeId, priority: choice(body.priority || 'Medium', D.enums.priority), category: choice(body.category || 'Other', D.enums.ticketCategory), status: choice(body.status || 'Open', STATUSES), assignmentStatus: assigneeId ? 'Assigned' : 'Unassigned', acceptedAt: null, createdAt: now(), updatedAt: now(), resolvedAt: null, _version: 1, archived: false };
          demand(t.status !== 'In progress' || !!t.assigneeId, 400, 'Assign a technician before starting work.');
          if (['Resolved', 'Closed'].includes(t.status)) t.resolvedAt = now();
          d.tickets.unshift(t); event(d, u, t, 'created', `Created ticket ${t.id}: ${t.subject}`); if (assigneeId) event(d, u, t, 'assignment', `Assigned to ${person(d, assigneeId).name}`); putWorkspace(d); return { id: t.id };
        }
        if (sub === 'comments' && method === 'POST') { keys(body, ['text', 'visibility']); const visibility = choice(body.visibility || 'public', ['public', 'internal']); demand(visibility !== 'internal' || u.role !== 'employee'); throttle('comments:' + u.id, 30, 60000); event(d, u, r, 'comment', text(body.text, 4000), visibility); return { ok: true }; }
        if (sub === 'accept' && method === 'POST') { keys(body, ['_version']); conflict(r, body); demand(['admin', 'technician'].includes(u.role) && r.assigneeId === u.employee_id); demand(r.assignmentStatus === 'Assigned', 409, 'This assignment has already been accepted.'); r.assignmentStatus = 'Accepted'; r.acceptedAt = now(); r.updatedAt = now(); r._version++; event(d, u, r, 'accepted', 'Accepted the ticket assignment'); putWorkspace(d); return { ok: true }; }
        if (sub === 'reopen' && method === 'POST') { keys(body, ['_version']); conflict(r, body); demand(r.requesterId === u.employee_id && ['Resolved', 'Closed'].includes(r.status)); r.status = 'Open'; r.resolvedAt = null; r.updatedAt = now(); r._version++; event(d, u, r, 'update', 'Requester reopened the ticket'); putWorkspace(d); return { ok: true }; }
        if (!sub && id && method === 'PATCH') { ticketPatch(d, u, r, body); putWorkspace(d); return { ok: true }; }
        if (!sub && id && method === 'DELETE') { demand(u.role === 'admin'); keys(body, ['_version']); conflict(r, body); r.archived = true; r._version++; event(d, u, r, 'archived', 'Archived the ticket; history retained'); putWorkspace(d); return { ok: true }; }
      }
      if (type === 'employees' && !sub) {
        demand(u.role === 'admin');
        if (method === 'DELETE') throw new ApiError(400, 'Deactivate employees instead of deleting their ticket history.');
        keys(body, ['_version', 'name', 'email', 'role', 'department', 'status']);
        if (id) conflict(r, body);
        const e = { ...(r || {}), id: id || nextId(d, 'EMP', 'employees'), name: text(body.name), email: email(body.email), role: text(body.role), department: choice(body.department, D.enums.department), status: choice(body.status, D.enums.employeeStatus), createdAt: r?.createdAt || now(), _version: (r?._version || 0) + 1 };
        demand(!d.employees.some(other => other.id !== id && other.email.toLowerCase() === e.email), 409, 'An employee with this email already exists.');
        const account = allUsers(u.organization_id).find(a => a.employee_id === id);
        if (account) {
          demand(e.status === 'Active' || !allUsers(u.organization_id).some(a => a.id === account.id && a.role === 'admin' && !a.disabled), 400, 'Disable/demote this administrator in Access management first.');
          demand(!sql.prepare('SELECT id FROM users WHERE id!=? AND email=?').get(account.id, e.email), 409, 'Unable to use this email for the account.');
          if (e.email !== r.email || e.department !== r.department || e.status === 'Inactive') sql.prepare('DELETE FROM sessions WHERE user_id=?').run(account.id);
          sql.prepare('UPDATE users SET email=?,disabled=?,version=version+1 WHERE id=?').run(e.email, e.status === 'Inactive' ? 1 : account.disabled, account.id);
        }
        if (id) d.employees = d.employees.map(old => old.id === id ? e : old); else d.employees.push(e);
        putWorkspace(d); return { id: e.id };
      }
      if (type === 'assets' && !sub) {
        demand(isLead(u)); if (id) { demand(canAsset(d, u, r), 404, 'Asset not found.'); conflict(r, body); }
        if (method === 'DELETE') { demand(u.role === 'admin'); keys(body, ['_version']); d.assets = d.assets.filter(a => a.id !== id); putWorkspace(d); return { ok: true }; }
        keys(body, ['_version', 'name', 'model', 'serial', 'category', 'status', 'assigneeId', 'value', 'purchaseDate', 'warrantyDate']);
        const assigneeId = body.assigneeId || '', status = choice(body.status, D.enums.assetStatus);
        demand((status === 'Assigned') === !!assigneeId, 400, 'Assigned assets require an employee; other states cannot have an assignee.');
        if (assigneeId) demand(person(d, assigneeId)?.status === 'Active' && (u.role === 'admin' || person(d, assigneeId)?.department === department(d, u)), 403, 'Assign assets only within your department.');
        demand(Number.isFinite(body.value) && body.value >= 0 && body.value <= 100000000, 400, 'Invalid purchase value.');
        for (const k of ['purchaseDate', 'warrantyDate']) demand(body[k] === '' || (typeof body[k] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body[k]) && Number.isFinite(Date.parse(body[k]))), 400, 'Invalid date.');
        demand(!body.purchaseDate || !body.warrantyDate || body.purchaseDate <= body.warrantyDate, 400, 'Warranty expiry cannot precede purchase.');
        const a = { id: id || nextId(d, 'AST', 'assets'), name: text(body.name), model: text(body.model || '', 160, false), serial: text(body.serial), category: choice(body.category, D.enums.assetCategory), status, assigneeId, value: body.value, purchaseDate: body.purchaseDate, warrantyDate: body.warrantyDate, createdAt: r?.createdAt || now(), _version: (r?._version || 0) + 1 };
        demand(!d.assets.some(other => other.id !== id && other.serial.toLowerCase() === a.serial.toLowerCase()), 409, 'This serial number already exists.');
        if (id) d.assets = d.assets.map(old => old.id === id ? a : old); else d.assets.push(a); putWorkspace(d); return { id: a.id };
      }
      throw new ApiError(405, 'Method not allowed.');
    });
    respond(res, !id && method === 'POST' ? 201 : 200, result);
  }
  server = http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer');
    // Existing charts use inline numeric styles; script execution remains strictly self-only.
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (origin().startsWith('https:')) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    route(req, res).catch(err => { if (res.headersSent) { res.end(); return; } if (!(err instanceof ApiError)) console.error('Nexus request failed:', err.message); respond(res, err.status || 500, { error: err.status ? err.message : 'The request could not be completed.' }); });
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  async function initialize({ name, email: address, password, demo = false, legacy = null }) {
    demand(!sql.prepare('SELECT id FROM users LIMIT 1').get(), 409, 'This workspace already has an administrator.');
    demand(!legacy || D.valid(legacy), 400, 'The legacy JSON snapshot is invalid. No data was imported.');
    demand(!legacy || !demo, 400, 'Choose either a legacy import or sample data, not both.');
    const hash = await hashPassword(password);
    transaction(() => {
      demand(!sql.prepare('SELECT id FROM users LIMIT 1').get(), 409, 'Already initialized.');
      const d = legacy ? structuredClone(legacy) : demo ? D.seed() : { employees: [], tickets: [], assets: [], settings: { organization: 'Nexus', compact: false }, activity: [] };
      d.version = 3; d.organizationId = 'legacy'; d.counters = { IT: 1048, EMP: 24, AST: 32 };
      let e = legacy ? d.employees.find(e => e.email.toLowerCase() === email(address)) : d.employees[0];
      if (!e) { e = { id: d.employees.length ? nextId(d, 'EMP', 'employees') : 'EMP-001', name: text(name), email: email(address), role: 'IT Administrator', department: 'IT', status: 'Active', createdAt: now() }; d.employees.push(e); } else { e.name = text(name); e.email = email(address); e.status = 'Active'; }
      const previousAssignments = new Map(d.tickets.map(t => [t.id, { name: person(d, t.assigneeId)?.name || 'Unassigned', status: t.status }]));
      for (const record of [...d.employees, ...d.assets]) record._version = 1;
      for (const t of d.tickets) { t.department = person(d, t.requesterId)?.department || 'IT'; t.assigneeId = ''; t.assignmentStatus = 'Unassigned'; t.acceptedAt = null; t._version = 1; t.archived = false; if (t.status === 'In progress') t.status = 'Open'; }
      putWorkspace(d);
      const id = crypto.randomUUID(); sql.prepare('INSERT INTO users(id,organization_id,employee_id,email,role,hash,must_change) VALUES(?,?,?,?,?,?,0)').run(id, d.organizationId, e.id, e.email, 'admin', hash);
      const actor = userById(id);
      for (const t of d.tickets) {
        event(d, actor, t, 'imported', `${legacy ? 'Legacy' : 'Sample'} ticket imported; verified history starts at import`);
        if (legacy) { const previous = previousAssignments.get(t.id); event(d, actor, t, 'imported', `Legacy assignment: ${previous.name}; legacy status: ${previous.status}. Assignment cleared pending account verification.`); }
      }
      // Asset assignments and record IDs survive legacy import. No browser passwords,
      // sessions, or unverified historical actors are promoted into authenticated data.
      putWorkspace(d);
    });
  }
  return { server, initialize, close: () => new Promise(resolve => { const end = () => { sql.close(); resolve(); }; if (server.listening) server.close(end); else end(); }), origin, dbPath };
}
module.exports = { createService, hashPassword, verifyPassword, ROLES, STATUSES };
if (require.main === module) {
  (async () => {
    const service = createService();
    if (process.argv[2] === 'init') {
      const readline = require('node:readline/promises'); const { Writable } = require('node:stream');
      demand(process.stdin.isTTY, 400, 'Run initialization interactively in a terminal.');
      let hidden = false; const output = new Writable({ write(chunk, encoding, cb) { if (!hidden) process.stdout.write(chunk); cb(); } });
      const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
      try {
        const legacyIndex = process.argv.indexOf('--legacy'); let legacy = null;
        if (legacyIndex >= 0) { const source = process.argv[legacyIndex + 1]; demand(source && fs.statSync(source).size <= 20 * 1024 * 1024, 400, 'Specify a legacy JSON file under 20 MB.'); legacy = JSON.parse(fs.readFileSync(source, 'utf8')); }
        const name = await rl.question('Administrator name: '), address = await rl.question('Administrator email: ');
        process.stdout.write('Password (12–128 characters; hidden): '); hidden = true; const password = await rl.question(''); hidden = false;
        process.stdout.write('\nConfirm password: '); hidden = true; const confirm = await rl.question(''); hidden = false; process.stdout.write('\n');
        demand(password === confirm, 400, 'Passwords did not match.'); await service.initialize({ name, email: address, password, demo: process.argv.includes('--demo'), legacy });
        console.log('Administrator created. Start with: node server.cjs');
      } finally { rl.close(); await service.close(); }
      return;
    }
    const host = process.env.NEXUS_HOST || '127.0.0.1', port = Number(process.env.PORT || 4173);
    demand(host === '127.0.0.1' || host === '::1' || process.env.NEXUS_ORIGIN?.startsWith('https://'), 500, 'Non-loopback binding requires an HTTPS NEXUS_ORIGIN.');
    service.server.listen(port, host, () => { console.log(`Nexus is running at ${service.origin()}`); console.log('Create an organization from Sign up as an admin. Optional operator setup: node server.cjs init --demo.'); });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await service.close(); process.exit(0); });
  })().catch(err => { console.error(err.message); process.exitCode = 1; });
}
