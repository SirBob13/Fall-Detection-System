const API_BASE = '/api/v1';
const tokenKey = 'fd_admin_token';

const loginSection = document.getElementById('loginSection');
const dashboardSection = document.getElementById('dashboardSection');
const docsSection = document.getElementById('docsSection');
const navTabs = document.getElementById('navTabs');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const loginStatus = document.getElementById('loginStatus');

const usersStat = document.getElementById('usersStat');
const usersActive = document.getElementById('usersActive');
const devicesStat = document.getElementById('devicesStat');
const devicesConnected = document.getElementById('devicesConnected');
const alertsStat = document.getElementById('alertsStat');
const alertsActive = document.getElementById('alertsActive');
const dataStat = document.getElementById('dataStat');
const lastActivity = document.getElementById('lastActivity');
const alertsTable = document.getElementById('alertsTable');
const vitalsTable = document.getElementById('vitalsTable');
const devicesTable = document.getElementById('devicesTable');
const reportsBox = document.getElementById('reportsBox');
const usersTable = document.getElementById('usersTable');
const userSearchInput = document.getElementById('userSearch');
const searchUsersBtn = document.getElementById('searchUsers');
const exportUsersBtn = document.getElementById('exportUsers');
const userDetailCard = document.getElementById('userDetailCard');
const userDetailBox = document.getElementById('userDetailBox');

const startDateInput = document.getElementById('startDate');
const endDateInput = document.getElementById('endDate');
const applyDateFilterBtn = document.getElementById('applyDateFilter');
const exportPdfBtn = document.getElementById('exportPdf');

const alertsChartEl = document.getElementById('alertsChart');
const vitalsChartEl = document.getElementById('vitalsChart');
const motionsChartEl = document.getElementById('motionsChart');

const refreshAlertsBtn = document.getElementById('refreshAlerts');
const refreshVitalsBtn = document.getElementById('refreshVitals');
const refreshDevicesBtn = document.getElementById('refreshDevices');

let activePeriod = 'weekly';
let currentUserSearch = '';
let currentUserId = null;
let activeTab = 'dashboard';

function setActiveTab(tab) {
  activeTab = tab;
  const tabButtons = document.querySelectorAll('.tab');
  tabButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  if (tab === 'docs') {
    dashboardSection.classList.add('hidden');
    docsSection.classList.remove('hidden');
  } else {
    docsSection.classList.add('hidden');
    dashboardSection.classList.remove('hidden');
  }
}

function setStatus(msg, ok = false) {
  loginStatus.textContent = msg;
  loginStatus.style.color = ok ? '#3ad29f' : '#ff6b6b';
}

function getToken() {
  return localStorage.getItem(tokenKey);
}

function setToken(token) {
  localStorage.setItem(tokenKey, token);
}

function clearToken() {
  localStorage.removeItem(tokenKey);
}

async function api(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const message = data?.error || data?.detail?.error || data?.detail || res.statusText;
    throw new Error(message);
  }
  return res.json();
}

async function login() {
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  if (!email || !password) {
    setStatus('Email and password required');
    return;
  }

  try {
    setStatus('Signing in...', true);
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok || !data?.access_token) {
      throw new Error(data?.error || 'Login failed');
    }

    setToken(data.access_token);
    setStatus('Login successful', true);
    await boot();
  } catch (err) {
    setStatus(err.message || 'Login failed');
  }
}

async function boot() {
  try {
    const overview = await api('/admin/overview');
    renderOverview(overview.data);

    loginSection.classList.add('hidden');
    dashboardSection.classList.remove('hidden');
    docsSection.classList.add('hidden');
    if (navTabs) navTabs.classList.remove('hidden');
    logoutBtn.classList.remove('hidden');
    setActiveTab(activeTab || 'dashboard');

    const results = await Promise.allSettled([
      loadAlerts(),
      loadVitals(),
      loadDevices(),
      loadUsers(),
      loadReports('weekly')
    ]);

    const failed = results
      .map((result, index) => ({ result, index }))
      .filter(({ result }) => result.status === 'rejected');

    if (failed.length) {
      console.warn('Some dashboard widgets failed to load', failed);
      setStatus('Logged in. Some dashboard sections failed to load.', false);
    } else {
      setStatus('');
    }
  } catch (err) {
    console.error('Admin boot failed', err);
    clearToken();
    loginSection.classList.remove('hidden');
    dashboardSection.classList.add('hidden');
    docsSection.classList.add('hidden');
    if (navTabs) navTabs.classList.add('hidden');
    logoutBtn.classList.add('hidden');
    setStatus(err.message || 'Admin access required');
  }
}

