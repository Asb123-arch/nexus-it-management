/* Isolated test accounts only. This module is never served to browsers. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createService } = require('../server.cjs');
async function fixture(options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-security-'));
  const service = createService({ dataDir, ...options });
  const adminPassword = 'Test-admin-passphrase-234!';
  await service.initialize({ name: 'Alex Morgan', email: 'admin@nexus.test', password: adminPassword, demo: true });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const origin = service.origin();
  async function request(url, { method = 'GET', body, auth, headers = {} } = {}) {
    const response = await fetch(origin + url, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json', Origin: origin } : {}), ...(auth ? { Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const raw = await response.text(); let data; try { data = JSON.parse(raw); } catch (_) { data = raw; }
    return { status: response.status, data, headers: response.headers };
  }
  async function login(email, password) {
    const r = await request('/api/login', { method: 'POST', body: { email, password } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return { cookie: r.headers.get('set-cookie').split(';')[0], csrf: r.data.csrf, user: r.data.user, email, password, cookieHeader: r.headers.get('set-cookie') };
  }
  const admin = await login('admin@nexus.test', adminPassword);
  const people = { manager: 'EMP-003', technician: 'EMP-009', employee: 'EMP-006', outsider: 'EMP-002' };
  const accounts = { admin };
  const workspace = (await request('/api/workspace', { auth: admin })).data;
  for (const [label, employeeId] of Object.entries(people)) {
    const employee = workspace.employees.find(e => e.id === employeeId);
    const role = label === 'outsider' ? 'employee' : label;
    const password = `Initial-${label}-test-passphrase-234!`, newPassword = `Changed-${label}-test-passphrase-567!`;
    const created = await request('/api/users', { method: 'POST', auth: admin, body: { employeeId, role, password } }); assert.equal(created.status, 201, JSON.stringify(created.data));
    const temporary = await login(employee.email, password);
    const blocked = await request('/api/workspace', { auth: temporary }); assert.equal(blocked.status, 403);
    const changed = await request('/api/password', { method: 'POST', auth: temporary, body: { currentPassword: password, newPassword } }); assert.equal(changed.status, 200, JSON.stringify(changed.data));
    accounts[label] = await login(employee.email, newPassword);
    accounts[label].id = created.data.id;
  }
  return { service, origin, request, login, accounts, dataDir, close: async () => { await service.close(); fs.rmSync(dataDir, { recursive: true, force: true }); } };
}
module.exports = { fixture };
