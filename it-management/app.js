/* Nexus UI: the original design, backed by authenticated, role-scoped server APIs.
 * The API is the security boundary. UI checks are affordances, not authorization.
 */
(() => {
  'use strict';
  const D = window.NexusData;
  let db = null, currentUser = null, csrf = '', notificationItems = [], pollTimer, currentTicket = null, users = [], requestBusy = false, registrationEnabled = true, backendReady = false;
  const views = { dashboard: 'Overview', employees: 'Employees', tickets: 'IT tickets', assets: 'Asset inventory', reports: 'Reports', settings: 'Settings', access: 'Access management' };
  const isEmployee = () => currentUser?.role === 'employee';
  const isAdmin = () => currentUser?.role === 'admin';
  const isLead = () => ['admin', 'manager'].includes(currentUser?.role);
  const canCreate = type => type === 'tickets' || (type === 'employees' ? isAdmin() : isLead());
  const canEdit = (type, r) => type === 'tickets' ? isLead() || (currentUser?.role === 'technician' && r.assigneeId === currentUser.employeeId) : canCreate(type);
  const canDelete = type => isAdmin() && type !== 'employees';
  const permittedView = view => !['employees', 'reports', 'access'].includes(view) || (view === 'access' ? isAdmin() : isLead());
  const state = { view: 'dashboard', query: '', filters: {}, page: 1, perPage: 8, sort: '', desc: false, days: 7, mobile: false, modal: null };
  let toastTimer, previousFocus;
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const paths = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
    ticket: '<path d="M4 4h16a1 1 0 0 1 1 1v4a3 3 0 0 0 0 6v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4a3 3 0 0 0 0-6V5a1 1 0 0 1 1-1Z"/><path d="M15 5v2m0 4v2m0 4v2"/>',
    laptop: '<rect x="4" y="3" width="16" height="12" rx="2"/><path d="m4 15-2 5a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1l-2-5M10 18h4"/>',
    box: '<path d="m12 3 9 5v9l-9 5-9-5V8l9-5Zm0 9 9-4M3 8l9 4v10M7.5 5.5l9 5"/>',
    chart: '<path d="M3 3v18h18M7 16v-4m5 4V7m5 9v-6"/>',
    settings: '<path d="m9 3-.7 2.2-2 .9-2.2-.5-1.7 3 1.5 1.7v2.4l-1.5 1.7 1.7 3 2.2-.5 2 .9L9 20h3l.7-2.2 2-.9 2.2.5 1.7-3-1.5-1.7v-2.4l1.5-1.7-1.7-3-2.2.5-2-.9L12 3H9Z"/><circle cx="10.5" cy="11.5" r="3"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5.8-1.5 1.3-1.5 2M12 16h.01"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-11 12a2 2 0 0 0 4 0"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    down: '<path d="m7 10 5 5 5-5"/>',
    right: '<path d="m9 6 6 6-6 6"/>',
    left: '<path d="m15 6-6 6 6 6"/>',
    chevrons: '<path d="m8 8 4-4 4 4m-8 8 4 4 4-4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
    building: '<rect x="5" y="3" width="14" height="19" rx="1"/><path d="M9 7h1m4 0h1M9 11h1m4 0h1M9 15h1m4 0h1M10 22v-3h4v3"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    circleCheck: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2.1 2.1 0 0 0-5-5L4 14l-1 7Zm8-16H5a2 2 0 0 0-2 2v3"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
    filter: '<path d="M4 7h16M7 12h10m-7 5h4"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8m-4-4v4"/>',
    phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
    network: '<rect x="8" y="2" width="8" height="6" rx="1"/><rect x="2" y="16" width="8" height="6" rx="1"/><rect x="14" y="16" width="8" height="6" rx="1"/><path d="M12 8v4m-6 4v-4h12v4"/>',
    refresh: '<path d="M20 8a9 9 0 0 0-15-4L2 7m0-5v5h5m-3 9a9 9 0 0 0 15 4l3-3m0 5v-5h-5"/>',
    logout: '<path d="M9 4H4v16h5m5-13 5 5-5 5M8 12h12"/>',
    spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
    home: '<path d="m3 10 9-7 9 7v11H3V10Zm6 11v-8h6v8"/>',
    external: '<path d="M14 3h7v7m0-7L10 14m0-10H3v17h17v-7"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>'
  };
  const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.box}</svg>`;
  const employee = id => db.employees.find(e => e.id === id) || db.directory.find(e => e.id === id) || db.assignees.find(e => e.id === id);
  const personName = id => employee(id)?.name || 'Unassigned';
  const avatar = (id, big = false) => { const p = employee(id); const name = p?.name || 'Unassigned'; const n = [...name].reduce((s, c) => s + c.charCodeAt(0), 0); return `<span class="avatar c${n % 6}${big ? ' big' : ''}" title="${esc(name)}">${esc(p ? name.split(' ').map(s => s[0]).slice(0, 2).join('') : '—')}</span>`; };
  const badge = text => { const color = ({ 'Active': 'green', 'Resolved': 'green', 'Available': 'green', 'Low': 'green', 'Open': 'blue', 'Assigned': 'blue', 'In progress': 'amber', 'On leave': 'amber', 'Maintenance': 'amber', 'Medium': 'amber', 'High': 'red', 'Urgent': 'red', 'Closed': 'gray', 'Retired': 'gray', 'Inactive': 'gray' })[text] || 'gray'; return `<span class="badge ${color}">${esc(text)}</span>`; };
  const assetIcon = category => ({ Laptop: 'laptop', Monitor: 'monitor', Phone: 'phone', Network: 'network', Accessory: 'box' })[category] || 'box';
  const money = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  const date = (s, long = false) => s && Number.isFinite(Date.parse(s)) ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(long ? { year: 'numeric' } : {}) }) : 'Not set';
  function relative(s) { const n = Math.max(0, Date.now() - new Date(s)); return n < 60000 ? 'Just now' : n < 3600000 ? `${Math.floor(n / 60000)} min ago` : n < 86400000 ? `${Math.floor(n / 3600000)}h ago` : `${Math.floor(n / 86400000)}d ago`; }
  function action(name, text, sym, extra = '', cls = '') { return `<button type="button" class="button ${cls}" data-action="${name}" ${extra}>${sym ? icon(sym) : ''}${text}</button>`; }
  const linkButton = (label, view) => `<a class="text-button" href="#${view}">${label}${icon('arrow')}</a>`;
  const nav = (view, label, symbol, count = '') => `<a href="#${view}" data-nav="${view}">${icon(symbol)}<span>${label}</span>${count ? `<span class="nav-count" id="ticket-count">${count}</span>` : ''}</a>`;

  function shell() {
    $('#app').innerHTML = `<a class="skip-link" href="#main-content">Skip to main content</a>
      <button class="sidebar-overlay" data-action="close-sidebar" aria-label="Close navigation"></button>
      <aside class="sidebar" id="sidebar" aria-label="Main navigation">
        <a class="brand" href="#dashboard" aria-label="Nexus home"><span class="brand-mark"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 18V6l14 12V6M5 12l7-6m0 12 7-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>nexus<span class="workspace-tag">IT</span></a>
        <button class="organization" data-action="organization"><span class="organization-icon">${icon('building')}</span><span class="org-info"><strong id="org-name">${esc(db.settings.organization)} workspace</strong><span>IT department</span></span>${icon('chevrons', 'small')}</button>
        <div class="nav-label">Workspace</div><nav class="nav-list">${nav('dashboard', 'Overview', 'grid')}${isLead() ? nav('employees', 'Employees', 'people') : ''}${nav('tickets', isEmployee() ? 'My tickets' : 'IT tickets', 'ticket', String(D.metrics(db).pending))}${nav('assets', isEmployee() ? 'My materials' : 'Asset inventory', 'laptop')}</nav>
        <div class="nav-secondary"><div class="nav-label">Manage</div><nav class="nav-list">${isLead() ? nav('reports', 'Reports', 'chart') : ''}${isAdmin() ? nav('access', 'Access management', 'shield') : ''}${nav('settings', isAdmin() ? 'Settings' : 'My account', 'settings')}</nav></div>
        <div class="sidebar-bottom"><div class="support-card">${icon('help')}<h3>A little help goes a long way</h3><p>Get to know your workspace<br>and make the most of Nexus.</p><button data-action="help">Help & getting started${icon('external')}</button></div><div class="sidebar-foot"><span class="status-dot"></span>Authenticated workspace <span style="margin-left:auto">v2.0</span></div></div>
      </aside>
      <div class="shell"><header class="topbar"><button class="icon-button mobile-menu" data-action="toggle-sidebar" aria-label="Open navigation" aria-controls="sidebar" aria-expanded="false">${icon('menu')}</button>
        <div class="breadcrumb">${icon('home')}<span>Workspace</span>${icon('right')}<strong id="breadcrumb-title">Overview</strong></div>
        <div class="top-actions"><div class="global-search"><div class="search-wrap">${icon('search')}<input id="global-search" type="search" placeholder="Search anything…" aria-label="Search all employees, tickets, and assets" autocomplete="off" aria-expanded="false" aria-controls="global-results"><kbd class="kbd">⌘ K</kbd></div><div class="dropdown global-results" id="global-results" hidden></div></div>
          <button class="icon-button" data-action="help" aria-label="Help">${icon('help')}</button><div class="popover-anchor"><button class="icon-button" data-action="notifications" aria-label="Open ticket notifications" aria-expanded="false">${icon('bell')}<span class="notification-dot"></span></button><div class="dropdown" id="notifications" hidden></div></div>
          <span class="top-divider"></span><div class="popover-anchor"><button class="profile-button" data-action="profile" aria-label="Workspace profile menu" aria-expanded="false">${avatar(currentUser.employeeId)}<span class="profile-label"><strong>${esc(currentUser.name)}</strong><small>${esc(currentUser.role)} · ${esc(currentUser.department)}</small></span>${icon('down')}</button><div class="dropdown" id="profile-menu" hidden></div></div>
        </div></header><main id="main-content" tabindex="-1"></main></div>`;
  }
  function syncShell() {
    for (const a of document.querySelectorAll('[data-nav]')) { const active = a.dataset.nav === state.view; a.classList.toggle('active', active); if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
    $('#breadcrumb-title').textContent = views[state.view];
    $('#org-name').textContent = db.settings.organization + ' workspace';
    $('#ticket-count').textContent = D.metrics(db).pending;
    const unread = notificationItems.filter(n => !n.read).length;
    $('.notification-dot').hidden = !unread;
    $('[data-action="notifications"]').setAttribute('aria-label', `Notifications, ${unread} unread`);
    document.body.classList.toggle('compact', db.settings.compact);
    document.title = `${views[state.view]} — Nexus IT`;
  }
  function heading(title, sub, buttons = '') { return `<div class="page-heading"><div><h1>${title}</h1><p>${sub}</p></div><div class="heading-actions">${buttons}</div></div>`; }
  function footer() { return `<footer class="workspace-footer"><span>© ${new Date().getFullYear()} Nexus. A little more organized, every day.</span><button data-action="refresh">Refresh workspace</button><span>${icon('shield', 'small')}${esc(currentUser.role)} access · Server-saved</span></footer>`; }
  function render() {
    if (!db || !currentUser || currentUser.mustChangePassword) return;
    if (!permittedView(state.view)) state.view = 'dashboard';
    syncShell();
    $('#main-content').innerHTML = ({ dashboard, employees: listPage, tickets: listPage, assets: listPage, reports, settings, access: accessPage })[state.view]() + footer();
    if (['employees', 'tickets', 'assets'].includes(state.view)) renderRows();
  }
  function go(view, filters = {}) {
    state.query = ''; state.filters = filters; state.page = 1; state.sort = ''; state.desc = false;
    if (!currentUser || !db) return;
    state.view = views[view] && permittedView(view) ? view : 'dashboard';
    if (location.hash !== '#' + state.view) history.pushState(null, '', '#' + state.view);
    closePopovers(); setSidebar(false); render(); window.scrollTo(0, 0);
  }
  function series(days = 7) {
    const points = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      const next = new Date(d); next.setDate(next.getDate() + 1);
      const within = s => s && new Date(s) >= d && new Date(s) < next;
      points.push({ day: d, opened: db.tickets.filter(t => within(t.createdAt)).length, resolved: db.tickets.filter(t => within(t.resolvedAt)).length });
    }
    return points;
  }
  function curve(points) {
    return points.map(([x, y], i) => i ? `C ${(points[i - 1][0] + x) / 2},${points[i - 1][1]} ${(points[i - 1][0] + x) / 2},${y} ${x},${y}` : `M ${x},${y}`).join(' ');
  }
  function sparkline(key, color) {
    const points = series(7).map(p => key === 'resolved' ? p.resolved : p.opened);
    const max = Math.max(...points, 1);
    const coords = points.map((v, i) => [i * 14, 28 - v / max * 23]);
    return `<svg class="sparkline" viewBox="0 0 88 32" aria-hidden="true"><path d="${curve(coords)}" stroke="${color}" stroke-width="1.7" fill="none"/></svg>`;
  }
  function stats() {
    const m = D.metrics(db);
    const stat = (title, value, symbol, color, foot, spark = '') => `<article class="stat-card"><div class="stat-top"><span class="stat-label">${title}</span><span class="stat-icon ${color}">${icon(symbol)}</span></div><div class="stat-main"><strong class="stat-value">${value}</strong>${spark}</div><div class="stat-foot">${foot}</div></article>`;
    if (isEmployee()) return `<div class="stats-grid">${stat('My open tickets', m.pending, 'ticket', 'blue', 'Your requests awaiting resolution')}${stat('Awaiting your response', db.tickets.filter(t => t.status === 'Waiting on employee').length, 'clock', 'orange', 'Your IT team needs more information')}${stat('My assigned materials', db.assets.length, 'laptop', '', 'Equipment currently assigned to you')}${stat('My resolved tickets', db.tickets.filter(t => ['Resolved', 'Closed'].includes(t.status)).length, 'circleCheck', 'purple', 'Completed requests')}</div>`;
    return `<div class="stats-grid">${stat('Total employees', m.employees, 'people', '', `<span class="metric-pill">${m.active} active</span><span>across ${new Set(db.employees.map(e => e.department)).size} departments</span>`)}${stat('Open tickets', m.pending, 'ticket', 'blue', `<span class="metric-pill amber">${m.urgent} high priority</span><span>need your attention</span>`, sparkline('opened', '#88a9d2'))}${stat('Total assets', m.assets, 'laptop', 'orange', `<span class="metric-pill">${m.available} available</span><span>${m.assigned} currently assigned</span>`)}${stat('Avg. resolution time', `${m.avg.toFixed(1)}<span class="stat-unit">h</span>`, 'clock', 'purple', `<span class="metric-pill">${m.resolution}% resolved</span><span>across all tickets</span>`, sparkline('resolved', '#a896c4'))}</div>`;
  }
  function chart() {
    const data = series(state.days), max = Math.max(4, ...data.flatMap(d => [d.opened, d.resolved]));
    const ceiling = Math.ceil(max / 4) * 4;
    const xy = key => data.map((d, i) => [38 + i * 520 / (data.length - 1), 165 - d[key] / ceiling * 140]);
    const opened = xy('opened'), resolved = xy('resolved');
    const grid = Array.from({ length: 5 }, (_, i) => `<line x1="38" x2="558" y1="${25 + i * 35}" y2="${25 + i * 35}" stroke="#edf1ee" stroke-dasharray="3 4"/><text x="21" y="${29 + i * 35}" text-anchor="end">${ceiling - i * ceiling / 4}</text>`).join('');
    const labels = data.map((p, i) => (state.days <= 7 || i % 5 === 0 || i === data.length - 1) ? `<text x="${opened[i][0]}" y="193" text-anchor="middle">${p.day.toLocaleDateString('en-US', state.days === 7 ? { weekday: 'short' } : { month: 'short', day: 'numeric' })}</text>` : '').join('');
    return `<div class="line-chart"><svg viewBox="0 0 580 205" role="img" aria-label="Tickets created and resolved over the last ${state.days} days. ${data.reduce((s, d) => s + d.opened, 0)} created, ${data.reduce((s, d) => s + d.resolved, 0)} resolved.">${grid}<path d="${curve(opened)} L558 165 L38 165 Z" fill="#eff7f2" opacity=".8"/><path d="${curve(resolved)}" fill="none" stroke="#b2cbbb" stroke-width="2" stroke-dasharray="5 4"/><path d="${curve(opened)}" fill="none" stroke="#368a65" stroke-width="2.4"/>${data.map((p, i) => `<circle cx="${opened[i][0]}" cy="${opened[i][1]}" r="${state.days === 7 ? 3 : 2}" fill="#fff" stroke="#368a65" stroke-width="1.7"><title>${date(p.day.toISOString())}: ${p.opened} created, ${p.resolved} resolved</title></circle>`).join('')}${labels}</svg></div><div class="chart-caption">${icon('info')}${data.reduce((s, d) => s + d.opened, 0)} tickets created in this period · Counts from your workspace</div>`;
  }
  const statusColors = ['#3c8e69', '#98bca4', '#d0dfd4', '#e9efeb', '#d9b875'];
  function donut() {
    const statuses = ['Resolved', 'In progress', 'Open', 'Closed', 'Waiting on employee'], total = db.tickets.length, radius = 64, circum = 2 * Math.PI * radius;
    let offset = 0;
    const segments = statuses.map((s, i) => { const count = db.tickets.filter(t => t.status === s).length, len = total ? count / total * circum : 0, start = offset; offset += len;
      return count ? `<circle cx="80" cy="80" r="64" fill="none" stroke="${statusColors[i]}" stroke-width="19" stroke-dasharray="${Math.max(0, len - 3)} ${circum - Math.max(0, len - 3)}" stroke-dashoffset="${-start}" data-action="filter-status" data-value="${s}" style="cursor:pointer"><title>${s}: ${count}</title></circle>` : ''; }).join('');
    return `<div class="donut-wrap"><svg viewBox="0 0 160 160" role="img" aria-label="Ticket distribution: ${statuses.map(s => `${s}: ${db.tickets.filter(t => t.status === s).length}`).join(', ')}"><circle cx="80" cy="80" r="64" fill="none" stroke="#f0f4f1" stroke-width="19"/>${segments}</svg><div class="donut-label"><strong>${total}</strong><span>Total tickets</span></div></div><div class="donut-legend">${statuses.map((s, i) => `<button data-action="filter-status" data-value="${s}" aria-label="View ${s.toLowerCase()} tickets"><span style="background:${statusColors[i]}"></span>${s}<b>${db.tickets.filter(t => t.status === s).length}</b></button>`).join('')}</div>`;
  }
  function recentTickets() {
    const items = [...db.tickets].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
    return `<div class="table-scroll recent-table"><table class="data-table"><caption class="sr-only">Five most recent IT tickets</caption><thead><tr><th>Ticket details</th><th>Status</th><th>Priority</th><th class="assignee-col">Assignee</th></tr></thead><tbody>${items.map(t => `<tr><td><button class="ticket-subject" data-action="detail" data-type="tickets" data-id="${esc(t.id)}">${esc(t.subject)}</button><div class="row-subtitle">#${esc(t.id)} <span style="padding:0 4px">·</span> ${esc(personName(t.requesterId))}</div></td><td>${badge(t.status)}</td><td>${badge(t.priority)}</td><td class="assignee-col">${avatar(t.assigneeId)}</td></tr>`).join('')}</tbody></table>${!items.length ? empty('No tickets yet', 'Create your first ticket to get support moving.') : ''}</div>`;
  }
  function dashboard() {
    return heading('Overview', isEmployee() ? 'Your requests, conversations, and assigned materials. All in one place.' : 'A clear view of your people, technology, and everything in between.', `<span class="button date-button date-chip">${icon('calendar')}${date(new Date().toISOString(), true)}</span>` + action('new', 'Create ticket', 'plus', 'data-type="tickets"', 'primary')) +
      `<div class="section-heading"><h2>${isEmployee() ? 'Your workspace at a glance' : 'Your department at a glance'}</h2><span>${esc(currentUser.role)} access</span></div>${stats()}
      <div class="charts-grid"><section class="card"><div class="card-heading"><div><h2>Ticket activity</h2><p class="card-subtitle">Keeping your team up and running.</p></div><label><span class="sr-only">Ticket activity date range</span><select id="chart-range" class="select-compact"><option value="7" ${state.days === 7 ? 'selected' : ''}>Last 7 days</option><option value="30" ${state.days === 30 ? 'selected' : ''}>Last 30 days</option></select></label></div><div class="chart-legend"><span class="legend-key">Tickets created</span><span class="legend-key secondary">Tickets resolved</span></div><div id="chart-region">${chart()}</div></section>
      <section class="card"><div class="card-heading"><div><h2>Tickets by status</h2><p class="card-subtitle">Every request, accounted for.</p></div><button class="icon-button" data-action="status-info" aria-label="About ticket statuses">${icon('info', 'small')}</button></div>${donut()}</section></div>
      <div class="bottom-grid"><section class="card"><div class="card-heading"><div><h2>Recent tickets</h2><p class="card-subtitle">The latest requests from your team.</p></div>${linkButton('View all tickets', 'tickets')}</div>${recentTickets()}<div class="card-footer"><span>Showing the ${Math.min(5, db.tickets.length)} most recent tickets</span><span>Updated just now</span></div></section>
      <section class="card"><div class="card-heading"><div><h2>Recent activity</h2><p class="card-subtitle">What’s happening in your workspace.</p></div>${icon('clock', 'small')}</div><div class="activity-list">${db.activity.slice(0, 4).map(a => `<button class="activity-item" data-action="activity" data-type="${esc(a.type)}" data-id="${esc(a.recordId)}"><span class="activity-symbol">${icon(a.type === 'employee' ? 'people' : a.type === 'asset' ? 'laptop' : a.type === 'settings' ? 'settings' : 'circleCheck')}</span><span><p>${esc(a.text)}</p><small>${relative(a.time)}</small></span></button>`).join('') || '<p class="muted">No activity yet.</p>'}</div><div class="card-footer"><span>Small updates. A smoother day.</span><button class="text-button" data-action="all-activity">View activity${icon('arrow')}</button></div></section></div>`;
  }
  function empty(title, sub, reset = false) { return `<div class="empty-state">${icon('search')}<h3>${title}</h3><p>${sub}</p>${reset ? action('clear-filters', 'Clear search & filters', 'refresh') : ''}</div>`; }
  function selectFilter(key, label, options) { return `<select class="filter-select" data-filter="${key}" aria-label="${label}"><option value="">${label}</option>${options.map(v => `<option value="${esc(v)}" ${state.filters[key] === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`; }
  const listMeta = { employees: { singular: 'employee', title: 'Employees', sub: 'Good people. One connected team.', symbol: 'people' }, tickets: { singular: 'ticket', title: 'IT tickets', sub: 'Less downtime. More getting things done.', symbol: 'ticket' }, assets: { singular: 'asset', title: 'Asset inventory', sub: 'Know what you have, and who has it.', symbol: 'laptop' } };
  function listPage() {
    const type = state.view, meta = listMeta[type], m = D.metrics(db);
    let filters = '', summary = '', tabs = [];
    if (type === 'employees') { filters = selectFilter('department', 'All departments', D.enums.department) + selectFilter('status', 'All statuses', D.enums.employeeStatus); summary = `<span><strong>${m.employees}</strong> team members</span><span><strong>${m.active}</strong> active employees</span><span><strong>${new Set(db.employees.map(e => e.department)).size}</strong> departments</span>`; tabs = ['', 'Active', 'On leave', 'Inactive']; }
    if (type === 'tickets') { filters = selectFilter('priority', 'All priorities', D.enums.priority) + selectFilter('category', 'All categories', D.enums.ticketCategory) + selectFilter('assignmentStatus', 'All assignments', ['Unassigned', 'Assigned', 'Accepted']); summary = `<span><strong>${db.tickets.length}</strong> tickets in your scope</span><span><strong>${m.pending}</strong> awaiting resolution</span><span><strong>${m.urgent}</strong> high priority</span>`; tabs = ['', ...D.enums.ticketStatus]; }
    if (type === 'assets') { filters = selectFilter('category', 'All categories', D.enums.assetCategory) + selectFilter('status', 'All statuses', D.enums.assetStatus); summary = `<span><strong>${m.assets}</strong> total assets</span><span><strong>${m.available}</strong> available</span><span><strong>${money(db.assets.filter(a => a.status !== 'Retired').reduce((s, a) => s + a.value, 0))}</strong> purchase value · USD</span>`; tabs = ['', ...D.enums.assetStatus]; }
    if (type === 'assets' && isEmployee()) { filters = selectFilter('category', 'All categories', D.enums.assetCategory); tabs = []; summary = `<span><strong>${db.assets.length}</strong> materials assigned to you</span>`; }
    return heading(views[type], type === 'assets' && isEmployee() ? 'Your work essentials, assigned to you.' : meta.sub, action('export-list', 'Export', 'download', '', 'export-button') + (canCreate(type) ? action('new', `Add ${meta.singular}`, 'plus', `data-type="${type}"`, 'primary') : '')) + `<div class="summary-strip">${summary}</div>${type === 'assets' && isEmployee() ? `<div class="my-materials-note">${icon('shield')}This view contains only materials currently assigned to you. Contact your IT team to request equipment or report an issue.</div>` : ''}<section class="card"><div class="view-tabs" aria-label="Filter by status">${tabs.map(t => `<button data-action="tab" data-value="${t}" class="${(state.filters.status || '') === t ? 'active' : ''}" aria-pressed="${(state.filters.status || '') === t}">${t || 'All ' + (type === 'tickets' ? 'tickets' : type === 'employees' ? 'employees' : 'assets')}<small>${db[type].filter(r => !t || r.status === t).length}</small></button>`).join('')}</div><div class="table-toolbar"><div class="search-wrap">${icon('search')}<input type="search" id="list-search" aria-label="Search ${type}" placeholder="Search ${type === 'assets' ? 'materials, serial numbers' : type}…" value="${esc(state.query)}"></div>${filters}${action('clear-filters', 'Reset', 'refresh', 'aria-label="Reset all search and filters"')}</div><div id="table-region" aria-live="polite" aria-atomic="false"></div></section>`;
  }
  function filtered() {
    const type = state.view;
    const text = r => type === 'employees' ? `${r.id} ${r.name} ${r.email} ${r.role} ${r.department}` : type === 'tickets' ? `${r.id} ${r.subject} ${r.description} ${personName(r.requesterId)} ${personName(r.assigneeId)} ${r.category}` : `${r.id} ${r.name} ${r.model} ${r.serial} ${personName(r.assigneeId)} ${r.category}`;
    const records = D.filter(db[type], state.query, state.filters, text);
    if (state.sort) records.sort((a, b) => { const av = a[state.sort], bv = b[state.sort]; const order = state.sort === 'priority' ? D.enums.priority.indexOf(av) - D.enums.priority.indexOf(bv) : typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv)); return state.desc ? -order : order; });
    else if (type === 'tickets') records.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return records;
  }
  function sortable(label, key) { return `<th aria-sort="${state.sort === key ? state.desc ? 'descending' : 'ascending' : 'none'}"><button data-action="sort" data-key="${key}">${label}${icon(state.sort === key ? 'down' : 'chevrons')}</button></th>`; }
  function renderRows() {
    const type = state.view, records = filtered(), pages = Math.max(1, Math.ceil(records.length / state.perPage));
    state.page = Math.min(state.page, pages);
    const start = (state.page - 1) * state.perPage, page = records.slice(start, start + state.perPage);
    let head, rows;
    const detail = (r, label) => `<button class="ticket-subject" data-action="detail" data-type="${type}" data-id="${esc(r.id)}">${esc(label)}</button>`;
    const actions = r => `<td><div class="row-actions">${canEdit(type, r) ? `<button class="icon-button" data-action="edit" data-type="${type}" data-id="${esc(r.id)}" aria-label="Edit ${esc(r.name || r.subject)}">${icon('edit')}</button>` : ''}${canDelete(type) ? `<button class="icon-button" data-action="delete" data-type="${type}" data-id="${esc(r.id)}" aria-label="${type === 'tickets' ? 'Archive' : 'Delete'} ${esc(r.name || r.subject)}">${icon('trash')}</button>` : ''}</div></td>`;
    if (type === 'employees') { head = sortable('Employee', 'name') + sortable('Role', 'role') + sortable('Department', 'department') + sortable('Status', 'status') + '<th>Assets</th><th><span class="sr-only">Actions</span></th>'; rows = page.map(r => `<tr><td><div class="person-cell">${avatar(r.id)}<div>${detail(r, r.name)}<small>${esc(r.email)}</small></div></div></td><td>${esc(r.role)}</td><td>${esc(r.department)}</td><td>${badge(r.status)}</td><td>${db.assets.filter(a => a.assigneeId === r.id).length} assigned</td>${actions(r)}</tr>`).join(''); }
    if (type === 'tickets') { head = sortable('Ticket', 'subject') + '<th>Requester</th>' + sortable('Status', 'status') + sortable('Priority', 'priority') + '<th>Assignment</th>' + sortable('Created', 'createdAt') + '<th><span class="sr-only">Actions</span></th>'; rows = page.map(r => `<tr><td>${detail(r, r.subject)}<div class="row-subtitle">#${esc(r.id)} · ${esc(r.category)}</div></td><td><div class="person-cell">${avatar(r.requesterId)}<span>${esc(r.requesterId ? personName(r.requesterId) : 'Former employee')}</span></div></td><td>${badge(r.status)}</td><td>${badge(r.priority)}</td><td><div class="assignment-cell">${avatar(r.assigneeId)}<span>${esc(personName(r.assigneeId))}<small class="assignment-status">${esc(r.assignmentStatus)}</small></span></div></td><td>${date(r.createdAt)}</td>${actions(r)}</tr>`).join(''); }
    if (type === 'assets') { head = sortable('Asset', 'name') + sortable('Category', 'category') + sortable('Status', 'status') + '<th>Assigned to</th>' + sortable('Purchase value', 'value') + '<th><span class="sr-only">Actions</span></th>'; rows = page.map(r => `<tr><td><div class="person-cell"><span class="asset-icon">${icon(assetIcon(r.category))}</span><div>${detail(r, r.name)}<small>${esc(r.id)} · ${esc(r.serial)}</small></div></div></td><td>${esc(r.category)}</td><td>${badge(r.status)}</td><td><div class="person-cell">${r.assigneeId ? avatar(r.assigneeId) : ''}${esc(personName(r.assigneeId))}</div></td><td>${money(r.value)}</td>${actions(r)}</tr>`).join(''); }
    if (type === 'assets' && isEmployee()) { head = sortable('Assigned material', 'name') + sortable('Category', 'category') + '<th>Model / specifications</th><th>Serial number</th>'; rows = page.map(r => `<tr><td><div class="person-cell"><span class="asset-icon">${icon(assetIcon(r.category))}</span><div>${detail(r, r.name)}<small>${esc(r.id)}</small></div></div></td><td>${esc(r.category)}</td><td>${esc(r.model)}</td><td>${esc(r.serial)}</td></tr>`).join(''); }
    $('#table-region').innerHTML = records.length ? `<div class="table-scroll"><table class="data-table"><caption class="sr-only">${views[type]}, ${records.length} matching records</caption><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div><div class="pagination"><span>Showing <strong>${start + 1}–${Math.min(start + state.perPage, records.length)}</strong> of <strong>${records.length}</strong> ${type}</span><div class="page-buttons"><button data-action="page" data-value="${state.page - 1}" aria-label="Previous page" ${state.page === 1 ? 'disabled' : ''}>${icon('left')}</button>${Array.from({ length: pages }, (_, i) => i + 1).filter(p => p === 1 || p === pages || Math.abs(p - state.page) <= 1).map((p, i, a) => `${i && p - a[i - 1] > 1 ? '<span>…</span>' : ''}<button data-action="page" data-value="${p}" class="${p === state.page ? 'active' : ''}" aria-label="Page ${p}" ${p === state.page ? 'aria-current="page"' : ''}>${p}</button>`).join('')}<button data-action="page" data-value="${state.page + 1}" aria-label="Next page" ${state.page === pages ? 'disabled' : ''}>${icon('right')}</button></div></div>` : empty('Nothing here just yet', 'Try a different search or clear your filters to see more results.', true);
  }

  function reports() {
    const maxDepartment = Math.max(1, ...D.enums.department.map(d => db.employees.filter(e => e.department === d).length));
    const progress = (label, count, max, suffix = '') => `<div class="progress-row"><div class="label"><span>${esc(label)}</span><strong>${count}${suffix}</strong></div><div class="progress-track"><span style="width:${max ? count / max * 100 : 0}%"></span></div></div>`;
    return heading('Reports', 'Your workspace, in perspective. Clear numbers, better decisions.', action('export-report', 'Export summary', 'download', '', 'primary')) + stats() + `<div class="reports-grid"><section class="card"><div class="card-heading"><div><h2>People by department</h2><p class="card-subtitle">Headcount across your organization.</p></div>${icon('people')}</div><div class="report-body">${D.enums.department.map(d => progress(d, db.employees.filter(e => e.department === d).length, maxDepartment)).join('')}</div></section><section class="card"><div class="card-heading"><div><h2>Asset utilization</h2><p class="card-subtitle">Inventory distribution across asset states.</p></div>${icon('laptop')}</div><div class="report-body">${D.enums.assetStatus.map(s => progress(s, db.assets.filter(a => a.status === s).length, db.assets.length)).join('')}<div class="notice-box">${money(db.assets.filter(a => a.status !== 'Retired').reduce((s, a) => s + a.value, 0))} in non-retired asset purchase value (USD). Purchase values are demo entries, not live prices or depreciated valuations.</div></div></section><section class="card"><div class="card-heading"><div><h2>Ticket categories</h2><p class="card-subtitle">Understand what your team needs help with.</p></div>${icon('ticket')}</div><div class="report-body">${D.enums.ticketCategory.map(c => progress(c, db.tickets.filter(t => t.category === c).length, db.tickets.length)).join('')}</div></section><section class="card"><div class="card-heading"><h2>About these numbers</h2></div><div class="settings-body"><p>All metrics are calculated from server records permitted for your account. Managers see their department’s people and tickets, department-assigned materials, and available inventory.</p><p><strong>Open tickets</strong> include Open, In progress, and Waiting on employee. <strong>Resolution time</strong> is elapsed time from creation to the latest resolution for completed tickets. <strong>Resolution rate</strong> is the percentage of tickets marked Resolved or Closed.</p><div class="notice-box">Notifications are in-app only. Email delivery, SLA automation, and background device monitoring are not enabled.</div></div></section></div>`;
  }
  function settings() {
    return heading(views.settings, 'Your account, security, and workspace preferences.') + `<div class="settings-layout"><section class="card"><div class="card-heading"><h2>Account security</h2>${icon('shield')}</div><div class="settings-body"><p><strong>${esc(currentUser.name)}</strong><br>${esc(currentUser.email)} · ${esc(currentUser.role)}<br>${esc(currentUser.department)}</p><p>Changing your password signs out every session. Use a unique password or passphrase.</p>${passwordForm()}</div></section><section class="card"><div class="card-heading"><h2>${isAdmin() ? 'Workspace preferences' : 'Your access'}</h2></div><div class="settings-body">${isAdmin() ? `<form id="settings-form"><div class="field"><label for="organization">Organization name</label><input id="organization" name="organization" required maxlength="60" value="${esc(db.settings.organization)}"></div><label class="check-field"><input type="checkbox" name="compact" ${db.settings.compact ? 'checked' : ''}><span>Compact table rows<small>Workspace-wide preference for employee, ticket, and inventory lists.</small></span></label><button type="submit" class="button primary">${icon('check')}Save preferences</button></form>` : `<p>Your ${esc(currentUser.role)} access is assigned by your administrator. ${isEmployee() ? 'Only your own tickets and assigned materials are shared with your account.' : 'Your workspace is filtered by your role and department.'}</p>`}<div class="notice-box" style="margin-top:24px">Your workspace data is saved on the Nexus server. Sessions expire after 30 minutes of inactivity or 8 hours. Sign out when using a shared computer.</div><div style="margin-top:22px">${action('logout', 'Sign out', 'logout')}</div></div></section></div>`;
  }
  function toast(message, warning = false) { clearTimeout(toastTimer); $('#toast-region').innerHTML = `<div class="toast ${warning ? 'warning' : ''}">${icon(warning ? 'info' : 'circleCheck')}<span>${esc(message)}</span></div>`; toastTimer = setTimeout(() => { $('#toast-region').innerHTML = ''; }, 4500); }
  function closePopovers() { for (const node of document.querySelectorAll('.dropdown')) node.hidden = true; for (const el of document.querySelectorAll('[aria-expanded="true"]')) if (!el.classList.contains('mobile-menu')) el.setAttribute('aria-expanded', 'false'); }
  function setSidebar(open) {
    state.mobile = open;
    $('.sidebar').classList.toggle('open', open);
    $('.sidebar-overlay').classList.toggle('visible', open);
    $('.mobile-menu').setAttribute('aria-expanded', String(open));
    // An off-screen drawer must not receive invisible keyboard focus.
    $('.sidebar').inert = window.matchMedia('(max-width:720px)').matches && !open;
  }
  function openModal(title, sub, body, footerHTML = '', small = false) {
    if (!state.modal) previousFocus = document.activeElement;
    closePopovers(); state.modal = true;
    $('#modal-root').innerHTML = `<div class="modal-backdrop"><section class="modal ${small ? 'small-modal' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><header class="modal-header"><div><h2 id="modal-title">${esc(title)}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div><button class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></header>${body}${footerHTML ? `<footer class="modal-footer">${footerHTML}</footer>` : ''}</section></div>`;
    $('#app').inert = true; document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => { const focus = $('#modal-root input:not([readonly]), #modal-root select, #modal-root textarea') || $('#modal-root .modal'); focus?.focus(); });
  }
  function closeModal() { $('#modal-root').innerHTML = ''; state.modal = null; $('#app').inert = false; document.body.style.overflow = ''; if (previousFocus?.isConnected) previousFocus.focus(); else $('#main-content').focus({ preventScroll: true }); }
  function field(name, label, value = '', options = {}) {
    const { type = 'text', full = false, required = false, values, help = '', max = 150, step = '' } = options;
    const common = `id="field-${name}" name="${name}" ${required ? 'required' : ''}`;
    let control;
    if (values) control = `<select ${common}>${values.map(v => { const id = typeof v === 'string' ? v : v.id, text = typeof v === 'string' ? v : v.text; return `<option value="${esc(id)}" ${String(value) === String(id) ? 'selected' : ''}>${esc(text)}</option>`; }).join('')}</select>`;
    else if (type === 'textarea') control = `<textarea ${common} maxlength="4000" rows="4" placeholder="A little context helps your team resolve this faster…">${esc(value)}</textarea>`;
    else control = `<input ${common} type="${type}" value="${esc(value)}" ${type === 'number' ? `min="0" max="100000000" step="${step || '1'}"` : `maxlength="${max}"`} ${type === 'email' ? 'autocomplete="email"' : ''}>`;
    return `<div class="field ${full ? 'full' : ''}"><label for="field-${name}">${label}${required ? ' <span class="muted">*</span>' : ''}</label>${control}${help ? `<small>${help}</small>` : ''}</div>`;
  }
  const peopleOptions = (emptyLabel = 'Unassigned') => [{ id: '', text: emptyLabel }, ...db.employees.map(e => ({ id: e.id, text: `${e.name} · ${e.department}` }))];
  function editRecord(type, id = '') {
    const record = currentTicket?.id === id && type === 'tickets' ? currentTicket : db[type].find(r => r.id === id);
    if (id ? !record || !canEdit(type, record) : !canCreate(type)) return toast('This action is not available for your role.', true);
    if (type === 'tickets' && id && !isLead()) return openTicket(id);
    if (id && !record) return toast('That record is no longer available.');
    const r = record || {}, meta = listMeta[type]; let fields = '';
    if (type === 'employees') fields = field('name', 'Full name', r.name, { required: true }) + field('email', 'Work email', r.email, { type: 'email', required: true }) + field('role', 'Job title', r.role, { required: true }) + field('department', 'Department', r.department || 'Engineering', { values: D.enums.department, required: true }) + field('status', 'Status', r.status || 'Active', { values: D.enums.employeeStatus });
    if (type === 'tickets') fields = field('subject', 'Subject', r.subject, { required: true, full: true }) + (isLead() ? field('requesterId', 'Requester', r.requesterId || currentUser.employeeId, { values: id ? [{ id: r.requesterId, text: personName(r.requesterId) }] : peopleOptions('Select a requester'), required: true }) + field('assigneeId', 'Assigned to', r.assigneeId || '', { values: [{ id: '', text: 'Unassigned' }, ...db.assignees.map(a => ({ id: a.id, text: a.name }))] }) : '') + field('priority', 'Priority', r.priority || 'Medium', { values: D.enums.priority }) + field('category', 'Category', r.category || 'Hardware', { values: D.enums.ticketCategory }) + (isLead() ? field('status', 'Status', r.status || 'Open', { values: D.enums.ticketStatus, full: true }) : '') + field('description', 'Description', r.description || '', { type: 'textarea', full: true });
    if (type === 'assets') fields = field('name', 'Asset name', r.name, { required: true }) + field('serial', 'Serial number / asset tag', r.serial, { required: true }) + field('model', 'Model / specifications', r.model, { full: true }) + field('category', 'Category', r.category || 'Laptop', { values: D.enums.assetCategory }) + field('status', 'Status', r.status || 'Available', { values: D.enums.assetStatus }) + field('assigneeId', 'Assigned to', r.assigneeId || '', { values: peopleOptions(), help: 'Selecting an employee sets the asset to Assigned.' }) + field('value', 'Purchase value (USD)', r.value ?? '', { type: 'number', step: '0.01', required: true }) + field('purchaseDate', 'Purchase date', r.purchaseDate || '', { type: 'date' }) + field('warrantyDate', 'Warranty expiry', r.warrantyDate || '', { type: 'date' });
    const form = `<form id="record-form" data-type="${type}" data-id="${esc(id)}" data-version="${r._version || ''}"><div class="modal-body"><div class="form-grid">${fields}<p id="form-error" class="form-error" role="alert"></p></div></div><footer class="modal-footer">${action('close-modal', 'Cancel')}<button type="submit" class="button primary">${icon('check')}${id ? 'Save changes' : 'Add ' + meta.singular}</button></footer></form>`;
    openModal(`${id ? 'Edit' : 'Add'} ${meta.singular}`, id ? `Update ${id} in your workspace.` : `Add a new ${meta.singular}. Fields marked * are required.`, form);
  }
  async function submitRecord(form) {
    const type = form.dataset.type, id = form.dataset.id, values = Object.fromEntries(new FormData(form));
    Object.keys(values).forEach(k => values[k] = values[k].trim());
    if (id) values._version = Number(form.dataset.version);
    if (type === 'assets') values.value = Number(values.value);
    await api('/' + type + (id ? '/' + encodeURIComponent(id) : ''), id ? 'PATCH' : 'POST', values);
    closeModal(); await refresh(`${listMeta[type].singular} ${id ? 'updated' : 'created'} successfully`);
  }
  async function detail(type, id) {
    if (type === 'tickets') return openTicket(id);
    const { record: r } = await api('/' + type + '/' + encodeURIComponent(id));
    const dt = (label, value) => `<div class="detail-field"><dt>${label}</dt><dd>${value}</dd></div>`;
    let body = '';
    if (type === 'employees') {
      const assigned = db.assets.filter(a => a.assigneeId === id);
      body = `<div class="detail-hero">${avatar(id, true)}<div><h3>${esc(r.name)}</h3><p>${esc(r.role)}</p></div></div><dl class="detail-grid">${dt('Work email', esc(r.email))}${dt('Department', esc(r.department))}${dt('Status', badge(r.status))}${dt('Employee ID', esc(r.id))}${dt('Assigned tickets', db.tickets.filter(t => t.assigneeId === id).length)}${dt('Assets in use', assigned.length)}</dl>${assigned.length ? `<div class="related-list"><h3>Assigned assets</h3>${assigned.map(a => `<button data-action="detail" data-type="assets" data-id="${esc(a.id)}">${icon(assetIcon(a.category))}${esc(a.name)} · ${esc(a.id)}${icon('arrow')}</button>`).join('')}</div>` : ''}`;
    }
    if (type === 'tickets') body = `<dl class="detail-grid">${dt('Status', badge(r.status))}${dt('Priority', badge(r.priority))}${dt('Requester', esc(r.requesterId ? personName(r.requesterId) : 'Former employee'))}${dt('Assigned to', esc(personName(r.assigneeId)))}${dt('Category', esc(r.category))}${dt('Created', date(r.createdAt, true))}${dt('Last updated', date(r.updatedAt, true))}${dt('Resolved', r.resolvedAt ? date(r.resolvedAt, true) : 'Not yet resolved')}</dl><div class="detail-description"><h3>Description</h3>${esc(r.description || 'No additional details provided.')}</div>`;
    if (type === 'assets') body = `<div class="detail-hero"><span class="asset-icon">${icon(assetIcon(r.category))}</span><div><h3>${esc(r.name)}</h3><p>${esc(r.model || 'No model specified')}</p></div></div><dl class="detail-grid">${dt('Serial number', esc(r.serial))}${dt('Category', esc(r.category))}${dt('Status', badge(r.status))}${dt('Assigned to', esc(personName(r.assigneeId)))}${dt('Purchase value', money(r.value) + ' USD')}${dt('Purchased', date(r.purchaseDate, true))}${dt('Warranty expires', date(r.warrantyDate, true))}${dt('Asset ID', esc(r.id))}</dl>`;
    if (type === 'assets' && isEmployee()) body = `<div class="detail-hero"><span class="asset-icon">${icon(assetIcon(r.category))}</span><div><h3>${esc(r.name)}</h3><p>Assigned to you</p></div></div><dl class="detail-grid">${dt('Material ID', esc(r.id))}${dt('Category', esc(r.category))}${dt('Serial number', esc(r.serial))}${dt('Model / specifications', esc(r.model))}</dl><div class="my-materials-note" style="margin-top:20px">Need help with this material? Create a ticket and include the material ID.</div>`;
    openModal(type === 'assets' && isEmployee() ? 'Assigned material' : `${listMeta[type].singular[0].toUpperCase() + listMeta[type].singular.slice(1)} details`, r.id, `<div class="modal-body">${body}</div>`, action('close-modal', 'Close') + (canDelete(type) ? action('delete', 'Delete', 'trash', `data-type="${type}" data-id="${esc(id)}"`, 'subtle left') : '') + (canEdit(type, r) ? action('edit', 'Edit ' + listMeta[type].singular, 'edit', `data-type="${type}" data-id="${esc(id)}"`, 'primary') : ''));
  }
  function deletePrompt(type, id) {
    const r = db[type]?.find(e => e.id === id); if (!r || !canDelete(type)) return;
    const verb = type === 'tickets' ? 'Archive' : 'Delete';
    openModal(`${verb} ${listMeta[type].singular}?`, r.name || r.subject, `<div class="modal-body"><p class="confirm-copy">${type === 'tickets' ? 'This ticket will leave active lists. Comments and its immutable history are retained on the server.' : 'This will permanently remove this asset. It cannot be undone.'}</p></div>`, action('close-modal', 'Keep record') + action('confirm-delete', verb, 'trash', `data-type="${type}" data-id="${esc(id)}"`, 'danger'), true);
  }
  function globalSearch(query) {
    const box = $('#global-results'), q = query.trim().toLowerCase();
    if (!q) { box.hidden = true; $('#global-search').setAttribute('aria-expanded', 'false'); return; }
    const items = ['employees', 'tickets', 'assets'].flatMap(type => db[type].filter(r => `${r.id} ${r.name || r.subject} ${r.email || ''} ${r.serial || ''} ${r.model || ''}`.toLowerCase().includes(q)).map(r => ({ type, r })));
    box.innerHTML = `<div class="dropdown-title">${items.length} result${items.length !== 1 ? 's' : ''}${items.length > 9 ? ' · showing first 9' : ''}</div>${items.slice(0, 9).map(({ type, r }) => `<button class="dropdown-item" data-action="detail" data-type="${type}" data-id="${esc(r.id)}">${icon(listMeta[type].symbol)}<span><strong>${esc(r.name || r.subject)}</strong><small>${esc(r.id)} · ${listMeta[type].singular}</small></span>${icon('right')}</button>`).join('') || '<div class="dropdown-empty">No matches. Try a name, ticket ID, or serial number.</div>'}`;
    box.hidden = false; $('#global-search').setAttribute('aria-expanded', 'true');
  }
  function download(name, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime })), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Download prepared');
  }
  function exportList() {
    const type = state.view, rows = filtered(); let headers, values;
    if (type === 'employees') { headers = ['ID', 'Name', 'Email', 'Role', 'Department', 'Status']; values = rows.map(r => [r.id, r.name, r.email, r.role, r.department, r.status]); }
    if (type === 'tickets') { headers = ['ID', 'Subject', 'Description', 'Status', 'Priority', 'Category', 'Requester', 'Assignee', 'Created', 'Resolved']; values = rows.map(r => [r.id, r.subject, r.description, r.status, r.priority, r.category, personName(r.requesterId), personName(r.assigneeId), r.createdAt, r.resolvedAt]); }
    if (type === 'assets') { headers = ['ID', 'Name', 'Model', 'Serial', 'Category', 'Status', 'Assigned to', 'Value USD', 'Purchase date', 'Warranty date']; values = rows.map(r => [r.id, r.name, r.model, r.serial, r.category, r.status, personName(r.assigneeId), r.value, r.purchaseDate, r.warrantyDate]); }
    if (type === 'assets' && isEmployee()) { headers = ['Material ID', 'Name', 'Model', 'Serial', 'Category']; values = rows.map(r => [r.id, r.name, r.model, r.serial, r.category]); }
    download(`nexus-${type}-${new Date().toISOString().slice(0, 10)}.csv`, D.csv(headers, values), 'text/csv;charset=utf-8');
  }
  function help() { openModal('Welcome to your workspace', 'Your access is tailored to your role.', `<div class="modal-body"><ul class="help-list"><li><strong>Your tickets, in one place</strong>Click a ticket to view assignment progress, add a comment, and read its history. IT staff can add team-only notes.</li><li><strong>Stay informed</strong>The bell shows updates to tickets you can access. Notifications refresh every 20 seconds; refresh the workspace to fetch the latest lists.</li><li><strong>Your materials</strong>Employees see only materials assigned to them. Request equipment through a ticket.</li><li><strong>Search and export</strong>Cmd/Ctrl+K searches records permitted for your account. CSV exports use the same scoped data.</li><li><strong>Account security</strong>Sign out on shared devices. Contact your administrator to reset access. Server authorization applies even to direct API calls.</li></ul></div>`, action('close-modal', 'Got it', 'check', '', 'primary')); }

  document.addEventListener('click', async e => {
    const route = e.target.closest('a[href^="#"]');
    if (route && !e.metaKey && !e.ctrlKey) { const view = route.getAttribute('href').slice(1); if (views[view]) { e.preventDefault(); go(view); return; } }
    const el = e.target.closest('[data-action]');
    if (!el) { if (!e.target.closest('.global-search, .popover-anchor')) closePopovers(); return; }
    const a = el.dataset.action, type = el.dataset.type, id = el.dataset.id;
    if (requestBusy) return;
    requestBusy = true;
    try {
    if (a === 'retry-connection') await start();
    else if (a === 'show-signup' && !currentUser) { history.pushState(null, '', '#signup'); signupScreen(); }
    else if (a === 'show-login' && !currentUser) { history.pushState(null, '', '#login'); loginScreen(); }
    else if (a === 'new') await editRecord(type);
    else if (a === 'edit') await editRecord(type, id);
    else if (a === 'detail') await detail(type, id);
    else if (a === 'close-modal') closeModal();
    else if (a === 'delete') deletePrompt(type, id);
    else if (a === 'confirm-delete') { const r = db[type].find(r => r.id === id); await api('/' + type + '/' + encodeURIComponent(id), 'DELETE', { _version: r._version }); closeModal(); await refresh(type === 'tickets' ? 'Ticket archived; history retained' : 'Asset deleted'); }
    else if (a === 'tab') { state.filters.status = el.dataset.value; state.page = 1; render(); }
    else if (a === 'page') { state.page = Number(el.dataset.value); renderRows(); }
    else if (a === 'sort') { const key = el.dataset.key; state.desc = state.sort === key ? !state.desc : false; state.sort = key; renderRows(); }
    else if (a === 'clear-filters') { state.query = ''; state.filters = {}; state.page = 1; render(); }
    else if (a === 'filter-status') go('tickets', { status: el.dataset.value });
    else if (a === 'export-list') { await refresh(); if (db) exportList(); }
    else if (a === 'export-report' && isLead()) { await refresh(); if (!db) return; const m = D.metrics(db); download('nexus-workspace-summary.csv', D.csv(['Metric', 'Value'], [['Employees in scope', m.employees], ['Active employees', m.active], ['Unresolved tickets', m.pending], ['High / urgent pending tickets', m.urgent], ['Assets in scope', m.assets], ['Assigned assets', m.assigned], ['Available assets', m.available], ['Average resolution hours', m.avg.toFixed(2)], ['Resolution rate (%)', m.resolution]]), 'text/csv;charset=utf-8'); }
    else if (a === 'refresh') await refresh('Workspace refreshed');
    else if (a === 'logout') { await api('/logout', 'POST', {}); signedOut('You have been signed out.'); }
    else if (a === 'new-account') accountEditor();
    else if (a === 'edit-account') accountEditor(id);
    else if (a === 'accept-ticket' || a === 'reopen-ticket') { await api('/tickets/' + encodeURIComponent(id) + (a === 'accept-ticket' ? '/accept' : '/reopen'), 'POST', { _version: currentTicket._version }); await refresh(); await openTicket(id); toast(a === 'accept-ticket' ? 'Assignment accepted' : 'Ticket reopened'); }
    else if (a === 'read-all') { await api('/notifications/read', 'POST', { id: 'all' }); await showNotifications(); }
    else if (a === 'open-notification') { await api('/notifications/read', 'POST', { id: Number(id) }); notificationItems = (await api('/notifications')).notifications; syncShell(); await openTicket(el.dataset.ticket); }
    else if (a === 'help') help();
    else if (a === 'organization') go('settings');
    else if (a === 'toggle-sidebar') setSidebar(!state.mobile);
    else if (a === 'close-sidebar') setSidebar(false);
    else if (a === 'status-info') openModal('A place for every request', 'Ticket statuses explained', `<div class="modal-body"><ul class="help-list"><li><strong>Open</strong>New requests awaiting work.</li><li><strong>In progress</strong>Requests currently being handled.</li><li><strong>Resolved</strong>A solution has been provided.</li><li><strong>Closed</strong>Work is complete and the request is archived.</li></ul></div>`, action('close-modal', 'Got it', 'check', '', 'primary'), true);
    else if (a === 'activity') { if (type === 'settings') go('settings'); else await detail(type === 'employee' ? 'employees' : type === 'asset' ? 'assets' : 'tickets', id); }
    else if (a === 'all-activity') openModal('Workspace activity', 'Your latest 100 local workspace updates.', `<div class="modal-body"><ul class="help-list">${db.activity.map(a => `<li><strong>${esc(a.text)}</strong>${date(a.time, true)} · ${relative(a.time)}</li>`).join('') || '<li>No activity yet.</li>'}</ul></div>`, action('close-modal', 'Close'));
    else if (a === 'notifications') { if ($('#notifications').hidden) await showNotifications(); else closePopovers(); }
    else if (a === 'profile') { const hidden = $('#profile-menu').hidden; closePopovers(); if (hidden) { $('#profile-menu').innerHTML = `<div class="dropdown-title">${esc(currentUser.name)} · ${esc(currentUser.role)}</div><button class="dropdown-item" data-action="organization">${icon('shield')}<span><strong>Account & security</strong><small>Change your password and view your access</small></span></button><button class="dropdown-item" data-action="logout">${icon('logout')}<span><strong>Sign out</strong><small>End this session on this device</small></span></button>`; $('#profile-menu').hidden = false; el.setAttribute('aria-expanded', 'true'); } }
    } catch (err) { toast(err.message || 'Unable to complete the request.', true); }
    finally { requestBusy = false; }
  });
  document.addEventListener('input', e => {
    if (e.target.closest('#signup-form')) {
      e.target.removeAttribute('aria-invalid');
      const error = document.getElementById(e.target.id + '-error'); if (error) error.textContent = '';
    }
    if (e.target.id === 'global-search') globalSearch(e.target.value);
    if (e.target.id === 'list-search') { state.query = e.target.value; state.page = 1; renderRows(); }
  });
  document.addEventListener('change', e => {
    if (e.target.dataset.filter) { state.filters[e.target.dataset.filter] = e.target.value; state.page = 1; render(); }
    if (e.target.id === 'chart-range') { state.days = Number(e.target.value); $('#chart-region').innerHTML = chart(); }
    if ($('#record-form')?.dataset.type === 'assets') {
      if (e.target.name === 'assigneeId') { if (e.target.value) $('#field-status').value = 'Assigned'; else if ($('#field-status').value === 'Assigned') $('#field-status').value = 'Available'; }
      if (e.target.name === 'status' && e.target.value !== 'Assigned') $('#field-assigneeId').value = '';
    }
  });
  document.addEventListener('submit', async e => {
    const form = e.target, id = form.id;
    if (!['login-form', 'signup-form', 'record-form', 'settings-form', 'password-form', 'account-form', 'comment-form', 'status-form'].includes(id)) return;
    e.preventDefault();
    if (id === 'signup-form' && !validateSignup(form)) return;
    if (requestBusy) {
      if (id === 'signup-form') showSignupMessage('Please wait for the current request to finish.');
      return;
    }
    const values = Object.fromEntries(new FormData(form)), button = $('button[type="submit"]', form);
    const buttonLabel = button?.innerHTML;
    requestBusy = true; if (button) button.disabled = true;
    if (id === 'signup-form') {
      showSignupMessage(''); form.setAttribute('aria-busy', 'true');
      $('#signup-progress').textContent = 'Creating your organization…';
      if (button) button.textContent = 'Creating organization…';
    }
    try {
      if (id === 'login-form') { const session = await api('/login', 'POST', values); currentUser = session.user; csrf = session.csrf; await enterWorkspace(); }
      else if (id === 'signup-form') {
        if (!values.organization.trim() || !values.name.trim()) throw new Error('Enter an organization name and your full name.');
        if (values.password !== values.confirmPassword) throw new Error('Passwords do not match.');
        const session = await api('/signup', 'POST', values);
        currentUser = session.user; csrf = session.csrf; currentTicket = null; users = []; notificationItems = [];
        history.replaceState(null, '', '#dashboard');
        await enterWorkspace(); toast(`${currentUser.organization} is ready. You are its administrator.`);
      }
      else if (id === 'record-form') await submitRecord(form);
      else if (id === 'settings-form') { await api('/settings', 'PATCH', { organization: values.organization.trim(), compact: values.compact === 'on' }); await refresh('Preferences saved'); }
      else if (id === 'password-form') { if (values.newPassword !== values.confirmPassword) throw new Error('New passwords do not match.'); await api('/password', 'POST', { currentPassword: values.currentPassword, newPassword: values.newPassword }); signedOut('Password changed. Please sign in with your new password.'); }
      else if (id === 'account-form') { if (form.dataset.id) { values.disabled = values.disabled === 'true'; values._version = Number(form.dataset.version); if (!values.password) delete values.password; } await api('/users' + (form.dataset.id ? '/' + encodeURIComponent(form.dataset.id) : ''), form.dataset.id ? 'PATCH' : 'POST', values); closeModal(); await refresh('Account saved. Share temporary passwords through a secure channel.'); }
      else if (id === 'comment-form') { const ticketId = currentTicket.id; await api('/tickets/' + encodeURIComponent(ticketId) + '/comments', 'POST', { text: values.text, visibility: values.visibility || 'public' }); await openTicket(ticketId); toast('Comment posted'); }
      else if (id === 'status-form') { const ticketId = currentTicket.id; await api('/tickets/' + encodeURIComponent(ticketId), 'PATCH', { status: values.status, _version: currentTicket._version }); await refresh(); await openTicket(ticketId); toast('Ticket status updated'); }
    } catch (err) {
      const selector = ({ 'login-form': '#login-error', 'signup-form': '#signup-error', 'record-form': '#form-error', 'password-form': '#password-error', 'account-form': '#account-error', 'comment-form': '#comment-error' })[id];
      if (id === 'signup-form' && currentUser && !$('#main-content')) {
        signedOut('Your account was created, but the workspace could not finish loading. Sign in with the email and password you just chose.');
      } else if (id === 'signup-form' && $('#signup-error')) showSignupMessage(err.message);
      else if (selector && $(selector)) $(selector).textContent = err.message; else toast(err.message, true);
    } finally {
      requestBusy = false;
      if (button?.isConnected) { button.disabled = false; button.innerHTML = buttonLabel; }
      if (form.isConnected) form.removeAttribute('aria-busy');
      if (id === 'signup-form' && $('#signup-progress')) $('#signup-progress').textContent = '';
    }
  });
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && !state.modal && db) { e.preventDefault(); $('#global-search').focus(); $('#global-search').select(); }
    if (e.key === 'Escape') { if (state.modal) closeModal(); else if (state.mobile) { setSidebar(false); $('.mobile-menu').focus(); } else { closePopovers(); } }
    if (e.target.id === 'global-search' && ['ArrowDown', 'Enter'].includes(e.key) && !$('#global-results').hidden) { e.preventDefault(); $('#global-results button')?.focus(); }
    if (e.target.closest('#global-results') && ['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); const items = [...document.querySelectorAll('#global-results button')], i = items.indexOf(document.activeElement); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
    if (e.key === 'Tab' && state.modal) {
      const items = [...document.querySelectorAll('#modal-root button, #modal-root input, #modal-root select, #modal-root textarea, #modal-root a[href]')].filter(el => !el.disabled && el.offsetParent !== null);
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === $('#modal-root .modal'))) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === $('#modal-root .modal'))) { e.preventDefault(); first?.focus(); }
    }
  });
  window.addEventListener('hashchange', () => { const view = location.hash.slice(1) || 'dashboard'; if (!currentUser) { if (view === 'signup') signupScreen(); else loginScreen(); return; } if (views[view]) { if (state.modal) closeModal(); go(view); } });
  window.matchMedia('(max-width:720px)').addEventListener('change', () => { if (db) setSidebar(false); });

  async function api(path, method = 'GET', body) {
    const requestAccount = currentUser?.id;
    if (!['http:', 'https:'].includes(location.protocol)) throw new Error('Open the live Nexus server to submit this form. File previews cannot create accounts.');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response, result;
    try {
      response = await fetch('/api' + path, { method, credentials: 'same-origin', cache: 'no-store', signal: controller.signal, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
      if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('This page is not connected to the Nexus API. Open the live server, not a static HTML preview.');
      result = await response.json();
    } catch (err) {
      if (err.name === 'AbortError') throw new Error(path === '/signup' ? 'The server took too long to respond. Try signing in with these details first in case creation completed; otherwise retry.' : 'The server took too long to respond. Please try again.');
      if (err instanceof TypeError) throw new Error('Cannot reach the Nexus server. Check that it is running, then try again. Your form entries have been kept.');
      if (err instanceof SyntaxError) throw new Error('The server returned an invalid response. Please try again or contact your administrator.');
      throw err;
    } finally { clearTimeout(timeout); }
    // A cookie may change in another tab. Never merge a different account's response
    // into cached names, ticket IDs, or a pending edit from the previous organization.
    const responseAccount = response.headers.get('X-Nexus-Account');
    if (requestAccount && (requestAccount !== currentUser?.id || responseAccount && requestAccount !== responseAccount)) {
      if (requestAccount === currentUser?.id) signedOut('Your account changed in another tab. Sign in again to continue.');
      throw new Error('The signed-in account changed. Please sign in again.');
    }
    if (!response.ok) {
      if (response.status === 401 && !['/login', '/signup'].includes(path)) signedOut('Your session expired. Please sign in again.');
      const retryAfter = Number(response.headers.get('retry-after'));
      const retryMessage = response.status === 429 && retryAfter > 0 ? ` Try again in ${Math.ceil(retryAfter / 60)} minute(s).` : '';
      const error = new Error((result.error || 'Request failed.') + retryMessage); error.status = response.status; throw error;
    }
    return result;
  }
  function signedOut(message = '') {
    clearInterval(pollTimer); currentUser = null; db = null; csrf = ''; users = []; notificationItems = []; currentTicket = null; state.modal = null;
    $('#modal-root').innerHTML = ''; $('#toast-region').innerHTML = ''; $('#app').inert = false; document.body.style.overflow = ''; document.body.classList.remove('compact');
    history.replaceState(null, '', '#login'); loginScreen(message);
  }
  function loginScreen(message = '', configured = true) {
    document.title = 'Sign in — Nexus IT';
    const fileMode = location.protocol === 'file:';
    $('#app').innerHTML = `<div class="login-shell"><section class="login-story"><a class="brand" href="#login"><span class="brand-mark">${icon('shield')}</span>nexus<span class="workspace-tag">IT</span></a><div class="login-copy"><div class="login-eyebrow">Your people. Your technology.</div><h1>A connected team.<br>A protected workspace.</h1><p>Everything your IT department needs, together in one place. The right tools and information, for the right people.</p><div class="login-features"><span>Role-based access</span><span>Ticket collaboration</span><span>Assigned materials</span></div></div><footer>© ${new Date().getFullYear()} Nexus IT Workspace</footer></section><section class="login-panel"><div class="login-card"><div class="login-mobile-brand"><span class="brand-mark">${icon('shield')}</span>nexus IT</div><div class="login-emblem">${icon('shield')}</div><h2>Welcome back</h2><p>Sign in to your IT workspace.<br>Your access is tailored to your role.</p>${fileMode ? '<div class="notice-box">Login and organization signup require the Nexus server. Run <code>node server.cjs</code> from this folder, then visit <a href="http://127.0.0.1:4173">http://127.0.0.1:4173</a>.</div>' : !configured ? `<div class="notice-box">${registrationEnabled ? 'New to Nexus? Create your organization below to become its first administrator.' : 'An operator must initialize the workspace. Organization signup is currently closed.'}</div>` : ''}<form id="login-form"><div class="field"><label for="login-email">Work email</label><input id="login-email" name="email" type="email" required maxlength="254" autocomplete="username" placeholder="you@company.com"></div><div class="field"><label for="login-password">Password</label><input id="login-password" name="password" type="password" required maxlength="128" autocomplete="current-password" placeholder="Enter your password"></div><p class="form-error" id="login-error" role="alert">${esc(message)}</p><button class="button primary" type="submit" ${fileMode || !configured ? 'disabled' : ''}>Sign in ${icon('arrow')}</button></form>${registrationEnabled ? `<div class="auth-switch"><span>Setting up a new organization?</span><button type="button" data-action="show-signup" class="text-button">Sign up as an admin ${icon('arrow')}</button></div>` : ''}<div class="login-note">Joining an existing organization? Ask its administrator to create your account. Signing up creates a separate organization; it does not grant access to an existing one.</div></div></section></div>`;
    if (!backendReady) {
      // Never invite users to fill an inert form in a file/static preview. The
      // launcher contains only a URL, and never transfers credentials between origins.
      const candidate = document.querySelector('meta[name="nexus-local-server"]')?.content;
      let live = new URL('http://127.0.0.1:4173');
      try { const parsed = new URL(candidate); if (['http:', 'https:'].includes(parsed.protocol)) live = parsed; } catch (_) {}
      live.pathname = '/'; live.search = ''; live.hash = '#signup';
      $('.login-card').innerHTML = `<div class="login-mobile-brand"><span class="brand-mark">${icon('building')}</span>nexus IT</div><div class="login-emblem">${icon('external')}</div><h2>Open the live workspace</h2><p>${fileMode ? 'This is a local file preview, not the running application.' : 'This page is not connected to the Nexus server.'} Organization creation needs the live server.</p><div class="notice-box" role="status">${esc(message || 'Use the link below to create your organization. There is no form to submit in this preview.')} No details are saved or sent from this preview.</div><a id="open-live-signup" class="button primary" href="${esc(live.href)}" target="_blank" rel="noopener noreferrer">Open organization signup ${icon('external')}</a><p class="server-link-label">${esc(live.origin)}</p>${fileMode ? '' : action('retry-connection', 'Retry connection', 'refresh', '', 'subtle')}<div class="login-note">Use the browser page at your running Nexus server address. If it is unavailable, start the server using the setup guide.</div>`;
    }
  }
  function showSignupMessage(message) {
    const error = $('#signup-error'); if (!error) return;
    error.textContent = message;
    if (message) { error.focus({ preventScroll: true }); error.scrollIntoView({ block: 'nearest' }); }
  }
  function validateSignup(form) {
    let first = null;
    for (const input of form.querySelectorAll('input')) {
      const label = input.labels[0]?.textContent || 'This field';
      let error = '';
      if (!input.value.trim()) error = `${label} is required.`;
      else if (input.type === 'email' && (input.validity.typeMismatch || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim()))) error = 'Enter a valid work email address.';
      else if (input.type === 'password' && (input.value.length < 12 || input.value.length > 128 || input.value.trim().length < 12)) error = 'Use a password of 12–128 characters, not just spaces.';
      else if (input.maxLength > 0 && input.value.length > input.maxLength) error = `${label} is too long (maximum ${input.maxLength} characters).`;
      else if (input.name === 'confirmPassword' && input.value !== form.elements.password.value) error = 'Passwords do not match.';
      input.setAttribute('aria-invalid', String(!!error));
      const message = document.getElementById(input.id + '-error'); if (message) message.textContent = error;
      if (error && !first) first = { input, error };
    }
    if (first) { showSignupMessage(first.error); first.input.focus(); return false; }
    return true;
  }
  function signupScreen() {
    if (!backendReady) { loginScreen(); return; }
    if (!registrationEnabled) { loginScreen('Organization signup is currently closed.'); return; }
    loginScreen(); document.title = 'Create organization — Nexus IT';
    $('.login-shell').classList.add('signup-shell');
    $('.login-copy h1').innerHTML = 'Your organization.<br>Your own workspace.';
    $('.login-copy p').textContent = 'Bring your people, support requests, and equipment together. Create your organization, then build your team with the right access for everyone.';
    $('.login-card').innerHTML = `<div class="login-mobile-brand"><span class="brand-mark">${icon('building')}</span>nexus IT</div><div class="login-emblem">${icon('building')}</div><div class="login-eyebrow">Administrator sign up</div><h2>Create your organization</h2><p>Start with your organization and your administrator account. Your workspace begins empty and separate from every other organization.</p>${location.protocol === 'file:' ? '<div class="notice-box">Run the Nexus server and use its HTTP(S) address to create an organization. File previews cannot save accounts.</div>' : ''}<form id="signup-form"><div class="field"><label for="signup-organization">Organization name</label><input id="signup-organization" name="organization" required maxlength="60" autocomplete="organization" placeholder="e.g. Acme Technologies"></div><div class="field"><label for="signup-name">Your full name</label><input id="signup-name" name="name" required maxlength="100" autocomplete="name" placeholder="e.g. Alex Morgan"></div><div class="field"><label for="signup-email">Work email</label><input id="signup-email" name="email" type="email" required maxlength="254" autocomplete="username" placeholder="you@company.com"><small>One organization account per email on this server.</small></div><div class="signup-passwords"><div class="field"><label for="signup-password">Password</label><input id="signup-password" name="password" type="password" required minlength="12" maxlength="128" autocomplete="new-password" aria-describedby="signup-password-help"><small id="signup-password-help">Use 12–128 characters.</small></div><div class="field"><label for="signup-confirm">Confirm password</label><input id="signup-confirm" name="confirmPassword" type="password" required minlength="12" maxlength="128" autocomplete="new-password"></div></div><p class="form-error" id="signup-error" role="alert"></p><button class="button primary" type="submit" ${location.protocol === 'file:' ? 'disabled' : ''}>${icon('plus')}Create organization</button></form><div class="auth-switch"><span>Already have an account?</span><button type="button" class="text-button" data-action="show-login">Sign in ${icon('arrow')}</button></div><div class="signup-security-note">${icon('shield')}You become an administrator of this new organization only. Existing organizations and their data remain private.</div>`;
    // Browser tooltip validation can look like an inert button inside a preview.
    // Always run explicit accessible validation; server checks remain unchanged.
    const form = $('#signup-form'); form.noValidate = true;
    for (const input of form.querySelectorAll('input')) {
      const message = document.createElement('small'); message.id = input.id + '-error'; message.className = 'field-error';
      input.closest('.field').append(message);
      input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'), message.id].filter(Boolean).join(' '));
    }
    $('#signup-error').tabIndex = -1;
    const progress = document.createElement('p'); progress.id = 'signup-progress'; progress.setAttribute('role', 'status'); progress.className = 'signup-progress';
    form.append(progress);
    requestAnimationFrame(() => $('#signup-organization')?.focus());
  }
  async function enterWorkspace() {
    if (currentUser.mustChangePassword) { passwordScreen(); return; }
    [db, { notifications: notificationItems }] = await Promise.all([api('/workspace'), api('/notifications')]);
    if (isAdmin()) users = (await api('/users')).users;
    views.assets = isEmployee() ? 'My materials' : 'Asset inventory'; views.tickets = isEmployee() ? 'My tickets' : 'IT tickets'; views.settings = isAdmin() ? 'Settings' : 'My account';
    state.view = permittedView(location.hash.slice(1)) && views[location.hash.slice(1)] ? location.hash.slice(1) : 'dashboard';
    state.query = ''; state.filters = {}; state.page = 1;
    shell(); setSidebar(false); render();
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => { if (document.hidden || requestBusy || !currentUser) return; try { notificationItems = (await api('/notifications')).notifications; syncShell(); } catch (_) { /* Polling cannot extend the server idle timer; 401 also clears an open dialog. */ } }, 20000);
  }
  async function refresh(message = '') {
    const session = await api('/session');
    if (!session.user) { signedOut('Please sign in again.'); return; }
    currentUser = session.user; csrf = session.csrf;
    if (currentUser.mustChangePassword) { passwordScreen(); return; }
    const next = await api('/workspace'); db = next;
    notificationItems = (await api('/notifications')).notifications;
    if (isAdmin()) users = (await api('/users')).users; else users = [];
    render(); if (message) toast(message);
  }
  function passwordForm() {
    return `<form id="password-form"><div class="form-grid"><div class="field full"><label for="current-password">Current password</label><input id="current-password" type="password" name="currentPassword" required maxlength="128" autocomplete="current-password"></div><div class="field full"><label for="new-password">New password or passphrase</label><input id="new-password" type="password" name="newPassword" required minlength="12" maxlength="128" autocomplete="new-password"><small>12–128 characters. Use a unique password for this workspace.</small></div><div class="field full"><label for="confirm-password">Confirm new password</label><input id="confirm-password" type="password" name="confirmPassword" required minlength="12" maxlength="128" autocomplete="new-password"></div><p id="password-error" class="form-error" role="alert"></p></div><button type="submit" class="button primary" style="margin-top:16px">${icon('shield')}Change password</button></form>`;
  }
  function passwordScreen() {
    clearInterval(pollTimer); db = null; document.title = 'Change password — Nexus IT';
    $('#app').innerHTML = `<div class="login-shell"><section class="login-story"><div class="brand"><span class="brand-mark">${icon('shield')}</span>nexus IT</div><div class="login-copy"><h1>A fresh start.<br>A password of your own.</h1><p>Your temporary password must be replaced before workspace information is available.</p></div></section><section class="login-panel"><div class="login-card"><div class="login-emblem">${icon('shield')}</div><h2>Set your password</h2><p>Welcome, ${esc(currentUser.name)}. Choose a unique passphrase. All sessions will be signed out after the change.</p>${passwordForm()}${action('logout', 'Back to sign in', 'logout', '', 'subtle')}</div></section></div>`;
  }
  function accessPage() {
    return heading('Access management', 'The right access, for every person. Only administrators can change account roles.', action('new-account', 'Create account', 'plus', '', 'primary')) + `<div class="my-materials-note">${icon('shield')}New and reset accounts must change their temporary password before accessing workspace data.</div><section class="card"><div class="table-scroll"><table class="data-table access-table"><thead><tr><th>Account</th><th>Access role</th><th>Department</th><th>Security status</th><th>Actions</th></tr></thead><tbody>${users.map(u => `<tr><td><div class="person-cell">${avatar(u.employeeId)}<div><strong>${esc(u.name)}</strong><small>${esc(u.email)}</small></div></div></td><td><span class="account-role">${esc(u.role)}</span></td><td>${esc(u.department)}</td><td>${badge(u.disabled ? 'Inactive' : 'Active')}${u.mustChangePassword ? '<div class="row-subtitle">Password change required</div>' : ''}</td><td>${u.id !== currentUser.id ? action('edit-account', 'Manage', 'settings', `data-id="${esc(u.id)}"`) : '<span class="muted">Your account</span>'}</td></tr>`).join('')}</tbody></table></div></section><section class="card" style="margin-top:22px"><div class="settings-body security-info"><strong>Administrator</strong> — all records, assignments, inventory, and accounts.<br><strong>Manager</strong> — department employees and tickets; department materials plus available inventory.<br><strong>Technician</strong> — assigned and own tickets; read-only inventory.<br><strong>Employee</strong> — own tickets, public conversations, and assigned materials only. No inventory availability, costs, team notes, or department reports.</div></section>`;
  }
  function accountEditor(id = '') {
    if (!isAdmin()) return;
    const u = users.find(u => u.id === id);
    const available = db.employees.filter(e => e.status === 'Active' && !users.some(u => u.employeeId === e.id));
    if (!id && !available.length) return toast('Add an active employee without a login first.');
    const fields = (!id ? field('employeeId', 'Employee', '', { values: available.map(e => ({ id: e.id, text: `${e.name} · ${e.email}` })), required: true, full: true }) : '') + field('role', 'Access role', u?.role || 'employee', { values: ['employee', 'technician', 'manager', 'admin'], required: true }) + (id ? field('disabled', 'Account status', String(!!u.disabled), { values: [{ id: 'false', text: 'Active' }, { id: 'true', text: 'Disabled' }] }) : '') + field('password', id ? 'Reset temporary password (optional)' : 'Temporary password', '', { type: 'password', required: !id, full: true, max: 128, help: 'Minimum 12 characters. Share through an approved secure channel. The user must replace it at their next sign-in.' });
    openModal(id ? 'Manage account' : 'Create account', id ? u.email : 'Provision secure access for an existing employee.', `<form id="account-form" data-id="${esc(id)}" data-version="${u?._version || ''}"><div class="modal-body"><div class="form-grid">${fields}<p id="account-error" class="form-error" role="alert"></p></div><p class="new-password-note">Role changes, disabling, and password resets revoke all sessions for this account.</p></div><footer class="modal-footer">${action('close-modal', 'Cancel')}<button type="submit" class="button primary">${icon('check')}Save account</button></footer></form>`);
  }
  async function openTicket(id) {
    const result = await api('/tickets/' + encodeURIComponent(id)); currentTicket = result.ticket;
    const t = result.ticket, p = result.permissions;
    const dt = (label, value) => `<div class="detail-field"><dt>${label}</dt><dd>${value}</dd></div>`;
    const comments = result.history.filter(e => e.kind === 'comment'), history = result.history.filter(e => e.kind !== 'comment');
    const body = `<div class="modal-body"><dl class="detail-grid">${dt('Status', badge(t.status))}${dt('Priority', badge(t.priority))}${dt('Requester', esc(personName(t.requesterId)))}${dt('Assigned to', esc(personName(t.assigneeId)))}${dt('Assignment status', `<span class="account-role">${esc(t.assignmentStatus)}</span>`)}${dt('Accepted', t.acceptedAt ? new Date(t.acceptedAt).toLocaleString() : 'Not yet accepted')}${dt('Created', new Date(t.createdAt).toLocaleString())}${dt('Category', esc(t.category))}</dl><div class="detail-description"><h3>Description</h3>${esc(t.description || 'No additional details.')}</div><div class="ticket-workflow">${p.accept ? action('accept-ticket', 'Accept assignment', 'check', `data-id="${esc(id)}"`, 'primary') : ''}${p.reopen ? action('reopen-ticket', 'Reopen ticket', 'refresh', `data-id="${esc(id)}"`) : ''}${p.edit ? `<form id="status-form" class="ticket-workflow" style="border:0;margin:0;padding:0;width:100%">${field('status', 'Update status', t.status, { values: D.enums.ticketStatus })}<button type="submit" class="button primary">Update status</button></form>` : ''}</div><section class="collaboration"><div class="collaboration-heading"><h3>Conversation</h3><span class="muted">${comments.length} comment${comments.length === 1 ? '' : 's'}</span></div><div class="comment-list">${comments.map(e => `<article class="comment ${e.visibility === 'internal' ? 'internal' : ''}"><div class="comment-meta"><strong>${esc(e.actor)}</strong><span>${esc(new Date(e.time).toLocaleString())}</span>${e.visibility === 'internal' ? '<span class="account-role">Team only</span>' : ''}</div><p>${esc(e.text)}</p></article>`).join('') || '<p class="comment-empty">No comments yet. Start the conversation.</p>'}</div>${p.comment ? `<form id="comment-form" class="comment-form"><div class="field"><label for="comment-text">Add a comment</label><textarea id="comment-text" name="text" required maxlength="4000" placeholder="Share an update or ask a question…"></textarea></div><div class="comment-controls">${p.internal ? '<select class="filter-select" name="visibility" aria-label="Comment visibility"><option value="public">Public · requester can see</option><option value="internal">Team only · hidden from employees</option></select>' : '<span class="muted">Visible to you and your IT team</span>'}<button type="submit" class="button primary">${icon('plus')}Post comment</button></div><p id="comment-error" class="form-error" role="alert"></p></form>` : '<p class="muted">This ticket is archived. History is retained.</p>'}</section><section class="collaboration"><h3>Ticket history</h3><ol class="history-list">${history.map(e => `<li>${esc(e.text)}<small>${esc(e.actor)} · ${esc(new Date(e.time).toLocaleString())}</small></li>`).join('')}</ol></section></div>`;
    openModal(t.subject, `${t.id} · ${t.department}`, body, action('close-modal', 'Close') + (p.assign ? action('edit', 'Edit & assign', 'edit', `data-type="tickets" data-id="${esc(id)}"`, 'primary') : ''));
    $('.modal').classList.add('ticket-modal');
  }
  async function showNotifications() {
    notificationItems = (await api('/notifications')).notifications;
    closePopovers(); syncShell();
    $('#notifications').innerHTML = `<div class="notification-head"><strong>Notifications · ${notificationItems.filter(n => !n.read).length} unread</strong><button data-action="read-all">Mark all read</button></div><div class="notification-feed">${notificationItems.map(n => `<button class="dropdown-item ${n.read ? '' : 'unread'}" data-action="open-notification" data-id="${n.id}" data-ticket="${esc(n.ticketId)}">${icon('ticket')}<span><strong>${esc(n.text)}</strong><small>${esc(n.ticketId)} · ${relative(n.time)}</small></span></button>`).join('') || '<div class="dropdown-empty">You’re all caught up. Ticket updates will appear here.</div>'}</div>`;
    $('#notifications').hidden = false; $('[data-action="notifications"]').setAttribute('aria-expanded', 'true');
  }
  async function start() {
    backendReady = false;
    if (!['http:', 'https:'].includes(location.protocol)) return loginScreen();
    try {
      const session = await api('/session');
      if (!session || typeof session !== 'object' || !Object.hasOwn(session, 'user') || typeof session.signupEnabled !== 'boolean') throw new Error('This address is not serving the current Nexus API. Open the live workspace.');
      backendReady = true; registrationEnabled = session.signupEnabled;
      if (!session.user) return location.hash === '#signup' ? signupScreen() : loginScreen('', session.configured);
      currentUser = session.user; csrf = session.csrf; await enterWorkspace();
    } catch (err) { signedOut(err.message || 'Unable to reach the workspace server. Check the connection and try again.'); }
  }
  start();
})();
