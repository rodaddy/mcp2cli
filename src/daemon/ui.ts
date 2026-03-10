/**
 * Embedded web UI for mcp2cli daemon management.
 * Single-file HTML dashboard -- no build step, no dependencies.
 */

export function renderUI(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mcp2cli - Service Manager</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
    background: #0d1117; color: #c9d1d9; line-height: 1.5;
    padding: 1.5rem; max-width: 960px; margin: 0 auto;
  }
  h1 { color: #58a6ff; font-size: 1.4rem; margin-bottom: 0.5rem; }
  h2 { color: #8b949e; font-size: 1rem; margin: 1.5rem 0 0.75rem; }
  .subtitle { color: #8b949e; font-size: 0.85rem; margin-bottom: 1.5rem; }
  .status-bar {
    display: flex; gap: 1.5rem; padding: 0.75rem 1rem;
    background: #161b22; border: 1px solid #30363d; border-radius: 6px;
    margin-bottom: 1.5rem; font-size: 0.85rem;
  }
  .status-bar span { color: #8b949e; }
  .status-bar strong { color: #c9d1d9; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 1rem; }
  th {
    text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #30363d;
    color: #8b949e; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em;
  }
  td {
    padding: 0.5rem 0.75rem; border-bottom: 1px solid #21262d;
    font-size: 0.9rem;
  }
  tr:hover { background: #161b22; }
  .dot {
    display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    margin-right: 6px; vertical-align: middle;
  }
  .dot-green { background: #3fb950; }
  .dot-red { background: #f85149; }
  .dot-gray { background: #484f58; }
  .backend-badge {
    display: inline-block; padding: 1px 6px; border-radius: 3px;
    font-size: 0.75rem; font-weight: 600;
  }
  .badge-stdio { background: #1f3a5f; color: #58a6ff; }
  .badge-http { background: #2a1f3f; color: #bc8cff; }
  .badge-websocket { background: #1f3f2a; color: #56d364; }
  button, .btn {
    padding: 0.4rem 0.85rem; border: 1px solid #30363d; border-radius: 6px;
    background: #21262d; color: #c9d1d9; cursor: pointer;
    font-size: 0.8rem; transition: background 0.15s;
  }
  button:hover, .btn:hover { background: #30363d; }
  .btn-primary { background: #238636; border-color: #2ea043; color: #fff; }
  .btn-primary:hover { background: #2ea043; }
  .btn-danger { background: #da3633; border-color: #f85149; color: #fff; }
  .btn-danger:hover { background: #f85149; }
  .btn-sm { padding: 0.2rem 0.5rem; font-size: 0.75rem; }
  .actions { display: flex; gap: 0.4rem; }
  .panel {
    background: #161b22; border: 1px solid #30363d; border-radius: 6px;
    padding: 1rem; margin-bottom: 1rem;
  }
  .panel h3 { color: #58a6ff; font-size: 0.9rem; margin-bottom: 0.75rem; }
  .form-row { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; align-items: center; }
  .form-row label { min-width: 80px; font-size: 0.85rem; color: #8b949e; }
  input, select, textarea {
    background: #0d1117; border: 1px solid #30363d; border-radius: 4px;
    color: #c9d1d9; padding: 0.35rem 0.6rem; font-size: 0.85rem;
    font-family: inherit; flex: 1;
  }
  input:focus, select:focus, textarea:focus { outline: none; border-color: #58a6ff; }
  textarea { min-height: 60px; resize: vertical; }
  .toast {
    position: fixed; top: 1rem; right: 1rem; padding: 0.75rem 1.25rem;
    border-radius: 6px; font-size: 0.85rem; z-index: 100;
    transition: opacity 0.3s; opacity: 0;
  }
  .toast.show { opacity: 1; }
  .toast-success { background: #238636; color: #fff; }
  .toast-error { background: #da3633; color: #fff; }
  .hidden { display: none; }
  .toolbar { display: flex; gap: 0.5rem; margin-bottom: 1rem; }
  .login-overlay {
    position: fixed; inset: 0; background: rgba(13,17,23,0.95);
    display: flex; align-items: center; justify-content: center; z-index: 200;
  }
  .login-box {
    background: #161b22; border: 1px solid #30363d; border-radius: 8px;
    padding: 2rem; width: 340px; text-align: center;
  }
  .login-box h2 { color: #58a6ff; margin-bottom: 0.25rem; font-size: 1.2rem; }
  .login-box p { color: #8b949e; font-size: 0.8rem; margin-bottom: 1rem; }
  .login-box input { width: 100%; margin-bottom: 0.75rem; }
  .login-box .login-error { color: #f85149; font-size: 0.8rem; margin-bottom: 0.5rem; min-height: 1.2em; }
  .login-tabs {
    display: flex; border-bottom: 1px solid #30363d; margin-bottom: 1rem;
  }
  .login-tab {
    flex: 1; padding: 0.5rem; background: none; border: none; border-bottom: 2px solid transparent;
    color: #8b949e; cursor: pointer; font-size: 0.85rem; font-family: inherit;
    transition: color 0.15s, border-color 0.15s;
  }
  .login-tab:hover { color: #c9d1d9; }
  .login-tab.active { color: #58a6ff; border-bottom-color: #58a6ff; }
  .login-tab-content { display: none; }
  .login-tab-content.active { display: block; }
  .auth-bar {
    display: flex; justify-content: flex-end; margin-bottom: 0.5rem;
    font-size: 0.8rem; color: #8b949e;
  }
  .auth-bar button { font-size: 0.75rem; }
  @media (max-width: 640px) {
    body { padding: 1rem; }
    .form-row { flex-direction: column; }
    .form-row label { min-width: auto; }
  }
</style>
</head>
<body>

<!-- Login Overlay -->
<div id="loginOverlay" class="login-overlay hidden">
  <div class="login-box">
    <h2>mcp2cli</h2>
    <p>Sign in to the daemon management UI</p>
    <div class="login-tabs">
      <button class="login-tab active" onclick="switchLoginTab('login')">Login</button>
      <button class="login-tab" onclick="switchLoginTab('token')">Token</button>
    </div>
    <div id="loginError" class="login-error"></div>
    <div id="loginTabContent" class="login-tab-content active">
      <input type="text" id="usernameInput" placeholder="Username" autocomplete="username" onkeydown="if(event.key==='Enter')document.getElementById('passwordInput').focus()">
      <input type="password" id="passwordInput" placeholder="Password" autocomplete="current-password" onkeydown="if(event.key==='Enter')doLoginBasic()">
      <button class="btn-primary" style="width:100%" onclick="doLoginBasic()">Sign In</button>
    </div>
    <div id="tokenTabContent" class="login-tab-content">
      <input type="password" id="tokenInput" placeholder="Bearer token" onkeydown="if(event.key==='Enter')doLogin()">
      <button class="btn-primary" style="width:100%" onclick="doLogin()">Sign In</button>
    </div>
  </div>
</div>

<div id="appContent">
<div class="auth-bar">
  <span id="authStatus"></span>
  <button onclick="doLogout()" id="logoutBtn" class="hidden">Sign Out</button>
</div>

<h1>mcp2cli</h1>
<div class="subtitle">Service Manager</div>

<div class="status-bar" id="statusBar">
  <div><span>Status:</span> <strong id="srvStatus">--</strong></div>
  <div><span>Services:</span> <strong id="srvCount">--</strong></div>
  <div><span>Connected:</span> <strong id="srvConnected">--</strong></div>
  <div><span>Uptime:</span> <strong id="srvUptime">--</strong></div>
</div>

<div class="toolbar">
  <button class="btn-primary" data-role="admin" onclick="showPanel('addPanel')">+ Add Service</button>
  <button data-role="admin" onclick="showPanel('importPanel')">Import from URL</button>
  <button data-role="admin" onclick="reloadConfig()">Reload from Disk</button>
</div>

<table>
  <thead>
    <tr><th>Service</th><th>Backend</th><th>Status</th><th>Endpoint</th><th>Actions</th></tr>
  </thead>
  <tbody id="serviceTable"><tr><td colspan="5">Loading...</td></tr></tbody>
</table>

<!-- Add Service Panel -->
<div id="addPanel" class="panel hidden">
  <h3 id="formTitle">Add Service</h3>
  <div class="form-row">
    <label>Name</label>
    <input type="text" id="svcName" placeholder="my-service">
  </div>
  <div class="form-row">
    <label>Backend</label>
    <select id="svcBackend" onchange="updateFormFields()">
      <option value="stdio">stdio</option>
      <option value="http">http</option>
      <option value="websocket">websocket</option>
    </select>
  </div>
  <div id="stdioFields">
    <div class="form-row">
      <label>Command</label>
      <input type="text" id="svcCommand" placeholder="/usr/bin/node">
    </div>
    <div class="form-row">
      <label>Args</label>
      <input type="text" id="svcArgs" placeholder="server.js --port 3000 (space-separated)">
    </div>
    <div class="form-row">
      <label>Env</label>
      <input type="text" id="svcEnv" placeholder="KEY=value KEY2=value2">
    </div>
  </div>
  <div id="httpFields" class="hidden">
    <div class="form-row">
      <label>URL</label>
      <input type="text" id="svcUrl" placeholder="http://localhost:3000/sse">
    </div>
    <div class="form-row">
      <label>Headers</label>
      <input type="text" id="svcHeaders" placeholder="Authorization=Bearer xxx">
    </div>
  </div>
  <div class="form-row" style="margin-top: 0.75rem;">
    <label></label>
    <div class="actions">
      <button class="btn-primary" onclick="submitService()">Save</button>
      <button onclick="hidePanel('addPanel'); editMode=null;">Cancel</button>
    </div>
  </div>
</div>

<!-- Import Panel -->
<div id="importPanel" class="panel hidden">
  <h3>Import Services</h3>
  <div class="form-row">
    <label>URL</label>
    <input type="text" id="importUrl" placeholder="https://raw.githubusercontent.com/user/repo/main/services.json">
  </div>
  <div class="form-row">
    <label>Mode</label>
    <select id="importMode">
      <option value="merge">Merge (add new, update existing, keep others)</option>
      <option value="replace">Replace (full replacement)</option>
    </select>
  </div>
  <div class="form-row" style="margin-top: 0.5rem;">
    <label>-- or --</label>
  </div>
  <div class="form-row">
    <label>Repo</label>
    <input type="text" id="importRepo" placeholder="owner/repo">
  </div>
  <div class="form-row">
    <label>Branch</label>
    <input type="text" id="importBranch" placeholder="main" value="main">
  </div>
  <div class="form-row">
    <label>Path</label>
    <input type="text" id="importPath" placeholder="services.json" value="services.json">
  </div>
  <div class="form-row" style="margin-top: 0.75rem;">
    <label></label>
    <div class="actions">
      <button class="btn-primary" onclick="importServices()">Import</button>
      <button onclick="hidePanel('importPanel')">Cancel</button>
    </div>
  </div>
</div>

<div id="toast" class="toast"></div>
</div><!-- /appContent -->

<script>
let editMode = null; // null = add, string = editing service name
let pollTimer = null;
let currentRole = 'admin'; // updated after auth

// --- Auth token management ---
function getToken() { return sessionStorage.getItem('mcp2cli_token'); }
function setToken(t) { sessionStorage.setItem('mcp2cli_token', t); }
function clearToken() { sessionStorage.removeItem('mcp2cli_token'); }
function isAdmin() { return currentRole === 'admin'; }

function showLogin(msg) {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  document.getElementById('loginOverlay').classList.remove('hidden');
  document.getElementById('loginError').textContent = msg || '';
  document.getElementById('tokenInput').value = '';
  document.getElementById('usernameInput').value = '';
  document.getElementById('passwordInput').value = '';
  // Focus the active tab's first input
  const activeTab = document.querySelector('.login-tab-content.active');
  if (activeTab) {
    const firstInput = activeTab.querySelector('input');
    if (firstInput) firstInput.focus();
  }
}

function switchLoginTab(tab) {
  document.getElementById('loginError').textContent = '';
  document.querySelectorAll('.login-tab').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.login-tab-content').forEach(el => el.classList.remove('active'));
  if (tab === 'token') {
    document.querySelectorAll('.login-tab')[1].classList.add('active');
    document.getElementById('tokenTabContent').classList.add('active');
    document.getElementById('tokenInput').focus();
  } else {
    document.querySelectorAll('.login-tab')[0].classList.add('active');
    document.getElementById('loginTabContent').classList.add('active');
    document.getElementById('usernameInput').focus();
  }
}

async function doLoginBasic() {
  const username = document.getElementById('usernameInput').value.trim();
  const password = document.getElementById('passwordInput').value;
  if (!username || !password) {
    document.getElementById('loginError').textContent = 'Username and password required';
    return;
  }
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!data.success) {
      document.getElementById('loginError').textContent = data.error || 'Invalid credentials';
      return;
    }
    setToken(data.token);
    currentRole = data.role || 'viewer';
    document.getElementById('loginOverlay').classList.add('hidden');
    document.getElementById('logoutBtn').classList.remove('hidden');
    document.getElementById('authStatus').textContent = data.userId + ' (' + currentRole + ')';
    applyRoleUI();
    refresh();
    pollTimer = setInterval(refresh, 5000);
  } catch (e) {
    document.getElementById('loginError').textContent = 'Connection error';
  }
}

async function doLogin() {
  const token = document.getElementById('tokenInput').value.trim();
  if (!token) { document.getElementById('loginError').textContent = 'Token required'; return; }
  // Test the token against /api/services
  const res = await fetch('/api/services', {
    headers: { 'Authorization': 'Bearer ' + token },
  });
  if (res.status === 401) {
    document.getElementById('loginError').textContent = 'Invalid token';
    return;
  }
  setToken(token);
  // Fetch role info
  const me = await fetch('/api/auth/me', { headers: { 'Authorization': 'Bearer ' + token } }).then(r => r.json());
  currentRole = me.role || 'viewer';
  document.getElementById('loginOverlay').classList.add('hidden');
  document.getElementById('logoutBtn').classList.remove('hidden');
  document.getElementById('authStatus').textContent = me.userId + ' (' + currentRole + ')';
  applyRoleUI();
  refresh();
  pollTimer = setInterval(refresh, 5000);
}

function doLogout() {
  clearToken();
  currentRole = 'admin';
  showLogin('');
  document.getElementById('logoutBtn').classList.add('hidden');
  document.getElementById('authStatus').textContent = '';
}

function applyRoleUI() {
  // Hide admin-only controls for non-admin roles
  document.querySelectorAll('[data-role="admin"]').forEach(el => {
    el.style.display = isAdmin() ? '' : 'none';
  });
}

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  if (res.status === 401) { showLogin('Session expired -- please sign in again'); throw new Error('Unauthorized'); }
  return res.json();
}

function toast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast toast-' + type + ' show';
  setTimeout(() => el.classList.remove('show'), 3000);
}

function showPanel(id) {
  document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  if (id === 'addPanel' && !editMode) {
    document.getElementById('formTitle').textContent = 'Add Service';
    document.getElementById('svcName').disabled = false;
    clearForm();
  }
}

function hidePanel(id) { document.getElementById(id).classList.add('hidden'); }

function clearForm() {
  ['svcName','svcCommand','svcArgs','svcEnv','svcUrl','svcHeaders'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('svcBackend').value = 'stdio';
  updateFormFields();
}

function updateFormFields() {
  const backend = document.getElementById('svcBackend').value;
  document.getElementById('stdioFields').classList.toggle('hidden', backend !== 'stdio');
  document.getElementById('httpFields').classList.toggle('hidden', backend === 'stdio');
}

function parseKV(str) {
  if (!str.trim()) return {};
  const obj = {};
  str.trim().split(/\\s+/).forEach(pair => {
    const i = pair.indexOf('=');
    if (i > 0) obj[pair.slice(0, i)] = pair.slice(i + 1);
  });
  return obj;
}

function buildConfig() {
  const backend = document.getElementById('svcBackend').value;
  if (backend === 'stdio') {
    return {
      backend: 'stdio',
      command: document.getElementById('svcCommand').value,
      args: document.getElementById('svcArgs').value.trim().split(/\\s+/).filter(Boolean),
      env: parseKV(document.getElementById('svcEnv').value),
    };
  }
  return {
    backend,
    url: document.getElementById('svcUrl').value,
    headers: parseKV(document.getElementById('svcHeaders').value),
  };
}

async function submitService() {
  const name = document.getElementById('svcName').value.trim();
  if (!name) { toast('Service name required', 'error'); return; }
  const config = buildConfig();
  if (config.backend === 'stdio' && !config.command) { toast('Command required', 'error'); return; }
  if (config.backend !== 'stdio' && !config.url) { toast('URL required', 'error'); return; }

  try {
    let res;
    if (editMode) {
      res = await api('PUT', '/services/' + encodeURIComponent(editMode), { config });
    } else {
      res = await api('POST', '/services', { name, config });
    }
    if (res.success) {
      toast(editMode ? 'Service updated' : 'Service added', 'success');
      editMode = null;
      hidePanel('addPanel');
      refresh();
    } else {
      toast(res.error?.message || 'Failed', 'error');
    }
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteService(name) {
  if (!confirm('Remove service "' + name + '"?')) return;
  try {
    const res = await api('DELETE', '/services/' + encodeURIComponent(name));
    if (res.success) { toast('Service removed', 'success'); refresh(); }
    else toast(res.error?.message || 'Failed', 'error');
  } catch (e) { toast(e.message, 'error'); }
}

function editService(name, svc) {
  editMode = name;
  document.getElementById('formTitle').textContent = 'Edit Service: ' + name;
  document.getElementById('svcName').value = name;
  document.getElementById('svcName').disabled = true;
  document.getElementById('svcBackend').value = svc.backend;
  updateFormFields();
  if (svc.backend === 'stdio') {
    document.getElementById('svcCommand').value = svc.command || '';
    document.getElementById('svcArgs').value = (svc.args || []).join(' ');
    document.getElementById('svcEnv').value = Object.entries(svc.env || {}).map(([k,v]) => k+'='+v).join(' ');
  } else {
    document.getElementById('svcUrl').value = svc.url || '';
    document.getElementById('svcHeaders').value = Object.entries(svc.headers || {}).map(([k,v]) => k+'='+v).join(' ');
  }
  showPanel('addPanel');
}

async function reloadConfig() {
  try {
    const res = await api('POST', '/services/reload');
    if (res.success) {
      const parts = [];
      if (res.added?.length) parts.push(res.added.length + ' added');
      if (res.updated?.length) parts.push(res.updated.length + ' updated');
      if (res.removed?.length) parts.push(res.removed.length + ' removed');
      toast(parts.length ? 'Reloaded: ' + parts.join(', ') : 'No changes', 'success');
      refresh();
    } else toast(res.error?.message || 'Failed', 'error');
  } catch (e) { toast(e.message, 'error'); }
}

async function importServices() {
  const url = document.getElementById('importUrl').value.trim();
  const repo = document.getElementById('importRepo').value.trim();
  const mode = document.getElementById('importMode').value;
  if (!url && !repo) { toast('URL or repo required', 'error'); return; }

  const body = { mode };
  if (url) body.url = url;
  if (repo) {
    body.repo = repo;
    body.branch = document.getElementById('importBranch').value.trim() || 'main';
    body.path = document.getElementById('importPath').value.trim() || 'services.json';
  }

  try {
    const res = await api('POST', '/services/import', body);
    if (res.success) {
      const parts = [];
      if (res.added?.length) parts.push(res.added.length + ' added');
      if (res.updated?.length) parts.push(res.updated.length + ' updated');
      if (res.removed?.length) parts.push(res.removed.length + ' removed');
      toast(parts.length ? 'Imported: ' + parts.join(', ') : 'No changes', 'success');
      hidePanel('importPanel');
      refresh();
    } else toast(res.error?.message || 'Failed', 'error');
  } catch (e) { toast(e.message, 'error'); }
}

// Store full service configs for edit
let serviceConfigs = {};

async function refresh() {
  try {
    const [health, services] = await Promise.all([
      fetch('/health').then(r => r.json()),
      api('GET', '/services'),
    ]);

    document.getElementById('srvStatus').textContent = health.status || '--';
    document.getElementById('srvCount').textContent = String(services.services?.length ?? 0);
    document.getElementById('srvConnected').textContent = String(health.activeConnections ?? 0);

    const s = Math.floor(health.uptime || 0);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    document.getElementById('srvUptime').textContent = h + 'h ' + m + 'm';

    const tbody = document.getElementById('serviceTable');
    if (!services.services?.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="color:#8b949e">No services configured</td></tr>';
      return;
    }

    serviceConfigs = {};
    tbody.innerHTML = services.services.map(svc => {
      serviceConfigs[svc.name] = svc;
      const dot = svc.connected ? 'dot-green' : 'dot-gray';
      const label = svc.connected ? 'Connected' : 'Idle';
      const badge = 'badge-' + svc.backend;
      const endpoint = svc.url || '--';
      return '<tr>' +
        '<td><strong>' + esc(svc.name) + '</strong></td>' +
        '<td><span class="backend-badge ' + badge + '">' + svc.backend + '</span></td>' +
        '<td><span class="dot ' + dot + '"></span>' + label + '</td>' +
        '<td style="color:#8b949e;font-size:0.8rem">' + esc(endpoint) + '</td>' +
        '<td class="actions">' +
          (isAdmin() ? '<button class="btn-sm" onclick="editService(\\''+esc(svc.name)+'\\',serviceConfigs[\\''+esc(svc.name)+'\\'])">Edit</button>' +
          '<button class="btn-sm btn-danger" onclick="deleteService(\\''+esc(svc.name)+'\\')">Remove</button>' : '') +
        '</td></tr>';
    }).join('');
  } catch (e) {
    document.getElementById('srvStatus').textContent = 'error';
  }
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// Initial load: check if auth is required
(async function init() {
  // Probe /api/services without token to see if auth is enforced
  const probe = await fetch('/api/services');
  if (probe.status === 401) {
    // Auth required -- check sessionStorage for saved token
    const saved = getToken();
    if (saved) {
      const recheck = await fetch('/api/services', {
        headers: { 'Authorization': 'Bearer ' + saved },
      });
      if (recheck.status === 401) {
        clearToken();
        showLogin('');
        return;
      }
      // Token still valid -- fetch role
      const me = await fetch('/api/auth/me', { headers: { 'Authorization': 'Bearer ' + saved } }).then(r => r.json());
      currentRole = me.role || 'viewer';
      document.getElementById('logoutBtn').classList.remove('hidden');
      document.getElementById('authStatus').textContent = me.userId + ' (' + currentRole + ')';
      applyRoleUI();
    } else {
      showLogin('');
      return;
    }
  }
  // No auth or valid token -- go
  refresh();
  pollTimer = setInterval(refresh, 5000);
})();
</script>
</body>
</html>`;
}
