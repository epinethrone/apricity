// ---------- state ----------
const state = {
  palace: null,
  selectedWing: "all",
  selectedRoom: "all",
  selectedDrawerId: null,
  deleteRequest: null,
  editDrawerId: null,
  query: "",
  sortBy: "filed-desc",
  editingWings: false,
  editingRooms: false,
  renaming: null,
  factsView: "list",
  graphFocus: null,
  draftsCount: 0,
  applyingHash: false,
  factEditing: null,
  editingDraft: null,
  // Tunnels: loaded lazily in parallel to the palace. Renderers read from
  // tunnelsByRoomKey (key = `wing|room`) to decorate room nav items.
  tunnels: [],
  tunnelsByRoomKey: new Map(),
  tunnelsByWing: new Map(),
  tunnelsLoaded: false,
  expandedTunnelRooms: new Set(),
};

const AUTH_STORAGE_KEY = "mempalace-auth-token";
const THEME_STORAGE_KEY = "mempalace-theme";

// ---------- dom refs ----------
const els = {
  wingNav: document.querySelector("#wingNav"),
  stats: document.querySelector("#stats"),
  drawerList: document.querySelector("#drawerList"),
  drawerCount: document.querySelector("#drawerCount"),
  roomNav: document.querySelector("#roomNav"),
  roomCount: document.querySelector("#roomCount"),
  detail: document.querySelector("#detail"),
  emptyState: document.querySelector("#emptyState"),
  facts: document.querySelector("#facts"),
  factsGraph: document.querySelector("#factsGraph"),
  factsViewList: document.querySelector("#factsViewList"),
  factsViewGraph: document.querySelector("#factsViewGraph"),
  footerInfo: document.querySelector("#footerInfo"),
  factCount: document.querySelector("#factCount"),
  searchInput: document.querySelector("#searchInput"),
  searchHint: document.querySelector("#searchHint"),
  sortSelect: document.querySelector("#sortSelect"),
  draftsBtn: document.querySelector("#draftsBtn"),
  draftsBadge: document.querySelector("#draftsBadge"),
  trashBtn: document.querySelector("#trashBtn"),
  addFactBtn: document.querySelector("#addFactBtn"),
  writeOpen: document.querySelector("#writeOpen"),
  writeSheet: document.querySelector("#writeSheet"),
  writeBackdrop: document.querySelector("#writeBackdrop"),
  writeClose: document.querySelector("#writeClose"),
  writeForm: document.querySelector("#writeForm"),
  writeWing: document.querySelector("#writeWing"),
  writeRoom: document.querySelector("#writeRoom"),
  writeTitle: document.querySelector("#writeTitle"),
  writeContent: document.querySelector("#writeContent"),
  writeStatus: document.querySelector("#writeStatus"),
  saveMemory: document.querySelector("#saveMemory"),
  saveDraft: document.querySelector("#saveDraft"),
  writeSheetTitle: document.querySelector("#writeSheetTitle"),
  writeSheetSubtitle: document.querySelector("#writeSheetSubtitle"),
  themeToggle: document.querySelector("#themeToggle"),
  themeIcon: document.querySelector("#themeIcon"),
  editSheet: document.querySelector("#editSheet"),
  editBackdrop: document.querySelector("#editBackdrop"),
  editClose: document.querySelector("#editClose"),
  editForm: document.querySelector("#editForm"),
  editSubtitle: document.querySelector("#editSubtitle"),
  editWing: document.querySelector("#editWing"),
  editRoom: document.querySelector("#editRoom"),
  editTitle: document.querySelector("#editTitle"),
  editContent: document.querySelector("#editContent"),
  editDrawerLabel: document.querySelector("#editDrawerLabel"),
  copyEditId: document.querySelector("#copyEditId"),
  saveEdit: document.querySelector("#saveEdit"),
  editStatus: document.querySelector("#editStatus"),
  deleteSheet: document.querySelector("#deleteSheet"),
  deleteBackdrop: document.querySelector("#deleteBackdrop"),
  deleteTitle: document.querySelector("#deleteTitle"),
  deleteBody: document.querySelector("#deleteBody"),
  deleteWarning: document.querySelector("#deleteWarning"),
  deleteCancel: document.querySelector("#deleteCancel"),
  deleteConfirm: document.querySelector("#deleteConfirm"),
  deleteStatus: document.querySelector("#deleteStatus"),
  loginSheet: document.querySelector("#loginSheet"),
  loginForm: document.querySelector("#loginForm"),
  loginUsername: document.querySelector("#loginUsername"),
  loginPassword: document.querySelector("#loginPassword"),
  loginRemember: document.querySelector("#loginRemember"),
  loginStatus: document.querySelector("#loginStatus"),
  logoutBtn: document.querySelector("#logoutBtn"),
  draftsSheet: document.querySelector("#draftsSheet"),
  draftsBackdrop: document.querySelector("#draftsBackdrop"),
  draftsClose: document.querySelector("#draftsClose"),
  draftsList: document.querySelector("#draftsList"),
  draftsStatus: document.querySelector("#draftsStatus"),
  trashSheet: document.querySelector("#trashSheet"),
  trashBackdrop: document.querySelector("#trashBackdrop"),
  trashClose: document.querySelector("#trashClose"),
  trashList: document.querySelector("#trashList"),
  trashStatus: document.querySelector("#trashStatus"),
  trashClearAll: document.querySelector("#trashClearAll"),
  factSheet: document.querySelector("#factSheet"),
  factBackdrop: document.querySelector("#factBackdrop"),
  factClose: document.querySelector("#factClose"),
  factForm: document.querySelector("#factForm"),
  factSheetTitle: document.querySelector("#factSheetTitle"),
  factSubject: document.querySelector("#factSubject"),
  factPredicate: document.querySelector("#factPredicate"),
  factObject: document.querySelector("#factObject"),
  factValidFrom: document.querySelector("#factValidFrom"),
  factSource: document.querySelector("#factSource"),
  saveFact: document.querySelector("#saveFact"),
  factStatus: document.querySelector("#factStatus"),
  settingsBtn: document.querySelector("#settingsBtn"),
  settingsSheet: document.querySelector("#settingsSheet"),
  settingsBackdrop: document.querySelector("#settingsBackdrop"),
  settingsClose: document.querySelector("#settingsClose"),
  settingsForm: document.querySelector("#settingsForm"),
  settingsSubtitle: document.querySelector("#settingsSubtitle"),
  settingsUsername: document.querySelector("#settingsUsername"),
  settingsPassword: document.querySelector("#settingsPassword"),
  settingsPasswordConfirm: document.querySelector("#settingsPasswordConfirm"),
  settingsCurrentRow: document.querySelector("#settingsCurrentRow"),
  settingsCurrentPassword: document.querySelector("#settingsCurrentPassword"),
  settingsMatchError: document.querySelector("#settingsMatchError"),
  saveSettings: document.querySelector("#saveSettings"),
  settingsStatus: document.querySelector("#settingsStatus"),
};

// ---------- helpers ----------
function getAuthToken() {
  try { return localStorage.getItem(AUTH_STORAGE_KEY) || ""; } catch { return ""; }
}

function setAuthToken(token) {
  try {
    if (token) localStorage.setItem(AUTH_STORAGE_KEY, token);
    else localStorage.removeItem(AUTH_STORAGE_KEY);
  } catch {}
}

const SUN_SVG = `
  <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.7"/>
  <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.55 1.55M16.85 16.85l1.55 1.55M5.6 18.4l1.55-1.55M16.85 7.15l1.55-1.55" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" fill="none"/>
`;
const MOON_SVG = `
  <path d="M20.5 14.4A8 8 0 1 1 9.6 3.5a6.8 6.8 0 0 0 10.9 10.9Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
`;

function getStoredTheme() {
  try { return localStorage.getItem(THEME_STORAGE_KEY); } catch { return null; }
}

function effectiveTheme() {
  const stored = getStoredTheme();
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme() {
  const t = effectiveTheme();
  const root = document.documentElement;
  // Only set the attribute when the user has explicitly chosen; otherwise leave
  // the page on "auto" so the @media rules drive the colors. We still mirror the
  // resolved state into the icon below.
  const stored = getStoredTheme();
  if (stored === "light" || stored === "dark") {
    root.dataset.theme = stored;
  } else {
    delete root.dataset.theme;
  }
  if (els.themeIcon) {
    // Show the *target* icon: when in light, show moon (click → dark); in dark, show sun.
    els.themeIcon.innerHTML = t === "dark" ? SUN_SVG : MOON_SVG;
  }
  if (els.themeToggle) {
    els.themeToggle.setAttribute("title", t === "dark" ? "Switch to light mode" : "Switch to dark mode");
    els.themeToggle.setAttribute("aria-label", t === "dark" ? "Switch to light mode" : "Switch to dark mode");
  }
}

function toggleTheme() {
  const current = effectiveTheme();
  const next = current === "dark" ? "light" : "dark";
  try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch {}
  applyTheme();
}

// Follow system changes when no manual override is set.
if (window.matchMedia) {
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!getStoredTheme()) applyTheme();
  });
}

function norm(value) {
  return String(value ?? "").toLowerCase();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Acronyms / brand names that should stay all-caps when humanizing slugs.
const ACRONYM_OVERRIDES = new Set([
  "ai", "api", "cli", "cpu", "css", "db", "gpu", "ha", "html", "http", "https",
  "id", "ip", "json", "kg", "mcp", "ml", "os", "pi", "pdf", "ram", "ssh", "ssl",
  "tcp", "tls", "tv", "ui", "url", "uuid", "vpn", "wifi", "yaml",
]);

function humanizeName(slug) {
  const raw = String(slug ?? "").trim();
  if (!raw) return "";
  return raw
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (ACRONYM_OVERRIDES.has(lower)) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    return true;
  } catch {
    return false;
  }
}

function debounce(fn, delay) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

// ---------- network ----------
async function fetchJson(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const token = getAuthToken();
  if (token) headers["X-Auth-Token"] = token;
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  let response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (error) {
    throw new Error(`Unable to reach MemPalace dashboard API: ${error.message}`);
  }
  if (response.status === 401) {
    openLoginSheet("Authentication required. Enter the dashboard token to continue.");
    throw new Error("Authentication required.");
  }
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`MemPalace dashboard API returned non-JSON (${response.status}): ${text.slice(0, 180)}`);
  }
  if (!response.ok || data.success === false) {
    throw new Error(data.error || "Request failed.");
  }
  return data;
}

function postJson(url, payload) {
  return fetchJson(url, { method: "POST", body: JSON.stringify(payload) });
}

// ---------- markdown ----------
function markdownLite(value) {
  const lines = escapeHtml(value).split("\n");
  const html = lines
    .map((line) => {
      if (line.startsWith("# ")) return `<h1>${line.slice(2)}</h1>`;
      if (line.startsWith("## ")) return `<h2>${line.slice(3)}</h2>`;
      if (line.startsWith("### ")) return `<h3>${line.slice(4)}</h3>`;
      if (line.startsWith("- ")) return `<p class="bullet">${line.slice(2)}</p>`;
      if (/^\d+\. /.test(line)) return `<p class="bullet">${line}</p>`;
      if (!line.trim()) return `<div class="space"></div>`;
      return `<p>${line}</p>`;
    })
    .join("");
  // [[name]] links — `name` was already escaped by the parent escapeHtml pass; do NOT re-escape
  return html.replace(/\[\[([^\]]+)\]\]/g, (_, name) => {
    const clean = String(name).trim();
    return `<a class="wiki-link" data-link="${clean}" href="#">${clean}</a>`;
  });
}

// ---------- selectors / filters ----------
function filteredDrawers() {
  const q = norm(state.query);
  let drawers = state.palace.drawers.filter((drawer) => {
    const wingMatch = state.selectedWing === "all" || drawer.wing === state.selectedWing;
    const roomMatch = state.selectedRoom === "all" || drawer.room === state.selectedRoom;
    const queryMatch =
      !q ||
      [drawer.title, drawer.content, drawer.wing, drawer.room, drawer.source_file, drawer.drawer_id]
        .map(norm)
        .some((value) => value.includes(q));
    return wingMatch && roomMatch && queryMatch;
  });
  drawers = drawers.slice();
  drawers.sort((a, b) => {
    switch (state.sortBy) {
      case "filed-asc": return (a.filed_at || "").localeCompare(b.filed_at || "");
      case "title": return (a.title || "").localeCompare(b.title || "");
      case "wing": return (a.wing || "").localeCompare(b.wing || "") || (a.room || "").localeCompare(b.room || "") || (a.title || "").localeCompare(b.title || "");
      case "filed-desc":
      default: return (b.filed_at || "").localeCompare(a.filed_at || "");
    }
  });
  return drawers;
}

