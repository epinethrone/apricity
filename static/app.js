// ---------- state ----------
const state = {
  palace: null,
  selectedWing: "all",
  selectedRoom: "all",
  selectedDrawerId: null,
  activeMetric: null,
  deleteRequest: null,
  editDrawerId: null,
  query: "",
  sortBy: "filed-desc",
  authorFilter: "all",
  draftsCount: 0,
  applyingHash: false,
  factEditing: null,
  editingDraft: null,
};

const AUTH_STORAGE_KEY = "mempalace-auth-token";
const THEME_STORAGE_KEY = "mempalace-theme";

// ---------- dom refs ----------
const els = {
  wingNav: document.querySelector("#wingNav"),
  stats: document.querySelector("#stats"),
  inventoryTray: document.querySelector("#inventoryTray"),
  drawerList: document.querySelector("#drawerList"),
  drawerCount: document.querySelector("#drawerCount"),
  roomNav: document.querySelector("#roomNav"),
  detail: document.querySelector("#detail"),
  emptyState: document.querySelector("#emptyState"),
  facts: document.querySelector("#facts"),
  factCount: document.querySelector("#factCount"),
  pageTitle: document.querySelector("#pageTitle"),
  pageSubtitle: document.querySelector("#pageSubtitle"),
  searchInput: document.querySelector("#searchInput"),
  searchHint: document.querySelector("#searchHint"),
  refreshBtn: document.querySelector("#refreshBtn"),
  sortSelect: document.querySelector("#sortSelect"),
  authorSelect: document.querySelector("#authorSelect"),
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
  writeWingPicker: document.querySelector("#writeWingPicker"),
  writeRoom: document.querySelector("#writeRoom"),
  writeRoomPicker: document.querySelector("#writeRoomPicker"),
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
    const authorMatch = state.authorFilter === "all" || (drawer.added_by || "unknown") === state.authorFilter;
    return wingMatch && roomMatch && queryMatch && authorMatch;
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

function uniqueAuthors() {
  const set = new Set();
  state.palace.drawers.forEach((d) => set.add(d.added_by || "unknown"));
  return [...set].sort();
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
  if (state.authorFilter && state.authorFilter !== "all") parts.push(`by=${encodeURIComponent(state.authorFilter)}`);
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
  state.authorFilter = hash.by || "all";
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
    ["drawers", "Drawers", stats.drawers, true],
    ["wings", "Wings", stats.wings, true],
    ["rooms", "Rooms", stats.rooms, true],
    ["facts", "Facts", stats.facts, true],
  ];
  els.stats.innerHTML = items
    .map(
      ([key, label, value, interactive]) => `
      <button class="stat ${interactive ? "interactive" : "static"} ${state.activeMetric === key ? "active" : ""}" data-metric="${key}" ${interactive ? "" : "disabled"}>
        <div class="stat-value">${value}</div>
        <div class="stat-label">${label}</div>
      </button>
    `,
    )
    .join("");
  els.stats.querySelectorAll("button.interactive").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeMetric = state.activeMetric === button.dataset.metric ? null : button.dataset.metric;
      renderStats();
      renderInventoryTray();
    });
  });
}

