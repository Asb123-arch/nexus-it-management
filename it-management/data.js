/* Nexus data model. Fictional demo records; no remote API or authentication.
 * Keep record relationships explicit so deleting a person cannot strand assignments.
 * Dates are seeded relative to the first launch and then persisted with the workspace.
 */
(function (root) {
  'use strict';
  const KEY = 'nexus-it-workspace-v1';
  const enums = {
    department: ['Engineering', 'Design', 'Marketing', 'Operations', 'Finance', 'People', 'IT'],
    employeeStatus: ['Active', 'On leave', 'Inactive'],
    ticketStatus: ['Open', 'In progress', 'Resolved', 'Closed'],
    priority: ['Low', 'Medium', 'High', 'Urgent'],
    ticketCategory: ['Hardware', 'Software', 'Access', 'Network', 'Other'],
    assetStatus: ['Available', 'Assigned', 'Maintenance', 'Retired'],
    assetCategory: ['Laptop', 'Monitor', 'Phone', 'Accessory', 'Network']
  };
  const isoAgo = (days, now = new Date()) => new Date(now.getTime() - days * 86400000).toISOString();
  function seed(now = new Date()) {
    const people = [
      ['Alex Morgan', 'IT Administrator', 'IT'], ['Olivia Rhye', 'Product Designer', 'Design'],
      ['Phoenix Baker', 'Engineering Lead', 'Engineering'], ['Lana Steiner', 'People Partner', 'People'],
      ['Demi Wilkinson', 'Marketing Manager', 'Marketing'], ['Drew Cano', 'Software Engineer', 'Engineering'],
      ['Natali Craig', 'Finance Analyst', 'Finance'], ['Orlando Diggs', 'Operations Lead', 'Operations'],
      ['Andi Lane', 'IT Support Specialist', 'IT'], ['Kate Morrison', 'UX Researcher', 'Design'],
      ['James Wilson', 'Software Engineer', 'Engineering'], ['Sofia Chen', 'IT Systems Engineer', 'IT'],
      ['Noah Williams', 'Accountant', 'Finance'], ['Emma Davis', 'Content Strategist', 'Marketing'],
      ['Liam Patel', 'DevOps Engineer', 'Engineering'], ['Ava Thompson', 'Recruiter', 'People'],
      ['Ethan Brooks', 'Product Manager', 'Operations'], ['Isabella Kim', 'Brand Designer', 'Design'],
      ['Lucas Martin', 'Security Analyst', 'IT'], ['Mia Robinson', 'Customer Success Lead', 'Operations'],
      ['Oliver Lee', 'Frontend Engineer', 'Engineering'], ['Amelia Clark', 'Growth Specialist', 'Marketing'],
      ['Benjamin Scott', 'Data Engineer', 'Engineering'], ['Charlotte Young', 'Office Manager', 'Operations']
    ];
    const employees = people.map(([name, role, department], i) => ({
      id: `EMP-${String(i + 1).padStart(3, '0')}`, name, role, department,
      email: `${name.toLowerCase().replaceAll(' ', '.')}@nexus.example`,
      status: i === 9 || i === 15 ? 'On leave' : 'Active', createdAt: isoAgo(120 + i, now)
    }));
    const subjects = [
      ['Unable to connect to office VPN', 'Network', 'High'],
      ['New laptop setup for onboarding', 'Hardware', 'Medium'],
      ['Figma license access request', 'Access', 'Low'],
      ['Monitor not detecting HDMI input', 'Hardware', 'Medium'],
      ['Email account locked out', 'Access', 'Urgent'],
      ['Slow Wi-Fi on the second floor', 'Network', 'High'],
      ['Install development tools', 'Software', 'Low'],
      ['Shared drive permission request', 'Access', 'Medium'],
      ['Laptop battery needs replacement', 'Hardware', 'High'],
      ['Video conferencing audio issue', 'Software', 'Medium'],
      ['Password reset assistance', 'Access', 'Low'],
      ['Printer connection not working', 'Network', 'Medium'],
      ['Security software update', 'Software', 'High'],
      ['Request for an additional monitor', 'Hardware', 'Low'],
      ['Unable to access staging server', 'Network', 'Urgent'],
      ['New team workspace provisioning', 'Access', 'Medium']
    ];
    const tickets = Array.from({ length: 48 }, (_, i) => {
      const [subject, category, priority] = subjects[i % subjects.length];
      const status = i < 4 ? 'Open' : i < 10 ? 'In progress' : i < 13 ? 'Open' : i % 5 === 0 ? 'Closed' : 'Resolved';
      const createdAt = isoAgo(i < 6 ? i * 0.09 : (i - 4) * 0.65, now);
      const resolvedAt = ['Resolved', 'Closed'].includes(status) ? new Date(new Date(createdAt).getTime() + (2 + i % 20) * 3600000).toISOString() : null;
      return { id: `IT-${1048 - i}`, subject, category, priority, status, requesterId: employees[(i + 1) % employees.length].id,
        assigneeId: [employees[0].id, employees[8].id, employees[11].id][i % 3],
        description: `Please help with this ${category.toLowerCase()} request. The issue is affecting daily work. Contact the requester to arrange a convenient time.`,
        createdAt, updatedAt: resolvedAt || createdAt, resolvedAt };
    });
    const models = [['MacBook Pro 14-inch', 'Apple M3 Pro · 18 GB / 512 GB', 'Laptop', 1999], ['ThinkPad X1 Carbon', 'Lenovo · 16 GB / 512 GB', 'Laptop', 1649], ['Dell UltraSharp 27', 'U2723QE · 4K USB-C monitor', 'Monitor', 549], ['iPhone 15', 'Apple · 128 GB', 'Phone', 799], ['Magic Keyboard', 'Apple · USB-C', 'Accessory', 129], ['UniFi Dream Machine', 'Ubiquiti · Network gateway', 'Network', 379]];
    const assets = Array.from({ length: 32 }, (_, i) => {
      const [name, model, category, value] = models[i % models.length];
      const status = i < 23 ? 'Assigned' : i < 29 ? 'Available' : i < 31 ? 'Maintenance' : 'Retired';
      return { id: `AST-${String(i + 1).padStart(3, '0')}`, name, model, category, value,
        serial: `NX-${2025 + i % 2}-${String(8300 + i).padStart(5, '0')}`, status,
        assigneeId: status === 'Assigned' ? employees[i % employees.length].id : '',
        purchaseDate: isoAgo(180 + i * 4, now).slice(0, 10), warrantyDate: isoAgo(-185 + i * 4, now).slice(0, 10), createdAt: isoAgo(180 + i * 4, now) };
    });
    return { version: 1, employees, tickets, assets, settings: { organization: 'Nexus', compact: false },
      activity: [{ id: 'act-seed-1', type: 'ticket', recordId: 'IT-1035', text: 'Andi Lane resolved a hardware request', time: isoAgo(0.02, now) },
        { id: 'act-seed-2', type: 'asset', recordId: 'AST-025', text: 'A new laptop was added to inventory', time: isoAgo(0.055, now) },
        { id: 'act-seed-3', type: 'employee', recordId: 'EMP-024', text: 'Charlotte Young joined the workspace', time: isoAgo(0.13, now) },
        { id: 'act-seed-4', type: 'ticket', recordId: 'IT-1046', text: 'Lana Steiner requested software access', time: isoAgo(0.2, now) }]
    };
  }
  function valid(data) {
    if (!data || data.version !== 1 || !data.settings || typeof data.settings.organization !== 'string' || typeof data.settings.compact !== 'boolean') return false;
    const fields = { employees: ['id', 'name', 'email', 'role', 'department', 'status', 'createdAt'], tickets: ['id', 'subject', 'description', 'category', 'priority', 'status', 'requesterId', 'assigneeId', 'createdAt', 'updatedAt'], assets: ['id', 'name', 'model', 'category', 'serial', 'status', 'assigneeId', 'purchaseDate', 'warrantyDate', 'createdAt'], activity: ['id', 'type', 'recordId', 'text', 'time'] };
    for (const [key, keys] of Object.entries(fields)) {
      if (!Array.isArray(data[key]) || data[key].length > 10000 || !data[key].every(r => r && keys.every(k => typeof r[k] === 'string' && r[k].length <= 20000))) return false;
      if (new Set(data[key].map(r => r.id)).size !== data[key].length) return false;
    }
    if (!data.employees.every(r => enums.department.includes(r.department) && enums.employeeStatus.includes(r.status))) return false;
    if (!data.tickets.every(r => enums.ticketStatus.includes(r.status) && enums.priority.includes(r.priority) && enums.ticketCategory.includes(r.category) && Number.isFinite(Date.parse(r.createdAt)) && Number.isFinite(Date.parse(r.updatedAt)) && (r.resolvedAt === null || typeof r.resolvedAt === 'string' && Number.isFinite(Date.parse(r.resolvedAt))))) return false;
    if (!data.assets.every(r => enums.assetStatus.includes(r.status) && enums.assetCategory.includes(r.category) && Number.isFinite(r.value) && r.value >= 0)) return false;
    const ids = new Set(data.employees.map(e => e.id));
    return [...data.tickets, ...data.assets].every(r => !r.assigneeId || ids.has(r.assigneeId)) && data.tickets.every(r => !r.requesterId || ids.has(r.requesterId)) && data.assets.every(r => (r.status === 'Assigned') === Boolean(r.assigneeId));
  }
  function load(storage) {
    try {
      const raw = storage.getItem(KEY);
      if (raw) {
        try { const parsed = JSON.parse(raw); if (valid(parsed)) return { data: parsed, warning: '' }; } catch (_) { /* Fall back without overwriting the damaged snapshot. */ }
        return { data: seed(), warning: 'Saved workspace data could not be read. A fresh demo is shown; changes replace the invalid data.' };
      }
      const data = seed(); storage.setItem(KEY, JSON.stringify(data)); return { data, warning: '' };
    } catch (_) { return { data: seed(), warning: 'Browser storage is unavailable. Changes work in this session but may not survive a reload.' }; }
  }
  function save(storage, data) {
    try { storage.setItem(KEY, JSON.stringify(data)); return true; } catch (_) { return false; }
  }
  function uid(prefix) { return `${prefix}-${root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`}`; }
  function nextId(prefix, records, min = 1) {
    const n = Math.max(min - 1, ...records.map(r => Number(r.id.replace(`${prefix}-`, ''))).filter(Number.isFinite)) + 1;
    return `${prefix}-${String(n).padStart(3, '0')}`;
  }
  function filter(records, query, filters, text) {
    const q = query.trim().toLowerCase();
    return records.filter(r => (!q || text(r).toLowerCase().includes(q)) && Object.entries(filters).every(([k, v]) => !v || r[k] === v));
  }
  function removeEmployee(data, id) {
    data.employees = data.employees.filter(e => e.id !== id);
    data.tickets.forEach(t => { if (t.assigneeId === id) t.assigneeId = ''; if (t.requesterId === id) t.requesterId = ''; });
    data.assets.forEach(a => { if (a.assigneeId === id) { a.assigneeId = ''; if (a.status === 'Assigned') a.status = 'Available'; } });
  }
  function metrics(data) {
    const pending = data.tickets.filter(t => !['Resolved', 'Closed'].includes(t.status));
    const resolved = data.tickets.filter(t => t.resolvedAt);
    const avg = resolved.length ? resolved.reduce((sum, t) => sum + Math.max(0, (new Date(t.resolvedAt) - new Date(t.createdAt)) / 3600000), 0) / resolved.length : 0;
    return { employees: data.employees.length, active: data.employees.filter(e => e.status === 'Active').length, pending: pending.length,
      urgent: pending.filter(t => t.priority === 'High' || t.priority === 'Urgent').length, assets: data.assets.length,
      assigned: data.assets.filter(a => a.status === 'Assigned').length, available: data.assets.filter(a => a.status === 'Available').length, avg,
      resolution: data.tickets.length ? Math.round(data.tickets.filter(t => ['Resolved', 'Closed'].includes(t.status)).length / data.tickets.length * 100) : 0 };
  }
  function csv(headers, rows) {
    const cell = v => { const value = String(v ?? ''); return `"${(/^[\s]*[=+@\-]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`; };
    return '\uFEFF' + [headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n');
  }
  const api = { KEY, enums, seed, valid, load, save, uid, nextId, filter, removeEmployee, metrics, csv };
  root.NexusData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