function filteredFacts() {
  const q = norm(state.query);
  return state.palace.triples.filter((fact) => {
    const queryMatch =
      !q ||
      [fact.subject, fact.predicate, fact.object, fact.source_drawer_id]
        .map(norm)
        .some((value) => value.includes(q));
    const wingMatch =
      state.selectedWing === "all" ||
      state.palace.drawers.some(
        (drawer) => drawer.drawer_id === fact.source_drawer_id && drawer.wing === state.selectedWing,
      );
    return queryMatch && wingMatch;
  });
}

function allRooms() {
  return state.palace.wings.flatMap((wing) =>
    wing.rooms.map((room) => ({ wing: wing.name, room: room.name, count: room.count })),
  );
}

function drawersInWing(wingName) {
  return state.palace.drawers.filter((drawer) => drawer.wing === wingName);
}

function drawersInRoom(wingName, roomName) {
  return state.palace.drawers.filter((drawer) => drawer.wing === wingName && drawer.room === roomName);
}

function drawerById(drawerId) {
  return state.palace.drawers.find((drawer) => drawer.drawer_id === drawerId);
}

// ---------- url hash ----------
function readHash() {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return {};
  const result = {};
  hash.split("&").forEach((part) => {
    const [key, value] = part.split("=");
    if (key) result[decodeURIComponent(key)] = decodeURIComponent(value || "");
  });
  return result;
}

function writeHash() {
  if (state.applyingHash) return;
  const parts = [];
  if (state.selectedWing && state.selectedWing !== "all") parts.push(`wing=${encodeURIComponent(state.selectedWing)}`);
  if (state.selectedRoom && state.selectedRoom !== "all") parts.push(`room=${encodeURIComponent(state.selectedRoom)}`);
  if (state.selectedDrawerId) parts.push(`d=${encodeURIComponent(state.selectedDrawerId)}`);
  if (state.query) parts.push(`q=${encodeURIComponent(state.query)}`);
  if (state.sortBy && state.sortBy !== "filed-desc") parts.push(`s=${encodeURIComponent(state.sortBy)}`);
  const next = parts.length ? "#" + parts.join("&") : window.location.pathname;
  if (window.location.hash !== (next.startsWith("#") ? next : "")) {
    history.replaceState(null, "", next);
  }
}

function applyHash() {
  const hash = readHash();
  state.applyingHash = true;
  state.selectedWing = hash.wing || "all";
  state.selectedRoom = hash.room || "all";
  state.selectedDrawerId = hash.d || null;
  state.query = hash.q || "";
  state.sortBy = hash.s || "filed-desc";
  if (els.searchInput) els.searchInput.value = state.query;
  if (els.sortSelect) els.sortSelect.value = state.sortBy;
  state.applyingHash = false;
}

// ---------- palace load ----------
async function loadPalace() {
  state.palace = await fetchJson("/api/palace");
  reconcileSelection();
  await refreshDraftsCount().catch(() => {});
  render();
  loadSystemInfo().catch(() => {});
  loadTunnels().catch(() => {});
}

// ---------- tunnel cache ----------
// Tunnels are cross-wing typed links between rooms. Stored under one wing-
// name normalization in tunnel-land (e.g. "home_assistant") and under
// another in drawer-land ("home-assistant"). We normalize to the drawer
// form ("home-assistant") because that's the canonical form the rest of
// the UI uses. Tracked upstream as MemPalace/mempalace#1621.
function tunnelWingForm(name) {
  // Tunnel storage replaces "-" with "_" inside wing names. Reverse it so
  // chips and lookups all live in drawer-name space ("home-assistant").
  return (name || "").replace(/_/g, "-");
}
function tunnelRoomKey(wing, room) {
  return `${tunnelWingForm(wing)}|${room || ""}`;
}

async function loadTunnels() {
  let raw;
  try {
    raw = await fetchJson("/api/tunnels");
  } catch (err) {
    // Auth not yet established, or endpoint unavailable. The UI is fine
    // without chips; we just don't render them.
    state.tunnelsLoaded = false;
    return;
  }
  const items = (raw && (raw.tunnels || raw.items || raw.results)) || [];
  state.tunnels = items;
  state.tunnelsByRoomKey = new Map();
  state.tunnelsByWing = new Map();
  for (const t of items) {
    const s = t.source || {};
    const d = t.target || {};
    const sWing = tunnelWingForm(s.wing);
    const dWing = tunnelWingForm(d.wing);
    const sKey = tunnelRoomKey(s.wing, s.room);
    const dKey = tunnelRoomKey(d.wing, d.room);
    pushMapList(state.tunnelsByRoomKey, sKey, { side: "outgoing", other: { wing: dWing, room: d.room }, tunnel: t });
    pushMapList(state.tunnelsByRoomKey, dKey, { side: "incoming", other: { wing: sWing, room: s.room }, tunnel: t });
    pushMapList(state.tunnelsByWing, sWing, t);
    if (sWing !== dWing) pushMapList(state.tunnelsByWing, dWing, t);
  }
  state.tunnelsLoaded = true;
  // Re-render so chips appear once tunnels arrive.
  if (state.palace) render();
}

function pushMapList(map, key, value) {
  const arr = map.get(key);
  if (arr) arr.push(value);
  else map.set(key, [value]);
}

function tunnelsForRoom(wing, room) {
  return state.tunnelsByRoomKey.get(tunnelRoomKey(wing, room)) || [];
}

function tunnelsForRoomAcrossWings(room) {
  // Used in "All Memory" view where wing context is ambiguous.
  const all = [];
  for (const [key, list] of state.tunnelsByRoomKey) {
    if (key.endsWith(`|${room}`)) all.push(...list);
  }
  return all;
}

function navigateToRoom(wing, room) {
  // Try wing as-is, then with underscore→hyphen swap (drawer-form).
  if (!state.palace) return false;
  const variants = [wing, (wing || "").replace(/_/g, "-"), (wing || "").replace(/-/g, "_")];
  let resolvedWing = null;
  for (const v of variants) {
    if (state.palace.wings.some((w) => w.name === v)) { resolvedWing = v; break; }
  }
  if (!resolvedWing) return false;
  state.selectedWing = resolvedWing;
  state.selectedRoom = room || "all";
  state.selectedDrawerId = null;
  render();
  return true;
}