function renderOverview(data) {
  usersStat.textContent = data?.users?.total ?? '-';
  usersActive.textContent = `Active: ${data?.users?.active ?? '-'}`;

  devicesStat.textContent = data?.devices?.total ?? '-';
  devicesConnected.textContent = `Connected: ${data?.devices?.connected ?? '-'}`;

  alertsStat.textContent = data?.alerts?.total ?? '-';
  alertsActive.textContent = `Active: ${data?.alerts?.active ?? '-'}`;

  dataStat.textContent = `${data?.motions ?? 0} motions / ${data?.vitals ?? 0} vitals`;
  const last = data?.last_activity || {};
  lastActivity.textContent = `Last: motion ${last.motion || '-'} | vital ${last.vital || '-'}`;
}

function renderList(container, items, renderFn) {
  container.innerHTML = '';
  if (!items?.length) {
    container.innerHTML = '<div class="muted">No data</div>';
    return;
  }
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = renderFn(item);
    container.appendChild(row);
  });
}

async function loadAlerts() {
  const query = buildDateQuery();
  const res = await api(`/admin/alerts?limit=10${query}`);
  renderList(alertsTable, res.data, (a) => `
    <div>
      <strong>${a.type}</strong> · ${a.severity} · ${a.status}<br/>
      <small>User ${a.user_id} · ${a.timestamp || ''}</small>
    </div>
    <div>${a.message || ''}</div>
  `);
}

async function loadVitals() {
  const query = buildDateQuery();
  const res = await api(`/admin/vitals?limit=10${query}`);
  renderList(vitalsTable, res.data, (v) => `
    <div>
      <strong>User ${v.user_id}</strong><br/>
      <small>${v.timestamp || ''}</small>
    </div>
    <div>
      HR ${v.heart_rate ?? '-'} | SpO2 ${v.oxygen_saturation ?? '-'} | Temp ${v.body_temperature ?? '-'}
    </div>
  `);
}

async function loadDevices() {
  const res = await api('/admin/devices?limit=10');
  renderList(devicesTable, res.data, (d) => `
    <div>
      <strong>${d.device_id}</strong><br/>
      <small>User ${d.user_id} · ${d.last_seen || ''}</small>
    </div>
    <div>
      Battery ${d.battery_level ?? '-'} | ${d.is_connected ? 'Connected' : 'Offline'}
    </div>
  `);
}

function buildDateQuery() {
  const start = startDateInput?.value;
  const end = endDateInput?.value;
  const parts = [];
  if (start) parts.push(`start=${encodeURIComponent(start)}`);
  if (end) parts.push(`end=${encodeURIComponent(end)}`);
  return parts.length ? `&${parts.join('&')}` : '';
}

async function loadReports(period) {
  activePeriod = period;
  const query = buildDateQuery();
  const res = await api(`/admin/reports?period=${period}${query}`);
  reportsBox.textContent = JSON.stringify(res, null, 2);
  renderCharts(res.series || {});
}

function renderCharts(series) {
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js is unavailable; skipping dashboard charts.');
    return;
  }

  const labels = (series.alerts || []).map(i => i.date);
  const alertCounts = (series.alerts || []).map(i => i.count);
  const vitalCounts = (series.vitals || []).map(i => i.count);
  const motionCounts = (series.motions || []).map(i => i.count);

  const baseConfig = (label, data, color) => ({
    type: 'line',
    data: {
      labels,
      datasets: [{
        label,
        data,
        borderColor: color,
        backgroundColor: 'rgba(78,161,255,0.15)',
        tension: 0.3,
        fill: true
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#9aa1ad' } },
        y: { ticks: { color: '#9aa1ad' } }
      }
    }
  });

  if (alertsChartEl) {
    if (alertsChartEl._chart) alertsChartEl._chart.destroy();
    alertsChartEl._chart = new Chart(alertsChartEl, baseConfig('Alerts', alertCounts, '#ff6b6b'));
  }
  if (vitalsChartEl) {
    if (vitalsChartEl._chart) vitalsChartEl._chart.destroy();
    vitalsChartEl._chart = new Chart(vitalsChartEl, baseConfig('Vitals', vitalCounts, '#3ad29f'));
  }
  if (motionsChartEl) {
    if (motionsChartEl._chart) motionsChartEl._chart.destroy();
    motionsChartEl._chart = new Chart(motionsChartEl, baseConfig('Motions', motionCounts, '#4ea1ff'));
  }
}