function renderInventoryTray() {
  if (!state.activeMetric) {
    els.inventoryTray.classList.add("hidden");
    els.inventoryTray.innerHTML = "";
    return;
  }
  const metric = state.activeMetric;
  const titles = { drawers: "All drawers", wings: "Wings", rooms: "Rooms", facts: "Facts" };
  if (!(metric in titles)) {
    els.inventoryTray.classList.add("hidden");
    els.inventoryTray.innerHTML = "";
    return;
  }
  let body = "";
  if (metric === "drawers") {
    body = state.palace.drawers
      .map((d) => `
        <button class="inventory-chip drawer-chip" data-action="drawer" data-id="${escapeHtml(d.drawer_id)}">
          <strong>${escapeHtml(d.title)}</strong>
          <span>${escapeHtml(d.wing)} / ${escapeHtml(d.room)}</span>
        </button>`)
      .join("");
  } else if (metric === "wings") {
    body = state.palace.wings
      .map((w) => `
        <button class="inventory-chip" data-action="wing" data-wing="${escapeHtml(w.name)}">
          <strong>${escapeHtml(w.name)}</strong>
          <span>${w.count} drawers · ${w.rooms.length} rooms</span>
        </button>`)
      .join("");
  } else if (metric === "rooms") {
    body = allRooms()
      .map((r) => `
        <button class="inventory-chip" data-action="room" data-wing="${escapeHtml(r.wing)}" data-room="${escapeHtml(r.room)}">
          <strong>${escapeHtml(r.room)}</strong>
          <span>${escapeHtml(r.wing)} / ${r.count}</span>
        </button>`)
      .join("");
  } else if (metric === "facts") {
    body = filteredFacts()
      .map((fact) => `
        <button class="inventory-chip fact-chip" data-action="fact" data-id="${escapeHtml(fact.source_drawer_id || "")}" data-query="${escapeHtml(fact.subject)}">
          <strong>${escapeHtml(fact.subject)}</strong>
          <span>${escapeHtml(fact.predicate)} → ${escapeHtml(fact.object)}</span>
        </button>`)
      .join("");
  }
  els.inventoryTray.classList.remove("hidden");
  els.inventoryTray.innerHTML = `
    <div class="inventory-header">
      <div>
        <h2>${escapeHtml(titles[metric])}</h2>
        <p>${body ? "Select an item to focus the browser." : "Nothing here yet."}</p>
      </div>
      <button class="tray-close" type="button" aria-label="Close inventory">Close</button>
    </div>
    <div class="inventory-list">${body || `<div class="empty-list">Nothing here yet.</div>`}</div>
  `;
  els.inventoryTray.querySelector(".tray-close").addEventListener("click", () => {
    state.activeMetric = null;
    renderStats();
    renderInventoryTray();
  });
  els.inventoryTray.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      state.query = "";
      if (els.searchInput) els.searchInput.value = "";
      if (action === "room") {
        state.selectedWing = button.dataset.wing;
        state.selectedRoom = button.dataset.room;
        state.selectedDrawerId = null;
      } else if (action === "wing") {
        state.selectedWing = button.dataset.wing;
        state.selectedRoom = "all";
        state.selectedDrawerId = null;
      } else if (action === "drawer") {
        const drawer = drawerById(button.dataset.id);
        if (drawer) {
          state.selectedWing = drawer.wing;
          state.selectedRoom = drawer.room;
          state.selectedDrawerId = drawer.drawer_id;
        }
      } else if (action === "fact") {
        const drawer = drawerById(button.dataset.id);
        if (drawer) {
          state.selectedWing = drawer.wing;
          state.selectedRoom = drawer.room;
          state.selectedDrawerId = drawer.drawer_id;
        } else {
          state.query = button.dataset.query;
          els.searchInput.value = state.query;
        }
      }
      render();
    });
  });
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

function renderNav() {
  const buttons = [{ name: "all", count: state.palace.stats.drawers }, ...state.palace.wings];
  els.wingNav.innerHTML = buttons
    .map((wing) => {
      const active = state.selectedWing === wing.name ? "active" : "";
      const label = wing.name === "all" ? "All Memory" : wing.name;
      const menu = wing.name === "all"
        ? ""
        : dotMenu(`wing-${wing.name}`, `Actions for ${label}`, [
            deleteMenuItem({ scope: "wing", wing: wing.name }),
          ]);
      return `<div class="nav-row ${active}" data-wing-row="${escapeHtml(wing.name)}">
        <button class="nav-item" type="button" data-wing="${escapeHtml(wing.name)}">
          <span>${escapeHtml(label)}</span>
          <strong>${wing.count}</strong>
        </button>
        ${menu}
      </div>`;
    })
    .join("");
  els.wingNav.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
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
  els.roomNav.innerHTML = [
    `<button class="room-item ${allActive}" type="button" data-room="all">
      <span>All rooms</span>
      <strong>${drawers.length}</strong>
    </button>`,
    ...rooms.map(([room, count]) => {
      const active = state.selectedRoom === room ? "active" : "";
      const menu = state.selectedWing === "all"
        ? ""
        : dotMenu(`room-${state.selectedWing}-${room}`, `Actions for ${room}`, [
            deleteMenuItem({ scope: "room", wing: state.selectedWing, room }),
          ]);
      return `<div class="room-row ${active}">
        <button class="room-item" type="button" data-room="${escapeHtml(room)}">
          <span>${escapeHtml(room)}</span>
          <strong>${count}</strong>
        </button>
        ${menu}
      </div>`;
    }),
  ].join("");
  els.roomNav.querySelectorAll(".room-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedRoom = button.dataset.room;
      state.selectedDrawerId = null;
      render();
    });
  });
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

  // populate author select (state.authorFilter is the source of truth)
  const authors = uniqueAuthors();
  els.authorSelect.innerHTML =
    `<option value="all">All</option>` +
    authors.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("");
  if (state.authorFilter !== "all" && !authors.includes(state.authorFilter)) {
    state.authorFilter = "all";
  }
  els.authorSelect.value = state.authorFilter;

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
            <span>${escapeHtml(drawer.wing)} / ${escapeHtml(drawer.room)}</span>
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
    ["Wing", drawer.wing],
    ["Room", drawer.room],
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

function renderTitle() {
  const wing = state.selectedWing === "all" ? "Palace" : state.selectedWing;
  els.pageTitle.textContent = wing;
  els.pageSubtitle.textContent =
    state.selectedWing === "all"
      ? "Local memory — browse, edit, prune."
      : "Browse drawers and graph facts in this wing.";
}