// Opens the Lab modal on the Tunnels tab, expands the Create section, and
// prefills the source endpoint. Used by inline "Connect this room…"
// affordances on room nav rows so users don't have to retype context. Lives
// on window so lab.js can also dispatch a refresh after a successful create
// (see the tunnels-changed event listener below).
function openTunnelCreate(wing, room) {
  const labBtn = document.querySelector("#labBtn");
  if (!labBtn) return;
  labBtn.click(); // open the lab sheet
  const tab = document.querySelector('.lab-tab[data-lab-tab="tunnels"]');
  if (tab) tab.click();
  // Expand the Create details panel inside the tunnels pane.
  const createBlock = document.querySelector('.lab-pane[data-lab-pane="tunnels"] details:nth-of-type(2)');
  if (createBlock) createBlock.open = true;
  const setVal = (id, val) => {
    const el = document.querySelector(id);
    if (el && val !== undefined && val !== null) el.value = val;
  };
  setVal("#tunCreateSourceWing", wing || "");
  setVal("#tunCreateSourceRoom", room || "");
  setVal("#tunCreateTargetWing", "");
  setVal("#tunCreateTargetRoom", "");
  setVal("#tunCreateLabel", "");
  const focusEl = document.querySelector("#tunCreateTargetWing");
  if (focusEl) {
    focusEl.focus();
    // Smooth-scroll the create block into view inside the lab body.
    requestAnimationFrame(() => {
      const block = focusEl.closest("details");
      if (block && typeof block.scrollIntoView === "function") {
        block.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }
}
// Expose so lab.js (which is its own IIFE) can re-trigger our tunnel
// loader after a create/delete.
window.loadTunnels = (...args) => loadTunnels(...args);
window.openTunnelCreate = openTunnelCreate;

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function formatUptime(seconds) {
  if (!seconds || seconds < 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${seconds}s`;
}

async function loadSystemInfo() {
  if (!els.footerInfo) return;
  const info = await fetchJson("/api/system");
  const host = info.host || {};
  const cells = [
    ["Host", `${host.name || "—"} · ${host.os || ""} ${host.release || ""}`.trim()],
    ["Python", info.python || "—"],
    ["Storage", `${formatBytes(info.db_bytes && info.db_bytes.total)} · port ${info.port}`],
    ["Uptime", formatUptime(info.uptime_seconds)],
  ];
  els.footerInfo.innerHTML = cells
    .map(
      ([label, value]) => `
      <div class="footer-cell">
        <span class="footer-cell-label">${escapeHtml(label)}</span>
        <span class="footer-cell-value">${escapeHtml(value)}</span>
      </div>
    `,
    )
    .join("");
}

function reconcileSelection() {
  if (!state.palace) return;
  if (state.selectedWing !== "all") {
    const wingExists = state.palace.wings.some((wing) => wing.name === state.selectedWing);
    if (!wingExists) {
      state.selectedWing = "all";
      state.selectedRoom = "all";
    }
  }
  if (state.selectedRoom !== "all" && state.selectedWing !== "all") {
    const wing = state.palace.wings.find((w) => w.name === state.selectedWing);
    const roomExists = wing && wing.rooms.some((r) => r.name === state.selectedRoom);
    if (!roomExists) state.selectedRoom = "all";
  }
  if (state.selectedDrawerId) {
    const exists = state.palace.drawers.some((d) => d.drawer_id === state.selectedDrawerId);
    if (!exists) state.selectedDrawerId = null;
  }
}

async function refreshDraftsCount() {
  try {
    const data = await fetchJson("/api/drafts");
    state.draftsCount = (data.drafts || []).length;
  } catch {
    state.draftsCount = 0;
  }
  updateDraftsBadge();
}

function updateDraftsBadge() {
  if (!els.draftsBadge) return;
  if (state.draftsCount > 0) {
    els.draftsBadge.textContent = state.draftsCount;
    els.draftsBadge.classList.remove("hidden");
  } else {
    els.draftsBadge.classList.add("hidden");
  }
}

// ---------- renders ----------
function renderStats() {
  const stats = state.palace.stats;
  const items = [
    ["Memories", stats.drawers],
    ["Wings", stats.wings],
    ["Rooms", stats.rooms],
    ["Facts", stats.facts],
  ];
  els.stats.innerHTML = items
    .map(
      ([label, value]) => `
      <div class="stat">
        <div class="stat-label">${escapeHtml(label)}</div>
        <div class="stat-value">${value}</div>
      </div>
    `,
    )
    .join("");
}

function dotMenu(menuId, label, items) {
  return `<div class="menu-wrap">
      <button class="menu-button compact" type="button" data-menu="${escapeHtml(menuId)}" aria-label="${escapeHtml(label)}" aria-haspopup="menu" aria-expanded="false">
        <svg class="menu-dots" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3" cy="8" r="1.4"></circle>
          <circle cx="8" cy="8" r="1.4"></circle>
          <circle cx="13" cy="8" r="1.4"></circle>
        </svg>
      </button>
      <div class="action-menu hidden" role="menu" data-menu-panel="${escapeHtml(menuId)}">
        ${items.join("")}
      </div>
    </div>`;
}

function editMenuItem(drawerId) {
  return `<button class="action-item edit-menu" role="menuitem" type="button" data-edit-drawer-id="${escapeHtml(drawerId)}">
      <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.06 4.94a2.25 2.25 0 0 1 3.18 0l1.82 1.82a2.25 2.25 0 0 1 0 3.18L9.5 19.5l-4.5 1 1-4.5 8.06-11.06Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="m13 6 5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
      <span>Edit</span>
    </button>`;
}

function deleteMenuItem({ scope, drawerId, wing, room }) {
  const attrs = [`data-delete-scope="${escapeHtml(scope)}"`];
  if (drawerId) attrs.push(`data-drawer-id="${escapeHtml(drawerId)}"`);
  if (wing) attrs.push(`data-wing="${escapeHtml(wing)}"`);
  if (room) attrs.push(`data-room="${escapeHtml(room)}"`);
  return `<button class="action-item danger-menu" role="menuitem" type="button" ${attrs.join(" ")}>
      <svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 7h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
        <path d="M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
        <path d="M7 7h10l-.9 11.2A1.8 1.8 0 0 1 14.3 20H9.7a1.8 1.8 0 0 1-1.8-1.8L7 7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
        <path d="M10.5 10.5v6M13.5 10.5v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
      <span>Delete</span>
    </button>`;
}

function editToggleButton({ id, label, active }) {
  return `<button class="edit-toggle ${active ? "active" : ""}" id="${escapeHtml(id)}" type="button" aria-pressed="${active ? "true" : "false"}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.06 4.94a2.25 2.25 0 0 1 3.18 0l1.82 1.82a2.25 2.25 0 0 1 0 3.18L9.5 19.5l-4.5 1 1-4.5 8.06-11.06Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="m13 6 5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
    </button>`;
}

function renameIconButton({ scope, wing, room }) {
  const attrs = [`data-rename-scope="${escapeHtml(scope)}"`];
  if (wing) attrs.push(`data-wing="${escapeHtml(wing)}"`);
  if (room) attrs.push(`data-room="${escapeHtml(room)}"`);
  return `<button class="row-action" type="button" aria-label="Rename" title="Rename" ${attrs.join(" ")}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M14.06 4.94a2.25 2.25 0 0 1 3.18 0l1.82 1.82a2.25 2.25 0 0 1 0 3.18L9.5 19.5l-4.5 1 1-4.5 8.06-11.06Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
      </svg>
    </button>`;
}

function deleteIconButton({ scope, wing, room }) {
  const attrs = [`data-delete-scope="${escapeHtml(scope)}"`];
  if (wing) attrs.push(`data-wing="${escapeHtml(wing)}"`);
  if (room) attrs.push(`data-room="${escapeHtml(room)}"`);
  return `<button class="row-action danger" type="button" aria-label="Delete" title="Delete" ${attrs.join(" ")}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 7h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
        <path d="M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
        <path d="M7 7h10l-.9 11.2A1.8 1.8 0 0 1 14.3 20H9.7a1.8 1.8 0 0 1-1.8-1.8L7 7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
      </svg>
    </button>`;
}

function renameRow({ scope, currentName, label }) {
  return `<form class="rename-row" data-rename-form data-rename-scope="${escapeHtml(scope)}" data-current="${escapeHtml(currentName)}">
      <input class="rename-input" type="text" autocomplete="off" spellcheck="false" value="${escapeHtml(currentName)}" aria-label="${escapeHtml(label)}" required />
      <button class="row-action accent" type="submit" aria-label="Save">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5 9-11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="row-action" type="button" data-rename-cancel aria-label="Cancel">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
    </form>`;
}

function renderNav() {
  const buttons = [{ name: "all", count: state.palace.stats.drawers }, ...state.palace.wings];
  const editing = state.editingWings;
  const editableCount = state.palace.wings.length;
  const toggle = editableCount
    ? `<div class="nav-toolbar">
        <span class="nav-toolbar-label">${editing ? "Editing wings" : "Wings"}</span>
        ${editToggleButton({ id: "wingEditToggle", label: editing ? "Done" : "Edit wings", active: editing })}
      </div>`
    : "";
  els.wingNav.classList.toggle("editing", editing);
  els.wingNav.innerHTML = toggle + buttons
    .map((wing) => {
      const active = state.selectedWing === wing.name ? "active" : "";
      const label = wing.name === "all" ? "All Memory" : humanizeName(wing.name);
      const isRenaming =
        state.renaming &&
        state.renaming.scope === "wing" &&
        state.renaming.wing === wing.name;
      if (isRenaming) {
        return `<div class="nav-row ${active} renaming" data-wing-row="${escapeHtml(wing.name)}">
          ${renameRow({ scope: "wing", currentName: wing.name, label: `Rename wing ${wing.name}` })}
        </div>`;
      }
      const actions = editing && wing.name !== "all"
        ? `<div class="row-actions">
            ${renameIconButton({ scope: "wing", wing: wing.name })}
            ${deleteIconButton({ scope: "wing", wing: wing.name })}
          </div>`
        : "";
      const wingTunnels = (!editing && wing.name !== "all")
        ? (state.tunnelsByWing.get(wing.name) || []).length
        : 0;
      const wingChip = wingTunnels > 0
        ? `<span class="wing-tunnel-chip" title="${wingTunnels} cross-wing tunnel${wingTunnels === 1 ? "" : "s"}" aria-label="${wingTunnels} tunnels">${wingTunnels}</span>`
        : "";
      return `<div class="nav-row ${active}" data-wing-row="${escapeHtml(wing.name)}">
        <button class="nav-item" type="button" data-wing="${escapeHtml(wing.name)}" ${editing && wing.name !== "all" ? "disabled" : ""}>
          <span>${escapeHtml(label)}</span>
          <span class="nav-item-meta">${wingChip}<strong>${wing.count}</strong></span>
        </button>
        ${actions}
      </div>`;
    })
    .join("");
  const toggleBtn = document.querySelector("#wingEditToggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      state.editingWings = !state.editingWings;
      state.renaming = null;
      render();
    });
  }
  els.wingNav.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      state.selectedWing = button.dataset.wing;
      state.selectedRoom = "all";
      state.selectedDrawerId = null;
      render();
    });
  });
}

function renderRooms(drawers) {
  const roomCounts = drawers.reduce((counts, drawer) => {
    counts.set(drawer.room, (counts.get(drawer.room) || 0) + 1);
    return counts;
  }, new Map());
  const rooms = [...roomCounts.entries()].sort(([a], [b]) => a.localeCompare(b));
  const allActive = state.selectedRoom === "all" ? "active" : "";
  if (els.roomCount) {
    els.roomCount.textContent = `${rooms.length} ${rooms.length === 1 ? "room" : "rooms"}`;
  }
  const canEdit = state.selectedWing !== "all" && rooms.length > 0;
  if (!canEdit && state.editingRooms) state.editingRooms = false;
  const editing = state.editingRooms;
  const showConnect = !editing && state.selectedWing !== "all" && state.selectedRoom !== "all";
  const connectBtn = showConnect
    ? `<button class="nav-toolbar-action" id="connectRoomBtn" type="button"
        title="Connect ${escapeHtml(state.selectedRoom)} to another room">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 17c4.5 0 5.5-10 10-10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          <path d="M14 7h3v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        Connect this room…
      </button>`
    : "";
  const toggle = canEdit
    ? `<div class="nav-toolbar room-toolbar">
        <span class="nav-toolbar-label">${editing ? "Editing rooms" : ""}</span>
        ${connectBtn}
        ${editToggleButton({ id: "roomEditToggle", label: editing ? "Done" : "Edit rooms", active: editing })}
      </div>`
    : (showConnect ? `<div class="nav-toolbar room-toolbar">${connectBtn}</div>` : "");
  els.roomNav.classList.toggle("editing", editing);
  els.roomNav.innerHTML =
    toggle +
    [
      `<button class="room-item ${allActive}" type="button" data-room="all" ${editing ? "disabled" : ""}>
        <span>All rooms</span>
        <strong>${drawers.length}</strong>
      </button>`,
      ...rooms.map(([room, count]) => {
        const active = state.selectedRoom === room ? "active" : "";
        const isRenaming =
          state.renaming &&
          state.renaming.scope === "room" &&
          state.renaming.wing === state.selectedWing &&
          state.renaming.room === room;
        if (isRenaming) {
          return `<div class="room-row ${active} renaming">
            ${renameRow({ scope: "room", currentName: room, label: `Rename room ${room}` })}
          </div>`;
        }
        const actions = editing
          ? `<div class="row-actions">
              ${renameIconButton({ scope: "room", wing: state.selectedWing, room })}
              ${deleteIconButton({ scope: "room", wing: state.selectedWing, room })}
            </div>`
          : "";
        // Tunnel decoration. In "all wings" view we sum across wings;
        // otherwise we scope to the current wing.
        const tunnelEntries = state.selectedWing === "all"
          ? tunnelsForRoomAcrossWings(room)
          : tunnelsForRoom(state.selectedWing, room);
        const tunnelKey = `${state.selectedWing} ${room}`;
        const expanded = state.expandedTunnelRooms.has(tunnelKey);
        const chip = (!editing && tunnelEntries.length > 0)
          ? `<button class="room-tunnel-chip ${expanded ? "open" : ""}" type="button"
              data-tunnel-toggle="${escapeHtml(tunnelKey)}"
              aria-expanded="${expanded ? "true" : "false"}"
              aria-label="${tunnelEntries.length} connected ${tunnelEntries.length === 1 ? "room" : "rooms"}"
              title="${tunnelEntries.length} connected ${tunnelEntries.length === 1 ? "room" : "rooms"}">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M7 17c4.5 0 5.5-10 10-10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
                <path d="M14 7h3v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>${tunnelEntries.length}</span>
            </button>`
          : "";
        const expansion = (expanded && tunnelEntries.length > 0)
          ? `<div class="room-tunnel-list">
              ${tunnelEntries.map((entry) => {
                const dir = entry.side === "outgoing" ? "→" : "←";
                const other = entry.other;
                const label = entry.tunnel.label
                  ? `<span class="room-tunnel-link-label" title="${escapeHtml(entry.tunnel.label)}">${escapeHtml(entry.tunnel.label)}</span>`
                  : "";
                return `<button class="room-tunnel-link" type="button"
                    data-jump-wing="${escapeHtml(other.wing)}"
                    data-jump-room="${escapeHtml(other.room)}"
                    title="Open ${escapeHtml(other.wing)}/${escapeHtml(other.room)}">
                    <span class="room-tunnel-link-arrow">${dir}</span>
                    <span class="room-tunnel-link-name">${escapeHtml(other.wing)} / <strong>${escapeHtml(other.room)}</strong></span>
                    ${label}
                  </button>`;
              }).join("")}
              ${(state.selectedWing !== "all") ? `
                <button class="room-tunnel-add" type="button"
                  data-tunnel-create-wing="${escapeHtml(state.selectedWing)}"
                  data-tunnel-create-room="${escapeHtml(room)}"
                  title="Add another connection from ${escapeHtml(room)}">
                  + Connect to another room
                </button>` : ""}
            </div>`
          : "";
        return `<div class="room-row ${active} ${expanded ? "tunnel-open" : ""}">
          <button class="room-item" type="button" data-room="${escapeHtml(room)}" ${editing ? "disabled" : ""}>
            <span>${escapeHtml(humanizeName(room))}</span>
            <strong>${count}</strong>
          </button>
          ${chip}
          ${actions}
          ${expansion}
        </div>`;
      }),
    ].join("");
  const roomToggleBtn = document.querySelector("#roomEditToggle");
  if (roomToggleBtn) {
    roomToggleBtn.addEventListener("click", () => {
      state.editingRooms = !state.editingRooms;
      state.renaming = null;
      render();
    });
  }
  els.roomNav.querySelectorAll(".room-item").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      state.selectedRoom = button.dataset.room;
      state.selectedDrawerId = null;
      render();
    });
  });
  els.roomNav.querySelectorAll("[data-tunnel-toggle]").forEach((button) => {
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = button.dataset.tunnelToggle;
      if (state.expandedTunnelRooms.has(key)) state.expandedTunnelRooms.delete(key);
      else state.expandedTunnelRooms.add(key);
      render();
    });
  });
  els.roomNav.querySelectorAll(".room-tunnel-link").forEach((button) => {
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      navigateToRoom(button.dataset.jumpWing, button.dataset.jumpRoom);
    });
  });
  els.roomNav.querySelectorAll(".room-tunnel-add").forEach((button) => {
    button.addEventListener("click", (e) => {
      e.stopPropagation();
      openTunnelCreate(button.dataset.tunnelCreateWing, button.dataset.tunnelCreateRoom);
    });
  });
  const connectHeaderBtn = document.querySelector("#connectRoomBtn");
  if (connectHeaderBtn) {
    connectHeaderBtn.addEventListener("click", () => {
      openTunnelCreate(state.selectedWing, state.selectedRoom);
    });
  }
}

function formatDate(iso) {
  if (!iso) return "";
  const trimmed = iso.length >= 10 ? iso.slice(0, 10) : iso;
  return trimmed;
}

function renderDrawers() {
  const allForWing = state.palace.drawers.filter(
    (drawer) => state.selectedWing === "all" || drawer.wing === state.selectedWing,
  );
  renderRooms(allForWing);

  const drawers = filteredDrawers();
  els.drawerCount.textContent = `${drawers.length} visible`;

  if (!state.palace.drawers.length) {
    els.drawerList.innerHTML = `<div class="empty-list"><strong>No memories yet.</strong><br/>Click <em>Write</em> to add the first one.</div>`;
    return;
  }
  if (!drawers.length) {
    els.drawerList.innerHTML = `<div class="empty-list">No memories match your current filters.</div>`;
    return;
  }

  els.drawerList.innerHTML = drawers
    .map((drawer) => {
      const active = drawer.drawer_id === state.selectedDrawerId ? "active" : "";
      const date = formatDate(drawer.filed_at);
      const menu = dotMenu(`drawer-${drawer.drawer_id}`, `Actions for ${drawer.title}`, [
        editMenuItem(drawer.drawer_id),
        deleteMenuItem({ scope: "drawer", drawerId: drawer.drawer_id }),
      ]);
      return `<div class="drawer-card ${active}" data-id="${escapeHtml(drawer.drawer_id)}">
        <button class="drawer-select" type="button" data-id="${escapeHtml(drawer.drawer_id)}">
          <span class="drawer-kicker">
            <span>${escapeHtml(humanizeName(drawer.wing))} / ${escapeHtml(humanizeName(drawer.room))}</span>
            ${date ? `<span class="drawer-date">${escapeHtml(date)}</span>` : ""}
          </span>
          <strong>${escapeHtml(drawer.title)}</strong>
          <span>${escapeHtml((drawer.content || "").replace(/\s+/g, " ").slice(0, 150))}</span>
        </button>
        ${menu}
      </div>`;
    })
    .join("");

  els.drawerList.querySelectorAll(".drawer-select").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedDrawerId = button.dataset.id;
      renderDetail();
      renderDrawers();
      writeHash();
    });
  });
}

function renderDetail() {
  const drawer = state.palace.drawers.find((item) => item.drawer_id === state.selectedDrawerId);
  if (!drawer) {
    els.emptyState.classList.remove("hidden");
    els.detail.classList.add("hidden");
    els.detail.innerHTML = "";
    return;
  }
  els.emptyState.classList.add("hidden");
  els.detail.classList.remove("hidden");
  const metadata = [
    ["Drawer", drawer.drawer_id],
    ["Wing", humanizeName(drawer.wing)],
    ["Room", humanizeName(drawer.room)],
    ["Source", drawer.source_file],
    ["Filed", drawer.filed_at],
    ["Added by", drawer.added_by],
  ].filter(([, value]) => value);

  els.detail.innerHTML = `
    <div class="detail-meta">
      ${metadata
        .map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
        .join("")}
      <div class="detail-meta-actions">
        <button class="icon-button" type="button" data-copy-id="${escapeHtml(drawer.drawer_id)}">Copy ID</button>
      </div>
    </div>
    <div class="markdown">${markdownLite(drawer.content)}</div>
  `;

  els.detail.querySelectorAll("[data-copy-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ok = await copyToClipboard(btn.dataset.copyId);
      btn.textContent = ok ? "Copied!" : "Copy failed";
      setTimeout(() => { btn.textContent = "Copy ID"; }, 1500);
    });
  });

  els.detail.querySelectorAll("a.wiki-link").forEach((a) => {
    a.addEventListener("click", (event) => {
      event.preventDefault();
      const target = a.dataset.link;
      const match = state.palace.drawers.find((d) =>
        norm(d.title) === norm(target) || norm(d.drawer_id) === norm(target),
      );
      if (match) {
        state.selectedWing = match.wing;
        state.selectedRoom = match.room;
        state.selectedDrawerId = match.drawer_id;
        state.query = "";
        els.searchInput.value = "";
        render();
      } else {
        state.query = target;
        els.searchInput.value = target;
        render();
      }
    });
  });
}

function renderFacts() {
  const facts = filteredFacts();
  els.factCount.textContent = `${facts.length} visible`;
  if (els.factsViewList && els.factsViewGraph) {
    const isGraph = state.factsView === "graph";
    els.factsViewList.classList.toggle("active", !isGraph);
    els.factsViewGraph.classList.toggle("active", isGraph);
    els.factsViewList.setAttribute("aria-selected", String(!isGraph));
    els.factsViewGraph.setAttribute("aria-selected", String(isGraph));
    els.facts.classList.toggle("hidden", isGraph);
    if (els.factsGraph) els.factsGraph.classList.toggle("hidden", !isGraph);
  }
  if (state.factsView === "graph") {
    renderFactsGraph(facts);
    return;
  }
  if (!facts.length) {
    els.facts.innerHTML = `<div class="empty-list">No facts match the current filters.</div>`;
    return;
  }
  els.facts.innerHTML = facts
    .map((fact) => {
      const expired = fact.valid_to ? "expired" : "";
      return `<div class="fact ${expired}" data-fact-id="${escapeHtml(String(fact.id))}">
        <span>${escapeHtml(fact.subject)}</span>
        <strong>${escapeHtml(fact.predicate)}</strong>
        <span>${escapeHtml(fact.object)}</span>
        <em>${escapeHtml(fact.valid_from || "undated")}${fact.valid_to ? " → " + escapeHtml(fact.valid_to) : ""}</em>
        <div class="fact-actions">
          ${fact.valid_to ? "" : `<button class="icon-button" type="button" data-invalidate-fact='${escapeHtml(JSON.stringify({ subject: fact.subject, predicate: fact.predicate, object: fact.object }))}' title="Mark as no longer true">End</button>`}
        </div>
      </div>`;
    })
    .join("");
  els.facts.querySelectorAll("[data-invalidate-fact]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const payload = JSON.parse(btn.dataset.invalidateFact);
      btn.disabled = true;
      try {
        await postJson("/api/facts/invalidate", payload);
        await loadPalace();
      } catch (error) {
        alert(`Could not invalidate fact: ${error.message}`);
        btn.disabled = false;
      }
    });
  });
}

// ---------- knowledge graph viz ----------
function shortenGraphLabel(value, max = 22) {
  const s = String(value ?? "");
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

const SVG_NS = "http://www.w3.org/2000/svg";

// Cluster palette — muted, distinct, dark-mode friendly. Cycled if needed.
const KG_CLUSTER_COLORS = [
  "#5fa9d0", // soft blue
  "#e6916a", // warm peach
  "#7dd394", // mint
  "#b89df1", // lavender
  "#f4cc6c", // pale gold
  "#ee87a8", // soft pink
  "#7bd0d5", // pale teal
  "#c98ac9", // mauve
];

const kg = {
  // lifecycle
  mounted: false,
  container: null,
  svg: null,
  edgesG: null,
  nodesG: null,
  hint: null,
  legend: null,
  legendText: null,
  resetBtn: null,

  // data
  nodes: [],
  edges: [],
  byId: new Map(),
  signature: "",
  zoomedIn: false,

  // view (overwritten in kgRecomputeBase based on actual SVG aspect)
  baseW: 2200,
  baseH: 1100,
  view: { x: 0, y: 0, w: 2200, h: 1100 },

  // simulation
  alpha: 0,
  alphaDecay: 0.0228,
  alphaMin: 0.0015,
  raf: null,

  // interaction
  focus: null,
  hover: null,
  drag: null,   // { node, dx, dy, moved }
  pan: null,    // { sx, sy, viewX, viewY }
};

function kgBuildGraph(facts) {
  const active = facts.filter((f) => !f.valid_to);
  const byId = new Map();
  const addNode = (id) => {
    let n = byId.get(id);
    if (!n) {
      n = { id, label: shortenGraphLabel(id), full: id, degree: 0, x: 0, y: 0, vx: 0, vy: 0 };
      byId.set(id, n);
    }
    return n;
  };
  const edges = active.map((fact) => {
    const source = addNode(fact.subject);
    const target = addNode(fact.object);
    source.degree += 1;
    target.degree += 1;
    return {
      source,
      target,
      label: shortenGraphLabel(fact.predicate, 18),
      full: fact.predicate,
    };
  });
  const nodes = [...byId.values()];

  // Hubs = top nodes by degree; they're the labelled landmarks.
  const sortedByDegree = [...nodes].sort((a, b) => b.degree - a.degree);
  const hubCount = Math.min(6, Math.max(1, Math.round(nodes.length * 0.18)));
  const hubs = [];
  sortedByDegree.forEach((n, i) => {
    n.isHub = i < hubCount;
    if (n.isHub) hubs.push(n);
  });

  // Multi-source BFS — each node inherits the cluster of the closest hub.
  const adj = new Map();
  nodes.forEach((n) => adj.set(n.id, []));
  edges.forEach((e) => {
    adj.get(e.source.id).push(e.target.id);
    adj.get(e.target.id).push(e.source.id);
  });
  const cluster = new Map();
  const queue = [];
  hubs.forEach((hub, idx) => {
    hub.cluster = idx;
    cluster.set(hub.id, idx);
    queue.push(hub.id);
  });
  while (queue.length) {
    const id = queue.shift();
    const c = cluster.get(id);
    for (const nbr of adj.get(id) || []) {
      if (!cluster.has(nbr)) {
        cluster.set(nbr, c);
        queue.push(nbr);
      }
    }
  }
  nodes.forEach((n) => {
    n.cluster = cluster.has(n.id) ? cluster.get(n.id) : 0;
    n.color = KG_CLUSTER_COLORS[n.cluster % KG_CLUSTER_COLORS.length];
  });
  edges.forEach((e) => {
    e.intra = e.source.cluster === e.target.cluster;
    e.color = e.intra
      ? KG_CLUSTER_COLORS[e.source.cluster % KG_CLUSTER_COLORS.length]
      : null;
  });

  // Seed positions: jittered ring around viewBox center for organic entry.
  const cx = kg.baseW / 2;
  const cy = kg.baseH / 2;
  const radius = Math.max(260, Math.min(640, 160 + nodes.length * 14));
  nodes.forEach((n, i) => {
    const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2 + Math.random() * 0.4;
    const r = radius * (0.5 + Math.random() * 0.5);
    n.x = cx + Math.cos(angle) * r;
    n.y = cy + Math.sin(angle) * r;
    n.vx = 0;
    n.vy = 0;
    n.radius = Math.min(48, 22 + Math.sqrt(n.degree) * 7);
  });
  return { nodes, edges, byId };
}

function kgSignature(facts) {
  return facts.filter((f) => !f.valid_to).map((f) => `${f.subject}|${f.predicate}|${f.object}`).sort().join("\n");
}

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    el.setAttribute(k, v);
  }
  return el;
}

function kgRecomputeBase() {
  if (!kg.svg) return false;
  const rect = kg.svg.getBoundingClientRect();
  if (rect.width < 50 || rect.height < 50) return false;
  const aspect = rect.width / rect.height;
  // Keep the layout "area" stable so node density is consistent across screen sizes.
  const area = 2_600_000;
  const baseH = Math.sqrt(area / aspect);
  const baseW = baseH * aspect;
  const w = Math.round(baseW);
  const h = Math.round(baseH);
  if (w === kg.baseW && h === kg.baseH) return false;
  // Scale existing positions so nodes don't get clipped after resize.
  if (kg.nodes && kg.nodes.length && kg.baseW && kg.baseH) {
    const sx = w / kg.baseW;
    const sy = h / kg.baseH;
    kg.nodes.forEach((n) => {
      n.x *= sx;
      n.y *= sy;
    });
  }
  kg.baseW = w;
  kg.baseH = h;
  kg.view = { x: 0, y: 0, w, h };
  kgApplyView();
  return true;
}

function kgEnsureMount(container) {
  if (kg.mounted && kg.container === container) return;
  // (Re)create scaffold
  container.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "kg-graph-wrap";

  const stage = document.createElement("div");
  stage.className = "kg-stage";
  const svg = svgEl("svg", {
    class: "kg-svg",
    viewBox: `${kg.view.x} ${kg.view.y} ${kg.view.w} ${kg.view.h}`,
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
    "aria-label": "Knowledge graph",
  });

  // defs: radial gradient for nodes + soft glow
  const defs = svgEl("defs");
  const grad = svgEl("radialGradient", { id: "kgNodeGrad", cx: "30%", cy: "30%", r: "70%" });
  const s1 = svgEl("stop", { offset: "0%", "stop-color": "rgba(255,255,255,0.16)" });
  const s2 = svgEl("stop", { offset: "100%", "stop-color": "rgba(255,255,255,0)" });
  grad.append(s1, s2);
  const focusGrad = svgEl("radialGradient", { id: "kgFocusGrad", cx: "30%", cy: "30%", r: "75%" });
  const f1 = svgEl("stop", { offset: "0%", "stop-color": "rgba(255,255,255,0.34)" });
  const f2 = svgEl("stop", { offset: "100%", "stop-color": "rgba(255,255,255,0)" });
  focusGrad.append(f1, f2);
  const glow = svgEl("filter", { id: "kgGlow", x: "-50%", y: "-50%", width: "200%", height: "200%" });
  const blur = svgEl("feGaussianBlur", { in: "SourceGraphic", stdDeviation: "8" });
  glow.append(blur);
  defs.append(grad, focusGrad, glow);
  svg.appendChild(defs);

  const edgesG = svgEl("g", { class: "kg-edges" });
  const nodesG = svgEl("g", { class: "kg-nodes" });
  svg.append(edgesG, nodesG);
  stage.appendChild(svg);
  wrap.appendChild(stage);

  const hint = document.createElement("div");
  hint.className = "kg-hint";
  hint.textContent = "Click a node to focus · drag to reposition · scroll to zoom · double-click to reset";
  wrap.appendChild(hint);

  const legend = document.createElement("div");
  legend.className = "kg-legend";
  const legendText = document.createElement("span");
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "kg-reset hidden";
  resetBtn.textContent = "Reset view";
  legend.append(legendText, resetBtn);
  wrap.appendChild(legend);

  container.appendChild(wrap);

  kg.container = container;
  kg.svg = svg;
  kg.edgesG = edgesG;
  kg.nodesG = nodesG;
  kg.hint = hint;
  kg.legend = legend;
  kg.legendText = legendText;
  kg.resetBtn = resetBtn;

  // ----- events -----
  svg.addEventListener("pointerdown", kgOnPointerDown);
  svg.addEventListener("pointermove", kgOnPointerMove);
  svg.addEventListener("pointerup", kgOnPointerUp);
  svg.addEventListener("pointercancel", kgOnPointerUp);
  svg.addEventListener("wheel", kgOnWheel, { passive: false });
  svg.addEventListener("dblclick", (event) => {
    if (event.target.closest(".kg-node")) return;
    event.preventDefault();
    kg.view = { x: 0, y: 0, w: kg.baseW, h: kg.baseH };
    kg.focus = null;
    kgApplyView();
    kgUpdateClasses();
    kgKick(0.6);
  });

  resetBtn.addEventListener("click", () => {
    kg.view = { x: 0, y: 0, w: kg.baseW, h: kg.baseH };
    kg.focus = null;
    kgApplyView();
    kgUpdateClasses();
    kgUpdateLegend();
    kgKick(0.5);
  });

  kg.mounted = true;

  // Adapt the viewBox to the actual SVG aspect ratio, then again on resize.
  requestAnimationFrame(() => kgRecomputeBase());
  if (typeof ResizeObserver !== "undefined") {
    if (kg._ro) kg._ro.disconnect();
    kg._ro = new ResizeObserver(() => {
      if (kgRecomputeBase()) kgKick(0.4);
    });
    kg._ro.observe(svg);
  }
}

function kgBuildDom() {
  // Build edge and node DOM, cache refs on objects.
  kg.edgesG.innerHTML = "";
  kg.nodesG.innerHTML = "";

  kg.edges.forEach((e) => {
    const lineClass = "kg-edge " + (e.intra ? "intra" : "bridge");
    const lineAttrs = { class: lineClass, "stroke-linecap": "round" };
    if (e.intra && e.color) lineAttrs.style = `--kg-color: ${e.color};`;
    const line = svgEl("line", lineAttrs);
    const label = svgEl("text", {
      class: "kg-edge-label",
      "text-anchor": "middle",
    });
    label.textContent = e.label;
    const titleEl = svgEl("title");
    titleEl.textContent = e.full;
    label.appendChild(titleEl);
    kg.edgesG.append(line, label);
    e._line = line;
    e._label = label;
  });

  kg.nodes.forEach((n) => {
    const g = svgEl("g", { class: "kg-node", style: `--kg-color: ${n.color};` });
    g.dataset.id = n.id;
    const ring = svgEl("circle", { class: "kg-node-ring", r: (n.radius + 6).toFixed(1) });
    const halo = svgEl("circle", { class: "kg-node-halo", r: (n.radius + 14).toFixed(1) });
    const circle = svgEl("circle", { class: "kg-node-fill", r: n.radius.toFixed(1) });
    const overlay = svgEl("circle", { class: "kg-node-overlay", r: n.radius.toFixed(1), fill: "url(#kgNodeGrad)" });
    const label = svgEl("text", {
      class: "kg-node-label",
      "text-anchor": "middle",
      dy: (n.radius + 26).toFixed(1),
    });
    label.textContent = n.label;
    const title = svgEl("title");
    title.textContent = n.full;
    g.append(title, halo, ring, circle, overlay, label);

    g.addEventListener("pointerenter", () => {
      kg.hover = n.id;
      kgUpdateClasses();
    });
    g.addEventListener("pointerleave", () => {
      if (kg.hover === n.id) {
        kg.hover = null;
        kgUpdateClasses();
      }
    });

    kg.nodesG.appendChild(g);
    n._g = g;
    n._ring = ring;
    n._halo = halo;
    n._fill = circle;
    n._label = label;
  });
}

function kgUpdateLegend() {
  if (!kg.legendText) return;
  const n = kg.nodes.length;
  const e = kg.edges.length;
  kg.legendText.textContent = `${n} node${n === 1 ? "" : "s"} · ${e} edge${e === 1 ? "" : "s"}`;
  const customView = kg.view.x !== 0 || kg.view.y !== 0 || kg.view.w !== kg.baseW || kg.view.h !== kg.baseH;
  kg.resetBtn.classList.toggle("hidden", !customView && !kg.focus);
}

function kgUpdateClasses() {
  const focus = kg.focus;
  const hover = kg.hover;
  const highlightId = focus || hover;
  const connected = new Set();
  if (highlightId) {
    connected.add(highlightId);
    kg.edges.forEach((e) => {
      if (e.source.id === highlightId) connected.add(e.target.id);
      if (e.target.id === highlightId) connected.add(e.source.id);
    });
  }
  kg.nodes.forEach((n) => {
    n._g.classList.toggle("focus", focus === n.id);
    n._g.classList.toggle("hover", hover === n.id);
    n._g.classList.toggle("connected", !!highlightId && connected.has(n.id) && highlightId !== n.id);
    n._g.classList.toggle("dim", !!highlightId && !connected.has(n.id));
    n._g.classList.toggle("hub", !!n.isHub);
  });
  kg.edges.forEach((e) => {
    const touches = highlightId && (e.source.id === highlightId || e.target.id === highlightId);
    e._line.classList.toggle("highlight", !!touches);
    e._line.classList.toggle("dim", !!highlightId && !touches);
    e._label.classList.toggle("highlight", !!touches);
    e._label.classList.toggle("dim", !!highlightId && !touches);
  });
  kgUpdateLegend();
}

function kgApplyView() {
  if (!kg.svg) return;
  kg.svg.setAttribute("viewBox", `${kg.view.x.toFixed(1)} ${kg.view.y.toFixed(1)} ${kg.view.w.toFixed(1)} ${kg.view.h.toFixed(1)}`);
  // Reveal every label once the user is zoomed in past ~33% of the base view.
  const zoomedIn = kg.view.w < kg.baseW * 0.66;
  if (zoomedIn !== kg.zoomedIn) {
    kg.zoomedIn = zoomedIn;
    kg.svg.classList.toggle("kg-zoomed", zoomedIn);
  }
}

function kgRenderFrame() {
  kg.nodes.forEach((n) => {
    n._g.setAttribute("transform", `translate(${n.x.toFixed(2)},${n.y.toFixed(2)})`);
  });
  kg.edges.forEach((e) => {
    e._line.setAttribute("x1", e.source.x.toFixed(2));
    e._line.setAttribute("y1", e.source.y.toFixed(2));
    e._line.setAttribute("x2", e.target.x.toFixed(2));
    e._line.setAttribute("y2", e.target.y.toFixed(2));
    e._label.setAttribute("x", ((e.source.x + e.target.x) / 2).toFixed(2));
    e._label.setAttribute("y", ((e.source.y + e.target.y) / 2 - 4).toFixed(2));
  });
}

function kgStep() {
  const nodes = kg.nodes;
  const edges = kg.edges;
  const cx = kg.baseW / 2;
  const cy = kg.baseH / 2;
  const idealLength = 320;
  const repulsion = 22000;
  const gravity = 0.0045;
  const damping = 0.72;

  // Repulsion (O(n²) — fine for our sizes).
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) {
        dx = (Math.random() - 0.5) * 4;
        dy = (Math.random() - 0.5) * 4;
        d2 = dx * dx + dy * dy + 1;
      }
      const d = Math.sqrt(d2);
      const f = (repulsion / d2) * kg.alpha;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }

  // Springs.
  for (const e of edges) {
    const dx = e.target.x - e.source.x;
    const dy = e.target.y - e.source.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const displacement = d - idealLength;
    const f = displacement * 0.08 * kg.alpha;
    const fx = (dx / d) * f;
    const fy = (dy / d) * f;
    e.source.vx += fx;
    e.source.vy += fy;
    e.target.vx -= fx;
    e.target.vy -= fy;
  }

  // Gravity toward center.
  for (const n of nodes) {
    n.vx += (cx - n.x) * gravity * kg.alpha;
    n.vy += (cy - n.y) * gravity * kg.alpha;
  }

  // Integrate.
  for (const n of nodes) {
    if (n.fixed) {
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    n.vx *= damping;
    n.vy *= damping;
    n.x += n.vx;
    n.y += n.vy;
    // Keep within roomy bounds so the view doesn't drift off.
    const m = 60;
    if (n.x < m) { n.x = m; n.vx *= -0.3; }
    if (n.x > kg.baseW - m) { n.x = kg.baseW - m; n.vx *= -0.3; }
    if (n.y < m) { n.y = m; n.vy *= -0.3; }
    if (n.y > kg.baseH - m) { n.y = kg.baseH - m; n.vy *= -0.3; }
  }
}

function kgTick() {
  // Run a couple of physics sub-steps per frame for snappier convergence.
  kgStep();
  kgStep();
  kg.alpha += (0 - kg.alpha) * kg.alphaDecay;
  kgRenderFrame();
  if (kg.alpha > kg.alphaMin || kg.drag) {
    kg.raf = requestAnimationFrame(kgTick);
  } else {
    kg.raf = null;
  }
}

function kgKick(value = 1) {
  kg.alpha = Math.max(kg.alpha, value);
  if (!kg.raf) kg.raf = requestAnimationFrame(kgTick);
}

function kgClientToView(event) {
  const rect = kg.svg.getBoundingClientRect();
  const x = kg.view.x + ((event.clientX - rect.left) / rect.width) * kg.view.w;
  const y = kg.view.y + ((event.clientY - rect.top) / rect.height) * kg.view.h;
  return { x, y };
}

function kgOnPointerDown(event) {
  if (event.button && event.button !== 0) return;
  kg.svg.setPointerCapture(event.pointerId);
  const targetG = event.target.closest(".kg-node");
  const pt = kgClientToView(event);
  if (targetG) {
    const node = kg.nodes.find((n) => n.id === targetG.dataset.id);
    if (node) {
      node.fixed = true;
      kg.drag = { node, dx: node.x - pt.x, dy: node.y - pt.y, moved: false };
      kg.svg.classList.add("kg-dragging");
      kgKick(0.4);
      event.preventDefault();
      return;
    }
  }
  kg.pan = { sx: event.clientX, sy: event.clientY, viewX: kg.view.x, viewY: kg.view.y };
  kg.svg.classList.add("kg-panning");
}

function kgOnPointerMove(event) {
  if (kg.drag) {
    const pt = kgClientToView(event);
    kg.drag.node.x = pt.x + kg.drag.dx;
    kg.drag.node.y = pt.y + kg.drag.dy;
    kg.drag.moved = true;
    kgRenderFrame();
    return;
  }
  if (kg.pan) {
    const rect = kg.svg.getBoundingClientRect();
    const scaleX = kg.view.w / rect.width;
    const scaleY = kg.view.h / rect.height;
    kg.view.x = kg.pan.viewX - (event.clientX - kg.pan.sx) * scaleX;
    kg.view.y = kg.pan.viewY - (event.clientY - kg.pan.sy) * scaleY;
    kgApplyView();
    kgUpdateLegend();
  }
}

function kgOnPointerUp(event) {
  try { kg.svg.releasePointerCapture(event.pointerId); } catch (_) {}
  if (kg.drag) {
    const wasDrag = kg.drag.moved;
    const node = kg.drag.node;
    node.fixed = false;
    kg.svg.classList.remove("kg-dragging");
    if (!wasDrag) {
      // It was a click — toggle focus.
      kg.focus = kg.focus === node.id ? null : node.id;
      kgUpdateClasses();
    } else {
      kgKick(0.4);
    }
    kg.drag = null;
    return;
  }
  if (kg.pan) {
    kg.svg.classList.remove("kg-panning");
    kg.pan = null;
    kgUpdateLegend();
  }
}

function kgOnWheel(event) {
  event.preventDefault();
  const factor = Math.exp(event.deltaY * 0.0012);
  const pt = kgClientToView(event);
  const nextW = Math.min(4000, Math.max(400, kg.view.w * factor));
  const ratio = nextW / kg.view.w;
  const nextH = kg.view.h * ratio;
  kg.view.x = pt.x - (pt.x - kg.view.x) * ratio;
  kg.view.y = pt.y - (pt.y - kg.view.y) * ratio;
  kg.view.w = nextW;
  kg.view.h = nextH;
  kgApplyView();
  kgUpdateLegend();
}

function renderFactsGraph(facts) {
  if (!els.factsGraph) return;
  const active = facts.filter((f) => !f.valid_to);
  if (!active.length) {
    if (kg.mounted) {
      els.factsGraph.innerHTML = "";
      kg.mounted = false;
      kg.signature = "";
    }
    const empty = document.createElement("div");
    empty.className = "empty-list";
    empty.textContent = "No active facts to graph.";
    els.factsGraph.appendChild(empty);
    return;
  }

  const sig = kgSignature(facts);
  kgEnsureMount(els.factsGraph);

  if (kg.signature !== sig) {
    const built = kgBuildGraph(facts);
    kg.nodes = built.nodes;
    kg.edges = built.edges;
    kg.byId = built.byId;
    kg.signature = sig;
    kg.focus = state.graphFocus && kg.byId.has(state.graphFocus) ? state.graphFocus : null;
    kg.hover = null;
    kgBuildDom();
    kgRenderFrame();
    kgUpdateClasses();
    kgKick(1);
  } else {
    // Same data, just re-shown — make sure classes reflect any state changes.
    kgUpdateClasses();
  }
}

function render() {
  closeMenus();
  renderStats();
  renderNav();
  renderDrawers();
  renderDetail();
  renderFacts();
  writeHash();
}

// ---------- search / sort / filter ----------
const debouncedRender = debounce(() => render(), 180);
els.searchInput.addEventListener("input", () => {
  state.query = els.searchInput.value;
  if (state.selectedDrawerId) {
    const stillMatches = filteredDrawers().some((d) => d.drawer_id === state.selectedDrawerId);
    if (!stillMatches) state.selectedDrawerId = null;
  }
  debouncedRender();
});

els.sortSelect.addEventListener("change", () => {
  state.sortBy = els.sortSelect.value;
  render();
});

// ---------- status helpers ----------
function setStatus(node, message, type = "") {
  node.className = `write-status ${type}`;
  node.textContent = message;
}
const setWriteStatus = (m, t = "") => setStatus(els.writeStatus, m, t);
const setDeleteStatus = (m, t = "") => setStatus(els.deleteStatus, m, t);
const setEditStatus = (m, t = "") => setStatus(els.editStatus, m, t);
const setLoginStatus = (m, t = "") => setStatus(els.loginStatus, m, t);
const setDraftsStatus = (m, t = "") => setStatus(els.draftsStatus, m, t);
const setTrashStatus = (m, t = "") => setStatus(els.trashStatus, m, t);
const setFactStatus = (m, t = "") => setStatus(els.factStatus, m, t);

// ---------- write sheet pickers (unchanged behaviour) ----------
function existingWings() {
  return state.palace.wings.map((wing) => wing.name);
}

function roomsForWing(wingName) {
  if (!wingName) {
    return [...new Set(allRooms().map((item) => item.room))];
  }
  const wing = state.palace.wings.find((item) => item.name === wingName);
  return wing ? wing.rooms.map((room) => room.name) : [...new Set(allRooms().map((item) => item.room))];
}

function matchingExisting(value, existingItems) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  return (
    existingItems.find((item) => item === trimmed) ||
    existingItems.find((item) => item.toLowerCase() === lower) ||
    existingItems.find((item) => humanizeName(item).toLowerCase() === lower) ||
    ""
  );
}

function toMemoryName(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function getWriteWing() {
  return matchingExisting(els.writeWing.value, existingWings()) || toMemoryName(els.writeWing.value);
}

function getWriteRoom() {
  return matchingExisting(els.writeRoom.value, roomsForWing(getWriteWing())) || toMemoryName(els.writeRoom.value);
}

// ---------- combobox ----------
function setupCombo({ field, getItems, onPick, normalize, kind }) {
  const comboEl = field.querySelector(".combo");
  const input = field.querySelector("[data-combo-input]");
  const toggle = field.querySelector("[data-combo-toggle]");
  const menu = field.querySelector("[data-combo-menu]");
  let highlighted = -1;
  let lastItems = [];

  function currentItems() {
    const filter = (input.value || "").trim().toLowerCase();
    const items = [...new Set((getItems() || []).filter(Boolean))].sort((a, b) =>
      humanizeName(a).localeCompare(humanizeName(b)),
    );
    if (!filter) return items;
    return items.filter(
      (slug) =>
        slug.toLowerCase().includes(filter) ||
        humanizeName(slug).toLowerCase().includes(filter),
    );
  }

  function render() {
    lastItems = currentItems();
    if (highlighted >= lastItems.length) highlighted = lastItems.length - 1;
    const typedRaw = (input.value || "").trim();
    const typedSlug = typedRaw ? toMemoryName(typedRaw) : "";
    const matchesExisting = matchingExisting(typedRaw, getItems() || "");
    const showCreate = typedSlug && !matchesExisting && !lastItems.includes(typedSlug);
    const itemsHtml = lastItems
      .map(
        (slug, idx) => `
        <button type="button" class="combo-option" role="option" data-slug="${escapeHtml(slug)}" ${
          highlighted === idx ? 'aria-selected="true"' : ""
        }>
          <strong>${escapeHtml(humanizeName(slug))}</strong>
          <span class="combo-option-slug">${escapeHtml(slug)}</span>
        </button>`,
      )
      .join("");
    const emptyHint = !lastItems.length
      ? `<div class="combo-option-hint">${
          getItems() && getItems().length
            ? "No matches in this list."
            : `No existing ${kind}s yet — type one to create.`
        }</div>`
      : "";
    const createHtml = showCreate
      ? `<button type="button" class="combo-option combo-option-create" role="option" data-slug="${escapeHtml(typedSlug)}" data-create="true">
          <strong>Create "${escapeHtml(humanizeName(typedSlug))}"</strong>
          <span class="combo-option-slug">${escapeHtml(typedSlug)}</span>
        </button>`
      : "";
    menu.innerHTML = itemsHtml + emptyHint + createHtml;
  }

  function open() {
    if (comboEl.dataset.open === "true") return;
    comboEl.dataset.open = "true";
    input.setAttribute("aria-expanded", "true");
    menu.classList.remove("hidden");
    render();
  }

  function close() {
    comboEl.dataset.open = "false";
    input.setAttribute("aria-expanded", "false");
    menu.classList.add("hidden");
    highlighted = -1;
  }

  function pick(slug) {
    input.value = slug;
    if (onPick) onPick(slug);
    close();
    input.focus();
  }

  toggle.addEventListener("mousedown", (event) => {
    event.preventDefault();
    if (comboEl.dataset.open === "true") {
      close();
    } else {
      open();
      input.focus();
    }
  });

  input.addEventListener("focus", () => open());

  input.addEventListener("input", () => {
    highlighted = -1;
    open();
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (menu.contains(document.activeElement)) return;
      if (normalize) input.value = normalize(input.value);
      close();
    }, 120);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      open();
      highlighted = Math.min(highlighted + 1, lastItems.length - 1);
      render();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      highlighted = Math.max(highlighted - 1, -1);
      render();
      return;
    }
    if (event.key === "Enter") {
      if (comboEl.dataset.open === "true" && highlighted >= 0 && lastItems[highlighted]) {
        event.preventDefault();
        pick(lastItems[highlighted]);
      }
    }
  });

  menu.addEventListener("mousedown", (event) => {
    const option = event.target.closest(".combo-option");
    if (!option) return;
    event.preventDefault();
    pick(option.dataset.slug);
  });

  document.addEventListener("mousedown", (event) => {
    if (!field.contains(event.target)) close();
  });

  return { open, close, refresh: render };
}

let writeWingCombo = null;
let writeRoomCombo = null;

function renderWritePickers(preferredWing = "", preferredRoom = "") {
  els.writeWing.value = preferredWing;
  els.writeRoom.value = preferredRoom;
  if (writeWingCombo) writeWingCombo.close();
  if (writeRoomCombo) writeRoomCombo.close();
}

function setWriteSheetMode(mode, draft = null) {
  if (mode === "edit-draft") {
    state.editingDraft = draft && draft.id ? draft.id : null;
    els.writeSheetTitle.textContent = "Edit draft";
    els.writeSheetSubtitle.textContent = "Save changes to the draft or file it into the palace.";
  } else {
    state.editingDraft = null;
    els.writeSheetTitle.textContent = "Write Memory";
    els.writeSheetSubtitle.textContent = "Save as a draft or file it directly into the palace.";
  }
}

function openWriteSheet() {
  setWriteSheetMode("create");
  renderWritePickers(
    state.selectedWing === "all" ? "" : state.selectedWing,
    state.selectedRoom === "all" ? "" : state.selectedRoom,
  );
  els.writeSheet.classList.remove("hidden");
  setWriteStatus("");
  els.writeTitle.focus();
}

function openWriteSheetForDraft(draft) {
  setWriteSheetMode("edit-draft", draft);
  renderWritePickers(draft.wing || "", draft.room || "");
  els.writeTitle.value = draft.title || "";
  els.writeContent.value = draft.content || "";
  els.writeSheet.classList.remove("hidden");
  setWriteStatus("");
  els.writeTitle.focus();
}

function closeWriteSheet() {
  els.writeSheet.classList.add("hidden");
  setWriteSheetMode("create");
}

// ---------- menus ----------
function closeMenus(exceptId = "") {
  document.querySelectorAll(".action-menu").forEach((menu) => {
    const open = menu.dataset.menuPanel === exceptId;
    menu.classList.toggle("hidden", !open);
    const trigger = document.querySelector(`.menu-button[data-menu="${CSS.escape(menu.dataset.menuPanel)}"]`);
    if (trigger) trigger.setAttribute("aria-expanded", open ? "true" : "false");
  });
}

function toggleMenu(menuId) {
  const panel = [...document.querySelectorAll(".action-menu")].find((menu) => menu.dataset.menuPanel === menuId);
  if (!panel) return;
  const opening = panel.classList.contains("hidden");
  closeMenus(opening ? menuId : "");
}

// ---------- delete ----------
function deleteRequestFromButton(button) {
  const scope = button.dataset.deleteScope;
  if (scope === "drawer") {
    const drawer = drawerById(button.dataset.drawerId);
    if (!drawer) return null;
    const wingCount = drawersInWing(drawer.wing).length;
    const roomCount = drawersInRoom(drawer.wing, drawer.room).length;
    const derivedNote =
      wingCount === 1
        ? "This is the last memory using this wing — deleting removes the wing category."
        : roomCount === 1
          ? "This is the last memory using this room — deleting removes the room category."
          : drawer.drawer_id;
    return {
      payload: { scope, drawer_id: drawer.drawer_id },
      title: "Delete memory?",
      body: `Only this memory will be deleted: ${drawer.title} in ${humanizeName(drawer.wing)} / ${humanizeName(drawer.room)}.`,
      warning: derivedNote,
      count: 1,
    };
  }
  if (scope === "room") {
    const wing = button.dataset.wing;
    const room = button.dataset.room;
    const count = drawersInRoom(wing, room).length;
    return {
      payload: { scope, wing, room },
      title: `Delete room ${humanizeName(room)}?`,
      body: `${count} memor${count === 1 ? "y" : "ies"} in ${humanizeName(wing)} / ${humanizeName(room)} will be permanently deleted.`,
      warning: "Snapshots are kept in Trash for recovery.",
      count,
    };
  }
  if (scope === "wing") {
    const wing = button.dataset.wing;
    const count = drawersInWing(wing).length;
    return {
      payload: { scope, wing },
      title: `Delete wing ${humanizeName(wing)}?`,
      body: `${count} memor${count === 1 ? "y" : "ies"} across all rooms in ${humanizeName(wing)} will be permanently deleted.`,
      warning: "Snapshots are kept in Trash for recovery.",
      count,
    };
  }
  return null;
}

function openDeleteSheet(request) {
  if (!request || request.count < 1) return;
  state.deleteRequest = request;
  els.deleteTitle.textContent = request.title;
  els.deleteBody.textContent = request.body;
  els.deleteWarning.textContent = request.warning;
  setDeleteStatus("");
  els.deleteConfirm.disabled = false;
  els.deleteSheet.classList.remove("hidden");
  els.deleteConfirm.focus();
}

function closeDeleteSheet() {
  state.deleteRequest = null;
  els.deleteSheet.classList.add("hidden");
  setDeleteStatus("");
}

async function confirmDelete() {
  if (!state.deleteRequest) return;
  els.deleteConfirm.disabled = true;
  try {
    setDeleteStatus("Deleting…", "info");
    const data = await postJson("/api/delete", { ...state.deleteRequest.payload, confirm: "DELETE" });
    state.selectedDrawerId = null;
    setDeleteStatus(`Deleted ${data.deleted} ${data.deleted === 1 ? "memory" : "memories"}.`, "success");
    await loadPalace();
    closeDeleteSheet();
  } catch (error) {
    els.deleteConfirm.disabled = false;
    setDeleteStatus(error.message, "error");
  }
}

// ---------- edit ----------
function openEditSheet(drawerId) {
  const drawer = drawerById(drawerId);
  if (!drawer) return;
  state.editDrawerId = drawer.drawer_id;
  els.editSubtitle.textContent = `${drawer.title} · ${drawer.wing}/${drawer.room}`;
  els.editContent.value = drawer.content || "";
  els.editWing.value = drawer.wing || "";
  els.editRoom.value = drawer.room || "";
  els.editTitle.value = drawer.title || "";
  els.editDrawerLabel.textContent = drawer.drawer_id;
  els.editDrawerLabel.dataset.etag = drawer.etag || "";
  setEditStatus("");
  els.saveEdit.disabled = false;
  els.editSheet.classList.remove("hidden");
  els.editTitle.focus();
}

function closeEditSheet() {
  state.editDrawerId = null;
  els.editSheet.classList.add("hidden");
  setEditStatus("");
}

function applyTitleToContent(content, newTitle) {
  if (!newTitle) return content;
  const lines = (content || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("# ")) {
      lines[i] = `# ${newTitle}`;
      return lines.join("\n");
    }
    if (lines[i].trim()) break;
  }
  return `# ${newTitle}\n\n${content || ""}`;
}

async function saveEdit(event) {
  event.preventDefault();
  if (!state.editDrawerId) return;
  els.saveEdit.disabled = true;
  try {
    setEditStatus("Saving changes…", "info");
    const current = drawerById(state.editDrawerId);
    const newWing = els.editWing.value.trim();
    const newRoom = els.editRoom.value.trim();
    const newTitle = els.editTitle.value.trim();
    let newContent = els.editContent.value;
    if (current && newTitle && newTitle !== (current.title || "")) {
      newContent = applyTitleToContent(newContent, newTitle);
    }
    const payload = {
      drawer_id: state.editDrawerId,
      etag: els.editDrawerLabel.dataset.etag || "",
    };
    if (current) {
      if (newContent !== (current.content || "")) payload.content = newContent;
      if (newWing && newWing !== current.wing) payload.wing = newWing;
      if (newRoom && newRoom !== current.room) payload.room = newRoom;
    } else {
      payload.content = newContent;
      if (newWing) payload.wing = newWing;
      if (newRoom) payload.room = newRoom;
    }
    if (!payload.content && !payload.wing && !payload.room) {
      setEditStatus("No changes to save.", "info");
      els.saveEdit.disabled = false;
      return;
    }
    await postJson("/api/memories/update", payload);
    state.selectedDrawerId = state.editDrawerId;
    if (payload.wing) state.selectedWing = payload.wing;
    if (payload.room) state.selectedRoom = payload.room;
    setEditStatus("Updated. Refreshing…", "success");
    await loadPalace();
    closeEditSheet();
  } catch (error) {
    els.saveEdit.disabled = false;
    setEditStatus(error.message, "error");
  }
}

// ---------- drafts ----------
async function openDraftsSheet() {
  els.draftsSheet.classList.remove("hidden");
  setDraftsStatus("");
  els.draftsList.innerHTML = `<div class="empty-list">Loading…</div>`;
  try {
    const data = await fetchJson("/api/drafts");
    state.draftsCount = (data.drafts || []).length;
    updateDraftsBadge();
    if (!data.drafts.length) {
      els.draftsList.innerHTML = `<div class="empty-list">No drafts staged.</div>`;
      return;
    }
    els.draftsList.innerHTML = data.drafts
      .map((d) => `
        <div class="draft-item">
          <div class="draft-info">
            <strong>${escapeHtml(d.title)}</strong>
            <span>${escapeHtml(d.wing)} / ${escapeHtml(d.room)} · ${escapeHtml(d.created_at)}</span>
          </div>
          <div class="draft-actions">
            <button class="icon-button icon-only" type="button" data-edit-draft="${escapeHtml(d.id)}" aria-label="Edit draft" title="Edit">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14.06 4.94a2.25 2.25 0 0 1 3.18 0l1.82 1.82a2.25 2.25 0 0 1 0 3.18L9.5 19.5l-4.5 1 1-4.5 8.06-11.06Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
                <path d="m13 6 5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              </svg>
            </button>
            <button class="icon-button icon-only danger-button" type="button" data-delete-draft="${escapeHtml(d.id)}" data-delete-label="${escapeHtml(d.title)}" aria-label="Delete draft" title="Delete">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 7h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
                <path d="M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
                <path d="M7 7h10l-.9 11.2A1.8 1.8 0 0 1 14.3 20H9.7a1.8 1.8 0 0 1-1.8-1.8L7 7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
                <path d="M10.5 10.5v6M13.5 10.5v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              </svg>
            </button>
            <button class="primary-action" type="button" data-commit-draft="${escapeHtml(d.id)}">File</button>
          </div>
        </div>`)
      .join("");
    els.draftsList.querySelectorAll("[data-commit-draft]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        setDraftsStatus("Filing draft…", "info");
        try {
          await postJson("/api/drafts/commit", { id: btn.dataset.commitDraft, confirm: "FILE" });
          setDraftsStatus("Filed.", "success");
          await loadPalace();
          openDraftsSheet();
        } catch (error) {
          setDraftsStatus(error.message, "error");
          btn.disabled = false;
        }
      });
    });
    els.draftsList.querySelectorAll("[data-edit-draft]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          const detail = await fetchJson(`/api/drafts?id=${encodeURIComponent(btn.dataset.editDraft)}`);
          closeDraftsSheet();
          openWriteSheetForDraft(detail.draft);
        } catch (error) {
          setDraftsStatus(error.message, "error");
          btn.disabled = false;
        }
      });
    });
    els.draftsList.querySelectorAll("[data-delete-draft]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const label = btn.dataset.deleteLabel || btn.dataset.deleteDraft;
        if (!confirm(`Delete draft "${label}"? This cannot be undone.`)) return;
        btn.disabled = true;
        setDraftsStatus("Deleting draft…", "info");
        try {
          await postJson("/api/drafts/delete", { id: btn.dataset.deleteDraft });
          await refreshDraftsCount();
          setDraftsStatus("Deleted.", "success");
          openDraftsSheet();
        } catch (error) {
          setDraftsStatus(error.message, "error");
          btn.disabled = false;
        }
      });
    });
  } catch (error) {
    setDraftsStatus(error.message, "error");
  }
}