async function loadUsers(search = '') {
  currentUserSearch = search;
  const query = search ? `&search=${encodeURIComponent(search)}` : '';
  const res = await api(`/admin/users?limit=20${query}`);
  renderUsers(res.data);
}

function renderUsers(items) {
  usersTable.innerHTML = '';
  if (!items?.length) {
    usersTable.innerHTML = '<div class="muted">No users found</div>';
    return;
  }

  items.forEach(u => {
    const row = document.createElement('div');
    row.className = 'row user-row';
    row.innerHTML = `
      <div>
        <strong>${u.name}</strong><br/>
        <small>${u.email}</small>
      </div>
      <div>
        Devices ${u.devices} · <span class="badge ${u.is_active ? 'success' : 'danger'}">${u.is_active ? 'Active' : 'Inactive'}</span><br/>
        <small>Last seen: ${u.last_seen || '-'}</small>
      </div>
      <div class="row actions">
        <button class="ghost btn-view" data-id="${u.id}">Details</button>
        <button class="ghost btn-toggle" data-id="${u.id}" data-active="${u.is_active}">${u.is_active ? 'Disable' : 'Activate'}</button>
        <button class="ghost danger btn-delete" data-id="${u.id}">Delete</button>
      </div>
    `;
    usersTable.appendChild(row);
  });
}

async function loadUserDetail(userId) {
  const res = await api(`/admin/users/${userId}`);
  currentUserId = userId;
  userDetailCard.classList.remove('hidden');
  userDetailBox.textContent = JSON.stringify(res.data, null, 2);
}

async function toggleUserStatus(userId, isActive) {
  await api(`/admin/users/${userId}/status`, {
    method: 'PUT',
    body: JSON.stringify({ is_active: !isActive })
  });
  await loadUsers(currentUserSearch);
  if (currentUserId === userId) {
    await loadUserDetail(userId);
  }
}

async function deleteUser(userId) {
  if (!confirm('Delete this user? This cannot be undone.')) return;
  await api(`/admin/users/${userId}`, { method: 'DELETE' });
  await loadUsers(currentUserSearch);
  if (currentUserId === userId) {
    currentUserId = null;
    userDetailCard.classList.add('hidden');
  }
}

async function exportUsers() {
  const token = getToken();
  if (!token) return;
  const res = await fetch(`${API_BASE}/admin/users/export`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    alert('Export failed');
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'users.csv';
  a.click();
  URL.revokeObjectURL(url);
}

loginBtn.addEventListener('click', login);
logoutBtn.addEventListener('click', () => {
  clearToken();
  loginSection.classList.remove('hidden');
  dashboardSection.classList.add('hidden');
  docsSection.classList.add('hidden');
  if (navTabs) navTabs.classList.add('hidden');
  logoutBtn.classList.add('hidden');
});

refreshAlertsBtn.addEventListener('click', loadAlerts);
refreshVitalsBtn.addEventListener('click', loadVitals);
refreshDevicesBtn.addEventListener('click', loadDevices);
if (searchUsersBtn) searchUsersBtn.addEventListener('click', () => loadUsers(userSearchInput.value));
if (exportUsersBtn) exportUsersBtn.addEventListener('click', exportUsers);
if (applyDateFilterBtn) {
  applyDateFilterBtn.addEventListener('click', async () => {
    await loadAlerts();
    await loadVitals();
    await loadReports(activePeriod);
  });
}
if (exportPdfBtn) {
  exportPdfBtn.addEventListener('click', async () => {
    const token = getToken();
    if (!token) return;
    const query = buildDateQuery();
    const res = await fetch(`${API_BASE}/admin/reports/export?period=${activePeriod}${query}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      alert('PDF export failed');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'report.pdf';
    a.click();
    URL.revokeObjectURL(url);
  });
}

usersTable.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const userId = parseInt(target.dataset.id, 10);
  if (!userId) return;

  if (target.classList.contains('btn-view')) {
    await loadUserDetail(userId);
  }
  if (target.classList.contains('btn-toggle')) {
    const isActive = target.dataset.active === 'true';
    await toggleUserStatus(userId, isActive);
  }
  if (target.classList.contains('btn-delete')) {
    await deleteUser(userId);
  }
});

document.querySelectorAll('[data-period]').forEach((btn) => {
  btn.addEventListener('click', () => loadReports(btn.dataset.period));
});

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
});

// Auto-boot if token exists
if (getToken()) {
  boot();
}
