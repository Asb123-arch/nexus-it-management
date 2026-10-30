/* Presentation helpers only. Every record comes from the authenticated, scoped API.
 * No seeded inventory, credentials, tokens, or workspace records in localStorage.
 */
window.NexusData = {
  enums: {
    department: ['Engineering', 'Design', 'Marketing', 'Operations', 'Finance', 'People', 'IT'],
    employeeStatus: ['Active', 'On leave', 'Inactive'],
    ticketStatus: ['Open', 'In progress', 'Waiting on employee', 'Resolved', 'Closed'],
    priority: ['Low', 'Medium', 'High', 'Urgent'],
    ticketCategory: ['Hardware', 'Software', 'Access', 'Network', 'Other'],
    assetStatus: ['Available', 'Assigned', 'Maintenance', 'Retired'],
    assetCategory: ['Laptop', 'Monitor', 'Phone', 'Accessory', 'Network']
  },
  filter(records, query, filters, text) {
    const q = query.trim().toLowerCase();
    return records.filter(r => (!q || text(r).toLowerCase().includes(q)) && Object.entries(filters).every(([k, v]) => !v || r[k] === v));
  },
  metrics(data) {
    const pending = data.tickets.filter(t => !['Resolved', 'Closed'].includes(t.status));
    const resolved = data.tickets.filter(t => t.resolvedAt);
    return { employees: data.employees.length, active: data.employees.filter(e => e.status === 'Active').length,
      pending: pending.length, urgent: pending.filter(t => ['High', 'Urgent'].includes(t.priority)).length,
      assets: data.assets.length, assigned: data.assets.filter(a => a.assigneeId).length,
      available: data.assets.filter(a => a.status === 'Available').length,
      avg: resolved.length ? resolved.reduce((sum, t) => sum + Math.max(0, (new Date(t.resolvedAt) - new Date(t.createdAt)) / 3600000), 0) / resolved.length : 0,
      resolution: data.tickets.length ? Math.round(resolved.length / data.tickets.length * 100) : 0 };
  },
  csv(headers, rows) {
    const cell = value => { const v = String(value ?? ''); return '"' + (/^[\s]*[=+@\-]/.test(v) ? "'" + v : v).replaceAll('"', '""') + '"'; };
    return '\uFEFF' + [headers, ...rows].map(r => r.map(cell).join(',')).join('\r\n');
  }
};