function closeDraftsSheet() {
  els.draftsSheet.classList.add("hidden");
}

// ---------- trash / versions ----------
async function openTrashSheet() {
  els.trashSheet.classList.remove("hidden");
  setTrashStatus("");
  els.trashList.innerHTML = `<div class="empty-list">Loading…</div>`;
  els.trashClearAll.classList.add("hidden");
  try {
    const data = await fetchJson("/api/versions");
    const versions = (data.versions || []).filter((v) => v.action === "delete" || v.action === "update-before");
    if (!versions.length) {
      els.trashList.innerHTML = `<div class="empty-list">No deleted or edited memories logged yet.</div>`;
      return;
    }
    els.trashClearAll.classList.remove("hidden");
    els.trashList.innerHTML = versions
      .map((v, idx) => `
        <div class="draft-item">
          <div class="draft-info">
            <strong>${escapeHtml(v.title || v.drawer_id)}</strong>
            <span>${escapeHtml(v.action)} · ${escapeHtml(v.wing || "?")}/${escapeHtml(v.room || "?")} · ${escapeHtml(v.logged_at)}</span>
          </div>
          <div class="draft-actions">
            <button class="icon-button icon-only danger-button" type="button" data-trash-delete="${idx}" aria-label="Permanently delete this snapshot" title="Delete">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 7h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
                <path d="M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
                <path d="M7 7h10l-.9 11.2A1.8 1.8 0 0 1 14.3 20H9.7a1.8 1.8 0 0 1-1.8-1.8L7 7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
                <path d="M10.5 10.5v6M13.5 10.5v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              </svg>
            </button>
            <button class="primary-action" type="button" data-restore-version="${idx}">Restore</button>
          </div>
        </div>`)
      .join("");
    els.trashList.querySelectorAll("[data-restore-version]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = parseInt(btn.dataset.restoreVersion, 10);
        const v = versions[idx];
        btn.disabled = true;
        setTrashStatus("Restoring…", "info");
        try {
          await postJson("/api/versions/restore", { drawer_id: v.drawer_id, logged_at: v.logged_at });
          setTrashStatus("Restored as a fresh copy.", "success");
          await loadPalace();
        } catch (error) {
          setTrashStatus(error.message, "error");
          btn.disabled = false;
        }
      });
    });
    els.trashList.querySelectorAll("[data-trash-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = parseInt(btn.dataset.trashDelete, 10);
        const v = versions[idx];
        if (!confirm(`Permanently delete this snapshot of "${v.title || v.drawer_id}"? It will not be restorable.`)) return;
        btn.disabled = true;
        setTrashStatus("Deleting snapshot…", "info");
        try {
          await postJson("/api/versions/delete", { drawer_id: v.drawer_id, logged_at: v.logged_at });
          openTrashSheet();
        } catch (error) {
          setTrashStatus(error.message, "error");
          btn.disabled = false;
        }
      });
    });
  } catch (error) {
    setTrashStatus(error.message, "error");
  }
}