function render() {
  closeMenus();
  renderTitle();
  renderStats();
  renderInventoryTray();
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

els.authorSelect.addEventListener("change", () => {
  state.authorFilter = els.authorSelect.value;
  render();
});

els.refreshBtn.addEventListener("click", () => {
  loadPalace().catch((err) => {
    if (err.message !== "Authentication required.") alert(`Refresh failed: ${err.message}`);
  });
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
function appendOption(select, label, value) {
  const option = document.createElement("option");
  option.textContent = label;
  option.value = value;
  select.append(option);
}

function fillPicker(select, items, placeholder) {
  const uniqueItems = [...new Set(items.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  select.replaceChildren();
  appendOption(select, placeholder, "");
  uniqueItems.forEach((item) => appendOption(select, item, item));
  select.value = "";
}

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
  const trimmed = value.trim();
  return existingItems.find((item) => item === trimmed) || existingItems.find((item) => item.toLowerCase() === trimmed.toLowerCase()) || "";
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

function updateRoomPicker() {
  const wing = getWriteWing();
  fillPicker(els.writeRoomPicker, roomsForWing(wing), "Choose room");
}

function renderWritePickers(preferredWing = "", preferredRoom = "") {
  fillPicker(els.writeWingPicker, existingWings(), "Choose wing");
  els.writeWing.value = preferredWing;
  updateRoomPicker();
  els.writeRoom.value = preferredRoom;
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
      body: `Only this memory will be deleted: ${drawer.title} in ${drawer.wing}/${drawer.room}.`,
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
      title: `Delete room ${wing}/${room}?`,
      body: `${count} memor${count === 1 ? "y" : "ies"} will be permanently deleted.`,
      warning: "Snapshots are kept in Trash for recovery.",
      count,
    };
  }
  if (scope === "wing") {
    const wing = button.dataset.wing;
    const count = drawersInWing(wing).length;
    return {
      payload: { scope, wing },
      title: `Delete wing ${wing}?`,
      body: `${count} memor${count === 1 ? "y" : "ies"} across all rooms will be permanently deleted.`,
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

function validatePasswordMatch() {
  const pw = els.settingsPassword.value;
  const confirmPw = els.settingsPasswordConfirm.value;
  const bothTouched = pw.length > 0 && confirmPw.length > 0;
  const mismatch = bothTouched && pw !== confirmPw;
  els.settingsMatchError.classList.toggle("hidden", !mismatch);
  els.settingsPasswordConfirm.classList.toggle("invalid-mismatch", mismatch);
  els.saveSettings.disabled = mismatch;
  return !mismatch;
}

async function openSettingsSheet() {
  setSettingsStatus("");
  els.settingsPassword.value = "";
  els.settingsPasswordConfirm.value = "";
  els.settingsCurrentPassword.value = "";
  els.settingsUsername.value = "";
  setCurrentPasswordRequired(false);
  validatePasswordMatch();
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
  const password = els.settingsPassword.value;
  const confirmPw = els.settingsPasswordConfirm.value;
  if (password.length < 8) {
    setSettingsStatus("Password must be at least 8 characters.", "error");
    return;
  }
  if (!validatePasswordMatch() || password !== confirmPw) {
    setSettingsStatus("New password and confirmation do not match.", "error");
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
if (els.settingsForm) els.settingsForm.addEventListener("submit", saveSettings);
if (els.settingsPassword) els.settingsPassword.addEventListener("input", validatePasswordMatch);
if (els.settingsPasswordConfirm) els.settingsPasswordConfirm.addEventListener("input", validatePasswordMatch);

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
    [els.writeSheet, els.editSheet, els.deleteSheet, els.draftsSheet, els.trashSheet, els.factSheet, els.settingsSheet]
      .forEach((sheet) => sheet && sheet.classList.add("hidden"));
    closeMenus();
    return;
  }
  if (!isMod && event.key.toLowerCase() === "r" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
    loadPalace().catch((err) => {
    if (err.message !== "Authentication required.") alert(`Refresh failed: ${err.message}`);
  });
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
els.writeWing.addEventListener("input", updateRoomPicker);
els.writeWing.addEventListener("blur", () => {
  els.writeWing.value = getWriteWing();
  updateRoomPicker();
});
els.writeRoom.addEventListener("blur", () => {
  els.writeRoom.value = getWriteRoom();
});
els.writeWingPicker.addEventListener("change", () => {
  if (!els.writeWingPicker.value) return;
  els.writeWing.value = els.writeWingPicker.value;
  els.writeRoom.value = "";
  updateRoomPicker();
  els.writeWing.focus();
});
els.writeRoomPicker.addEventListener("change", () => {
  if (!els.writeRoomPicker.value) return;
  els.writeRoom.value = els.writeRoomPicker.value;
  els.writeRoom.focus();
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