if (els.trashClearAll) {
  els.trashClearAll.addEventListener("click", async () => {
    if (!confirm("Permanently delete every snapshot in Recently deleted? This cannot be undone.")) return;
    els.trashClearAll.disabled = true;
    setTrashStatus("Clearing…", "info");
    try {
      await postJson("/api/versions/clear", { confirm: "CLEAR" });
      openTrashSheet();
    } catch (error) {
      setTrashStatus(error.message, "error");
    } finally {
      els.trashClearAll.disabled = false;
    }
  });
}

function closeTrashSheet() {
  els.trashSheet.classList.add("hidden");
}

// ---------- fact CRUD ----------
function openFactSheet() {
  state.factEditing = null;
  els.factSheetTitle.textContent = "Add fact";
  els.factSubject.value = "";
  els.factPredicate.value = "";
  els.factObject.value = "";
  els.factValidFrom.value = "";
  els.factSource.value = state.selectedDrawerId || "";
  setFactStatus("");
  els.saveFact.disabled = false;
  els.factSheet.classList.remove("hidden");
  els.factSubject.focus();
}

function closeFactSheet() {
  els.factSheet.classList.add("hidden");
  state.factEditing = null;
}

async function saveFact(event) {
  event.preventDefault();
  els.saveFact.disabled = true;
  try {
    setFactStatus("Saving…", "info");
    await postJson("/api/facts", {
      subject: els.factSubject.value,
      predicate: els.factPredicate.value,
      object: els.factObject.value,
      valid_from: els.factValidFrom.value,
      source_drawer_id: els.factSource.value,
    });
    setFactStatus("Fact added.", "success");
    await loadPalace();
    closeFactSheet();
  } catch (error) {
    setFactStatus(error.message, "error");
    els.saveFact.disabled = false;
  }
}

// ---------- settings ----------
const setSettingsStatus = (m, t = "") => setStatus(els.settingsStatus, m, t);

function setCurrentPasswordRequired(required) {
  if (required) {
    els.settingsCurrentRow.classList.remove("hidden");
    els.settingsCurrentPassword.setAttribute("required", "");
  } else {
    els.settingsCurrentRow.classList.add("hidden");
    els.settingsCurrentPassword.removeAttribute("required");
  }
}

function passwordsMatch() {
  return els.settingsPassword.value === els.settingsPasswordConfirm.value;
}

function setMatchErrorVisible(visible) {
  els.settingsMatchError.classList.toggle("hidden", !visible);
  els.settingsPasswordConfirm.classList.toggle("invalid-mismatch", visible);
}

async function openSettingsSheet() {
  setSettingsStatus("");
  els.settingsPassword.value = "";
  els.settingsPasswordConfirm.value = "";
  els.settingsCurrentPassword.value = "";
  els.settingsUsername.value = "";
  setCurrentPasswordRequired(false);
  setMatchErrorVisible(false);
  els.saveSettings.disabled = false;
  els.settingsSheet.classList.remove("hidden");
  try {
    const data = await fetchJson("/api/settings");
    if (data.credentials_configured) {
      els.settingsUsername.value = data.username || "";
      setCurrentPasswordRequired(true);
      els.settingsSubtitle.textContent = "Update the credentials used to secure the dashboard.";
    } else {
      els.settingsSubtitle.textContent = "Set the credentials used to secure the dashboard.";
    }
  } catch (error) {
    setSettingsStatus(error.message, "error");
  }
  els.settingsUsername.focus();
}

function closeSettingsSheet() {
  els.settingsSheet.classList.add("hidden");
}

async function saveSettings(event) {
  event.preventDefault();
  setMatchErrorVisible(false);
  const password = els.settingsPassword.value;
  if (password.length < 8) {
    setSettingsStatus("Password must be at least 8 characters.", "error");
    return;
  }
  if (!passwordsMatch()) {
    setMatchErrorVisible(true);
    els.settingsPasswordConfirm.focus();
    return;
  }
  const currentRequired = !els.settingsCurrentRow.classList.contains("hidden");
  if (currentRequired && !els.settingsCurrentPassword.value) {
    setSettingsStatus("Current password is required.", "error");
    return;
  }
  els.saveSettings.disabled = true;
  try {
    setSettingsStatus("Saving…", "info");
    const payload = {
      username: els.settingsUsername.value.trim(),
      password,
    };
    if (currentRequired) {
      payload.current_password = els.settingsCurrentPassword.value;
    }
    await postJson("/api/settings/credentials", payload);
    setSettingsStatus("Credentials saved. Authentication is prepared but not yet enforced.", "success");
    setTimeout(() => closeSettingsSheet(), 800);
  } catch (error) {
    setSettingsStatus(error.message, "error");
  } finally {
    els.saveSettings.disabled = false;
  }
}

if (els.settingsBtn) els.settingsBtn.addEventListener("click", openSettingsSheet);
if (els.settingsClose) els.settingsClose.addEventListener("click", closeSettingsSheet);
if (els.settingsBackdrop) els.settingsBackdrop.addEventListener("click", closeSettingsSheet);
async function exportPalace() {
  const btn = document.querySelector("#exportBtn");
  const status = document.querySelector("#exportStatus");
  const setStat = (msg, type = "") => {
    if (!status) return;
    status.className = `write-status ${type}`;
    status.textContent = msg;
  };
  if (btn) btn.disabled = true;
  setStat("Preparing download…", "info");
  try {
    const data = await fetchJson("/api/export");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    const link = document.createElement("a");
    link.href = url;
    link.download = `mempalace-export-${stamp}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStat(`Exported ${data.counts.drawers} memories · ${data.counts.facts} facts.`, "success");
  } catch (error) {
    setStat(error.message, "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

const exportBtn = document.querySelector("#exportBtn");
if (exportBtn) exportBtn.addEventListener("click", exportPalace);

async function importPalace(file) {
  const status = document.querySelector("#exportStatus");
  const importBtn = document.querySelector("#importBtn");
  const setStat = (msg, type = "") => {
    if (!status) return;
    status.className = `write-status ${type}`;
    status.textContent = msg;
  };
  if (importBtn) importBtn.disabled = true;
  setStat(`Restoring from ${file.name}…`, "info");
  try {
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("File isn't valid JSON.");
    }
    const result = await postJson("/api/import", { data });
    const addedD = result.added.drawers;
    const addedF = result.added.facts;
    const skippedD = result.skipped.drawers;
    const skippedF = result.skipped.facts;
    const errors = (result.errors.drawers.length || 0) + (result.errors.facts.length || 0);
    const parts = [
      `Restored ${addedD} memor${addedD === 1 ? "y" : "ies"} · ${addedF} fact${addedF === 1 ? "" : "s"}`,
      `${skippedD + skippedF} already present, skipped`,
    ];
    if (errors) parts.push(`${errors} error${errors === 1 ? "" : "s"} — see console`);
    if (errors) console.warn("Import errors:", result.errors);
    setStat(parts.join(" · "), errors ? "error" : "success");
    await loadPalace().catch(() => {});
  } catch (error) {
    setStat(error.message, "error");
  } finally {
    if (importBtn) importBtn.disabled = false;
  }
}

const importBtn = document.querySelector("#importBtn");
const importInput = document.querySelector("#importInput");
if (importBtn && importInput) {
  importBtn.addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", () => {
    const file = importInput.files && importInput.files[0];
    if (file) importPalace(file);
    importInput.value = "";
  });
}

if (els.settingsForm) els.settingsForm.addEventListener("submit", saveSettings);
// Any input event in either password field clears a stale mismatch error.
// The error is only re-shown on the next save attempt with mismatched values.
const dismissMatchError = () => setMatchErrorVisible(false);
if (els.settingsPassword) els.settingsPassword.addEventListener("input", dismissMatchError);
if (els.settingsPasswordConfirm) els.settingsPasswordConfirm.addEventListener("input", dismissMatchError);

// ---------- login ----------
function openLoginSheet(message = "") {
  els.loginSheet.classList.remove("hidden");
  setLoginStatus(message, message ? "error" : "");
  els.loginPassword.value = "";
  els.loginUsername.focus();
}

function closeLoginSheet() {
  els.loginSheet.classList.add("hidden");
}

els.loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setLoginStatus("Signing in…", "info");
  try {
    await postJson("/api/login", {
      username: els.loginUsername.value.trim(),
      password: els.loginPassword.value,
      remember: !!els.loginRemember.checked,
    });
    setLoginStatus("");
    closeLoginSheet();
    await loadPalace();
  } catch (error) {
    setLoginStatus(error.message || "Could not sign in.", "error");
  }
});

async function logout() {
  try {
    await postJson("/api/logout", {});
  } catch {}
  closeSettingsSheet();
  openLoginSheet("Signed out.");
}

if (els.logoutBtn) els.logoutBtn.addEventListener("click", logout);

if (els.factsViewList) {
  els.factsViewList.addEventListener("click", () => {
    if (state.factsView === "list") return;
    state.factsView = "list";
    renderFacts();
  });
}
if (els.factsViewGraph) {
  els.factsViewGraph.addEventListener("click", () => {
    if (state.factsView === "graph") return;
    state.factsView = "graph";
    renderFacts();
  });
}

// ---------- rename submission ----------
async function submitRename(form) {
  const input = form.querySelector(".rename-input");
  if (!input) return;
  const scope = form.dataset.renameScope;
  const current = form.dataset.current;
  const next = input.value.trim();
  if (!next) {
    input.focus();
    return;
  }
  if (next === current) {
    state.renaming = null;
    render();
    return;
  }
  const submitBtn = form.querySelector("button[type='submit']");
  if (submitBtn) submitBtn.disabled = true;
  input.classList.remove("rename-error");
  try {
    const payload = { scope, new_name: next };
    if (scope === "wing") {
      payload.wing = state.renaming && state.renaming.wing;
    } else if (scope === "room") {
      payload.wing = state.renaming && state.renaming.wing;
      payload.room = state.renaming && state.renaming.room;
    }
    await postJson("/api/rename", payload);
    if (scope === "wing" && state.selectedWing === current) state.selectedWing = next;
    if (scope === "room" && state.selectedRoom === current) state.selectedRoom = next;
    state.renaming = null;
    await loadPalace();
  } catch (error) {
    input.classList.add("rename-error");
    input.title = error.message;
    if (submitBtn) submitBtn.disabled = false;
  }
}

document.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-rename-form]");
  if (!form) return;
  event.preventDefault();
  submitRename(form);
});

// ---------- document click router ----------
document.addEventListener("click", (event) => {
  const menuButton = event.target.closest(".menu-button");
  if (menuButton) {
    event.preventDefault();
    event.stopPropagation();
    toggleMenu(menuButton.dataset.menu);
    return;
  }
  const deleteButton = event.target.closest("[data-delete-scope]");
  if (deleteButton) {
    event.preventDefault();
    event.stopPropagation();
    closeMenus();
    openDeleteSheet(deleteRequestFromButton(deleteButton));
    return;
  }
  const renameButton = event.target.closest("[data-rename-scope]");
  if (renameButton && !event.target.closest("[data-rename-form]")) {
    event.preventDefault();
    event.stopPropagation();
    const scope = renameButton.dataset.renameScope;
    state.renaming = {
      scope,
      wing: renameButton.dataset.wing || null,
      room: renameButton.dataset.room || null,
    };
    render();
    requestAnimationFrame(() => {
      const input = document.querySelector(".rename-input");
      if (input) {
        input.focus();
        input.select();
      }
    });
    return;
  }
  const renameCancel = event.target.closest("[data-rename-cancel]");
  if (renameCancel) {
    event.preventDefault();
    event.stopPropagation();
    state.renaming = null;
    render();
    return;
  }
  const editButton = event.target.closest("[data-edit-drawer-id]");
  if (editButton) {
    event.preventDefault();
    event.stopPropagation();
    closeMenus();
    openEditSheet(editButton.dataset.editDrawerId);
    return;
  }
  if (!event.target.closest(".action-menu")) {
    closeMenus();
  }
});

// ---------- keyboard shortcuts ----------
document.addEventListener("keydown", (event) => {
  const isMod = event.metaKey || event.ctrlKey;
  if (isMod && event.key.toLowerCase() === "k") {
    event.preventDefault();
    els.searchInput.focus();
    els.searchInput.select();
    return;
  }
  if (event.key === "Escape") {
    if (state.renaming) {
      state.renaming = null;
      render();
      return;
    }
    [els.writeSheet, els.editSheet, els.deleteSheet, els.draftsSheet, els.trashSheet, els.factSheet, els.settingsSheet]
      .forEach((sheet) => sheet && sheet.classList.add("hidden"));
    closeMenus();
    return;
  }
});

// ---------- sheet wiring ----------
els.deleteCancel.addEventListener("click", closeDeleteSheet);
els.deleteBackdrop.addEventListener("click", closeDeleteSheet);
els.deleteConfirm.addEventListener("click", confirmDelete);

els.editClose.addEventListener("click", closeEditSheet);
els.editBackdrop.addEventListener("click", closeEditSheet);
els.editForm.addEventListener("submit", saveEdit);
els.copyEditId.addEventListener("click", async () => {
  const ok = await copyToClipboard(els.editDrawerLabel.textContent || "");
  els.copyEditId.textContent = ok ? "Copied!" : "Copy failed";
  setTimeout(() => { els.copyEditId.textContent = "Copy ID"; }, 1500);
});

els.draftsBtn.addEventListener("click", openDraftsSheet);
els.draftsClose.addEventListener("click", closeDraftsSheet);
els.draftsBackdrop.addEventListener("click", closeDraftsSheet);

els.trashBtn.addEventListener("click", openTrashSheet);
els.trashClose.addEventListener("click", closeTrashSheet);
els.trashBackdrop.addEventListener("click", closeTrashSheet);

els.addFactBtn.addEventListener("click", openFactSheet);
els.factClose.addEventListener("click", closeFactSheet);
els.factBackdrop.addEventListener("click", closeFactSheet);
els.factForm.addEventListener("submit", saveFact);

els.writeOpen.addEventListener("click", openWriteSheet);
els.writeClose.addEventListener("click", closeWriteSheet);
els.writeBackdrop.addEventListener("click", closeWriteSheet);

writeWingCombo = setupCombo({
  field: document.querySelector('[data-combo="wing"]'),
  kind: "wing",
  getItems: () => existingWings(),
  normalize: (value) => getWriteWing(),
  onPick: () => {
    els.writeRoom.value = "";
    if (writeRoomCombo) writeRoomCombo.refresh();
  },
});

writeRoomCombo = setupCombo({
  field: document.querySelector('[data-combo="room"]'),
  kind: "room",
  getItems: () => roomsForWing(getWriteWing()),
  normalize: (value) => getWriteRoom(),
});

function gatherWritePayload() {
  const wing = getWriteWing();
  const room = getWriteRoom();
  if (!wing) throw new Error("Wing is required. Choose an existing wing or type a new name.");
  if (!room) throw new Error("Room is required. Choose an existing room or type a new name.");
  els.writeWing.value = wing;
  els.writeRoom.value = room;
  return {
    wing,
    room,
    title: els.writeTitle.value,
    content: els.writeContent.value,
  };
}

function setWriteButtonsBusy(busy) {
  [els.saveMemory, els.saveDraft].forEach((btn) => {
    if (btn) btn.disabled = busy;
  });
}

async function saveDraftAction() {
  try {
    setWriteButtonsBusy(true);
    const payload = gatherWritePayload();
    setWriteStatus("Saving draft…", "info");
    if (state.editingDraft) {
      await postJson("/api/drafts/update", { id: state.editingDraft, ...payload });
    } else {
      await postJson("/api/drafts", payload);
    }
    els.writeTitle.value = "";
    els.writeContent.value = "";
    await refreshDraftsCount();
    setWriteStatus("");
    closeWriteSheet();
  } catch (error) {
    setWriteStatus(error.message, "error");
  } finally {
    setWriteButtonsBusy(false);
  }
}

async function fileAction(event) {
  if (event) event.preventDefault();
  try {
    setWriteButtonsBusy(true);
    const payload = gatherWritePayload();
    setWriteStatus("Filing memory…", "info");
    if (state.editingDraft) {
      await postJson("/api/drafts/update", { id: state.editingDraft, ...payload });
      await postJson("/api/drafts/commit", { id: state.editingDraft, confirm: "FILE" });
    } else {
      await postJson("/api/memories", payload);
    }
    els.writeTitle.value = "";
    els.writeContent.value = "";
    await loadPalace();
    await refreshDraftsCount();
    setWriteStatus("");
    closeWriteSheet();
  } catch (error) {
    setWriteStatus(error.message, "error");
  } finally {
    setWriteButtonsBusy(false);
  }
}

els.writeForm.addEventListener("submit", fileAction);
if (els.saveDraft) els.saveDraft.addEventListener("click", saveDraftAction);

if (els.themeToggle) {
  els.themeToggle.addEventListener("click", toggleTheme);
}

applyTheme();

// ---------- hash routing ----------
window.addEventListener("hashchange", () => {
  applyHash();
  render();
});

// platform hint
if (els.searchHint) {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  els.searchHint.textContent = isMac ? "⌘K" : "Ctrl+K";
}

applyHash();

(async function boot() {
  let sessionInfo = null;
  try {
    sessionInfo = await fetchJson("/api/session");
  } catch (error) {
    document.body.innerHTML = `<main class="fatal"><h1>Unable to reach MemPalace</h1><p>${escapeHtml(error.message)}</p></main>`;
    return;
  }
  if (sessionInfo.credentials_required && !sessionInfo.authenticated) {
    openLoginSheet();
    return;
  }
  try {
    await loadPalace();
  } catch (error) {
    if (error.message === "Authentication required.") return;
    document.body.innerHTML = `<main class="fatal"><h1>Unable to load MemPalace</h1><p>${escapeHtml(error.message)}</p></main>`;
  }
})();
