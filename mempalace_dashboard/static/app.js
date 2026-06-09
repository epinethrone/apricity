// ---------- animation suppression ----------
// Set the no-anim class IMMEDIATELY so transitions don't fire while
// initial state is being restored (hash → applyHash → render). The
// boot() async tail removes it after the first paint. Without this,
// refreshing on a maximized memory replayed the maximize animation
// even though the state was already in place.
document.documentElement.classList.add("apricity-no-anim");

// Prime the content-grid layout class from the URL hash BEFORE the
// first paint, so the panel skeleton already shows the CORRECT number
// of panels that the restored state will use — instead of always
// painting the static 2-pane default (.detail-hidden) and then
// snapping to a 3-pane / maximized layout once boot renders.
//
// The static HTML hardcodes `.content-grid.detail-hidden` (2-pane:
// Wings + Memories, detail collapsed). That's only correct when NO
// memory is open. When the hash restores an open memory:
//   • normal view (d=…)        → wants the 3-pane layout (detail
//     panel present as a third column) → remove `detail-hidden`
//   • maximized view (d=… & e=1) → wants the single big detail panel
//     → remove `detail-hidden`, add `detail-enlarged`
// Setting the right class here means the empty panel FRAMES paint in
// the final arrangement immediately; render() then just fills them
// with content — no pane-count pop, and no blank gate hiding
// everything. The `.page-loading` visibility gate is left OFF for all
// cases now (the layout is already correct pre-render, so there's
// nothing to hide); `.apricity-no-anim` still suppresses any
// transition during the restore. The hash is readable synchronously
// at parse time. Runs on DOMContentLoaded if the grid isn't in the
// DOM yet (scripts are deferred, so the DOM is parsed — but guard
// anyway).
(function primeGridLayoutFromHash() {
  // Prime the resizable-pane widths on :root SYNCHRONOUSLY, before the
  // first paint. The search box width is `calc(var(--drawers-w, 480px)
  // + 60px)` — if --drawers-w isn't set on :root yet, the search paints
  // at the 480px FALLBACK, then initResizers() (later in this deferred
  // script) sets the real stored width and the box visibly jumps/shifts.
  // Setting the var here from the same localStorage keys means the first
  // paint already uses the correct width — no snap. initResizers'
  // applyStoredPaneWidths() then just re-sets the same value (no-op).
  try {
    const paneVars = { "--rooms-w": [200, 600, 300], "--drawers-w": [280, 900, 480] };
    for (const cssVar of Object.keys(paneVars)) {
      const [min, max, dflt] = paneVars[cssVar];
      let px = dflt;
      const raw = localStorage.getItem("mempalace-pane" + cssVar);
      const n = raw == null ? NaN : parseInt(raw, 10);
      if (Number.isFinite(n)) px = Math.min(max, Math.max(min, n));
      document.documentElement.style.setProperty(cssVar, px + "px");
    }
  } catch { /* storage blocked → CSS calc() fallbacks (480px etc.) apply */ }

  const apply = () => {
    try {
      const h = (window.location.hash || "").replace(/^#/, "");
      const hasOpenMemory = /(^|&)d=[^&]/.test(h);
      const isEnlarged = hasOpenMemory && /(^|&)e=1(&|$)/.test(h);
      const grid = document.querySelector(".content-grid");
      // Always lift the visibility gate — the layout is primed below
      // so the skeleton frames are already in the right place.
      document.documentElement.classList.remove("page-loading");
      // Reveal the Tools (labBtn) button pre-paint IFF the show-tools
      // preference is on. The button is `hidden` by default in static
      // HTML so it never FLASHES visible before JS reads the pref —
      // we only un-hide it here when the user opted in. (Mirrors the
      // applyShowTools() logic that keeps it in sync after boot.)
      try {
        const labBtn = document.querySelector("#labBtn");
        if (labBtn && localStorage.getItem("apricity-show-tools") === "1") {
          labBtn.hidden = false;
        }
      } catch { /* storage blocked → stays hidden, which is the default */ }
      if (!grid) return;
      if (hasOpenMemory) {
        grid.classList.remove("detail-hidden");
        grid.classList.toggle("detail-enlarged", isEnlarged);
        grid.classList.add("detail-kind-drawer");
        // Un-hide #detail so its static skeleton meta strip (the grey
        // band) is visible from first paint on a memory-open reload —
        // otherwise the panel is empty until the boot render injects
        // content, and the grey band "pops" in. The skeleton's blank
        // values are replaced wholesale by the live render; the band
        // itself never disappears, so there's no flicker. Stamp the
        // detail-kind so the panel chrome (floating buttons etc.) is
        // styled correctly pre-render too.
        const detailEl = document.querySelector("#detail");
        if (detailEl) {
          detailEl.classList.remove("hidden");
          detailEl.dataset.detailKind = "drawer";
        }
      }
      // No memory → leave the static `detail-hidden` default as-is, and
      // strip the skeleton meta band so the empty/browse state doesn't
      // show a stray grey strip behind the (hidden) detail panel.
      else {
        const detailEl = document.querySelector("#detail");
        if (detailEl && detailEl.classList.contains("detail-skeleton")) {
          detailEl.innerHTML = "";
          detailEl.classList.remove("detail-skeleton");
        }
      }
    } catch {
      // On any error, ensure the gate is off so we never trap the
      // page blank; boot()'s tail also clears it regardless.
      document.documentElement.classList.remove("page-loading");
    }
  };
  if (document.querySelector(".content-grid")) {
    apply();
  } else {
    document.addEventListener("DOMContentLoaded", apply, { once: true });
  }
})();

/** Schedule removal of the no-anim class after the browser paints.
 * Two RAFs because the first only commits style changes; the second
 * runs after layout/paint, by which point any state-restoration
 * class toggles have settled. Helper exposed so other code (e.g.
 * the reduce-motion toggle) can wrap its own class flips in a
 * brief animation-suppression bubble too. */
function suppressAnimationsBriefly() {
  document.documentElement.classList.add("apricity-no-anim");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("apricity-no-anim");
    });
  });
}

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
  // In-memory queue of edit saves that failed AFTER the user already
  // saw the optimistic in-UI change land. The notification bell
  // surfaces each entry as a red error item so the user can see
  // exactly which save the server rejected. Cleared on Mark-all-as-
  // seen + automatically when the user re-edits and successfully
  // saves the affected drawer. Entries are not persisted across
  // reload — on refresh the user sees the actual server-side state
  // (the save genuinely didn't go through, so there's nothing to
  // remember beyond the live session).
  failedSaves: [],
  // Tracks the previous render's notification count (failures +
  // updates) so renderNotifications can detect a count-INCREASE event
  // and trigger the synthesized notification sound. Sentinel -1 means
  // "no baseline yet" — the first render captures the count without
  // playing a sound. _lastNotifSoundAt debounces within 500ms.
  _lastNotifCount: -1,
  _lastFailureCount: 0,
  _lastNotifSoundAt: 0,
  // Last /api/palace version token applied to state.palace. Background
  // notification polls compare against /api/palace-version and only fetch
  // the full palace payload when one of its source files changed.
  _palaceVersion: "",
  // Shared seen-state map — notification item id → ISO seen-at timestamp.
  // Drawer notifications use their drawer_id directly; fact lifecycle
  // notifications use fact:<fact_id>:added / fact:<fact_id>:ended.
  // Populated from /api/palace.seen on every poll so notification-
  // dismissal syncs across every LAN client. Local mutations via
  // markDrawerSeen / markDrawersSeen update this immediately + fire
  // a /api/seen POST in the background.
  _seenMap: {},
  // One-shot flag: while true, applyDetailTransition() skips the
  // slide/fade. Set during boot so the cache-paint + live-fetch
  // double-render doesn't replay the detail meta-strip cross-fade
  // (the grey-banner "flicker" on cached reload). Cleared right after
  // the live render lands, so genuine card→card navigation still
  // animates.
  _suppressDetailTransition: false,
  applyingHash: false,
  factEditing: null,
  editingDraft: null,
  // Tunnels: loaded lazily in parallel to the palace. Renderers read from
  // tunnelsByRoomKey (key = `wing|room`) to decorate room nav items with a
  // tunnel-glyph indicator and to drive the right-pane inspector — when
  // the selected room has at least one tunnel and no drawer is selected,
  // renderDetail dispatches to the tunnel view instead of the empty state.
  tunnels: [],
  tunnelsByRoomKey: new Map(),
  tunnelsLoaded: false,
  // In-pane navigation stack for the detail panel. When set, renderDetail
  // displays this drawer in-place and shows a "← Back" button that pops
  // back to whatever was showing before (typically a tunnel inspector).
  // Lets the user follow an endpoint into a memory and return without
  // disturbing wing/room selection in the other panes.
  detailOverride: null,        // null | { drawerId, originTunnelId }
  detailDirection: null,       // null | "forward" | "backward" — drives the iOS-style slide
  // Wikilink / cross-memory navigation stack. Each entry snapshots the
  // FULL detail-relevant selection (wing, room, drawerId, override,
  // enlarged-state, scroll position) of the drawer the user was looking
  // at BEFORE following an in-content link to another memory. When the
  // user hits the back button at the top of the followed-into memory we
  // pop the top entry and restore everything in one shot, which slides
  // them back to where they came from — including a tunnel-pushed peek
  // (override) if that's where they started from. Supports arbitrary
  // depth: A → B (via link) → C (via link) → back → back → A. Cleared
  // on any navigation that isn't a wikilink follow (card click,
  // notification click, hash deep-link, tunnel "Open memory"), so the
  // stack only ever represents an unbroken chain of in-content link
  // follows starting from the current selection. */
  drawerNavStack: [],
  // One-shot scroll-restoration request, set by the back-button click
  // handler and consumed by the next renderDrawerDetail render. Restores
  // the scrollTop captured when the entry was pushed so popping back
  // lands the user exactly where they left off reading.
  _restoreDetailScroll: null,  // null | number
  // Set true when the user explicitly hits the close X on the detail
  // pane. Suppresses the auto-tunnel dispatch in renderDetail so the
  // panel stays collapsed even when the selected room has tunnels.
  // Reset on any wing/room/drawer click so navigating to anything else
  // re-arms the auto-show.
  detailDismissed: false,
  // Set true when the user clicks the maximize button on the detail
  // panel. updateGridLayout reads this and toggles
  // .content-grid.detail-enlarged, which slides rooms+drawers off to
  // the left and lets detail claim the full content row. Reset to
  // false whenever the detail panel collapses (no point being
  // "enlarged" with nothing to show).
  detailEnlarged: false,
  // Set true when the user clicks the maximize button on the Memories
  // panel (Browse mode). updateGridLayout reads this and toggles
  // .content-grid.drawers-enlarged, which slides Rooms off to the
  // left, lets Memories claim the full content row, and switches the
  // drawer-list to a 4-column grid for high-density scanning.
  // Mutually exclusive with detailEnlarged AND with detail being
  // non-empty: opening any memory forces drawersEnlarged = false in
  // the drawer-card click handler, and entering browse forces
  // detailEnlarged = false in the maximize button handler.
  drawersEnlarged: false,
  // Inline visual editor — set true when the user has clicked the
  // pencil button on the detail panel. While true, the detail body
  // renders editable inputs (title + wing/room + content textarea)
  // instead of the static markdown render, and the edit/delete
  // buttons morph into save/cancel via the .content-grid.detail-
  // editing class. editBuffer holds in-progress edits so renders
  // triggered by unrelated state changes don't blow them away.
  isEditing: false,
  editBuffer: null,        // null | { drawerId, etag, title, content, wing, room }
  editError: "",           // surfaced inline below the editor on save failure
  // Tracks which "kind" of view the detail pane LAST rendered. Compared
  // against the new render's kind to decide animation scope (layout
  // switch → whole-panel slide; same-kind update → values-only slide).
  previousDetailKind: null,    // null | "drawer" | "tunnel" | "empty"
  // The full data object behind the last drawer/tunnel detail render.
  // Used for per-cell diffs so unchanged values (e.g., Added by often
  // stays "claude-code"; Wing always matches the selected wing) don't
  // animate. Reset to null when the detail switches to a different
  // kind so the next same-kind render treats all values as new.
  previousDrawerData: null,
  previousTunnelData: null,
  // Direction of the Rooms-panel drill-down slide. Set by the
  // wing-row / back-button click handlers and consumed once by
  // applyRoomsPanelTransition() after the next render that changes
  // the panel's view kind. Mirrors the existing state.detailDirection
  // pattern used by the tunnel inspector / drawer push-pop.
  roomsPanelDirection: null,   // null | "forward" | "backward"
};

const AUTH_STORAGE_KEY = "mempalace-auth-token";
const THEME_STORAGE_KEY = "mempalace-theme";

// ---------- dom refs ----------
const els = {
  wingNav: document.querySelector("#wingNav"),
  statsInfo: document.querySelector("#statsInfo"),
  drawerList: document.querySelector("#drawerList"),
  drawerCount: document.querySelector("#drawerCount"),
  roomNav: document.querySelector("#roomNav"),
  roomCount: document.querySelector("#roomCount"),
  roomNavTitle: document.querySelector("#roomNavTitle"),
  detail: document.querySelector("#detail"),
  facts: document.querySelector("#facts"),
  factsGraph: document.querySelector("#factsGraph"),
  factsViewList: document.querySelector("#factsViewList"),
  factsViewGraph: document.querySelector("#factsViewGraph"),
  factStats: document.querySelector("#factStats"),
  footerInfo: document.querySelector("#footerInfo"),
  factCount: document.querySelector("#factCount"),
  searchInput: document.querySelector("#searchInput"),
  searchHint: document.querySelector("#searchHint"),
  sortSelect: document.querySelector("#sortSelect"),
  draftsBtn: document.querySelector("#draftsBtn"),
  draftsBadge: document.querySelector("#draftsBadge"),
  mobileLabAction: document.querySelector("#mobileLabAction"),
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

// ---------- resizable panes ----------
// Two drag handles in .content-grid: rooms/drawers and drawers/detail.
// Each handle controls one CSS custom property on :root. Widths are
// clamped to bounds and persisted in localStorage so resizes survive
// reloads. Double-click resets to default. Keyboard: arrow keys nudge
// ±16px (±64px with Shift). (The third handle that used to sit
// between the left sidebar and main was removed when the sidebar was
// dissolved — brand moved into the top bar, wings became a horizontal
// pill row, settings became a floating fab.)
const PANE_DEFAULTS = {
  "--rooms-w": 300,
  "--drawers-w": 480,
};

const PANE_BOUNDS = {
  "--rooms-w":   { min: 200, max: 600 },
  "--drawers-w": { min: 280, max: 900 },
};

function paneStorageKey(cssVar) { return `mempalace-pane${cssVar}`; }

function readStoredPaneWidth(cssVar) {
  try {
    const raw = localStorage.getItem(paneStorageKey(cssVar));
    if (raw == null) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

function applyPaneWidth(cssVar, px) {
  const b = PANE_BOUNDS[cssVar];
  const clamped = Math.min(b.max, Math.max(b.min, Math.round(px)));
  document.documentElement.style.setProperty(cssVar, clamped + "px");
  try { localStorage.setItem(paneStorageKey(cssVar), String(clamped)); } catch {}
  return clamped;
}

function applyStoredPaneWidths() {
  for (const cssVar of Object.keys(PANE_DEFAULTS)) {
    const stored = readStoredPaneWidth(cssVar);
    const px = stored != null ? stored : PANE_DEFAULTS[cssVar];
    const b = PANE_BOUNDS[cssVar];
    const clamped = Math.min(b.max, Math.max(b.min, px));
    document.documentElement.style.setProperty(cssVar, clamped + "px");
  }
}

function makeResizer(cssVar) {
  const el = document.createElement("div");
  el.className = "col-resizer";
  el.setAttribute("role", "separator");
  el.setAttribute("aria-orientation", "vertical");
  el.setAttribute("tabindex", "0");
  el.dataset.cssVar = cssVar;
  el.title = "Drag to resize · double-click to reset";

  function getCurrentPx() {
    const computed = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    const n = parseFloat(computed);
    return Number.isFinite(n) ? n : PANE_DEFAULTS[cssVar];
  }

  function beginDrag(startX) {
    const startWidth = getCurrentPx();
    el.classList.add("dragging");
    document.body.classList.add("col-resizing");
    function move(clientX) {
      applyPaneWidth(cssVar, startWidth + (clientX - startX));
    }
    function end() {
      el.classList.remove("dragging");
      document.body.classList.remove("col-resizing");
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", end);
    }
    function onMouseMove(e) { move(e.clientX); }
    function onTouchMove(e) {
      if (!e.touches[0]) return;
      e.preventDefault();
      move(e.touches[0].clientX);
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", end);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
  }

  el.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    beginDrag(e.clientX);
  });
  el.addEventListener("touchstart", (e) => {
    if (!e.touches[0]) return;
    e.preventDefault();
    beginDrag(e.touches[0].clientX);
  }, { passive: false });

  el.addEventListener("dblclick", () => {
    applyPaneWidth(cssVar, PANE_DEFAULTS[cssVar]);
  });

  el.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const step = e.shiftKey ? 64 : 16;
    applyPaneWidth(cssVar, getCurrentPx() + (e.key === "ArrowRight" ? step : -step));
  });

  return el;
}

function initResizers() {
  applyStoredPaneWidths();
  // The sidebar/main resizer block was removed when the sidebar was
  // dissolved (brand → top bar, wings → horizontal row, settings →
  // floating fab). Only the two intra-content-grid resizers remain.
  const content = document.querySelector(".content-grid");
  if (content) {
    const panels = Array.from(content.children).filter((c) => !c.classList.contains("col-resizer"));
    const [rooms, drawers, detail] = panels;
    const hasRoomsResizer = rooms && rooms.nextElementSibling && rooms.nextElementSibling.classList.contains("col-resizer");
    const hasDrawersResizer = drawers && drawers.nextElementSibling && drawers.nextElementSibling.classList.contains("col-resizer");
    if (rooms && drawers && !hasRoomsResizer) {
      content.insertBefore(makeResizer("--rooms-w"), drawers);
    }
    if (drawers && detail && !hasDrawersResizer) {
      content.insertBefore(makeResizer("--drawers-w"), detail);
    }
    // Only flip to the resizable grid template if BOTH resizers landed,
    // otherwise the column count won't match the template and the layout
    // will look weird.
    const resizerCount = content.querySelectorAll(":scope > .col-resizer").length;
    if (resizerCount >= 2) content.classList.add("resizable");
  }
}

initResizers();

// .page-loading removal is now deferred to the END of boot() (inside
// releaseAnim) so it covers init AND the async loadPalace render —
// the maximize/enlarged-detail transitions don't fire during state
// restoration. See boot() for the actual removal.

// ---------- helpers ----------
function getAuthToken() {
  try { return localStorage.getItem(AUTH_STORAGE_KEY) || ""; } catch { return ""; }
}

// setAuthToken removed 2026-05-28 — was a paired writer to getAuthToken
// but had no live call sites. Auth-token storage is now handled by the
// /api/auth/login response path, which writes localStorage directly via
// a small inline block in the login handler (search for AUTH_STORAGE_KEY
// to find it). Re-introduce a centralized setter if/when token rotation
// needs a single mutation point.

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
  // NOTE: the top-bar icon is no longer injected here. Both sun + moon
  // SVGs live in static HTML (#themeIcon) and CSS shows the one matching
  // the resolved theme off :root[data-theme] (+ @media for auto). Setting
  // data-theme above (or leaving it off for auto) is all that's needed —
  // the icon updates purely via CSS, with no innerHTML pop-in on reload.
  // `t` (effectiveTheme) is still computed above for any callers that
  // read it; intentionally unused for the icon now.
  void t;
  if (els.themeToggle) {
    const modeLabel = stored === "light" ? "Light" : stored === "dark" ? "Dark" : "Auto";
    els.themeToggle.setAttribute("title", `Theme: ${modeLabel}`);
    els.themeToggle.setAttribute("aria-label", `Theme: ${modeLabel}`);
  }
  // Mark the active option inside the theme dropdown so it shows a check.
  const activeMode = stored === "light" || stored === "dark" ? stored : "auto";
  document.querySelectorAll("[data-theme-option]").forEach((opt) => {
    opt.classList.toggle("is-active", opt.dataset.themeOption === activeMode);
  });
}

/**
 * Set the theme mode. "auto" follows the system; "light"/"dark" override.
 * "auto" is the default for a fresh install (no value in localStorage),
 * so calling setThemeMode("auto") clears the storage key.
 *
 * Note: the earlier global cross-fade (.theme-transitioning class
 * forcing transitions on every element) was removed — it was visibly
 * laggy. The theme swap snaps instantly now; the dropdown's cascade
 * and click spring carry the action feedback.
 */
function setThemeMode(mode) {
  try {
    if (mode === "auto") localStorage.removeItem(THEME_STORAGE_KEY);
    else if (mode === "light" || mode === "dark") localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {}
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
  // Polish OFF → render the stored slug verbatim. The String coerce
  // and trim above stay (those are sanity, not cosmetic) — but the
  // word splitting, capitalization, and acronym uppercasing all sit
  // behind the polish_text preference.
  if (!getPolishText()) return raw;
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

/**
 * Display-only prettifier for actor names (the `added_by` author
 * field on drawers). Normalises any input to "Word Word" — first
 * letter of each whitespace-separated token uppercased, rest
 * lowercased. Examples: "zhiar" → "Zhiar", "ZHIAR" → "Zhiar",
 * "Claude" → "Claude" (no change). The raw value is left alone in
 * storage / tooltip / copy paths; only the rendered label here gets
 * normalised so author cells read consistently regardless of how a
 * given client typed the username originally.
 */
function prettifyActorName(value) {
  const raw = String(value ?? "").trim();
  // Polish OFF → render the stored name verbatim. "ZHIAR" stays
  // ZHIAR, "zhiar" stays zhiar — author cells reflect exactly what
  // each client wrote into added_by. Whitespace collapse stays
  // intact (the trim above) since that's sanity, not cosmetic.
  if (!getPolishText()) return raw;
  return raw
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .filter(Boolean)
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

// Classic "Copied" pill toast that floats above the click and auto-
// dismisses. Uses DOCUMENT coordinates (event.pageX/pageY) with
// position:absolute on body so the toast becomes part of the document
// layout — it scales and scrolls with the document under pinch-zoom,
// keeping it anchored to the touched point. (The previous
// clientX/Y + position:fixed approach was anchored to the layout
// viewport, which pushes off-screen when the visual viewport zooms in.)
// Falls back to the element's bounding rect for non-mouse triggers.
// `error=true` swaps to the danger color.
function showCopiedToast(anchorEl, message = "Copied", error = false, event = null) {
  const toast = document.createElement("div");
  toast.className = "copied-toast" + (error ? " copied-toast-error" : "");
  toast.textContent = message;
  document.body.appendChild(toast);
  let x;
  let y;
  if (event && Number.isFinite(event.pageX) && Number.isFinite(event.pageY) && (event.pageX || event.pageY)) {
    x = event.pageX;
    y = event.pageY;
  } else if (anchorEl) {
    // No click event (programmatic / keyboard) — fall back to the
    // element's rect plus the document scroll offset to convert
    // viewport coords to document coords.
    const rect = anchorEl.getBoundingClientRect();
    x = rect.left + rect.width / 2 + window.scrollX;
    y = rect.top + window.scrollY;
  } else {
    x = window.innerWidth / 2 + window.scrollX;
    y = window.innerHeight / 2 + window.scrollY;
  }
  toast.style.left = `${x}px`;
  toast.style.top = `${y - 6}px`;
  // Force layout so the entry transition actually runs.
  // eslint-disable-next-line no-unused-expressions
  void toast.offsetWidth;
  toast.classList.add("copied-toast-visible");
  window.setTimeout(() => {
    toast.classList.remove("copied-toast-visible");
    toast.classList.add("copied-toast-dismissing");
    window.setTimeout(() => toast.remove(), 240);
  }, 1100);
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
// Inline markdown formatting for an already-HTML-escaped string.
// Handles: `code`, **bold**, *italic*, _italic_, [text](url) links,
// and bare-URL autolinks. Operates on the output of escapeHtml (which
// already turned <, >, &, ", ' into entities — backticks, asterisks,
// brackets, parens, underscores all survive escaping and are what we
// match here).
//
// The stash pattern prevents inner content from being double-
// processed: once a token (code chunk / link) is turned into HTML,
// it's swapped for a placeholder so subsequent passes see only the
// remaining markdown text. Without this, a URL inside a markdown link
// or backticked code would get auto-linked again and produce nested
// <a><a>...</a></a>.
function inlineFormat(escapedText) {
  let text = String(escapedText);
  const stash = [];
  const stashIt = (html) => {
    const idx = stash.length;
    stash.push(html);
    return ` P${idx} `;
  };
  // Inline code first — its content is treated literally, so stashing
  // protects link-like or bold-like content inside backticks.
  text = text.replace(/`([^`]+?)`/g, (_, code) =>
    stashIt(`<code class="inline-code">${code}</code>`),
  );
  // Bold / italic. Italic regex uses look-arounds to avoid matching
  // intra-word asterisks/underscores (e.g. `snake_case` should NOT
  // become italic). Bold runs before italic so `**x**` doesn't get
  // mistakenly chunked as two italic `*x*` matches.
  text = text.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(?<![*\w])\*([^*\n]+?)\*(?![\w*])/g, "<em>$1</em>");
  text = text.replace(/(?<![_\w])_([^_\n]+?)_(?![\w_])/g, "<em>$1</em>");
  // Markdown links [text](url) — stashed so the URL inside the href
  // isn't re-matched by the bare-URL autolinker below.
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) =>
    stashIt(`<a href="${url}" target="_blank" rel="noopener">${label}</a>`),
  );
  // Bare-URL autolink. Trailing punctuation (period, comma, paren,
  // etc.) is excluded so it doesn't become part of the link.
  // Lookbehind avoids matching URLs already inside an href attribute,
  // a link's text content, or a wiki-link bracket.
  text = text.replace(
    /(?<![=">(\[\w ])(https?:\/\/[^\s<>"`) ]+[^\s<>"`.,;:!?)\] ])/g,
    (url) => stashIt(`<a href="${url}" target="_blank" rel="noopener">${url}</a>`),
  );
  // Restore stashed HTML.
  return text.replace(/ P(\d+) /g, (_, idx) => stash[+idx]);
}

// Render a fenced code block + its sibling copy button, wrapped in a
// position:relative div so the button stays pinned to the visible
// top-right corner even when the <pre> is horizontally scrolled.
// (If the button lived inside the <pre>, it'd scroll with the code
// content out of view.) `lines` is the buffered code body (each line
// already HTML-escaped by markdownLite's upfront escapeHtml pass);
// `lang` is the optional language hint from the opening ```fence.
// The button carries no data-* duplicate of the code — the click
// handler in renderDrawerDetail reads textContent from the sibling
// <code> at click time.
function renderCodeBlock(lines, lang) {
  const langAttr = lang ? ` data-lang="${lang}"` : "";
  const body = lines.join("\n");
  const copyBtn =
    `<button class="code-copy-btn" type="button" aria-label="Copy code" title="Copy code">` +
    `<svg viewBox="0 0 24 24" class="code-copy-icon-copy" aria-hidden="true">` +
    `<rect x="8" y="8" width="11" height="13" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/>` +
    `<path d="M16 8V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>` +
    `</svg>` +
    `<svg viewBox="0 0 24 24" class="code-copy-icon-done" aria-hidden="true">` +
    `<path d="m5 12.5 4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>` +
    `</button>`;
  return `<div class="code-block-wrap"><pre class="code-block"${langAttr}><code>${body}</code></pre>${copyBtn}</div>`;
}

// Parse a single pipe-row into cells. Strips the leading and trailing
// pipes so an outer-pipe table syntax doesn't produce phantom empty
// cells at each end.
function parseTableRow(line) {
  return line.trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

// Markdown table separator row, e.g. `| --- | --- |` (with optional
// `:` colons for alignment, which we don't currently use).
const TABLE_SEPARATOR_RE = /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/;

// Flush a buffered run of pipe-lines. If line 2 is a separator, treat
// the buffer as a real markdown table; otherwise emit each line as a
// regular paragraph (preserves pipe-containing prose that wasn't meant
// to be tabular).
function renderTableOrParagraphs(rows) {
  if (rows.length >= 2 && TABLE_SEPARATOR_RE.test(rows[1])) {
    const header = parseTableRow(rows[0]);
    const body = rows.slice(2).map(parseTableRow);
    let html = `<table class="md-table"><thead><tr>`;
    for (const cell of header) html += `<th>${inlineFormat(cell)}</th>`;
    html += `</tr></thead>`;
    if (body.length) {
      html += `<tbody>`;
      for (const row of body) {
        html += `<tr>`;
        for (const cell of row) html += `<td>${inlineFormat(cell)}</td>`;
        html += `</tr>`;
      }
      html += `</tbody>`;
    }
    html += `</table>`;
    return html;
  }
  return rows.map((l) => `<p>${inlineFormat(l)}</p>`).join("");
}

// Flush a buffered blockquote run as a single <blockquote>. Detects
// GitHub-style admonitions (`> [!NOTE]`, `> [!WARNING]`, etc) on the
// first line and tags the element so CSS can theme it (color + label).
// Recognised types: NOTE, TIP, IMPORTANT, WARNING, CAUTION. Unknown
// types fall back to a plain blockquote.
const CALLOUT_TYPES = new Set(["note", "tip", "important", "warning", "caution"]);
function renderBlockquote(quotedLines) {
  if (!quotedLines.length) return "";
  let kind = "";
  let bodyLines = quotedLines;
  const head = quotedLines[0].match(/^\[!([A-Za-z]+)\]\s*$/);
  if (head) {
    const t = head[1].toLowerCase();
    if (CALLOUT_TYPES.has(t)) {
      kind = t;
      bodyLines = quotedLines.slice(1);
    }
  }
  const inner = bodyLines.map((l) => l.trim()
    ? `<p>${inlineFormat(l)}</p>`
    : `<div class="space"></div>`).join("");
  const cls = kind ? `callout callout-${kind}` : "";
  // contenteditable=false locks the label against typing inside the
  // editor — the type tag is the callout's identity, not user prose.
  // In view-mode (non-editable parent) the attribute is a no-op.
  const label = kind
    ? `<div class="callout-label" contenteditable="false">${kind.toUpperCase()}</div>`
    : "";
  return `<blockquote${cls ? ` class="${cls}"` : ""}>${label}${inner}</blockquote>`;
}

function markdownLite(value) {
  const lines = escapeHtml(value).split("\n");
  const out = [];
  // Two-pass-in-one-loop fence handler: a line of just ``` opens / closes
  // a fenced code block. Inside a fence we don't apply paragraph or
  // header rules — the buffered lines emit as one <pre><code> at close.
  // Same pattern for `>` blockquote runs and for `- ` / `\d+. ` list
  // runs: collect consecutive list lines, flush as a single <ul> /
  // <ol> when the run ends so browsers render real bullet/number
  // markers (and screen readers see actual lists).
  let inFence = false;
  let fenceLang = "";
  let fenceBuffer = [];
  let quoteBuffer = [];
  let listType = null;     // "ul" | "ol" | null
  let listBuffer = [];
  let pipeBuffer = [];     // consecutive `|...|` lines, candidate table
  const flushQuote = () => {
    if (quoteBuffer.length) {
      out.push(renderBlockquote(quoteBuffer));
      quoteBuffer = [];
    }
  };
  const flushList = () => {
    if (listBuffer.length) {
      const items = listBuffer.map((l) => `<li>${inlineFormat(l)}</li>`).join("");
      out.push(`<${listType}>${items}</${listType}>`);
      listBuffer = [];
      listType = null;
    }
  };
  const flushPipe = () => {
    if (pipeBuffer.length) {
      out.push(renderTableOrParagraphs(pipeBuffer));
      pipeBuffer = [];
    }
  };
  for (const line of lines) {
    if (inFence) {
      if (/^```\s*$/.test(line)) {
        out.push(renderCodeBlock(fenceBuffer, fenceLang));
        inFence = false;
        fenceLang = "";
        fenceBuffer = [];
      } else {
        fenceBuffer.push(line);
      }
      continue;
    }
    const fenceOpen = line.match(/^```\s*([\w+\-]*)\s*$/);
    if (fenceOpen) {
      flushQuote();
      flushList();
      flushPipe();
      inFence = true;
      fenceLang = fenceOpen[1] || "";
      fenceBuffer = [];
      continue;
    }
    // Blockquote line: `>` followed by optional space and content.
    // A bare `>` (no content) is a continuation that emits a blank line
    // inside the quote, supporting multi-paragraph callouts. NB: we
    // match `&gt;` here (not `>`) because markdownLite runs escapeHtml
    // on the whole input upfront, so the raw `>` from the user's source
    // has already become `&gt;` by the time we line-scan. (The other
    // line markers — `#`, `-`, spaces — aren't touched by escapeHtml,
    // so they continue to match their literal forms.)
    const quoteMatch = line.match(/^&gt;\s?(.*)$/);
    if (quoteMatch) {
      flushList();
      flushPipe();
      // A `[!TYPE]` admonition head starts a NEW callout. Without this,
      // two adjacent admonitions (no blank line between them — required
      // by the tight-source convention) collapse into one blockquote
      // and the second `[!TYPE]` renders as literal body text. Flushing
      // the current run when a head appears mid-run gives each its box.
      const content = quoteMatch[1];
      if (quoteBuffer.length
          && /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i.test(content)) {
        flushQuote();
      }
      quoteBuffer.push(content);
      continue;
    }
    flushQuote();
    // Pipe-row line (potential markdown table): collect consecutive
    // `|...|` lines into a buffer. We can't decide if it's a real
    // table until we hit a non-pipe line — only then do we check if
    // row 2 is a `| --- |` separator. The flush function (renderTable
    // OrParagraphs) does the right thing either way: real table →
    // <table>, otherwise → <p> for each row.
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushList();
      pipeBuffer.push(line);
      continue;
    }
    flushPipe();
    // Unordered-list line (`- item`): start a <ul> run or extend the
    // current one. Switching from <ol> to <ul> mid-stream flushes the
    // previous list first.
    if (line.startsWith("- ")) {
      if (listType !== "ul") {
        flushList();
        listType = "ul";
      }
      listBuffer.push(line.slice(2));
      continue;
    }
    // Ordered-list line (`1. item`, `2. item`, …): start an <ol> run or
    // extend the current one. We discard the source number and let CSS
    // counter render the list as 1., 2., 3., … in order — matches
    // standard markdown behaviour where `1. 1. 1.` still renders 1/2/3.
    const numMatch = line.match(/^\d+\.\s+(.*)$/);
    if (numMatch) {
      if (listType !== "ol") {
        flushList();
        listType = "ol";
      }
      listBuffer.push(numMatch[1]);
      continue;
    }
    flushList();
    // Horizontal rule: a line of just three or more dashes, underscores,
    // or asterisks, optionally surrounded by whitespace.
    if (/^\s*(?:---+|___+|\*\*\*+)\s*$/.test(line)) {
      out.push(`<hr class="markdown-hr" />`);
      continue;
    }
    // H1 in the body is the drawer title (per the MemPalace convention
    // that every drawer begins with `# Title`). Pass it through
    // cleanTitle so the rendered heading matches the cleaned title we
    // show on the card kicker (Title Case, no trailing date, no
    // underscores) — keeps card → detail navigation visually
    // continuous. Sub-headers (##, ###) are authored prose and stay
    // exactly as written.
    if (line.startsWith("# ")) out.push(`<h1>${inlineFormat(cleanTitle(line.slice(2)))}</h1>`);
    else if (line.startsWith("## ")) out.push(`<h2>${inlineFormat(line.slice(3))}</h2>`);
    else if (line.startsWith("### ")) out.push(`<h3>${inlineFormat(line.slice(4))}</h3>`);
    else if (!line.trim()) out.push(`<div class="space"></div>`);
    else out.push(`<p>${inlineFormat(line)}</p>`);
  }
  flushQuote();
  flushList();
  flushPipe();
  // Unterminated fence at EOF — flush remaining lines as code rather
  // than dropping them.
  if (inFence) {
    out.push(renderCodeBlock(fenceBuffer, fenceLang));
  }
  const html = out.join("");
  // [[name]] / [[anchor|display]] links. Pipe-syntax is the canonical
  // form: `anchor` is the drawer_id we resolve against (stable across
  // renames, title changes, polish_text toggling), `display` is the
  // human-readable label the reader sees. Bare [[name]] is still
  // accepted for backward compatibility with older drawers, but new
  // writes should always use the pipe form so the link survives any
  // title edit. The click handler in renderDrawerDetail mirrors this:
  // it tries drawer_id first (exact), then falls back to title match
  // (also case-insensitive), then to a search-query fallback.
  //
  // `name` was already escaped by the parent escapeHtml pass; do NOT
  // re-escape. The split on "|" happens AFTER escapeHtml ran, but
  // pipes don't get encoded by escapeHtml so the split is safe.
  return html.replace(/\[\[([^\]]+)\]\]/g, (_, raw) => {
    const trimmed = String(raw).trim();
    const pipeIdx = trimmed.indexOf("|");
    const anchor = pipeIdx >= 0 ? trimmed.slice(0, pipeIdx).trim() : trimmed;
    const display = pipeIdx >= 0 ? trimmed.slice(pipeIdx + 1).trim() : trimmed;
    return `<a class="wiki-link" data-link="${anchor}" href="#">${display}</a>`;
  });
}

// ---------- selectors / filters ----------
// Memoization for filteredDrawers — invalidated when ANY input
// changes. Each render call previously triggered 2-4 separate
// filter+sort passes (renderDrawers, renderDrawerWindow's cols
// resolver, syncAdaptiveBrowse's count probe, and the search-input
// listener's stillMatches check). For a 200-drawer palace that's
// ~800 array iterations + 800 sort comparisons per render. Cached,
// the same render hits the array once and the other 3 callers get
// the same reference back in O(1). Cache key incorporates all five
// pure inputs to the function — palace.drawers identity (replaced
// wholesale on every loadPalace, so identity comparison is correct),
// query, selectedWing, selectedRoom, sortBy. Any state mutation
// that touches these auto-invalidates the cache via the key mismatch.
const _filteredDrawersCache = { key: null, value: null };

function filteredDrawers() {
  // Defensive guard: state.palace is only set after loadPalace
  // resolves. Some call sites (the search-input listener, the
  // browseModeProfile probe, future hash-deep-link handlers) can fire
  // during the brief window between page mount and first palace
  // payload. Returning [] there avoids "Cannot read 'drawers' of
  // null" without forcing every caller to add its own guard.
  if (!state.palace || !Array.isArray(state.palace.drawers)) return [];
  // Memoized fast path. The cache key is a compound of the FIVE
  // inputs filteredDrawers reads from state. Drawer-array identity
  // (===) is the right comparator because loadPalace replaces the
  // array wholesale on every refresh; an in-place mutation of the
  // existing array would NOT invalidate, but the codebase never does
  // that — all writes go through the API and re-fetch the palace.
  const cacheKey = `${state.palace.drawers.length}|${state.query}|${state.selectedWing}|${state.selectedRoom}|${state.sortBy}`;
  if (_filteredDrawersCache.key === cacheKey
      && _filteredDrawersCache.palace === state.palace.drawers) {
    return _filteredDrawersCache.value;
  }
  const q = norm(state.query);
  // Search is GLOBAL when a query is typed — once the user is asking
  // "find this thing", wing/room scope is the wrong default (they
  // almost never know which wing they originally filed it in, and
  // restricting to the currently-selected wing produces the
  // "search-returns-nothing-for-known-content" surprise). The wing/
  // room filters still apply for browsing (no query), so the
  // currently-active pill still narrows the visible list while
  // scrolling around.
  let drawers = state.palace.drawers.filter((drawer) => {
    const wingMatch = q || state.selectedWing === "all" || drawer.wing === state.selectedWing;
    const roomMatch = q || state.selectedRoom === "all" || drawer.room === state.selectedRoom;
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
  // Populate the cache so subsequent calls within this render cycle
  // hit the fast path. NOTE: callers must not mutate the returned
  // array — it's shared. The .slice() above gives us a fresh array
  // (separated from state.palace.drawers), so the only mutation
  // concern is between memoized callers. The current callers all
  // treat it as read-only (filter, .some, .length, .map for HTML),
  // so this is safe today.
  _filteredDrawersCache.key = cacheKey;
  _filteredDrawersCache.palace = state.palace.drawers;
  _filteredDrawersCache.value = drawers;
  return drawers;
}

function filteredFacts() {
  const q = norm(state.query);
  // Same global-on-query semantics as filteredDrawers — a search
  // query escapes the wing scope so the user finds the fact
  // regardless of which wing it was sourced from.
  return state.palace.triples.filter((fact) => {
    const queryMatch =
      !q ||
      [fact.subject, fact.predicate, fact.object, fact.source_drawer_id]
        .map(norm)
        .some((value) => value.includes(q));
    const wingMatch =
      q ||
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
  // Persist the enlarged-detail state so refreshing while a memory
  // is maximized restores it to its maximized layout instead of
  // collapsing back to the 3-pane reading view. Only meaningful when
  // a drawer is selected — enlarged-without-drawer is unreachable
  // (renderDetail force-clears the flag when detail is empty).
  if (state.detailEnlarged && state.selectedDrawerId) parts.push("e=1");
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
  // Hash-driven navigation (back/forward, deep-link, share-paste) is a
  // fresh URL-level location, not a follow of any in-content link, so
  // any wikilink nav history accumulated in this tab no longer
  // applies — drop it.
  clearDrawerNavStack();
  state.selectedWing = hash.wing || "all";
  state.selectedRoom = hash.room || "all";
  state.selectedDrawerId = hash.d || null;
  // Restore enlarged detail when ?e=1 is in the hash AND a drawer is
  // actually selected (defensive — enlarged with no drawer would
  // surface as an empty full-screen panel).
  state.detailEnlarged = Boolean(hash.e === "1" && hash.d);
  state.query = hash.q || "";
  state.sortBy = hash.s || "filed-desc";
  if (els.searchInput) els.searchInput.value = state.query;
  if (els.sortSelect) els.sortSelect.value = state.sortBy;
  state.applyingHash = false;
}

// ---------- localStorage JSON primitives ----------
// Every cache below (palace, tunnels, seen-map) is the same shape: JSON
// in / JSON out, wrapped in a try/catch because storage can be disabled,
// full (QuotaExceeded), or private-mode. These two helpers hold that
// boilerplate once; the named caches just add their key + shape check.
// Writes fail silently (caching is a pure optimization); reads return
// `fallback` (default null) on missing/corrupt/parse-error.
function lsWriteJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage disabled / quota / private-mode — skip silently.
  }
}

function lsReadJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// ---------- DOM event wiring ----------
// Collapses the `const x = document.querySelector("#id"); if (x)
// x.addEventListener(event, handler)` guard that recurs ~60× across the
// boot-time control wiring. Looks the element up by id, binds the
// listener only when it exists, and RETURNS the element (or null) so
// callers that reference it (e.g. `el.checked` inside the handler, or
// later setup) keep their reference: `const el = on("id", "change", …)`.
// `opts` passes through to addEventListener (capture / passive / once).
function on(id, event, handler, opts) {
  const el = document.querySelector("#" + id);
  if (el) el.addEventListener(event, handler, opts);
  return el;
}

// ---------- card-list cache invalidation ----------
// Drop the cached virtualized card-list HTML and reset the visible-
// window indices so the next render rebuilds the card slice from
// scratch. Called wherever something the cached markup or the window
// math depends on changes (sort, content edits, date-format / polish
// prefs, etc.). The exact 3-line reset recurred ~9× before this.
function invalidateCardCache() {
  state._virtCardsHtml = null;
  state._lastStartIdx = -1;
  state._lastEndIdx = -1;
}

// ---------- palace localStorage cache ----------
// Persist the last successfully-fetched palace payload so the NEXT page
// load can render memories INSTANTLY from it — before the network fetch
// returns — instead of booting from an empty state and waiting on the
// (parse app.js → fetch → render) chain. This is the "stale-while-
// revalidate" pattern: paint cached immediately, fetch fresh in the
// background, reconcile. The server stays the source of truth — the
// cache is only a head-start for the very first paint after reload.
const PALACE_CACHE_KEY = "apricity-palace-cache-v1";

function writePalaceCache(palace) {
  // Stamp it so a future read can age it out / debug staleness. We do
  // NOT gate reads on the timestamp (the background fetch always wins
  // within ~1ms here), but keeping it is cheap and useful.
  lsWriteJson(PALACE_CACHE_KEY, { ts: Date.now(), palace });
}

function readPalaceCache() {
  const parsed = lsReadJson(PALACE_CACHE_KEY);
  const palace = parsed && parsed.palace;
  // Minimal shape check — a cache from an older schema that lacks
  // drawers would render a broken empty list, so reject it and let
  // the live fetch populate instead.
  return (palace && Array.isArray(palace.drawers)) ? palace : null;
}

// ---------- tunnels localStorage cache ----------
// Same stale-while-revalidate rationale as the palace cache, but for the
// SEPARATE /api/tunnels endpoint. The tunnel indicators — the graph-edge
// watermark in the meta strip and the per-wing / per-room connection
// counts — are driven by tunnel data. Without caching it, the instant boot
// paint (which renders the cached palace before the network resolves) had
// no tunnels, so those icons popped in visibly LATER when the tunnels
// fetch landed. Caching the raw list lets the first paint draw them
// immediately; the live fetch still overwrites + reconciles right after.
const TUNNELS_CACHE_KEY = "apricity-tunnels-cache-v1";

function writeTunnelsCache(items) {
  lsWriteJson(TUNNELS_CACHE_KEY, { ts: Date.now(), items: items || [] });
}

function readTunnelsCache() {
  const parsed = lsReadJson(TUNNELS_CACHE_KEY);
  return (parsed && Array.isArray(parsed.items)) ? parsed.items : null;
}

// ---------- seen-map localStorage cache ----------
// The palace cache above is only rewritten on a full loadPalace fetch.
// But the SEEN map (which drawers have had their "Updated" marker /
// bell notification dismissed) mutates far more often — every mark-seen
// click, every card open. If those mutations only lived in the big
// palace blob, refreshing right after dismissing would repaint the
// STALE seen state from the last full fetch → the "Updated" gradient +
// notification briefly flash back before the live fetch reconciles.
// So the seen map gets its OWN tiny key, written on every mutation, and
// overlaid onto the cached palace at boot-paint time. Cheap (a few KB)
// vs re-serializing the ~470KB palace on every card click.
const SEEN_CACHE_KEY = "apricity-seen-cache-v1";

function writeSeenCache() {
  if (state._seenMap && typeof state._seenMap === "object") {
    lsWriteJson(SEEN_CACHE_KEY, state._seenMap);
  }
}

function readSeenCache() {
  const parsed = lsReadJson(SEEN_CACHE_KEY);
  return (parsed && typeof parsed === "object") ? parsed : null;
}

// ---------- palace load ----------
// `prefetched` (optional): a palace payload already fetched in parallel
// by boot(), so the initial load doesn't pay a serial round-trip here.
// When omitted (poll refreshes) we fetch fresh as before.
async function loadPalace(prefetched) {
  // Kick off the tunnels fetch IN PARALLEL with the palace fetch on
  // first load (they're independent endpoints) so the tunnel-bind
  // chip is ready for the first paint WITHOUT adding a serial
  // round-trip. The earlier "await loadTunnels() after await palace
  // after await drafts" chain made all THREE requests sequential —
  // that was the "everything renders late on refresh" regression.
  // Now palace + tunnels overlap; we await both right before render.
  // (loadTunnels guards its own internal render on state.palace, so
  // whichever resolves first doesn't paint a half-loaded UI.)
  const tunnelsPromise = !state.tunnelsLoaded
    ? loadTunnels().catch(() => {})
    : null;
  state.palace = prefetched || await fetchJson("/api/palace");
  if (state.palace && state.palace.version) {
    state._palaceVersion = String(state.palace.version);
  }
  // Hydrate the LAN-shared seen-state map from the palace response
  // before render so isRecentlyUpdated / bell counts reflect the
  // canonical server view. Any local optimistic writes that haven't
  // POSTed yet will get overwritten — that's the right behavior
  // (server is the source of truth across all LAN clients).
  if (state.palace && state.palace.seen && typeof state.palace.seen === "object") {
    state._seenMap = state.palace.seen;
    // Server seen-state is canonical — refresh the dedicated seen cache
    // so it never lags behind the palace the user just (re)loaded.
    writeSeenCache();
  }
  // Cache the fresh payload to localStorage so the NEXT reload can render
  // memories instantly from it (before the network fetch returns) instead
  // of booting from an empty state. Only cache when we actually fetched
  // (not when rendering FROM the cache via `prefetched`) so we don't
  // round-trip the same bytes back to storage. See writePalaceCache.
  if (!prefetched && state.palace) writePalaceCache(state.palace);
  reconcileSelection();
  // Await the parallel tunnels fetch (already in flight) so the first
  // render has the chip. After tunnels have loaded, routine palace
  // refreshes check them in the background; /api/tunnels is now a cheap
  // mtime-cached file read and loadTunnels bails without rendering when
  // the version is unchanged.
  if (tunnelsPromise) {
    await tunnelsPromise;
  }
  render();
  if (!tunnelsPromise) loadTunnels().catch(() => {});
  // Drafts count + system info are non-critical chrome — fire after
  // the first paint so they never delay it. Each re-renders its own
  // small piece (badge / footer) when it resolves.
  refreshDraftsCount().catch(() => {});
  loadSystemInfo().catch(() => {});
}

async function fetchPalaceVersion() {
  const raw = await fetchJson("/api/palace-version");
  return raw && raw.version ? String(raw.version) : "";
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
  const version = raw && raw.version ? String(raw.version) : "";
  if (state.tunnelsLoaded && version && state._tunnelsVersion === version) {
    return;
  }
  applyTunnelItems(items);
  state._tunnelsVersion = version;
  // Cache the raw list so the NEXT reload's instant cache-paint can draw
  // the tunnel indicators immediately instead of popping them in late.
  writeTunnelsCache(items);
  state.tunnelsLoaded = true;
  // Re-render so tunnel indicators appear once tunnels arrive.
  if (state.palace) render();
}

// Build state.tunnels + the room-key index from a raw tunnel list. Shared
// by loadTunnels (live fetch) and the boot cache-hydration path so both
// produce an identical index from the same input.
function applyTunnelItems(items) {
  state.tunnels = items;
  state.tunnelsByRoomKey = new Map();
  for (const t of items) {
    const s = t.source || {};
    const d = t.target || {};
    const sWing = tunnelWingForm(s.wing);
    const dWing = tunnelWingForm(d.wing);
    const sKey = tunnelRoomKey(s.wing, s.room);
    const dKey = tunnelRoomKey(d.wing, d.room);
    pushMapList(state.tunnelsByRoomKey, sKey, { side: "outgoing", other: { wing: dWing, room: d.room }, tunnel: t });
    pushMapList(state.tunnelsByRoomKey, dKey, { side: "incoming", other: { wing: sWing, room: s.room }, tunnel: t });
  }
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

/** Find every tunnel that has this drawer as either endpoint
 * (drawer-bound source or target). Used by the memory detail's
 * metadata strip to surface a tunnel indicator when the open
 * memory is linked through tunnels. Returns an array (possibly
 * empty) — caller checks .length to decide whether to render
 * the cell. */
function tunnelsForDrawer(drawerId) {
  if (!drawerId || !state.tunnels || !state.tunnels.length) return [];
  return state.tunnels.filter((t) =>
    (t.source && t.source.drawer_id === drawerId)
    || (t.target && t.target.drawer_id === drawerId)
  );
}

// Single source of truth for the link/arrow glyph used by every tunnel
// indicator (room rows + detail-panel header). Mirrors the path data in
// the rooms-toolbar "Connect this room…" action so the two read as the
// same gesture.
// Tunnel glyph: two nodes connected by a vertical line — a literal
// graph edge. Semantically exact: a tunnel IS an edge between two
// rooms in the palace's graph. Replaces the previous curved-arrow
// glyph that was visually identical to the universal "open in new
// tab / external link" icon — too easy to misread as "this opens
// somewhere external" when actually it's an internal symmetric
// connection. Vertical orientation per the user's preference, and
// it reads cleanly at 14–16px display sizes since the dots stay
// visible and the connecting line stays thick enough to anchor
// them as a single unit.
const TUNNEL_GLYPH = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="5" r="2.2" fill="currentColor"/>
    <line x1="12" y1="8.2" x2="12" y2="15.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    <circle cx="12" cy="19" r="2.2" fill="currentColor"/>
  </svg>`;

// Standard X close glyph used everywhere a sheet/panel needs a dismiss
// affordance — replaces the old text-based "Close" buttons across the
// write/edit/drafts/trash/settings/fact/lab sheets and the detail-pane
// close. Two diagonal strokes with rounded caps; same path the rename-
// row cancel button uses so the gesture reads as one consistent symbol.
const CLOSE_X_SVG = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>`;

// Wing-name forms in tunnel-land use underscores; drawer-land uses hyphens
// (see [[MemPalace bug #1621]]). This finds the first drawer in the target
// (wing, room) across either spelling so a navigation jump always lands on
// something concrete instead of an empty room.
function findFirstDrawerInRoom(wing, room) {
  if (!state.palace || !room) return null;
  return state.palace.drawers.find(
    (d) => d.room === room && (!wing || d.wing === wing
      || d.wing.replace(/_/g, "-") === wing
      || d.wing.replace(/-/g, "_") === wing),
  ) || null;
}

// jumpToTunnelOtherEnd removed 2026-05-28 — the legacy tunnel-list
// "tap to jump" affordance was superseded by the tunnel-detail page's
// own click-through, which routes via renderTunnelDetail → drawer
// selection directly. The earlier helper had no remaining call sites.
// If a future surface needs to navigate from a tunnel entry to its
// other-end memory, build the lookup inline; the logic is small.

function navigateToRoom(wing, room) {
  // Try wing as-is, then with underscore→hyphen swap (drawer-form).
  if (!state.palace) return false;
  const variants = [wing, (wing || "").replace(/_/g, "-"), (wing || "").replace(/-/g, "_")];
  let resolvedWing = null;
  for (const v of variants) {
    if (state.palace.wings.some((w) => w.name === v)) { resolvedWing = v; break; }
  }
  if (!resolvedWing) return false;
  // Moving to a different wing/room is a fresh location, not a
  // continuation of the current memory's link chain — drop the back
  // stack so the next opened memory doesn't surface a stale back
  // target from a room the user has navigated away from.
  clearDrawerNavStack();
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
// Both functions are already on window — top-level `function` declarations
// in a classic script auto-attach to the global object, so lab.js can call
// `window.loadTunnels(...)` and `window.openTunnelCreate(...)` directly.
//
// The previous version of this file wrapped them in arrows like:
//   window.loadTunnels = (...args) => loadTunnels(...args);
// which exploded the stack on initial load. The arrow rebound
// window.loadTunnels, so the bare `loadTunnels` inside the arrow then
// resolved back to the arrow itself (function declarations create global
// properties that ARE writable). Every call recursed. Don't re-add wrappers.

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
  els.footerInfo.innerHTML = cells.map(([label, value]) => footerCellHtml(label, value)).join("");
}

function footerCellHtml(label, value) {
  return `
      <div class="footer-cell">
        <span class="footer-cell-label">${escapeHtml(label)}</span>
        <span class="footer-cell-value">${escapeHtml(value)}</span>
      </div>
    `;
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
    const drawers = state.palace.drawers || [];
    const stillThere = drawers.some((d) => d.drawer_id === state.selectedDrawerId);
    if (!stillThere) {
      // The open drawer's id vanished. Before dropping the selection
      // (which collapses the detail panel mid-read), try to re-locate the
      // same memory: an agent updating it MCP-side re-files it under a
      // fresh drawer_id but preserves filed_at. Match on that stable
      // signature and re-point so a background update never closes the
      // panel the user is actively viewing.
      const sig = state._selectedDrawerSig;
      let moved = null;
      if (sig && sig.filed_at) {
        const sameTime = drawers.filter((d) => d.filed_at === sig.filed_at);
        moved = sameTime.find((d) => d.title === sig.title)
          || (sameTime.length === 1 ? sameTime[0] : null);
      }
      if (moved) {
        state.selectedDrawerId = moved.drawer_id;
        state._selectedDrawerSig = {
          filed_at: moved.filed_at,
          title: moved.title,
          wing: moved.wing,
          room: moved.room,
        };
      } else {
        // Genuinely gone (deleted) — only now clear the selection.
        state.selectedDrawerId = null;
        state._selectedDrawerSig = null;
      }
    }
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
  if (!els.statsInfo) return;
  const stats = state.palace.stats;
  // Reuses the .footer-cell markup so the palace stats render with
  // identical typography and spacing as the system-info row right
  // below it. Visually the two .footer-info blocks read as one
  // continuous stat strip, separated by a thin rule (see CSS).
  const items = [
    ["Memories", stats.drawers],
    ["Wings", stats.wings],
    ["Rooms", stats.rooms],
    ["Facts", stats.facts],
  ];
  els.statsInfo.innerHTML = items.map(([label, value]) => footerCellHtml(label, String(value))).join("");
}

function dotMenu(menuId, label, items) {
  return `<div class="menu-wrap">
      <button class="menu-button compact" type="button" data-menu="${escapeHtml(menuId)}" aria-label="${escapeHtml(label)}" aria-haspopup="menu" aria-expanded="false">
        ${menuDotsIcon()}
      </button>
      <div class="action-menu hidden" role="menu" data-menu-panel="${escapeHtml(menuId)}">
        ${items.join("")}
      </div>
    </div>`;
}

const ICON_PATHS = Object.freeze({
  edit: `<path d="M14.06 4.94a2.25 2.25 0 0 1 3.18 0l1.82 1.82a2.25 2.25 0 0 1 0 3.18L9.5 19.5l-4.5 1 1-4.5 8.06-11.06Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
        <path d="m13 6 5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
  editSimple: `<path d="M14.06 4.94a2.25 2.25 0 0 1 3.18 0l1.82 1.82a2.25 2.25 0 0 1 0 3.18L9.5 19.5l-4.5 1 1-4.5 8.06-11.06Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`,
  trash: `<path d="M5 7h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
        <path d="M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
        <path d="M7 7h10l-.9 11.2A1.8 1.8 0 0 1 14.3 20H9.7a1.8 1.8 0 0 1-1.8-1.8L7 7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>`,
  trashLines: `<path d="M5 7h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
        <path d="M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
        <path d="M7 7h10l-.9 11.2A1.8 1.8 0 0 1 14.3 20H9.7a1.8 1.8 0 0 1-1.8-1.8L7 7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
        <path d="M10.5 10.5v6M13.5 10.5v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
  check: `<path d="m5 12 5 5 9-11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  x: `<path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
});

function svgIcon(name, className = "") {
  const classAttr = className ? ` class="${className}"` : "";
  return `<svg${classAttr} viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
}

function menuDotsIcon() {
  return `<svg class="menu-dots" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3" cy="8" r="1.4"></circle>
          <circle cx="8" cy="8" r="1.4"></circle>
          <circle cx="13" cy="8" r="1.4"></circle>
        </svg>`;
}

function actionItem({ className, attrs, icon, label }) {
  return `<button class="${escapeHtml(className)}" role="menuitem" type="button" ${attrs.join(" ")}>
      ${svgIcon(icon, "action-icon")}
      <span>${escapeHtml(label)}</span>
    </button>`;
}

function editMenuItem(drawerId) {
  return actionItem({
    className: "action-item edit-menu",
    attrs: [`data-edit-drawer-id="${escapeHtml(drawerId)}"`],
    icon: "edit",
    label: "Edit",
  });
}

function deleteMenuItem({ scope, drawerId, wing, room }) {
  const attrs = [`data-delete-scope="${escapeHtml(scope)}"`];
  if (drawerId) attrs.push(`data-drawer-id="${escapeHtml(drawerId)}"`);
  if (wing) attrs.push(`data-wing="${escapeHtml(wing)}"`);
  if (room) attrs.push(`data-room="${escapeHtml(room)}"`);
  return actionItem({
    className: "action-item danger-menu",
    attrs,
    icon: "trashLines",
    label: "Delete",
  });
}

function editToggleButton({ id, label, active }) {
  return `<button class="edit-toggle ${active ? "active" : ""}" id="${escapeHtml(id)}" type="button" aria-pressed="${active ? "true" : "false"}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
      ${svgIcon("edit")}
    </button>`;
}

function rowActionButton({ className = "row-action", attrs, icon }) {
  return `<button class="${escapeHtml(className)}" ${attrs.join(" ")}>
        ${svgIcon(icon)}
      </button>`;
}

function renameIconButton({ scope, wing, room }) {
  const attrs = [`data-rename-scope="${escapeHtml(scope)}"`];
  if (wing) attrs.push(`data-wing="${escapeHtml(wing)}"`);
  if (room) attrs.push(`data-room="${escapeHtml(room)}"`);
  return rowActionButton({
    attrs: ["type=\"button\"", "aria-label=\"Rename\"", "title=\"Rename\"", ...attrs],
    icon: "editSimple",
  });
}

function deleteIconButton({ scope, wing, room }) {
  const attrs = [`data-delete-scope="${escapeHtml(scope)}"`];
  if (wing) attrs.push(`data-wing="${escapeHtml(wing)}"`);
  if (room) attrs.push(`data-room="${escapeHtml(room)}"`);
  return rowActionButton({
    className: "row-action danger",
    attrs: ["type=\"button\"", "aria-label=\"Delete\"", "title=\"Delete\"", ...attrs],
    icon: "trash",
  });
}

function renameRow({ scope, currentName, label }) {
  return `<form class="rename-row" data-rename-form data-rename-scope="${escapeHtml(scope)}" data-current="${escapeHtml(currentName)}">
      <input class="rename-input" type="text" autocomplete="off" spellcheck="false" value="${escapeHtml(currentName)}" aria-label="${escapeHtml(label)}" required />
      ${rowActionButton({ className: "row-action accent", attrs: ["type=\"submit\"", "aria-label=\"Save\""], icon: "check" })}
      ${rowActionButton({ attrs: ["type=\"button\"", "data-rename-cancel", "aria-label=\"Cancel\""], icon: "x" })}
    </form>`;
}

// renderNav is now a no-op. The wing navigation used to be a separate
// horizontal pill row above the content grid, but has been folded into
// the Rooms panel as a wing-grouped accordion — see renderRooms below.
// Keeping the function so render()'s existing call chain stays intact
// without conditional logic; deleting the call from render() is fine
// too, but this is the minimal-touch surgery.
function renderNav() {}

/**
 * Render the Rooms panel as a two-level drill-down navigator:
 *
 *   • WINGS VIEW (state.selectedWing === "all"):
 *       ┌─ Rooms ──────────────┐
 *       │ All Memory     71    │  ← always-active row, can't drill
 *       │ ───────────────────  │
 *       │ Claude         03    │  ← tap → drills into Claude
 *       │ Home Assistant 46    │
 *       │ Notes          02    │
 *       │ Pi Inventory   07    │
 *       └──────────────────────┘
 *
 *   • ROOMS-OF-WING VIEW (state.selectedWing !== "all"):
 *       ┌─ Rooms ──────────────┐
 *       │ ← BACK TO WINGS      │  ← matches tunnel-inspector back bar
 *       │ Home Assistant       │
 *       │ 46 memories          │
 *       │ ───────────────────  │
 *       │ Addons         01    │
 *       │ Architecture   01    │
 *       │ Auth           02    │
 *       │ …                    │
 *       └──────────────────────┘
 *       The wing's "all memories" view is implicit — the user gets it
 *       by drilling in (which sets selectedRoom="all"); no separate
 *       "All rooms" pseudo-row is needed.
 *
 * Transitions: forward slide on wing → rooms drill-in, backward slide
 * on back-button → wings. Reuses the iOS-style detail-slide-in
 * keyframes / cubic-bezier(0.32, 0.72, 0, 1) curve already used by
 * the detail-pane tunnel push-pop, so the motion language is uniform.
 *
 * The `drawers` argument is unused — kept so renderDrawers can keep
 * its existing renderRooms(allForWing) call without touching it.
 */
function renderRooms(_drawers) {
  if (!els.roomNav || !state.palace) return;
  const wings = state.palace.wings || [];
  const totalDrawers = state.palace.stats ? state.palace.stats.drawers : 0;
  // View kind drives both the rendered chrome AND the slide-direction
  // applied after innerHTML swap. Stamped on the .room-nav element as
  // data-rooms-view; the previous value determines whether the swap
  // crossed a view boundary (animate) or stayed in the same view
  // (no animation, just content refresh).
  const currentView = state.selectedWing === "all" ? "wings" : "rooms";
  // Panel title swaps with the view: "Wings" for the top-level list,
  // "Rooms" once the user has drilled into a specific wing. Keeps the
  // h2 in the panel header semantically accurate without needing a
  // breadcrumb.
  if (els.roomNavTitle) {
    els.roomNavTitle.textContent = currentView === "wings" ? "Wings" : "Rooms";
  }
  if (els.roomCount) {
    if (currentView === "wings") {
      els.roomCount.textContent = `${wings.length} ${wings.length === 1 ? "wing" : "wings"}`;
    } else {
      const w = wings.find((x) => x.name === state.selectedWing);
      const rc = w && w.rooms ? w.rooms.length : 0;
      els.roomCount.textContent = `${rc} ${rc === 1 ? "room" : "rooms"}`;
    }
  }

  // ---------- fast path: structure unchanged ----------
  // The .active class is the only thing that shifts when the user
  // clicks a different room within the same wing — wings list and
  // rooms list are identical, the view kind is the same, no chrome
  // needs to be re-rendered. We compute a structural signature and,
  // when it matches the previous render, just toggle .active on the
  // existing .room-row nodes and bail. No innerHTML wipe, no DOM
  // node destruction, no listener re-wiring.
  //
  // This was the root cause of the "phantom highlight on the row
  // above the click target" bug: every click triggered an innerHTML
  // wipe, which destroyed the live <button> the user was clicking
  // mid-:active state. The browser, having no live element at the
  // cursor between destruction and re-creation, re-ran hit-testing
  // against the new tree — and during the keyframe slide-in (or even
  // a single paint frame later), the cursor's screen position briefly
  // intersected the neighbouring row's box. That neighbour received
  // :hover, lighting up with --accent-soft (same colour as .active),
  // which read to the user as "I clicked X but Y lit up."
  //
  // Skipping the wipe entirely when the structure hasn't changed
  // means the live DOM the user is interacting with stays mounted
  // through the click, the :active state releases cleanly to the same
  // node, and :hover never has a chance to retarget. The slow path
  // (full innerHTML re-render) still runs for genuine structural
  // changes — drilling into a wing, going back to wings view, palace
  // refresh — and those cases are not click-bound so the hit-test
  // race doesn't apply.
  const sigParts = [currentView];
  if (currentView === "wings") {
    sigParts.push(wings.map((w) => `${w.name}:${w.count}`).join(","));
  } else {
    const wing = wings.find((w) => w.name === state.selectedWing);
    sigParts.push(state.selectedWing);
    sigParts.push(((wing && wing.rooms) || []).map((r) => r.name).join(","));
    // Tunnel counts can change without the room list changing —
    // include them so a tunnel add/remove still triggers re-render
    // (the glyph in .room-item-end depends on tunnelsForRoom count).
    sigParts.push(((wing && wing.rooms) || []).map(
      (r) => tunnelsForRoom(state.selectedWing, r.name).length,
    ).join(","));
  }
  const structuralSig = sigParts.join("|");
  if (els.roomNav.dataset.structuralSig === structuralSig
      && !state.roomsPanelDirection) {
    if (currentView === "rooms") {
      els.roomNav.querySelectorAll(".room-row").forEach((row) => {
        const btn = row.querySelector(".room-item:not(.wing-drill-item)");
        if (!btn || !btn.dataset.room) return;
        const shouldBeActive = state.selectedRoom === btn.dataset.room;
        row.classList.toggle("active", shouldBeActive);
      });
    }
    // Wings view has no per-row .active to update (only the always-on
    // All Memory pseudo-row, which is rendered with .active baked into
    // the markup — no toggle needed).
    return;
  }
  els.roomNav.dataset.structuralSig = structuralSig;

  // ---------- view: WINGS ----------
  if (currentView === "wings") {
    const allCountLabel = totalDrawers < 10 ? `0${totalDrawers}` : String(totalDrawers);
    const allMemoryHtml = `
      <div class="all-memory-row active">
        <button class="all-memory-item" type="button" data-wing="all" disabled aria-current="true">
          <span>All Memory</span>
          <strong>${allCountLabel}</strong>
        </button>
      </div>`;

    const wingsHtml = wings.map((wing) => {
      const countLabel = wing.count < 10 ? `0${wing.count}` : String(wing.count);
      return `<div class="room-row" data-wing-row="${escapeHtml(wing.name)}">
        <button class="room-item wing-drill-item" type="button" data-wing="${escapeHtml(wing.name)}">
          <span>${escapeHtml(humanizeName(wing.name))}</span>
          <span class="room-item-end"><strong>${countLabel}</strong><span class="wing-drill-chevron" aria-hidden="true">›</span></span>
        </button>
      </div>`;
    }).join("");

    els.roomNav.innerHTML = allMemoryHtml + wingsHtml;
  }

  // ---------- view: ROOMS OF A WING ----------
  else {
    const wing = wings.find((w) => w.name === state.selectedWing);
    const wingLabel = wing ? humanizeName(wing.name) : humanizeName(state.selectedWing);
    const wingCount = wing ? wing.count : 0;
    const wingCountLabel = wingCount < 10 ? `0${wingCount}` : String(wingCount);

    const backBarHtml = `
      <div class="room-nav-back-bar">
        <button class="room-nav-back-btn" type="button" id="roomsNavBackBtn"
          aria-label="Back to wings"
          title="Back to wings">
          <span class="room-nav-back-arrow" aria-hidden="true">←</span>
          <span>Back to wings</span>
        </button>
      </div>
      <div class="room-nav-wing-header">
        <strong>${escapeHtml(wingLabel)}</strong>
        <span>${wingCountLabel} memor${wingCount === 1 ? "y" : "ies"}</span>
      </div>`;

    const roomsHtml = ((wing && wing.rooms) || []).map((room) => {
      const isActiveRoom = state.selectedRoom === room.name;
      const tunnelEntries = tunnelsForRoom(state.selectedWing, room.name);
      const tunnelIcon = tunnelEntries.length > 0
        ? `<span class="room-tunnel-icon" aria-hidden="true"
            title="This room has ${tunnelEntries.length} tunnel${tunnelEntries.length === 1 ? "" : "s"} — open the room to inspect">
            ${TUNNEL_GLYPH}
          </span>`
        : "";
      // Per-room counts intentionally omitted. Most rooms hold 1-2
      // memories so a column of "1"s adds scanning noise without
      // info. Wing total in the back-bar covers the volume signal;
      // the precise per-room count appears in the Memories panel
      // header once the user picks the room.
      return `<div class="room-row ${isActiveRoom ? "active" : ""}">
        <button class="room-item" type="button" data-wing="${escapeHtml(state.selectedWing)}" data-room="${escapeHtml(room.name)}">
          <span>${escapeHtml(humanizeName(room.name))}</span>
          <span class="room-item-end">${tunnelIcon}</span>
        </button>
      </div>`;
    }).join("");

    els.roomNav.innerHTML = backBarHtml + roomsHtml;
  }

  // ---------- slide animation ----------
  // Stamp the current view on the element, compare against the
  // previous stamp, and only animate when the view kind changed.
  applyRoomsNavTransition(currentView);

  // ---------- wire interactions ----------
  // Wing drill items (wings view only): forward slide → rooms view.
  // selectedRoom set to "all" so the memories panel immediately shows
  // every memory in this wing.
  els.roomNav.querySelectorAll(".wing-drill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wingName = btn.dataset.wing;
      state.selectedWing = wingName;
      state.selectedRoom = "all";
      // Apple sidebar pattern: don't dismiss the open memory when
      // the user changes scope — they can keep it visible while
      // browsing a different wing.
      state.detailOverride = null;
      state.detailDismissed = false;
      state.roomsPanelDirection = "forward";
      render();
    });
  });

  // Back button (rooms view only): backward slide → wings view.
  const backBtn = on("roomsNavBackBtn", "click", () => {
      state.selectedWing = "all";
      state.selectedRoom = "all";
      state.detailOverride = null;
      state.detailDismissed = false;
      state.roomsPanelDirection = "backward";
      render();
    });

  // Room items (rooms view): narrow to a specific room.
  els.roomNav.querySelectorAll(".room-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const wingName = btn.dataset.wing;
      const roomName = btn.dataset.room;
      if (!roomName) return; // wing-drill items (no data-room) handled above
      if (state.selectedWing === wingName
          && state.selectedRoom === roomName
          && !state.selectedDrawerId
          && !state.detailOverride
          && !state.detailDismissed) {
        return;
      }
      state.selectedWing = wingName;
      state.selectedRoom = roomName;
      state.detailOverride = null;
      state.detailDismissed = false;
      render();
    });
  });

}

/**
 * Apply the iOS-style push/pop slide to the Rooms-panel content
 * after a render. Consumes state.roomsPanelDirection (one shot) and
 * tracks the previously-rendered view kind via a data attribute on
 * els.roomNav so the slide only fires when the view actually changed.
 * Same easing curve (cubic-bezier 0.32, 0.72, 0, 1) and duration as
 * the detail-pane push-pop in applyDetailTransition().
 */
function applyRoomsNavTransition(currentView) {
  const dir = state.roomsPanelDirection;
  state.roomsPanelDirection = null;
  if (!els.roomNav) return;
  const previousView = els.roomNav.dataset.roomsView || "";
  els.roomNav.dataset.roomsView = currentView;
  els.roomNav.classList.remove(
    "rooms-nav-enter-forward",
    "rooms-nav-enter-backward",
  );
  if (!dir) return;
  if (currentView === previousView) return;
  // eslint-disable-next-line no-unused-expressions
  void els.roomNav.offsetWidth;
  els.roomNav.classList.add(
    dir === "backward" ? "rooms-nav-enter-backward" : "rooms-nav-enter-forward",
  );
}

// Card-kicker date — same human format as the detail panel's
// formatTimestamp ("25 May 2026"), but without the trailing HH:MM since
// the kicker is space-constrained and the time is already visible on
// the detail side when the user opens the memory.
// Parse an ISO string to a Date, or null when it's empty/invalid. The
// date formatters share this guard so the "" (empty in) / passthrough-
// raw-iso (invalid in) fallback behaviour stays identical across them.
function parseIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(iso) {
  const d = parseIso(iso);
  if (!d) return iso || "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = FORMAT_TS_MONTHS[d.getMonth()];
  return `${day} ${month} ${d.getFullYear()}`;
}

// Normalize a stored drawer title for display: strips trailing
// (YYYY-MM-DD) dates appended by the auto-import flow, replaces
// underscores with spaces (e.g. `apple_tv` → `apple tv`), collapses
// runs of whitespace, then Title-Cases the result word-by-word —
// preserving any word that already contains an uppercase letter so
// proper nouns like `MemPalace`, `INDEX`, `Pi`, `AAAK` survive intact.
// Underlying drawer.title is unchanged; this is display-only and runs
// at every render site that shows the stored title to the user. Search
// and sort continue to operate on the raw field.
function cleanTitle(rawTitle) {
  if (!rawTitle) return "";
  // Polish OFF → render the stored title verbatim (just trimmed).
  // No date-suffix stripping, no underscore→space, no title-casing.
  // The user sees exactly what's in the first `#` heading of the
  // drawer body. Useful for debugging "why does my title render
  // funny" — and aligns with the broader polish_text contract that
  // OFF means raw source text.
  if (!getPolishText()) return String(rawTitle).trim();
  let cleaned = String(rawTitle);
  cleaned = cleaned.replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, "");
  cleaned = cleaned.replace(/_/g, " ");
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  cleaned = cleaned.split(" ").map((word) => {
    if (!word) return word;
    if (/[A-Z]/.test(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(" ");
  return cleaned;
}

// Drop the leading markdown H1/H2 line from drawer content when it just
// repeats the title we already render in bold above the preview. The
// MemPalace convention is `# <title>\n\n<body…>`, so without this strip
// every card preview begins with the title twice ("Attribution protocol
// — every writer follow this Every MemPalace write must fill…"). We
// only strip when the header text exactly matches the title — content
// that legitimately starts with a non-redundant H1 is left intact.
function stripRepeatedTitle(content, title) {
  if (!content) return "";
  const match = content.match(/^\s*#+\s+(.+?)\s*(?:\n+|$)/);
  if (!match) return content;
  const headerText = match[1].trim();
  const titleText = (title || "").trim();
  if (!titleText || headerText !== titleText) return content;
  return content.slice(match[0].length).replace(/^\s+/, "");
}

// Reduce a drawer body to clean, flat prose suitable for a card-preview
// line-clamp. The detail panel still renders full markdown via
// markdownLite — this is just the simplified-for-glance preview path.
// Stripping order matters: remove BLOCK structures (fenced code blocks,
// headers, lists, blockquote prefixes, admonition tags, HR lines, table
// pipes) before INLINE markup (bold, code, wiki-links) so block-level
// markers don't get half-mistaken for inline content. Final whitespace
// collapse turns the remainder into a single flowing line the CSS
// line-clamp can truncate cleanly.
function cleanForPreview(content, title) {
  let s = stripRepeatedTitle(content || "", title);
  // Block-level cleanup
  s = s.replace(/```[^\n]*\n[\s\S]*?\n```/g, " ");      // drop fenced code blocks entirely
  s = s.replace(/^>\s?/gm, "");                          // strip blockquote `>` prefixes
  s = s.replace(/^\s*\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/gim, ""); // drop admonition type lines
  s = s.replace(/^\s*(?:---+|___+|\*\*\*+)\s*$/gm, ""); // drop HR lines
  s = s.replace(/^#+\s+/gm, "");                          // drop header `#` markers, keep text
  s = s.replace(/^-\s+/gm, "");                           // drop unordered-list bullet
  s = s.replace(/^\d+\.\s+/gm, "");                      // drop ordered-list number
  s = s.replace(/\|/g, " ");                              // drop table cell separators
  // Inline-level cleanup (keep the inner text, drop the chrome)
  s = s.replace(/\*\*([^*]+?)\*\*/g, "$1");              // bold markers
  s = s.replace(/(?<![\w*])\*([^*\n]+?)\*(?![\w*])/g, "$1"); // italic markers (safe with look-arounds)
  s = s.replace(/`([^`]+?)`/g, "$1");                    // inline code backticks
  s = s.replace(/\[\[([^\]]+)\]\]/g, "$1");              // wiki-link brackets, keep name
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");       // standard markdown links → just the text
  // Final flatten: any whitespace run → single space, trim
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// Human date + 24h time, e.g. "01 Jan 2026 – 23:00". Used wherever a full
// ISO timestamp would otherwise be displayed (drawer Filed, tunnel
// Created / Updated, trash logged-at). Falls back to the raw string when
// the input isn't a parseable date.
const FORMAT_TS_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function formatTimestamp(iso) {
  const d = parseIso(iso);
  if (!d) return iso || "";
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${formatDate(iso)} – ${hours}:${minutes}`;
}

// ---------- Drawer-list virtualization ----------
// True virtualization (not CSS content-visibility) for the drawers
// list — only the cards in the visible scroll window are actually
// rendered into the DOM. With 70+ memories in a room, that means ~8-10
// cards live in the DOM at any moment instead of 70. The per-frame
// layout cost during the enlarge/minimize animation drops from O(N)
// to O(visible), and the cost of switching rooms / search / sort
// drops too. Off-screen rows are represented by a single sized spacer
// at the top and another at the bottom so the scrollbar stays the
// right size and scroll position is preserved naturally.
//
// Card height is fixed in CSS (.drawer-card { height: var(--drawer-
// card-height) }) so the math here is exact — no row-position
// jittering as cards render. The fixed height also forces the title
// to a single-line ellipsis (see CSS), which reads more cleanly in a
// dense list anyway.
const VIRT_CARD_HEIGHT = 140;
const VIRT_CARD_GAP = 10;             // matches .drawer-list gap
const VIRT_ROW = VIRT_CARD_HEIGHT + VIRT_CARD_GAP;
const VIRT_BUFFER = 4;                // extra rows rendered above/below the visible window

// HTML generator for a single card. NO active class baked in — the
// active state is applied via JS after the windowed slice is inserted
// (see renderDrawerWindow), so card-selection changes don't invalidate
// the per-drawer HTML cache built in renderDrawers.
/** Threshold below which a drawer's `updated_at` counts as "recent"
 * and earns the marker on its card + the meta-strip indicator.
 * 12h chosen because "yesterday" already reads as stale per the
 * user's intuition — recent should mean genuinely fresh, on the
 * scale of a working session, not on the scale of days. */
const RECENT_UPDATE_MS = 12 * 60 * 60 * 1000;

/** Shared seen-state map — {notification_id → ISO-timestamp} of when the
 * user last marked each bell item as seen. Drawer notifications use the
 * drawer_id itself; fact lifecycle notifications use fact:<id>:added /
 * fact:<id>:ended. SERVER-SIDE since 2026-05-28:
 * lives in ~/.mempalace/dashboard-seen.json on the Pi so notification-
 * dismissal syncs across every browser/device hitting this dashboard
 * on the LAN. Same mental model as iOS Mail's unread dot disappearing
 * when you tap the message — and on Apple's setup the dot disappears
 * on every device, not just the one you tapped on.
 *
 * Local cache (state._seenMap) is populated from the /api/palace
 * response (which now includes a `seen` field). Subsequent polls
 * refresh it. Mark-seen writes are optimistic: update the local cache
 * immediately for instant UI feedback, then POST /api/seen in the
 * background. If the POST fails, the next palace poll reconciles. */
const SEEN_AT_STORAGE_KEY = "apricity.drawerSeenAt"; // legacy — no longer used

function readSeenAtMap() {
  // Read from the server-synced cache populated by loadPalace. Empty
  // dict default until the first palace response lands.
  if (state._seenMap && typeof state._seenMap === "object") return state._seenMap;
  return {};
}

/** Fire-and-forget POST to persist seen-state to the server. Multiple
 * IDs in one call so bulk-seen is one round trip instead of N. The
 * response (updated map) replaces the local cache so any concurrent
 * server-side change is picked up. Errors are silent — local cache is
 * already updated optimistically; next palace poll reconciles. */
function _persistSeenToServer(itemIds) {
  if (!itemIds || !itemIds.length) return;
  postJson("/api/seen", { item_ids: itemIds })
    .then((resp) => {
      if (resp && resp.seen && typeof resp.seen === "object") {
        state._seenMap = resp.seen;
        // Mirror the server-reconciled map into the local cache so the
        // next refresh paints the canonical seen state.
        writeSeenCache();
      }
    })
    .catch(() => {
      // Network blip — next /api/palace poll refreshes the map.
    });
}

function markDrawerSeen(drawerId) {
  if (!drawerId) return;
  // Optimistic local cache update — UI reflects the dismiss instantly,
  // before the server round trip lands. Other LAN clients pick up the
  // change on their next palace poll (≤ refresh-interval seconds).
  if (!state._seenMap) state._seenMap = {};
  state._seenMap[drawerId] = new Date().toISOString();
  // Persist to the dedicated seen localStorage key too, so a refresh
  // right after dismissing paints the up-to-date seen state instead of
  // the stale one baked into the (less-frequently-written) palace cache.
  writeSeenCache();
  _persistSeenToServer([drawerId]);
}

function markFactEventSeen(eventId) {
  if (!eventId) return;
  if (!state._seenMap) state._seenMap = {};
  state._seenMap[eventId] = new Date().toISOString();
  writeSeenCache();
  _persistSeenToServer([eventId]);
}

/** Position the tunnel-bind card so its bottom edge sits ~16px ABOVE
 * the editor's WING pill, and keep it glued there as the panel scrolls.
 *
 * The card is position:absolute relative to the NON-scrolling
 * .detail-panel, while the WING/ROOM chips (.detail-editor-chips) are
 * position:sticky inside the scrolling #detail. To sit "right above
 * WING" wherever WING currently is, we measure the chips' live top and
 * place the card's bottom just above it. Because the chips are sticky,
 * their top changes as you scroll (riding up with content, then pinning
 * at top:170) — so this MUST be re-run on scroll (see the listener in
 * updateTunnelBindIndicator) or the card freezes at its scroll-top
 * position while the chips ride up and the two cross. Tracking the
 * chips means the card glides up with the content and locks the instant
 * the chips pin, exactly mirroring the toolbar's own behaviour.
 *
 * No high `top` clamp: the card lives in the chip column (offset well
 * to the right of the top-left close/maximize cluster), so even when
 * the chips pin and the card tracks up near the panel top it never
 * horizontally overlaps those buttons. A small 8px floor only stops a
 * very tall multi-tunnel card from poking above the panel. */
function positionTunnelInfo(info) {
  if (!info || info.classList.contains("hidden")) return;
  const panel = info.closest(".detail-panel");
  const detail = panel && panel.querySelector("#detail");
  if (!panel || !detail) return;
  const panelRect = panel.getBoundingClientRect();
  const boxH = info.offsetHeight || 120;
  // VERTICAL anchor — pinned, and identical in view AND edit mode. Use the
  // meta band's RENDERED bottom (getBoundingClientRect). #detail has NO
  // padding, so the sticky meta sits flush at the panel top and its
  // rendered bottom is a CONSTANT (~78px) at rest AND scrolled — the box
  // never moves. Do NOT use meta.offsetTop: for a position:sticky element
  // WebKit returns natural + sticky displacement, which GROWS with scroll
  // and slid the box right off the bottom of the panel. (An earlier
  // view/edit "snap" that this offsetTop swap was meant to fix was really
  // the chips being pinned at the wrong 288 — now fixed at 240 in CSS — so
  // getBoundingClientRect is correct here and does not snap.) box bottom =
  // metaBottom + 170 − 16 ≈ 232, sitting the box ~8px above the chip
  // column pinned at 240. Keep +170 / −16 in sync with the chips'
  // top(240)/margin-top(162) in styles.css.
  const meta = detail.querySelector(".detail-meta");
  const metaBottom = meta ? (meta.getBoundingClientRect().bottom - panelRect.top) : 78;
  const wingTop = metaBottom + 170;
  info.style.top = Math.max(8, Math.round(wingTop - boxH - 16)) + "px";
  // HORIZONTAL — copy the editor chip column's exact left edge so the box
  // and the pills share one left rail (perfectly symmetric). In EDIT mode
  // just measure the chips directly — no geometry guessing (an earlier
  // bodyLeft−226 estimate ignored the column's margin-right:24 and landed
  // the box ~24px too far right). In VIEW mode the chips don't exist, so
  // reproduce their left from the centred body: the column is right-
  // aligned in the left gutter against the 760px body, offset by the grid
  // column-gap(16) + its margin-right(24) + its width(210) = 250. The body
  // is centred at the SAME left in both modes, so view matches edit.
  const chips = detail.querySelector(".detail-editor-chips");
  let left;
  if (chips) {
    left = chips.getBoundingClientRect().left - panelRect.left;
  } else {
    const body = detail.querySelector(".markdown");
    left = body ? (body.getBoundingClientRect().left - panelRect.left - 250) : 48;
  }
  info.style.left = Math.max(24, Math.round(left)) + "px";
}

/** Update the floating tunnel-bind indicator (chip + watermark)
 * shown on the detail panel for tunnel-bound memories. Replaces
 * the old TUNNELS meta cell. Called from renderDrawerDetail with
 * the current drawer and its tunnel list; passed null on
 * non-drawer renders (tunnel inspector, empty state, hidden
 * panel) so the indicator clears.
 *
 * Layout: floating box anchored to the LEFT gutter, positioned by
 * positionTunnelInfo() just above the editor's WING pill. One chip
 * per
 * tunnel showing the OTHER endpoint memory's title with a small
 * graph-edge glyph on top, click → navigates straight to that
 * linked memory. Drawer-side endpoints with no bound memory fall
 * back to their wing/room label.
 *
 * In edit mode each chip gets a corner × so the user can unbind
 * the tunnel without leaving the memory they're editing.
 *
 * Watermark: a low-opacity wide graph-edge SVG already placed in
 * index.html, gated on .has-tunnel toggled here. */
function updateTunnelBindIndicator(drawer, drawerTunnels) {
  const panel = document.querySelector(".detail-panel");
  const info = document.querySelector("#detailPanelTunnelInfo");
  if (!panel || !info) return;
  const tunnels = Array.isArray(drawerTunnels) ? drawerTunnels : [];
  const hasTunnel = !!drawer && tunnels.length > 0;
  panel.classList.toggle("has-tunnel", hasTunnel);
  if (!hasTunnel) {
    info.classList.add("hidden");
    info.setAttribute("aria-hidden", "true");
    info.innerHTML = "";
    return;
  }
  // Walk each tunnel, look up the OTHER endpoint (the side the user
  // would jump to via this chip), prefer a drawer-bound title, fall
  // back to wing/room when the other end is room-only. Each chip
  // ALWAYS renders its own unbind × — CSS fades the button in/out
  // based on the .content-grid.detail-editing class, so re-rendering
  // the chip on edit-mode toggle isn't needed (and the × can animate
  // its fade-in instead of popping in on the next render tick).
  const drawers = (state.palace && state.palace.drawers) || [];
  const chips = tunnels.map((tunnel) => {
    const isSource = tunnel.source && tunnel.source.drawer_id === drawer.drawer_id;
    const otherSide = isSource ? tunnel.target : tunnel.source;
    if (!otherSide) return "";
    const linkedDrawer = otherSide.drawer_id
      ? drawers.find((d) => d.drawer_id === otherSide.drawer_id)
      : null;
    const linkedTitle = linkedDrawer
      ? (cleanTitle(linkedDrawer.title || "") || linkedDrawer.drawer_id)
      : (otherSide.wing && otherSide.room
          ? `${humanizeName(otherSide.wing)} / ${humanizeName(otherSide.room)}`
          : "Linked endpoint");
    const thisSide = isSource ? "source" : "target";
    const linkedDrawerId = linkedDrawer ? linkedDrawer.drawer_id : "";
    return `<div class="detail-panel-tunnel-chip-wrap">
      <button class="detail-panel-tunnel-chip" type="button"
        data-linked-drawer-id="${escapeHtml(linkedDrawerId)}"
        data-tunnel-id="${escapeHtml(tunnel.id || "")}"
        title="${escapeHtml(linkedTitle)}"
        aria-label="Open linked memory: ${escapeHtml(linkedTitle)}">
        <svg class="detail-panel-tunnel-chip-glyph" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="5" r="2.4" fill="currentColor"/>
          <line x1="12" y1="8.4" x2="12" y2="15.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <circle cx="12" cy="19" r="2.4" fill="currentColor"/>
        </svg>
        <span class="detail-panel-tunnel-chip-label">${escapeHtml(linkedTitle)}</span>
      </button>
      <button class="detail-panel-tunnel-unbind" type="button"
        data-tunnel-unbind-id="${escapeHtml(tunnel.id || "")}"
        data-tunnel-unbind-side="${thisSide}"
        title="Unbind this memory from the tunnel"
        aria-label="Unbind tunnel"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>
    </div>`;
  });
  info.classList.remove("hidden");
  info.removeAttribute("aria-hidden");
  info.innerHTML = chips.join("");
  // Place the box just above the WING pill now that its content (and
  // therefore its height) is known. Run synchronously to avoid a
  // visible reflow, then again next frame as a safety net for the
  // first paint where layout may not have fully settled.
  positionTunnelInfo(info);
  requestAnimationFrame(() => positionTunnelInfo(info));
  // The card tracks the sticky chips' live position, so it must be
  // re-placed as the panel scrolls — otherwise it freezes at its
  // scroll-top spot while the chips ride up to pin, and the two cross.
  // One rAF-throttled scroll listener wired once for the life of the
  // page (els.detail persists across renders), same pattern the
  // virtual drawer list uses.
  if (!state._tunnelScrollWired && els.detail) {
    state._tunnelScrollWired = true;
    let tunnelRafPending = false;
    els.detail.addEventListener("scroll", () => {
      if (tunnelRafPending) return;
      tunnelRafPending = true;
      requestAnimationFrame(() => {
        tunnelRafPending = false;
        const cur = document.querySelector("#detailPanelTunnelInfo");
        if (cur && !cur.classList.contains("hidden")) positionTunnelInfo(cur);
      });
    }, { passive: true });
  }
  // Chip click → jump straight to the linked memory (or back to the
  // tunnel inspector if the other side is unbound / not findable).
  info.querySelectorAll("[data-linked-drawer-id]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const linkedId = chip.dataset.linkedDrawerId;
      const tunnelId = chip.dataset.tunnelId;
      if (linkedId) {
        const linked = drawers.find((d) => d.drawer_id === linkedId);
        if (!linked) return;
        // Treat as a wikilink-style follow so the back-bar lets the
        // user return to the originating memory. Push the current
        // state onto the nav stack first.
        pushDrawerNavEntry();
        state.detailOverride = null;
        state.detailDismissed = false;
        state.selectedWing = linked.wing;
        state.selectedRoom = linked.room;
        state.selectedDrawerId = linked.drawer_id;
        state.detailDirection = "forward";
        render();
        writeHash();
        return;
      }
      // Unbound other side → fall through to the tunnel inspector.
      if (!tunnelId) return;
      clearDrawerNavStack();
      state.detailOverride = null;
      state.detailDismissed = false;
      state.selectedDrawerId = null;
      state.detailDirection = "forward";
      const targetTunnel = state.tunnels.find((t) => t.id === tunnelId);
      if (targetTunnel) {
        state.selectedWing = targetTunnel.source.wing;
        state.selectedRoom = targetTunnel.source.room;
      }
      render();
      writeHash();
    });
  });
  // Per-chip unbind (edit mode). Sends the update-tunnel API with
  // the appropriate side cleared. Stops propagation so the chip's
  // click handler (which would navigate) doesn't also fire.
  info.querySelectorAll("[data-tunnel-unbind-id]").forEach((unbind) => {
    unbind.addEventListener("click", async (event) => {
      event.stopPropagation();
      const tunnelId = unbind.dataset.tunnelUnbindId;
      const side = unbind.dataset.tunnelUnbindSide;
      const tunnel = state.tunnels.find((t) => t.id === tunnelId);
      if (!tunnel) return;
      try {
        const changes = side === "source"
          ? { source_drawer_id: "" }
          : { target_drawer_id: "" };
        await updateTunnel(tunnel, changes);
        await loadTunnels();
        render();
      } catch {
        // Silent — tunnel detail inspector still works for cleanup.
      }
    });
  });
}

function drawerMetadataCellHtml(cell, idx) {
  // The Drawer cell's value is itself the copy-ID affordance —
  // click the hash to copy the full id. Hover + cursor + accent
  // color signal interactivity; the title turns into an explicit
  // "Click to copy" hint instead of just showing the full id.
  const isDrawerCell = idx === 0;
  const strongClass = [
    cell.changed ? "value-changed" : "",
    isDrawerCell ? "drawer-id-copy" : "",
    cell.recent ? "meta-recent" : "",
  ].filter(Boolean).join(" ");
  const titleAttr = isDrawerCell
    ? `Click to copy: ${escapeHtml(cell.full)}`
    : escapeHtml(cell.full);
  const dataAttr = isDrawerCell
    ? `data-copy-drawer-id="${escapeHtml(cell.full)}"`
    : "";
  // Drawer cell renders BOTH the short hash suffix and the full
  // id in nested spans; CSS shows one based on the enlarged
  // state of the panel (.content-grid.detail-enlarged swaps to
  // the full id since the metadata bar has plenty of horizontal
  // room then). The full-form DISPLAY strips the `drawer_`
  // prefix — redundant with the "DRAWER" label directly above —
  // but the data-copy-drawer-id attribute keeps the full
  // unmodified id for the click-to-copy action.
  const fullDisplay = isDrawerCell
    ? (cell.full || "").replace(/^drawer_/, "")
    : cell.full;
  // Tunnels cell prefixes its count with the graph-edge glyph so
  // the link semantic is immediately legible even at a glance.
  let valueHtml;
  if (isDrawerCell) {
    valueHtml = `<span class="drawer-id-short">${escapeHtml(cell.display)}</span><span class="drawer-id-full">${escapeHtml(fullDisplay)}</span>`;
  } else if (cell.tunnels) {
    valueHtml = `<span class="meta-tunnel-glyph" aria-hidden="true">${TUNNEL_GLYPH}</span>${escapeHtml(cell.display)}`;
  } else {
    valueHtml = escapeHtml(cell.display);
  }
  // Enlarged-only cells (e.g. Location) get a class CSS uses to
  // hide them in normal-width view.
  const cellClass = cell.enlargedOnly ? "meta-cell-enlarged" : "";
  return `<div class="${cellClass}"><span>${escapeHtml(cell.label)}</span><strong class="${strongClass}" title="${titleAttr}" ${dataAttr}>${valueHtml}</strong></div>`;
}

function detailBackBarHtml({ ariaLabel, title, label }) {
  return `<div class="detail-back-bar">
        <button class="detail-back-btn" type="button" id="detailBackBtn"
          aria-label="${escapeHtml(ariaLabel)}"
          title="${escapeHtml(title)}">
          <span class="detail-back-arrow" aria-hidden="true">←</span>
          <span>${escapeHtml(label)}</span>
        </button>
      </div>`;
}

function drawerBackBarHtml(backToTunnel) {
  if (backToTunnel) {
    return detailBackBarHtml({
      ariaLabel: "Back to tunnel inspector",
      title: "Back to tunnel inspector",
      label: "Back to tunnel",
    });
  }
  if (state.drawerNavStack && state.drawerNavStack.length) {
    return detailBackBarHtml({
      ariaLabel: "Back to previous memory",
      title: "Back to previous memory",
      label: "Back to previous memory",
    });
  }
  return "";
}

function detailMetaWatermarkHtml(tunnelsCount) {
  return tunnelsCount > 0
    ? `<svg class="detail-meta-tunnel-watermark" viewBox="0 0 200 40" aria-hidden="true" focusable="false">
        <circle cx="10" cy="20" r="6" fill="currentColor"/>
        <line x1="18" y1="20" x2="182" y2="20" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
        <circle cx="190" cy="20" r="6" fill="currentColor"/>
      </svg>`
    : "";
}

/** Capture the current detail-pane selection (including tunnel
 * override + enlarged state + scroll position) onto the wikilink
 * nav stack BEFORE following an in-content link to another memory.
 * Each entry is one back-step the user can return through. Skipped
 * when there's no current drawer selection — pushing an empty entry
 * would give the user a back button that takes them to a blank
 * panel, which is worse than no back button at all. */
function pushDrawerNavEntry() {
  if (!state.selectedDrawerId && !state.detailOverride) return;
  state.drawerNavStack.push({
    wing: state.selectedWing,
    room: state.selectedRoom,
    drawerId: state.selectedDrawerId,
    override: state.detailOverride
      ? { ...state.detailOverride }
      : null,
    detailEnlarged: !!state.detailEnlarged,
    scroll: els.detail ? els.detail.scrollTop || 0 : 0,
  });
}

/** Wipe the wikilink nav stack — called from every navigation path
 * that ISN'T an in-content link follow (card click in the memories
 * list, notification-item click, hash deep-link, tunnel "Open
 * memory" → drawer, search filter narrowing to a different drawer).
 * Keeps the stack representing only an unbroken chain of follows
 * from the current selection — otherwise pressing back would
 * surface stale memories the user already left behind by other
 * means and never expected to revisit. */
function clearDrawerNavStack() {
  if (state.drawerNavStack && state.drawerNavStack.length) {
    state.drawerNavStack = [];
  }
}

/** Stamp every notification item in `itemIds` as seen in one server
 * round trip. Used by bulk-clear affordances. */
function markNotificationItemsSeen(itemIds) {
  if (!Array.isArray(itemIds) || !itemIds.length) return;
  if (!state._seenMap) state._seenMap = {};
  const now = new Date().toISOString();
  const realIds = [];
  for (const id of itemIds) {
    if (id) {
      state._seenMap[id] = now;
      realIds.push(id);
    }
  }
  writeSeenCache();
  _persistSeenToServer(realIds);
}

function markDrawersSeen(drawerIds) {
  markNotificationItemsSeen(drawerIds);
}

/** Per-actor avatar spec for the notification bell.
 *
 * The composition is: a brand-coloured circle (the .bg below) with
 * the model's mark rendered WHITE inside it (achieved via the
 * CSS-side `filter: brightness(0) invert(1)` on the inner <img>,
 * which works because each /icons/*.svg here is the MONOCHROME
 * variant from lobehub/lobe-icons — black on transparent, ideal
 * for CSS recolouring).
 *
 * Each .bg is the brand's signature primary so the avatar reads
 * as "Anthropic / OpenAI / Google / xAI" at a glance — same
 * pattern Discord, Slack, and iMessage use for app/service avatars.
 *
 * CLI / coding-agent variants preferred where they ship — the
 * dashboard surfaces edits made by agentic CLIs (Claude Code, Codex,
 * Gemini CLI) more often than their base chat products. Grok CLI
 * doesn't ship a dedicated variant in lobe-icons yet (probed
 * 2026-05-28), so the Grok actor uses the base `grok.svg`.
 *
 * Adding a new model: probe @lobehub/icons-static-svg for the
 * mono slug (no `-color` suffix), drop the SVG in /static/icons/,
 * add an entry below with the brand's primary colour. */
const NOTIFICATION_AVATARS = {
  // Anthropic warm terracotta — the colour of the company's mark
  // and the primary brand accent.
  claude:  { src: "/icons/claudecode.svg", bg: "#cc785c" },
  // OpenAI dark grey, near-black — the brand's neutral primary.
  codex:   { src: "/icons/codex.svg",      bg: "#0d0d0d" },
  chatgpt: { src: "/icons/codex.svg",      bg: "#0d0d0d" },
  gpt:     { src: "/icons/codex.svg",      bg: "#0d0d0d" },
  // Gemini's signature blue→violet→pink gradient — the most
  // recognizable Google AI mark. Diagonal sweep mirrors how
  // Google's own Gemini app uses it.
  gemini:  { src: "/icons/geminicli.svg",  bg: "linear-gradient(135deg,#4285f4 0%,#9b59ff 60%,#ec4899 100%)" },
  // xAI brand is essentially pure black — wordmarks + product UI
  // both lean on it as the dominant surface.
  grok:    { src: "/icons/grok.svg",       bg: "#000000" },
};

/** Build the avatar HTML for a given actor name (drawer.added_by).
 * AI-author avatars wrap the mono brand SVG in a brand-coloured
 * circle, with the SVG forced to white by CSS so the brand colour
 * stays dominant and the mark stays legible regardless of theme.
 * Human / unknown authors fall back to a deterministic muted-blue
 * circle with their initial — distinguishable from the AI brand
 * marks at a glance. */
function notificationAvatarHtml(actor) {
  const raw = String(actor || "").trim();
  const key = raw.toLowerCase();
  const spec = NOTIFICATION_AVATARS[key];
  if (spec) {
    return `<span class="notif-avatar notif-avatar-brand" style="background:${spec.bg}" aria-label="${escapeHtml(raw)}"><img src="${spec.src}" alt="" /></span>`;
  }
  // Human / unknown actor — deterministic hue from the name's char
  // codes so the same person always gets the same colour. Hue band
  // 200-260 (muted blue-violet) intentionally avoids the AI brand
  // marks' visual register so "this was a human edit" reads at a
  // glance.
  const hash = Array.from(key).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const hue = 200 + (hash % 60);
  const glyph = (raw[0] || "?").toUpperCase();
  return `<span class="notif-avatar" style="background:hsl(${hue},20%,42%);color:#f5f5f7" aria-label="${escapeHtml(raw)}">${escapeHtml(glyph)}</span>`;
}

function isRecentlyUpdated(drawer) {
  if (!drawer || !drawer.updated_at) return false;
  const updated = Date.parse(drawer.updated_at);
  if (Number.isNaN(updated)) return false;
  if ((Date.now() - updated) >= RECENT_UPDATE_MS) return false;
  // If the user has already viewed this drawer SINCE its last
  // update, suppress the marker — they've already seen the change.
  const seenMap = readSeenAtMap();
  const seenIso = seenMap[drawer.drawer_id];
  if (seenIso) {
    const seenAt = Date.parse(seenIso);
    if (!Number.isNaN(seenAt) && seenAt >= updated) return false;
  }
  return true;
}

function factEventSeenKey(event) {
  if (!event) return "";
  if (event.event_id) return String(event.event_id);
  if (event.fact_id && event.event) return `fact:${event.fact_id}:${event.event}`;
  return "";
}

function factEventTimestamp(event) {
  return event && (event.at || event.extracted_at || event.valid_to || "");
}

function isRecentlyFactEvent(event) {
  const key = factEventSeenKey(event);
  const atIso = factEventTimestamp(event);
  if (!key || !atIso) return false;
  const at = Date.parse(atIso);
  if (Number.isNaN(at)) return false;
  if ((Date.now() - at) >= RECENT_UPDATE_MS) return false;
  const seenIso = readSeenAtMap()[key];
  if (seenIso) {
    const seenAt = Date.parse(seenIso);
    if (!Number.isNaN(seenAt) && seenAt >= at) return false;
  }
  return true;
}

// ---- Bell-notification "dismissed" namespace ------------------------
// The bell is STICKIER than the card "Updated" dot. A new memory stays
// in the bell until the user dismisses it FROM the bell — opening the
// memory (which writes the plain seen-key and clears the card dot) no
// longer clears it. To decouple the two WITHOUT a second server store,
// bell dismissals are recorded in the SAME seen-map under a "bell:"
// prefix: viewing writes <id>, bell actions write bell:<id>. The
// server's /api/seen already accepts arbitrary item ids, so the backend
// is unchanged. isRecentlyUpdated (card dot) keeps reading the plain key.
const BELL_SEEN_PREFIX = "bell:";
function bellDismissedAt(id) {
  return id ? readSeenAtMap()[BELL_SEEN_PREFIX + id] : "";
}
function isBellUnseenDrawer(drawer) {
  if (!drawer || !drawer.updated_at) return false;
  const updated = Date.parse(drawer.updated_at);
  if (Number.isNaN(updated) || (Date.now() - updated) >= RECENT_UPDATE_MS) return false;
  const seenIso = bellDismissedAt(drawer.drawer_id);
  if (seenIso) {
    const seenAt = Date.parse(seenIso);
    if (!Number.isNaN(seenAt) && seenAt >= updated) return false;
  }
  return true;
}
function isBellUnseenFactEvent(event) {
  const key = factEventSeenKey(event);
  const atIso = factEventTimestamp(event);
  if (!key || !atIso) return false;
  const at = Date.parse(atIso);
  if (Number.isNaN(at) || (Date.now() - at) >= RECENT_UPDATE_MS) return false;
  const seenIso = bellDismissedAt(key);
  if (seenIso) {
    const seenAt = Date.parse(seenIso);
    if (!Number.isNaN(seenAt) && seenAt >= at) return false;
  }
  return true;
}
// Record bell items as dismissed (writes the "bell:"-prefixed keys via
// the shared seen-map plumbing, so it persists + syncs to the server).
function markBellItemsSeen(ids) {
  const keys = (ids || []).filter(Boolean).map((id) => BELL_SEEN_PREFIX + id);
  if (keys.length) markNotificationItemsSeen(keys);
}

function factEventTitle(event) {
  const parts = [event.subject, event.predicate, event.object]
    .map(prettifyFactValue)
    .filter(Boolean);
  return parts.join(" ");
}

function factEventMetaLabel(event) {
  if (event && event.event === "deleted") return "Fact deleted";
  if (event && event.event === "ended") return "Fact ended";
  return "Fact added";
}

/** Format an ISO timestamp as a short relative phrase ("2h ago",
 * "yesterday", "Mar 4"). Used by the recently-updated marker — the
 * dot shows the marker, this string explains it. Falls back to the
 * formatted absolute date if the value is older than ~30 days, since
 * relative time past that point is more confusing than helpful. */
function formatRelativeTime(iso) {
  if (!iso) return "";
  // Relative-time pref OFF → render the full absolute timestamp so
  // the meta-strip UPDATED cell matches the sibling FILED cell's
  // format. The relative phrase ("Xh ago" / "yesterday") only fires
  // when the user has the pref ON (default).
  if (!getRelativeTime()) return formatTimestamp(iso) || formatDate(iso) || "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 30) return `${day}d ago`;
  return formatDate(iso) || "";
}

function drawerCardHtml(drawer, showWing, showRoom) {
  // Card date always uses the relative format ("1h ago", "Yesterday",
  // "Tuesday"). Past 7 days it falls back to the absolute date to
  // match Apple's iOS Mail / Messages convention — relative time
  // stops being useful once "Xd ago" gets large enough that the
  // user has to do the math anyway. The full ISO timestamp stays
  // in the detail panel's Date cell for precision.
  const dateText = formatCardDate(drawer.filed_at);
  let locStr = "";
  if (showWing && showRoom) {
    locStr = `${humanizeName(drawer.wing)} / ${humanizeName(drawer.room)}`;
  } else if (showRoom) {
    locStr = humanizeName(drawer.room);
  }
  const kickerLeft = locStr ? `<span>${escapeHtml(locStr)}</span>` : "";
  const kickerRight = dateText ? `<span class="drawer-date">${escapeHtml(dateText)}</span>` : "";
  const kicker = (kickerLeft || kickerRight)
    ? `<span class="drawer-kicker">${kickerLeft}${kickerRight}</span>`
    : "";
  const bodyPreview = cleanForPreview(drawer.content, drawer.title).slice(0, 600);
  const displayTitle = cleanTitle(drawer.title);
  const displayTitleClean = cleanForPreview(displayTitle, "");
  // Recently-updated cards get .is-updated which CSS uses to tint
  // the right edge of the card accent. No new chrome added — just
  // a colour shift on the existing right-edge fade. Click handler
  // adds .is-fading to dissolve the tint back to the default
  // white/grey edge as the user opens the memory.
  const updatedClass = isRecentlyUpdated(drawer) ? " is-updated" : "";
  // Failed-save tint — cards whose drawer_id is in state.failedSaves
  // get .is-failed for a persistent red right-edge gradient. Visually
  // identical pattern to .is-updated but in --danger, no auto-fade
  // (failure stays red until the user retries successfully or
  // dismisses). When BOTH classes are present, CSS scopes the red
  // overlay to win so the colours don't muddle.
  const hasFailure = Array.isArray(state.failedSaves)
    && state.failedSaves.some((e) => e.drawer_id === drawer.drawer_id);
  const failedClass = hasFailure ? " is-failed" : "";
  // .drawer-card-wrap is the cascade-animation target. It uses
  // `display: contents` by default (transparent to layout, so the
  // inner .drawer-card stays the effective grid item), and switches
  // to `display: block` only when .waterfall is applied — the wrap
  // becomes a real block-level transform context for the cascade
  // duration, then collapses back.
  return `<div class="drawer-card-wrap"><div class="drawer-card${updatedClass}${failedClass}" data-id="${escapeHtml(drawer.drawer_id)}">
    <button class="drawer-select" type="button" data-id="${escapeHtml(drawer.drawer_id)}">
      ${kicker}
      <strong>${escapeHtml(displayTitleClean)}</strong>
      <span class="drawer-preview">${escapeHtml(bodyPreview)}</span>
    </button>
  </div></div>`;
}

/** Card-specific date format: relative for the last 7 days, absolute
 * beyond. Matches Apple's pattern across iOS Mail / Messages — the
 * relative form is more useful for recent items, the absolute form
 * is more useful for historical ones. The detail panel keeps the
 * full ISO timestamp via formatTimestamp for precision. */
function formatCardDate(iso) {
  if (!iso) return "";
  // Relative-time pref OFF → always render the absolute date, even
  // for fresh items. The kicker is space-constrained so we use
  // formatDate ("28 May 2026") rather than formatTimestamp (with
  // HH:MM) — same form the function already uses for items past
  // the 7-day threshold, just applied uniformly.
  if (!getRelativeTime()) return formatDate(iso) || "";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return formatDate(iso) || "";
  const diffMs = Date.now() - then;
  if (diffMs < 0) return "just now";
  const day = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (day < 7) return formatRelativeTime(iso);
  return formatDate(iso) || "";
}

function attachDrawerCardListeners() {
  els.drawerList.querySelectorAll(".drawer-select").forEach((button) => {
    if (button._listenerAttached) return;
    button._listenerAttached = true;
    button.addEventListener("click", () => {
      if (button.dataset.id === state.selectedDrawerId
          && !state.detailOverride
          && !state.detailDismissed) {
        return;
      }
      // Recently-updated cards: kick off the accent-tint drain BEFORE
      // state changes. .is-fading slides the tint overlay rightward
      // (drained off the edge) over ~0.45s in parallel with the
      // panel-open. markDrawerSeen records the view so future
      // renderDrawers passes won't re-add .is-updated.
      const clickedCard = button.closest(".drawer-card");
      if (clickedCard && clickedCard.classList.contains("is-updated")) {
        clickedCard.classList.add("is-fading");
      }
      markDrawerSeen(button.dataset.id);
      // Picking a card from the list is an explicit "fresh start" —
      // it is NOT a follow of any in-content link, so any pending
      // wikilink nav history is stale and should be dropped.
      // Otherwise the back button on the freshly-opened memory would
      // surface a previously-visited memory the user already moved
      // on from by a different route.
      clearDrawerNavStack();
      // Also update the cached virtual-list HTML for this card so
      // the next renderDrawerWindow (triggered by ANY scroll, mode
      // toggle, or grid resize) doesn't blow away the live DOM's
      // .is-fading by replacing it with the stale .is-updated cache
      // entry. Without this, the tint would visibly snap back on
      // the next maximize/minimize cycle or scroll-window update.
      const drawerId = button.dataset.id;
      if (state._virtDrawers && state._virtCardsHtml) {
        const idx = state._virtDrawers.findIndex((d) => d.drawer_id === drawerId);
        if (idx >= 0) {
          const showWing = state.selectedWing === "all";
          const showRoom = state.selectedRoom === "all";
          state._virtCardsHtml[idx] = drawerCardHtml(state._virtDrawers[idx], showWing, showRoom);
        }
      }
      // Auto-clear the bell entry for this drawer in the same frame
      // as the click. A deliberate tap on a card IS the user "seeing"
      // the memory, so it dismisses the bell (writes bell:<id>) — while
      // a background 30s poll re-rendering the open drawer does NOT (it
      // only ever writes the plain seen-key via renderDrawerDetail), so
      // notifications are never silently cleared before a real tap.
      // markDrawerSeen() above cleared the card "Updated" dot (plain
      // <id>); markBellItemsSeen here clears the bell (bell:<id>). Both
      // update state._seenMap synchronously, so the renderNotifications
      // re-render below reflects the dismissal immediately — matches the
      // iOS / Mail pattern where viewing a message clears its badge.
      markBellItemsSeen([drawerId]);
      renderNotifications();
      // Update active class DIRECTLY in DOM — no re-render needed.
      // The cached card HTML doesn't include the active class, so we
      // manage selection visuals purely via classList here. Avoids
      // the expensive innerHTML swap just to flip one class.
      const prev = els.drawerList.querySelector(".drawer-card.active");
      if (prev) prev.classList.remove("active");
      const next = button.closest(".drawer-card");
      if (next) {
        next.classList.add("active");
        // Tactile click feedback — brief scale-up pop via CSS keyframe.
        // Re-trigger by removing + re-adding the class so consecutive
        // clicks on the same card both animate. requestAnimationFrame
        // ensures the browser registers the class removal before the
        // re-add, otherwise the second add would be a no-op.
        next.classList.remove("clicked-pop");
        requestAnimationFrame(() => next.classList.add("clicked-pop"));
        setTimeout(() => next.classList.remove("clicked-pop"), 360);
      }
      state.selectedDrawerId = button.dataset.id;
      state.detailOverride = null;
      state.detailDismissed = false;
      state.detailDirection = "forward";
      // Browse mode is for scanning the list without inspecting any
      // single memory — opening a memory is an explicit pivot back to
      // the standard 3-panel reading layout. Force browse off so the
      // ensuing renderDetail → updateGridLayout transition slides
      // Rooms back in and shrinks the grid to one column alongside
      // the freshly-opened Detail panel. Sync the maximize button's
      // labels so screen readers reflect the new state. Also save the
      // 4-col scroll so a future max → min cycle (after the user
      // finishes reading this memory) restores their browse position
      // — without this, re-entering browse after a card click would
      // always snap to top because the saved browse anchor would be
      // stale (0 from initialization).
      if (state.drawersEnlarged) {
        state._scrollByMode = state._scrollByMode || { normal: 0, browse: 0 };
        if (els.drawerList) {
          state._scrollByMode.browse = els.drawerList.scrollTop || 0;
        }
        state.drawersEnlarged = false;
        const drawersMaxBtn = document.querySelector("#drawersPanelMaximize");
        if (drawersMaxBtn) {
          drawersMaxBtn.setAttribute("aria-label", "Browse all memories");
          drawersMaxBtn.setAttribute("title", "Browse all");
        }
        // The 4-col→1-col layout switch reshapes the list entirely;
        // without an explicit scroll the user lands wherever the old
        // 4-col scrollTop happens to fall in the new 1-col coords
        // (often the top). Scroll the normal-mode list to the card
        // they just clicked so it's still in view when the panel
        // re-flows. Deferred to next frame so the grid/cols update
        // has settled and renderDrawerWindow knows it's 1-col.
        requestAnimationFrame(() => {
          updateGridLayout();
          scrollDrawerListToSelected();
        });
      }
      renderDetail();
      writeHash();
    });
  });
}

/** Scroll the drawer list so the currently-selected card is visible
 * in the active mode (normal 1-col or browse 4-col). Used by every
 * mode-transition path so the user's anchor — the card they're
 * actively reading or just clicked — stays in view across browse/
 * normal/maximize/minimize cycles. Falls back to leaving scroll
 * untouched when there's no selection or the card isn't in the
 * current filter result. Computes the target row index from the
 * virtualized list, positions the row ~30% from the top so it
 * doesn't crowd the bottom edge mask-fade. Two-pass-aware: re-
 * triggers renderDrawerWindow so the new visible window paints. */
function scrollDrawerListToSelected() {
  const drawerId = state.selectedDrawerId;
  if (!drawerId || !els.drawerList) return;
  if (!state._virtDrawers || !state._virtDrawers.length) return;
  const idx = state._virtDrawers.findIndex((d) => d.drawer_id === drawerId);
  if (idx < 0) return;
  const cols = state.drawersEnlarged ? browseModeProfile().cols : 1;
  const rowIdx = Math.floor(idx / cols);
  const targetTop = rowIdx * VIRT_ROW;
  const viewportHeight = els.drawerList.clientHeight || 600;
  // Position the card ~30% from top — comfortable reading height,
  // leaves room below for context cards.
  const scrollTo = Math.max(0, targetTop - viewportHeight * 0.3);
  els.drawerList.scrollTop = scrollTo;
  state._lastStartIdx = -1;
  state._lastEndIdx = -1;
  renderDrawerWindow();
}

function renderDrawerWindow() {
  const drawers = state._virtDrawers;
  const cache = state._virtCardsHtml;
  if (!drawers || !drawers.length || !cache) return;
  const list = els.drawerList;
  // Columns: 2/3/4 in browse mode (Memories panel maximized) per the
  // adaptive scale (see adaptiveBrowseCols), 1 otherwise. Legacy
  // path (adaptive pref off) sits at 4. The virtualizer computes its
  // window in ROW space and then expands to CARD space via × cols,
  // so the same windowing system feeds every layout — even with
  // thousands of drawers, browse mode stays as smooth as the default
  // view because we still only DOM-render the cards inside
  // (viewport ± buffer rows) × cols.
  const cols = state.drawersEnlarged ? browseModeProfile().cols : 1;
  // Push the column count down to CSS so .drawer-list's
  // grid-template-columns matches. Stamped on .drawers-panel (the
  // ancestor of .drawer-list) so it's available even before the
  // first render of the list. Done once per call — cheap, but worth
  // skipping when nothing changed to avoid pointless style invalidation.
  if (els.drawerList && els.drawerList.parentElement) {
    const wantStr = String(cols);
    if (els.drawerList.parentElement.style.getPropertyValue("--browse-cols") !== wantStr) {
      els.drawerList.parentElement.style.setProperty("--browse-cols", wantStr);
    }
  }
  const scrollTop = list.scrollTop || 0;
  const viewHeight = list.clientHeight || 600;

  const totalRows = Math.ceil(drawers.length / cols);
  const firstVisibleRow = Math.floor(scrollTop / VIRT_ROW);
  const lastVisibleRow = Math.ceil((scrollTop + viewHeight) / VIRT_ROW);
  const startRow = Math.max(0, firstVisibleRow - VIRT_BUFFER);
  const endRow = Math.min(totalRows, lastVisibleRow + VIRT_BUFFER);
  const startIdx = startRow * cols;
  const endIdx = Math.min(drawers.length, endRow * cols);

  // SKIP if the visible window AND the column count are both unchanged.
  // _lastCols is the new piece — without it, toggling browse mode at
  // the same scroll position would compute "same startIdx, same endIdx"
  // and skip the re-render even though the grid layout flipped 1↔4.
  if (
    state._lastStartIdx === startIdx
    && state._lastEndIdx === endIdx
    && state._lastCols === cols
  ) {
    return;
  }
  state._lastStartIdx = startIdx;
  state._lastEndIdx = endIdx;
  state._lastCols = cols;

  // Spacer sizing: rows × VIRT_ROW, minus one VIRT_CARD_GAP because
  // the spacer is itself a grid item and the parent grid adds gap
  // after it. Same math in both 1-col and 4-col since VIRT_ROW is the
  // height of one ROW (one card + one gap), and rows are the
  // virtualization unit regardless of cols.
  const topSpacer = startRow > 0 ? startRow * VIRT_ROW - VIRT_CARD_GAP : 0;
  const bottomSpacer = endRow < totalRows
    ? (totalRows - endRow) * VIRT_ROW - VIRT_CARD_GAP
    : 0;

  const cardsHtml = cache.slice(startIdx, endIdx).join("");

  list.classList.add("no-card-transition");

  // Spacers carry `grid-column: 1 / -1` so they span ALL columns in
  // browse mode (4-col grid). Without this a spacer would occupy one
  // cell of a 4-col row and the following cards would shift right of
  // it, breaking the row alignment. In 1-col the rule is a no-op.
  list.innerHTML =
    (topSpacer > 0 ? `<div class="virt-spacer" style="height:${topSpacer}px;grid-column:1/-1"></div>` : "")
    + cardsHtml
    + (bottomSpacer > 0 ? `<div class="virt-spacer" style="height:${bottomSpacer}px;grid-column:1/-1"></div>` : "");

  if (state.selectedDrawerId) {
    const activeCard = list.querySelector(`.drawer-card[data-id="${CSS.escape(state.selectedDrawerId)}"]`);
    if (activeCard) activeCard.classList.add("active");
  }

  // Waterfall stagger. Scoped to cards in the visible viewport (plus
  // one extra ROW below the fold so the trailing edge still cascades).
  // In browse mode this is rows × cols cards per stagger window —
  // matching the user-visible card count. Per-card 30ms stagger gives
  // a left-to-right top-to-bottom reading-order cascade in 4-col,
  // top-to-bottom in 1-col. Every visible card animates uniformly —
  // this is the same "opening a wing" feel applied to mode changes.
  // (Earlier iterations tried a "carry over" trick that skipped cards
  // already in the DOM, but the virt buffer covered exactly the cards
  // the new 4-col viewport showed, so almost nothing cascaded — the
  // visible effect was "memories appear super fast" instead of a
  // waterfall. Uniform cascade reads as intentional and matches the
  // motion vocabulary every other list-change uses.)
  if (state._waterfallNext) {
    state._waterfallNext = false;
    const wraps = list.querySelectorAll(".drawer-card-wrap");
    const visibleRows = Math.ceil(viewHeight / VIRT_ROW);
    const firstVisibleIdx = firstVisibleRow * cols;
    const cascadeEndIdx = (firstVisibleRow + visibleRows + 1) * cols;
    const wrapStart = Math.max(0, firstVisibleIdx - startIdx);
    const cascadeEnd = Math.min(wraps.length, cascadeEndIdx - startIdx);
    wraps.forEach((wrap, i) => {
      if (i < wrapStart || i >= cascadeEnd) return;
      const cascadeIdx = i - wrapStart;
      wrap.style.animationDelay = `${cascadeIdx * 30}ms`;
      wrap.classList.add("waterfall");
      wrap.addEventListener("animationend", () => {
        wrap.classList.remove("waterfall");
        wrap.style.animationDelay = "";
      }, { once: true });
    });
  }

  attachDrawerCardListeners();

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      list.classList.remove("no-card-transition");
    });
  });
}

function renderDrawers() {
  // Stamp the currently-selected drawer as seen BEFORE the card HTML
  // cache rebuilds. Without this, paths that change selectedDrawerId
  // via state mutation + render() — wikilink follows, hash deep-links,
  // arrow-key navigation, tunnel-detail "open memory" buttons — would
  // build the destination card with .is-updated still on, because
  // isRecentlyUpdated() runs against the OLD seenAt map. The
  // markDrawerSeen call in renderDrawerDetail (further down the
  // render chain) lands AFTER the card cache is already built, so
  // it doesn't help for the current render — only the NEXT one. The
  // card-click path doesn't have this problem because its handler
  // stamps seen + patches the cache entry directly BEFORE state
  // changes (see attachDrawerCardListeners). Doing it here covers
  // every other path with one line.
  if (state.selectedDrawerId) markDrawerSeen(state.selectedDrawerId);
  const allForWing = state.palace.drawers.filter(
    (drawer) => state.selectedWing === "all" || drawer.wing === state.selectedWing,
  );
  renderRooms(allForWing);

  const drawers = filteredDrawers();
  els.drawerCount.textContent = `${drawers.length} visible`;
  // Adaptive browse — sync the maximize button's visibility and
  // possibly force-exit browse mode if the new filter shrunk the
  // list below the hide threshold. Runs after every filter change
  // so the toggle disappears the moment a wing/room/query narrows
  // the view past the easy-scroll size, and reappears when the
  // filter relaxes back.
  syncAdaptiveBrowse();
  // Notification bell — recomputes the badge count + dropdown panel
  // contents from the GLOBAL set of recently-updated unseen drawers
  // (not just visible ones). Runs every renderDrawers pass so the
  // count tracks card clicks, wikilink follows, edits, bulk-clears,
  // and anything else that mutates the seen map.
  renderNotifications();

  // Two related signatures, split to fire different effects:
  //
  //   navSig = wing|room|query|sort — the user's NAVIGATION intent.
  //   When this changes, the list is showing a fundamentally
  //   different slice and the scroll position from the previous
  //   slice is stale; reset drawerList.scrollTop (and the per-mode
  //   scroll anchors) so the new wing/room/search opens at the top
  //   the way every native list does when you switch sections. Same
  //   spirit as renderDrawerDetail's "different drawer → scroll 0"
  //   behavior for the third panel.
  //
  //   filterSig = navSig|length — adds the result length so a memory
  //   add or delete (which doesn't change navigation but DOES change
  //   the visible list) still fires the waterfall stagger animation.
  //   We don't reset scroll on a pure length change, though — a user
  //   deleting card #4 while scrolled to #20 wants to stay near #20,
  //   not get yanked to the top by an unrelated mutation.
  const navSig = `${state.selectedWing}|${state.selectedRoom}|${state.query}|${state.sortBy}`;
  const filterSig = `${navSig}|${drawers.length}`;
  if (navSig !== state._lastDrawerNavSig) {
    // Navigation changed (wing/room/query/sort) — reset list scroll
    // to the top and clear the per-mode anchors. els.drawerList may
    // not exist yet on the very first render; guarded for that.
    if (els.drawerList) els.drawerList.scrollTop = 0;
    state._scrollByMode = { normal: 0, browse: 0 };
    state._lastStartIdx = -1;
    state._lastEndIdx = -1;
    state._lastDrawerNavSig = navSig;
  }
  if (filterSig !== state._lastDrawerFilterSig) {
    state._waterfallNext = true;
    state._lastDrawerFilterSig = filterSig;
  }

  if (!state.palace.drawers.length) {
    els.drawerList.innerHTML = `<div class="empty-list"><strong>No memories yet.</strong><br/>Click <em>Write</em> to add the first one.</div>`;
    state._virtDrawers = null;
    invalidateCardCache();
    return;
  }
  if (!drawers.length) {
    els.drawerList.innerHTML = `<div class="empty-list">No memories match your current filters.</div>`;
    state._virtDrawers = null;
    invalidateCardCache();
    return;
  }

  state._virtDrawers = drawers;
  // Pre-compute card HTML ONCE per filter/sort pass. The heavy work
  // (cleanForPreview regex + escapeHtml + kicker assembly per card)
  // happens here, not on every scroll re-render. renderDrawerWindow
  // then just slices the cache. Selection state isn't baked in (the
  // click handler / window renderer manage `.active` via classList),
  // so this cache only invalidates when the underlying drawer list,
  // wing, or room scope changes.
  const showWing = state.selectedWing === "all";
  const showRoom = state.selectedRoom === "all";
  state._virtCardsHtml = drawers.map((d) => drawerCardHtml(d, showWing, showRoom));
  // Reset the scroll-window cache so the next render isn't skipped.
  state._lastStartIdx = -1;
  state._lastEndIdx = -1;
  renderDrawerWindow();

  // One-time scroll listener: rAF-throttled re-render of the window
  // as the user scrolls. Re-using a single listener across all
  // renderDrawers calls keeps the event subscription stable when the
  // drawers change.
  if (!state._virtScrollWired) {
    state._virtScrollWired = true;
    let rafPending = false;
    els.drawerList.addEventListener("scroll", () => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        renderDrawerWindow();
      });
    }, { passive: true });
  }
}

// Applies the directional slide to the detail panel after a re-render.
// Reads + clears state.detailDirection so a single nav action animates one
// turn. Dispatches between two animation scopes:
//
//   - Layout switch (drawer ↔ tunnel ↔ empty): the WHOLE panel slides.
//     A different "kind of thing" is being shown so the container-level
//     gesture matches the semantic change.
//   - Same-kind value update (drawer A → drawer B, tunnel A → tunnel B):
//     ONLY the value cells animate (the strong tags and the markdown
//     body). Static scaffolding — section labels, field labels, action
//     buttons — stays put. Apple's rule: motion reinforces meaning, so
//     don't animate what didn't change. iOS Music switches tracks the
//     same way (artwork + metadata crossfade, controls don't move).
//
// Render fns stamp els.detail.dataset.detailKind ("drawer" | "tunnel" |
// "empty") before innerHTML; we compare against state.previousDetailKind
// to decide which scope.
function applyDetailTransition() {
  const dir = state.detailDirection;
  state.detailDirection = null;
  if (!dir) return;
  const node = els.detail;
  if (!node || node.classList.contains("hidden")) return;
  const currentKind = node.dataset.detailKind || "";
  const previousKind = state.previousDetailKind || "";
  state.previousDetailKind = currentKind;
  // Boot suppression: on a cached reload the detail panel renders TWICE
  // (cache paint, then live-fetch overwrite). Replaying the slide/fade
  // on each is the grey meta-strip "flicker". During boot detailDirection
  // is never set, so this function early-returns at `if (!dir)` above and
  // never even reaches here — but keep this guard as defence in case a
  // future boot path does set a direction. previousDetailKind is instead
  // seeded directly from the rendered DOM at the end of boot() (see the
  // `state.previousDetailKind = els.detail.dataset.detailKind` there), so
  // the first real navigation classifies drawer→drawer as a same-kind
  // body-rise rather than a kind-change slide.
  if (state._suppressDetailTransition) return;
  // Clear any prior animation class so the keyframe restarts on rapid taps.
  node.classList.remove(
    "detail-enter-forward", "detail-enter-backward",
    "detail-values-forward", "detail-values-backward",
  );
  // eslint-disable-next-line no-unused-expressions
  void node.offsetWidth;
  const layoutSwitch = currentKind !== previousKind;
  const prefix = layoutSwitch ? "detail-enter-" : "detail-values-";
  node.classList.add(prefix + (dir === "backward" ? "backward" : "forward"));
}

function renderDetail() {
  // Dispatch order:
  //   1. detailOverride — in-pane drawer view pushed from the tunnel
  //      inspector. Rendered with a "← Back" button that pops back to
  //      whatever the override originated from. Does NOT change selected
  //      wing/room/drawer in the rest of the UI, so the middle and left
  //      panes stay where the user left them.
  //   2. selectedDrawerId — the normal drawer-detail view (drawer card
  //      clicked in the middle pane, wiki-link followed, etc.).
  //   3. tunnel for selected room — auto-inspector when no drawer is in
  //      play but the room has tunnels.
  //   4. empty state.
  if (state.detailOverride) {
    const overrideDrawer = state.palace.drawers.find(
      (d) => d.drawer_id === state.detailOverride.drawerId,
    );
    if (overrideDrawer) {
      const origin = state.detailOverride.originTunnelId
        ? state.tunnels.find((t) => t.id === state.detailOverride.originTunnelId)
        : null;
      renderDrawerDetail(overrideDrawer, { backToTunnel: origin });
      applyDetailTransition();
      updateGridLayout();
      return;
    }
    state.detailOverride = null;
  }
  const drawer = state.selectedDrawerId
    ? state.palace.drawers.find((item) => item.drawer_id === state.selectedDrawerId)
    : null;
  if (drawer) {
    renderDrawerDetail(drawer);
    applyDetailTransition();
    updateGridLayout();
    return;
  }
  if (!state.detailDismissed && state.selectedRoom && state.selectedRoom !== "all") {
    const entries = state.selectedWing === "all"
      ? tunnelsForRoomAcrossWings(state.selectedRoom)
      : tunnelsForRoom(state.selectedWing, state.selectedRoom);
    if (entries.length > 0) {
      renderTunnelDetail(entries[0].tunnel);
      applyDetailTransition();
      updateGridLayout();
      return;
    }
  }
  els.detail.classList.add("hidden");
  els.detail.innerHTML = "";
  els.detail.dataset.detailKind = "empty";
  state.previousDrawerData = null;
  state.previousTunnelData = null;
  // Empty state: nothing to bind to → clear the tunnel chip + watermark
  // so a leftover indicator from a previously-rendered drawer doesn't
  // linger over the blank panel.
  updateTunnelBindIndicator(null, []);
  updateGridLayout();
}

// Extracted so both the normal drawer-detail dispatch and the in-pane
// override dispatch share one implementation. `opts.backToTunnel`, when
// set, prepends an iOS-style back button that pops the override and
// returns to the tunnel inspector with the reverse slide animation.
function renderDrawerDetail(drawer, opts = {}) {
  const { backToTunnel } = opts;
  // Mark this drawer as seen — covers every code path that shows a
  // drawer to the user (card click, hash deep-link, keyboard nav,
  // tunnel inspector → memory). The "recently updated" marker
  // suppresses on any drawer whose seen-at is later than its
  // updated_at, so viewing a memory clears its dot immediately on
  // the next render (typical case: user clicks the card, sees it,
  // clicks away — the card no longer has the Updated tag).
  markDrawerSeen(drawer.drawer_id);
  // Stable identity for the open drawer so a background poll can follow
  // it across an agent's MCP-side update, which re-embeds the memory under
  // a NEW drawer_id (the creation time `filed_at` is preserved; the id is
  // not). Consumed by reconcileSelection so the detail panel the user is
  // reading is never collapsed just because an agent touched the memory.
  state._selectedDrawerSig = {
    filed_at: drawer.filed_at,
    title: drawer.title,
    wing: drawer.wing,
    room: drawer.room,
  };
  // Per-cell change detection so only the cells whose value actually
  // changed get the value-slide animation on a drawer → drawer
  // transition. Captured BEFORE we stamp the new kind / data so we can
  // compare against the prior render's drawer object.
  const wasDrawer = els.detail.dataset.detailKind === "drawer";
  const prevDrawer = wasDrawer ? state.previousDrawerData : null;
  const isNew = (key) => !prevDrawer || prevDrawer[key] !== drawer[key];

  // No-op short-circuit. On a cached reload the panel renders TWICE —
  // cache paint, then live-fetch overwrite — and on a same-drawer poll
  // refresh it re-renders too. When the live/refresh render targets the
  // SAME drawer with byte-identical content, fields, and edit state as
  // what's already in the DOM, rebuilding els.detail.innerHTML would
  // destroy + recreate the entire subtree (including the grey
  // .detail-meta strip) for zero visual change — which is exactly the
  // meta-strip "flicker/pop" on reload. Bail before touching the DOM in
  // that case: the existing nodes stay put, nothing flickers. We still
  // refresh the tunnel-bind indicator (cheap, its own element) since a
  // poll could have changed tunnels without changing the drawer.
  const isEditingThisEarly = state.isEditing
    && state.editBuffer
    && state.editBuffer.drawerId === drawer.drawer_id;
  const sameDrawerInDom = wasDrawer
    && prevDrawer
    && prevDrawer.drawer_id === drawer.drawer_id
    && prevDrawer.content === drawer.content
    && prevDrawer.title === drawer.title
    && prevDrawer.updated_at === drawer.updated_at
    && prevDrawer.source_file === drawer.source_file
    && prevDrawer.added_by === drawer.added_by
    && prevDrawer.wing === drawer.wing
    && prevDrawer.room === drawer.room;
  // Only short-circuit when NOT (entering/leaving the inline editor) —
  // the editor swaps the body markup, so its renders must run. Also
  // require the back-bar state to be unchanged (a peek that gained/lost
  // its "← Back to tunnel" bar needs the rebuild).
  const backBarUnchanged =
    Boolean(backToTunnel) === Boolean(els.detail.querySelector(".detail-back-bar"));
  // If the body still holds the inline editor (a contenteditable
  // surface), we're transitioning OUT of edit mode — cancel or commit.
  // The dirty editor DOM MUST be rebuilt into the clean read-only view
  // even though the saved drawer fields look unchanged: on cancel the
  // edits were never committed (they live only in the contenteditable +
  // the now-nulled editBuffer), so sameDrawerInDom is true and the
  // fast-path would early-return, leaving the unsaved typing (e.g. a
  // stray empty line from Enter) visible in "view" mode. The editor body
  // is the only node with contenteditable="true" (callout label/remove
  // buttons are "false"), so its presence is a clean exit-edit signal.
  const editorInDom = !!els.detail.querySelector('[contenteditable="true"]');
  if (sameDrawerInDom && !isEditingThisEarly && !state.isEditing && backBarUnchanged && !editorInDom) {
    // Keep state + tunnel chip in sync, then leave the DOM untouched.
    state.previousDrawerData = drawer;
    state.previousTunnelData = null;
    state.detailDirection = null; // consume any pending slide; nothing to animate
    const drawerTunnelsNow = tunnelsForDrawer(drawer.drawer_id);
    updateTunnelBindIndicator(drawer, drawerTunnelsNow);
    return;
  }

  els.detail.classList.remove("hidden");
  // Real content is about to replace the static skeleton band — drop
  // the marker class so it's only ever a one-time pre-paint placeholder.
  els.detail.classList.remove("detail-skeleton");

  // Drawer ID format is `drawer_<wing>_<room>_<hash>` — the wing/room
  // prefix is duplicated info (visible in the sidebar / rooms panel) so
  // we show only the trailing hash and keep the full id in title for
  // hover + the Copy ID button copies the full thing.
  const drawerIdSuffix = (drawer.drawer_id || "").split("_").pop() || drawer.drawer_id;

  // Wing and Room dropped from this block — they're already conveyed by
  // the selected wing in the sidebar and the highlighted room in the
  // rooms panel. Showing them here was redundant chrome.
  // Filed gets the readable timestamp format; the full ISO sits in the
  // title attribute for hover and copy-paste use.
  const filedDisplay = drawer.filed_at ? formatTimestamp(drawer.filed_at) : "";
  // Location (wing / room) — shown only in enlarged mode (CSS hides
  // it in normal-width view to keep the 4-cell layout compact). Gives
  // useful palace-hierarchy context when the user opened a memory via
  // search / deep-link / All Memory, so they know exactly where the
  // drawer lives without having to glance back at the sidebar.
  const locationDisplay = drawer.wing && drawer.room
    ? `${humanizeName(drawer.wing)} / ${humanizeName(drawer.room)}`
    : "";
  // Updated cell shows the relative "Xh ago" string ONLY when the
  // drawer was modified within the recent threshold AND the modify
  // time is meaningfully later than creation (no point showing
  // "Updated 5m ago" right after a memory is created). Carries the
  // accent dot class so it's visually emphasised the same way the
  // card-list dot is — same family of UI signal.
  const updatedRecent = isRecentlyUpdated(drawer)
    && drawer.updated_at && drawer.updated_at !== drawer.filed_at;
  const updatedDisplay = updatedRecent ? formatRelativeTime(drawer.updated_at) : "";
  // Tunnels-cell: when this memory is a drawer-bound endpoint on any
  // Tunnel bind state — surfaced via a low-opacity horizontal-glyph
  // watermark on the panel + a floating bottom-LEFT chip (opposite
  // the edit/delete buttons) instead of the meta strip's "TUNNELS ↕ 1"
  // cell, which read as cramped and visually noisy next to the other
  // metadata. The chip is rendered into #detailPanelTunnelInfo
  // further below; the watermark is toggled via .has-tunnel on
  // .detail-panel.
  const drawerTunnels = tunnelsForDrawer(drawer.drawer_id);
  const tunnelsCount = drawerTunnels.length;
  // Cell ORDER matters for layout stability: the always-present cells
  // (Drawer / Date / Source / Author) come first and occupy fixed
  // columns (see .detail-meta CSS), so their positions never move
  // between drawers. The CONDITIONAL cells (Updated — only when
  // recently changed; Location — only in enlarged view) are pushed to
  // the END so their appearing/disappearing can't shove the core four
  // sideways. Updated moved from index 2 → after Author for exactly
  // this reason.
  const metadata = [
    { label: "Drawer", display: drawerIdSuffix, full: drawer.drawer_id, changed: isNew("drawer_id") },
    { label: "Date", display: filedDisplay, full: drawer.filed_at, changed: isNew("filed_at") },
    { label: "Source", display: drawer.source_file, full: drawer.source_file, changed: isNew("source_file") },
    { label: "Author", display: prettifyActorName(drawer.added_by), full: drawer.added_by, changed: isNew("added_by") },
    { label: "Updated", display: updatedDisplay, full: drawer.updated_at, changed: false, recent: true },
    { label: "Location", display: locationDisplay, full: locationDisplay, changed: isNew("wing") || isNew("room"), enlargedOnly: true },
  ].filter((cell) => cell.display);
  const contentChanged = isNew("content");

  // (The old per-drawer tunnel-jump icon was removed — the tunnel
  // inspector is the canonical way to reach a tunnel now: click the
  // room with the tunnel-glyph indicator and the inspector loads in
  // the right pane. Keeping a one-click jump here re-introduces the
  // pre-standardisation shortcut.)

  // Eyebrow-style back affordance — two flavours sharing one chrome:
  //   • backToTunnel: the drawer was opened from a tunnel inspector
  //     peek. Pop returns to the tunnel.
  //   • drawerNavStack non-empty: the drawer was opened by following
  //     a wikilink (or hyperlink that resolved to a drawer). Pop
  //     returns to the originating memory. The label names the
  //     target so the user knows which memory the back button will
  //     surface; tunnels stay with the generic "Back to tunnel"
  //     label because tunnel inspectors aren't titled artifacts the
  //     user holds in their head.
  // Matches the typography used for FROM / TO / ABOUT THIS CONNECTION
  // elsewhere in the inspector so the chrome reads as one UI, not a
  // transplanted iOS bar. The arrow is the same Unicode glyph as the
  // route arrow between endpoint cards (just facing the other way).
  // Generic previous-memory label — same chrome regardless of which
  // memory the back step lands on. Inserting the previous title here
  // read as visually noisy and forced length-capping for long titles;
  // "Back to previous memory" is enough for the user to know the
  // affordance returns them to where the wikilink was clicked.
  const backBar = drawerBackBarHtml(backToTunnel);

  els.detail.dataset.detailKind = "drawer";
  // Scroll preservation is conditional: keep the cursor where it was
  // ONLY when this render is a re-render of the SAME drawer (entering
  // edit mode, saving, canceling, metadata refresh — the panel should
  // stay where the user was reading). When a DIFFERENT drawer is
  // being shown — the user clicked a new card — the panel naturally
  // resets to the top, same way every native document viewer behaves
  // when you switch documents. Detected via state.previousDrawerData,
  // which is stashed at the end of this function on every drawer
  // render; differs from drawer.drawer_id means "this is a fresh
  // memory in the panel." On the very first render (previousDrawer-
  // Data is null), there's no scroll to restore anyway, so the
  // condition naturally falls through to scrollTop = 0.
  const isSameDrawer = state.previousDrawerData
    && state.previousDrawerData.drawer_id === drawer.drawer_id;
  // Back-button pop sets state._restoreDetailScroll to the scrollTop
  // we captured at push time so popping back lands the user where
  // they were reading. Consumed once, then cleared so a subsequent
  // unrelated render doesn't try to re-apply it.
  let popScrollRestore = null;
  if (state._restoreDetailScroll !== null && state._restoreDetailScroll !== undefined) {
    popScrollRestore = state._restoreDetailScroll;
    state._restoreDetailScroll = null;
  }
  const savedDetailScroll = popScrollRestore !== null
    ? popScrollRestore
    : (isSameDrawer ? els.detail.scrollTop : 0);
  // Body branch: when the user has clicked the pencil and editBuffer
  // targets THIS drawer, render the inline editor in place of the
  // static markdown body. If editBuffer targets a different drawer
  // (user navigated mid-edit), silently cancel the edit so the new
  // drawer renders normally — buffer was unsaved scratch.
  const isEditingThis = state.isEditing
    && state.editBuffer
    && state.editBuffer.drawerId === drawer.drawer_id;
  if (state.isEditing && state.editBuffer
      && state.editBuffer.drawerId !== drawer.drawer_id) {
    state.isEditing = false;
    state.editBuffer = null;
    state.editError = "";
  }
  const bodyHtml = isEditingThis
    ? renderInlineEditorHtml(state.editBuffer)
    : `<div class="markdown ${contentChanged ? "value-changed" : ""}">${markdownLite(drawer.content)}</div>`;
  // Tunnel-bind watermark inside the META STRIP background — a wide,
  // low-opacity horizontal graph-edge SVG sitting behind the metadata
  // cells. Rendered here (instead of as a sibling of .detail) so it
  // shares the meta strip's lifetime + visibility: the meta strip is
  // always rendered for any drawer, so the watermark is visible even
  // in non-enlarged mode (where the floating chip on the right is
  // hidden). That makes "this memory is linked" detectable at a
  // glance without having to maximize first.
  const tunnelMetaWatermark = detailMetaWatermarkHtml(tunnelsCount);
  els.detail.innerHTML = `
    ${backBar}
    <div class="detail-meta">
      ${tunnelMetaWatermark}
      ${metadata
        .map(drawerMetadataCellHtml)
        .join("")}
    </div>
    ${bodyHtml}
  `;

  // Apply the scroll position decided above (current scrollTop for
  // same-drawer re-renders, 0 for a fresh drawer). Force a layout
  // flush via offsetHeight first so the browser knows the new
  // scrollHeight bounds — without this, a restore to a value past
  // the new content's max gets clamped to whatever the stale layout
  // reported, snapping the user further up than intended.
  void els.detail.offsetHeight;
  els.detail.scrollTop = savedDetailScroll;

  // Wire inline editor inputs if we just rendered the editor body —
  // every keystroke needs to flow into state.editBuffer so renders
  // triggered by unrelated state don't lose the in-flight edits.
  if (isEditingThis) wireInlineEditorInputs();

  // Stash for next render's diff. Reset the other-kind stash so a future
  // drawer-after-tunnel transition doesn't compare against a stale
  // tunnel data structure.
  state.previousDrawerData = drawer;
  state.previousTunnelData = null;

  // Tunnel-bind affordance — floating chip at bottom-LEFT (mirroring
  // the edit/delete cluster on bottom-right) + low-opacity watermark
  // across the panel background. Both replace the old TUNNELS meta
  // cell, which was visually noisy. Renders only when the drawer
  // actually has a tunnel; otherwise both are cleared/hidden.
  updateTunnelBindIndicator(drawer, drawerTunnels);

  const backBtn = els.detail.querySelector("#detailBackBtn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      state.detailDirection = "backward";
      if (state.detailOverride) {
        // Tunnel-pushed peek — clearing the override returns the
        // detail panel to the originating tunnel inspector via the
        // normal renderDetail dispatch.
        state.detailOverride = null;
      } else if (state.drawerNavStack && state.drawerNavStack.length) {
        // Wikilink-pushed nav — pop the most recent entry and
        // restore the full pre-follow selection in one shot. Stash
        // the captured scrollTop for renderDrawerDetail to consume
        // on the next render so the popped-into memory reopens at
        // the exact reading position the user left.
        const prev = state.drawerNavStack.pop();
        if (prev) {
          state.selectedWing = prev.wing;
          state.selectedRoom = prev.room;
          state.selectedDrawerId = prev.drawerId;
          state.detailOverride = prev.override
            ? { ...prev.override }
            : null;
          state.detailEnlarged = !!prev.detailEnlarged;
          state.detailDismissed = false;
          state._restoreDetailScroll = prev.scroll || 0;
        }
      }
      render();
    });
  }

  // Drawer-hash copy: click the truncated hash to copy the full id.
  // Feedback is a small "Copied" pill toast that pops above the hash
  // and fades out — same gesture as macOS / iOS "Copied" affordances.
  els.detail.querySelectorAll("[data-copy-drawer-id]").forEach((el) => {
    el.addEventListener("click", async (event) => {
      const ok = await copyToClipboard(el.dataset.copyDrawerId);
      showCopiedToast(el, ok ? "Copied" : "Copy failed", !ok, event);
    });
  });

  // Code-block copy: click the top-right clipboard icon on any fenced
  // code block to copy the whole block. The button briefly swaps to a
  // checkmark and gets a `copied` class for 1.4s so the user gets
  // visual confirmation without an extra toast cluttering the dense
  // code-block area. Button is a sibling of the <pre> (inside the
  // shared .code-block-wrap), not a child — that way it stays pinned
  // when the <pre> scrolls horizontally. Read text from the sibling
  // <code> at click time — no DOM-bloating data-* duplicate of the
  // code.
  els.detail.querySelectorAll(".code-copy-btn").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      const wrap = btn.closest(".code-block-wrap");
      const code = wrap ? wrap.querySelector("pre.code-block > code") : null;
      if (!code) return;
      const ok = await copyToClipboard(code.textContent);
      if (ok) {
        btn.classList.add("copied");
        clearTimeout(btn._copiedTimer);
        btn._copiedTimer = setTimeout(() => btn.classList.remove("copied"), 1400);
      } else {
        showCopiedToast(btn, "Copy failed", true, event);
      }
    });
  });

  els.detail.querySelectorAll("a.wiki-link").forEach((a) => {
    a.addEventListener("click", (event) => {
      event.preventDefault();
      const target = a.dataset.link;
      if (!target || !state.palace) return;
      // Resolver order — chosen so the canonical pipe-syntax form
      // [[drawer_id|Display]] is the fastest and most precise path,
      // and older bare-name forms still resolve where they can:
      //
      //   1. EXACT drawer_id match (case-sensitive, no normalize). The
      //      anchor is meant to be a stable id; matching loosely here
      //      would let typos open the wrong memory.
      //   2. Case-insensitive title match. Backwards-compat with the
      //      pre-pipe format that put titles inside the brackets.
      //   3. Case-insensitive drawer_id match. Defensive — covers
      //      drawer_ids that got case-munged in transit.
      //   4. Search-query fallback. When the anchor doesn't resolve to
      //      any drawer, populate the search input so the user can
      //      see what was being referenced.
      const drawers = state.palace.drawers || [];
      let match = drawers.find((d) => d.drawer_id === target);
      if (!match) match = drawers.find((d) => norm(d.title) === norm(target));
      if (!match) match = drawers.find((d) => norm(d.drawer_id) === norm(target));
      if (match) {
        // Don't push a no-op back step when the link points at the
        // memory the user is already reading — that would surface a
        // back button to nowhere.
        const targetingSelf = match.drawer_id === state.selectedDrawerId
          && !state.detailOverride;
        if (!targetingSelf) {
          // Push the current detail-pane state onto the nav stack
          // BEFORE mutating selection so the back button at the top
          // of the followed-into memory can return here. Captures
          // the tunnel override if the user got here from a tunnel
          // peek, the enlarged state, and the scroll position so a
          // pop restores exactly what they saw.
          pushDrawerNavEntry();
          // Forward direction for the slide-in transition — same
          // animation as opening a memory from the card list.
          state.detailDirection = "forward";
        }
        // Wiki-link follow is a "deep nav" rather than an in-pane peek —
        // clear the override so the rest of the UI updates too.
        state.detailOverride = null;
        state.detailDismissed = false;
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

// ---------- tunnel inspector ----------
// Renders the right-hand detail panel as a graphical tunnel view: a header
// with the tunnel id, two endpoint cards with a directional arrow between
// them, the label as the body, and a metadata footer with a Delete action.
// Drawer-bound endpoints show the bound memory's title and an "Open
// memory" affordance; room-only endpoints show the room's memory count
// and an "Open room" affordance. Either way, the buttons clear the tunnel
// selection so the right pane returns to drawer-detail mode once the user
// commits to a destination.
// MemPalace exposes no tool_update_tunnel; tool_create_tunnel doubles as the
// update path (same canonical id for the same endpoints → existing record
// gets its label/drawer_ids overwritten and an updated_at stamp added).
// Anything the inspector can mutate funnels through this one helper so the
// "preserve everything you didn't touch" rule lives in one place.
async function updateTunnel(tunnel, changes) {
  const sourceDrawer = (tunnel.source && tunnel.source.drawer_id) || "";
  const targetDrawer = (tunnel.target && tunnel.target.drawer_id) || "";
  const body = {
    source_wing: tunnel.source.wing,
    source_room: tunnel.source.room,
    target_wing: tunnel.target.wing,
    target_room: tunnel.target.room,
    label: tunnel.label || "",
    source_drawer_id: sourceDrawer,
    target_drawer_id: targetDrawer,
    ...changes,
  };
  return postJson("/api/tunnels", body);
}

function renderTunnelDetail(tunnel) {
  // Defensive: render() can fire before loadPalace() resolves (initial page
  // load with ?t=… in the hash). Without drawers we can't enrich endpoint
  // cards with counts/titles, so fall back to the empty state and wait for
  // the next render after palace data arrives.
  if (!state.palace) {
    els.detail.classList.add("hidden");
    els.detail.innerHTML = "";
    els.detail.dataset.detailKind = "empty";
    updateTunnelBindIndicator(null, []);
    return;
  }
  // Tunnel inspector replaces drawer detail in this panel — clear the
  // drawer-bound indicator so it doesn't sit on top of the inspector.
  updateTunnelBindIndicator(null, []);
  els.detail.classList.remove("hidden");

  // Per-cell diff against the prior tunnel render so unchanged endpoint
  // labels / metadata don't animate on a tunnel → tunnel transition.
  const wasTunnel = els.detail.dataset.detailKind === "tunnel";
  const prevTunnel = wasTunnel ? state.previousTunnelData : null;
  const ptSrc = (prevTunnel && prevTunnel.source) || {};
  const ptTgt = (prevTunnel && prevTunnel.target) || {};

  const sourceWing = tunnelWingForm(tunnel.source && tunnel.source.wing);
  const targetWing = tunnelWingForm(tunnel.target && tunnel.target.wing);
  const sourceRoom = (tunnel.source && tunnel.source.room) || "";
  const targetRoom = (tunnel.target && tunnel.target.room) || "";
  const sourceDrawerId = tunnel.source && tunnel.source.drawer_id;
  const targetDrawerId = tunnel.target && tunnel.target.drawer_id;
  const sourceDrawer = sourceDrawerId
    ? state.palace.drawers.find((d) => d.drawer_id === sourceDrawerId)
    : null;
  const targetDrawer = targetDrawerId
    ? state.palace.drawers.find((d) => d.drawer_id === targetDrawerId)
    : null;
  const cellChanged = (side, key, value) => {
    const prev = side === "source" ? ptSrc : ptTgt;
    return !prevTunnel || tunnelWingForm(prev[key]) !== value;
  };
  const labelChanged = !prevTunnel || (prevTunnel.label || "") !== (tunnel.label || "");
  const idChanged = !prevTunnel || prevTunnel.id !== tunnel.id;
  const createdChanged = !prevTunnel || prevTunnel.created_at !== tunnel.created_at;
  const updatedChanged = !prevTunnel || prevTunnel.updated_at !== tunnel.updated_at;
  const kindChanged = !prevTunnel || prevTunnel.kind !== tunnel.kind;
  const cls = (changed) => changed ? "value-changed" : "";

  const drawersInRoom = (wing, room) => state.palace.drawers.filter(
    (d) => d.room === room && (d.wing === wing
      || d.wing.replace(/_/g, "-") === wing
      || d.wing.replace(/-/g, "_") === wing),
  );

  const renderCard = (side, wing, room, drawer) => {
    const inRoom = drawersInRoom(wing, room);
    const count = inRoom.length;
    const eyebrow = side === "source" ? "From" : "To";
    const wingChanged = cellChanged(side, "wing", wing);
    const roomChanged = cellChanged(side, "room", room);
    const prevDrawerId = (side === "source" ? ptSrc.drawer_id : ptTgt.drawer_id) || null;
    const drawerChanged = !prevTunnel || prevDrawerId !== (drawer ? drawer.drawer_id : null);
    // Drawer-bound endpoints get a dashed memory chip with an unbind ×;
    // unbound endpoints get the count and an inline picker that lists every
    // drawer in the endpoint's wing/room.
    const drawerDisplayTitle = drawer ? (cleanTitle(drawer.title) || drawer.drawer_id) : "";
    const drawerBlock = drawer
      ? `<div class="tunnel-endpoint-drawer">
          <span class="tunnel-endpoint-drawer-label">Memory</span>
          <strong class="${cls(drawerChanged)}" title="${escapeHtml(drawerDisplayTitle)}">${escapeHtml(drawerDisplayTitle)}</strong>
          <button class="tunnel-endpoint-unbind" type="button"
            data-tunnel-unbind="${escapeHtml(side)}"
            title="Unbind this memory — endpoint becomes room-level"
            aria-label="Unbind memory">×</button>
        </div>`
      : `<div class="tunnel-endpoint-stat ${cls(drawerChanged || wingChanged || roomChanged)}">${count} ${count === 1 ? "memory" : "memories"} in this room</div>`;
    // "Open memory →" link, header-row right side — opposite the FROM/TO
    // eyebrow. Conditional: only rendered for drawer-BOUND endpoints
    // (where there's a specific memory to open). Unbound endpoints are
    // room-only references; the user can reach the room via the Rooms
    // panel. Compact text-link styling (not a full button) so the chrome
    // stays anchored to the header and doesn't claim a card-bottom row
    // pushing "About this connection" off-viewport.
    const openLink = drawer
      ? `<button class="tunnel-endpoint-open" type="button"
          data-tunnel-open-side="${escapeHtml(side)}"
          aria-label="Open this memory"
          title="Open this memory">
          Open memory →
        </button>`
      : "";
    // Build the bind picker. Skip it if the endpoint is already bound or
    // there's nothing to pick (room missing or empty).
    const bindBlock = (!drawer && inRoom.length > 0)
      ? `<details class="tunnel-endpoint-bind">
          <summary>Bind a specific memory…</summary>
          <select data-tunnel-bind="${escapeHtml(side)}" aria-label="Pick a memory to bind">
            <option value="">— pick one —</option>
            ${inRoom.map((d) => `<option value="${escapeHtml(d.drawer_id)}">${escapeHtml(cleanTitle(d.title) || d.drawer_id)}</option>`).join("")}
          </select>
        </details>`
      : "";
    return `<div class="tunnel-endpoint">
      <div class="tunnel-endpoint-head">
        <div class="tunnel-endpoint-eyebrow">${eyebrow}</div>
        ${openLink}
      </div>
      <div class="tunnel-endpoint-wing ${cls(wingChanged)}">${escapeHtml(humanizeName(wing))}</div>
      <div class="tunnel-endpoint-room ${cls(roomChanged)}">${escapeHtml(humanizeName(room))}</div>
      ${drawerBlock}
      ${bindBlock}
    </div>`;
  };

  // formatTimestamp for the full "DD MMM YYYY – HH:MM" rendering. Consistent
  // with the drawer Filed cell so the two detail views read alike.
  const filed = tunnel.created_at ? formatTimestamp(tunnel.created_at) : "";
  const updated = tunnel.updated_at ? formatTimestamp(tunnel.updated_at) : "";
  // Tunnel id shows as short hash + full form (same drawer-id pattern in
  // the memory detail), tied to a click-to-copy via data-copy-tunnel-id.
  const tunnelIdShort = (tunnel.id || "").slice(-12);
  const metaCells = [
    { label: "Tunnel", display: tunnelIdShort, full: tunnel.id, changed: idChanged, isTunnelCell: true },
    filed ? { label: "Created", display: filed, full: tunnel.created_at, changed: createdChanged } : null,
    updated && updated !== filed ? { label: "Updated", display: updated, full: tunnel.updated_at, changed: updatedChanged } : null,
    tunnel.kind ? { label: "Kind", display: tunnel.kind, full: tunnel.kind, changed: kindChanged } : null,
  ].filter(Boolean);

  els.detail.dataset.detailKind = "tunnel";
  els.detail.innerHTML = `
    <div class="detail-meta">
      ${metaCells.map((cell) => {
        const isTunnel = cell.isTunnelCell;
        const strongClass = [
          cell.changed ? "value-changed" : "",
          isTunnel ? "drawer-id-copy" : "",
        ].filter(Boolean).join(" ");
        const titleAttr = isTunnel
          ? `Click to copy: ${escapeHtml(cell.full)}`
          : escapeHtml(cell.full);
        const dataAttr = isTunnel
          ? `data-copy-tunnel-id="${escapeHtml(cell.full)}"`
          : "";
        // Tunnel cell renders both the short hash + full form (same
        // dual-display the Drawer cell uses in the memory detail).
        const valueHtml = isTunnel
          ? `<span class="drawer-id-short">${escapeHtml(cell.display)}</span><span class="drawer-id-full">${escapeHtml(cell.full)}</span>`
          : escapeHtml(cell.display);
        return `<div><span>${escapeHtml(cell.label)}</span><strong class="${strongClass}" title="${titleAttr}" ${dataAttr}>${valueHtml}</strong></div>`;
      }).join("")}
    </div>

    <article class="tunnel-detail">
      <section class="tunnel-route" aria-label="Tunnel route">
        ${renderCard("source", sourceWing, sourceRoom, sourceDrawer)}
        <div class="tunnel-route-connector" aria-hidden="true">${TUNNEL_GLYPH}</div>
        ${renderCard("target", targetWing, targetRoom, targetDrawer)}
      </section>

      <section class="tunnel-detail-label ${tunnel.label ? "" : "tunnel-detail-label-empty"}" id="tunnelLabelSection">
        <div class="tunnel-detail-label-head">
          <div class="tunnel-detail-section-label">About this connection</div>
          <button class="tunnel-detail-edit" type="button" id="tunnelLabelEdit"
            title="Edit label" aria-label="Edit label">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 20h4l10-10-4-4L4 16v4Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
              <path d="m14 6 4 4" fill="none" stroke="currentColor" stroke-width="1.6"/>
            </svg>
          </button>
        </div>
        <p class="${cls(labelChanged)}">${tunnel.label ? escapeHtml(tunnel.label) : "No label was set when this tunnel was created."}</p>
      </section>

      <div class="write-status" id="tunnelDetailStatus"></div>
    </article>
  `;

  const status = els.detail.querySelector("#tunnelDetailStatus");
  const showStatus = (msg, isError = false) => {
    if (!status) return;
    status.textContent = msg || "";
    status.classList.toggle("status-error", isError);
  };

  // Tunnel-id click-to-copy in the metadata strip — same pattern as
  // the drawer-id copy on the memory detail panel: click the value
  // cell, get a brief "Copied" toast bubble at the click position.
  els.detail.querySelectorAll("[data-copy-tunnel-id]").forEach((el) => {
    el.addEventListener("click", async (event) => {
      const ok = await copyToClipboard(el.dataset.copyTunnelId);
      showCopiedToast(el, ok ? "Copied" : "Copy failed", !ok, event);
    });
  });

  els.detail.querySelectorAll("[data-tunnel-open-side]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const side = btn.dataset.tunnelOpenSide;
      const wing = side === "source" ? sourceWing : targetWing;
      const room = side === "source" ? sourceRoom : targetRoom;
      const drawer = side === "source" ? sourceDrawer : targetDrawer;
      if (drawer) {
        // Drawer-bound endpoint: push an in-pane override so we slide the
        // memory in from the right WITHOUT disturbing the room/wing
        // selection — the user can pop back to this same tunnel with the
        // chevron at the top of the drawer view. Hash unchanged (the
        // override is a transient peek, not a persistent location).
        // A tunnel peek is a fresh navigation from outside any
        // wikilink chain; drop the back-stack so the peek's own
        // back affordance only returns to the tunnel inspector.
        clearDrawerNavStack();
        state.detailDirection = "forward";
        state.detailDismissed = false;
        state.detailOverride = {
          drawerId: drawer.drawer_id,
          originTunnelId: tunnel.id,
        };
        render();
        return;
      }
      // Unbound endpoint: full navigation to the target room, since there's
      // no specific memory to peek at — the right thing is to actually
      // move the user there.
      if (navigateToRoom(wing, room)) {
        clearDrawerNavStack();
        const first = findFirstDrawerInRoom(wing, room);
        if (first) state.selectedDrawerId = first.drawer_id;
        render();
        writeHash();
      }
    });
  });

  // ---- Edit label ----
  const labelSection = els.detail.querySelector("#tunnelLabelSection");
  const labelEditBtn = els.detail.querySelector("#tunnelLabelEdit");
  if (labelEditBtn && labelSection) {
    labelEditBtn.addEventListener("click", () => {
      const existing = tunnel.label || "";
      labelSection.innerHTML = `
        <div class="tunnel-detail-label-head">
          <div class="tunnel-detail-section-label">About this connection</div>
        </div>
        <textarea class="tunnel-detail-label-editor" rows="4"
          placeholder="What does this connection mean? Why are these rooms linked?">${escapeHtml(existing)}</textarea>
        <div class="tunnel-detail-label-actions">
          <button class="icon-button" type="button" data-tunnel-label-cancel>Cancel</button>
          <button class="icon-button primary-action" type="button" data-tunnel-label-save>Save</button>
        </div>
      `;
      const ta = labelSection.querySelector("textarea");
      const save = labelSection.querySelector("[data-tunnel-label-save]");
      const cancel = labelSection.querySelector("[data-tunnel-label-cancel]");
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
      cancel.addEventListener("click", () => renderTunnelDetail(tunnel));
      save.addEventListener("click", async () => {
        save.disabled = true;
        cancel.disabled = true;
        showStatus("Saving label…");
        try {
          await updateTunnel(tunnel, { label: ta.value.trim() });
          await loadTunnels();
          render();
          writeHash();
        } catch (err) {
          save.disabled = false;
          cancel.disabled = false;
          showStatus((err && err.message) || "Save failed.", true);
        }
      });
    });
  }

  // ---- Bind a memory (per-endpoint inline picker) ----
  els.detail.querySelectorAll("[data-tunnel-bind]").forEach((select) => {
    select.addEventListener("change", async () => {
      const drawerId = select.value;
      if (!drawerId) return;
      const side = select.dataset.tunnelBind;
      const change = side === "source"
        ? { source_drawer_id: drawerId }
        : { target_drawer_id: drawerId };
      select.disabled = true;
      showStatus(`Binding ${side} to memory…`);
      try {
        await updateTunnel(tunnel, change);
        await loadTunnels();
        render();
        writeHash();
      } catch (err) {
        select.disabled = false;
        showStatus((err && err.message) || "Bind failed.", true);
      }
    });
  });

  // ---- Unbind ----
  els.detail.querySelectorAll("[data-tunnel-unbind]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const side = btn.dataset.tunnelUnbind;
      const change = side === "source"
        ? { source_drawer_id: "" }
        : { target_drawer_id: "" };
      btn.disabled = true;
      showStatus(`Unbinding ${side}…`);
      try {
        await updateTunnel(tunnel, change);
        await loadTunnels();
        render();
        writeHash();
      } catch (err) {
        btn.disabled = false;
        showStatus((err && err.message) || "Unbind failed.", true);
      }
    });
  });

  // ---- Delete ----
  // No explicit click handler needed — the trash icon carries
  // `data-delete-scope="tunnel"` so the document-level delegated handler
  // (see the [data-delete-scope] dispatcher) opens the standard delete
  // confirmation sheet. confirmDelete dispatches scope === "tunnel" to
  // /api/tunnels/delete, which the server already wraps with a
  // log_tunnel_version snapshot so the tunnel lands in Recently deleted.

  // Stash for next render's diff. Reset the other-kind stash so a future
  // tunnel-after-drawer transition doesn't compare against a stale
  // drawer object.
  state.previousTunnelData = tunnel;
  state.previousDrawerData = null;
}

/**
 * Display-only prettifier for KG fact values. Replaces underscores
 * with spaces and collapses any run of whitespace to a single space.
 * Storage is unchanged — the raw value still goes to /api/facts on
 * invalidate or query. Just makes the panel readable when agents
 * have been writing underscore-joined identifiers as triple parts.
 *
 * Deliberately conservative: no title-casing (would mangle dates,
 * proper nouns, version numbers, mixed-case identifiers, em dashes,
 * arrows). Just kills the underscores.
 */
function prettifyFactValue(value) {
  return String(value ?? "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function factLifecycleLabel(fact) {
  return fact && fact.valid_to ? "Ended" : "Active";
}

function factDateLabel(fact) {
  if (!fact) return "Undated";
  const from = String(fact.valid_from || "").trim();
  const to = String(fact.valid_to || "").trim();
  if (from && to) return `${from} to ${to}`;
  if (from) return `Since ${from}`;
  if (to) return `Ended ${to}`;
  return "Undated";
}

function renderFactStats(facts) {
  if (!els.factStats) return;
  const active = facts.filter((fact) => !fact.valid_to).length;
  const ended = facts.length - active;
  const entities = new Set();
  const predicates = new Set();
  facts.forEach((fact) => {
    if (fact.subject) entities.add(String(fact.subject));
    if (fact.object) entities.add(String(fact.object));
    if (fact.predicate) predicates.add(String(fact.predicate));
  });
  const stats = [
    ["Active", active],
    ["Ended", ended],
    ["Entities", entities.size],
    ["Relations", predicates.size],
  ];
  els.factStats.innerHTML = stats
    .map(([label, value]) => `<div class="fact-stat"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");
}

function openFactSourceDrawer(drawerId) {
  const drawer = drawerById(drawerId);
  if (!drawer) return false;
  clearDrawerNavStack();
  state.detailOverride = null;
  state.detailDismissed = false;
  state.detailDirection = "forward";
  state.selectedWing = drawer.wing;
  state.selectedRoom = drawer.room;
  state.selectedDrawerId = drawer.drawer_id;
  state.query = "";
  if (els.searchInput) els.searchInput.value = "";
  render();
  writeHash();
  return true;
}

function renderFacts() {
  const facts = filteredFacts();
  els.factCount.textContent = `${facts.length} ${facts.length === 1 ? "relation" : "relations"}`;
  renderFactStats(facts);
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
      const sourceDrawer = fact.source_drawer_id ? drawerById(fact.source_drawer_id) : null;
      const sourceTitle = sourceDrawer ? cleanTitle(sourceDrawer.title || sourceDrawer.drawer_id) : "";
      const sourceLabel = sourceTitle ? `Source: ${sourceTitle}` : "No source drawer";
      const lifecycle = factLifecycleLabel(fact);
      // Display values are prettified (underscores → spaces); the
      // invalidate payload uses the RAW stored values so the server
      // lookup matches exactly.
      // Each relationship renders as a single flowing line — subject and
      // object carry the visual weight (they're the entities); the
      // predicate is quiet connective text with a direction arrow. This
      // replaces the old three-box "flung to the corners" layout that
      // read as cluttered. Rows live inside one grouped surface (see
      // .facts in styles.css) Apple-grouped-list style, so the section
      // reads as a sibling of the cleaner panels above it.
      return `<div class="fact ${expired}" data-fact-id="${escapeHtml(String(fact.id))}">
        <div class="fact-body">
          <div class="fact-line">
            <span class="fact-term">${escapeHtml(prettifyFactValue(fact.subject))}</span>
            <span class="fact-rel">
              <span class="fact-rel-label">${escapeHtml(prettifyFactValue(fact.predicate))}</span>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h13M14 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
            <span class="fact-term">${escapeHtml(prettifyFactValue(fact.object))}</span>
          </div>
          <div class="fact-meta">
            <span class="fact-status ${fact.valid_to ? "is-ended" : "is-active"}">${lifecycle}</span>
            <span class="fact-meta-item">${escapeHtml(factDateLabel(fact))}</span>
            <span class="fact-meta-item">${escapeHtml(sourceLabel)}</span>
          </div>
        </div>
        <div class="fact-actions">
          ${sourceDrawer ? `<button class="fact-action" type="button" data-open-source-drawer="${escapeHtml(fact.source_drawer_id)}" title="Open source memory" aria-label="Open source memory">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 5h14v14H5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
              <path d="M9 15 15 9M11 9h4v4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>Open</span>
          </button>` : ""}
          ${fact.valid_to ? "" : `<button class="fact-action fact-action-end" type="button" data-invalidate-fact='${escapeHtml(JSON.stringify({ subject: fact.subject, predicate: fact.predicate, object: fact.object }))}' title="Mark as no longer true" aria-label="Mark as no longer true">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <span>End</span>
          </button>`}
        </div>
      </div>`;
    })
    .join("");
  els.facts.querySelectorAll("[data-open-source-drawer]").forEach((btn) => {
    btn.addEventListener("click", () => {
      openFactSourceDrawer(btn.dataset.openSourceDrawer);
    });
  });
  els.facts.querySelectorAll("[data-invalidate-fact]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        // JSON.parse moved INSIDE the try block: the dataset value is
        // produced by escapeHtml(JSON.stringify(...)) in render so it
        // SHOULD always be valid, but if a future HTML-escape change
        // ever munges the JSON, an unguarded parse here would throw
        // and leave the button permanently disabled with no UI signal.
        const payload = JSON.parse(btn.dataset.invalidateFact);
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

  const legend = document.createElement("div");
  legend.className = "kg-legend";
  const legendText = document.createElement("span");
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "kg-reset hidden";
  resetBtn.title = "Reset view";
  resetBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12a7 7 0 1 0 2-4.9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>
    <path d="M5 5v5h5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
  </svg><span>Reset</span>`;
  legend.append(legendText, resetBtn);
  wrap.appendChild(legend);
  wrap.appendChild(stage);

  container.appendChild(wrap);

  kg.container = container;
  kg.svg = svg;
  kg.edgesG = edgesG;
  kg.nodesG = nodesG;
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
    els.factsGraph.innerHTML = "";
    if (kg.mounted) {
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
  // Only auto-close menus when none is currently open. The user might
  // be mid-interaction with a dropdown (theme menu, drawer-card dot
  // menu, etc.) and a background async fetch — loadTunnels resolving,
  // a delayed loadPalace, etc. — shouldn't yank the menu out from
  // under them. Direct user actions that need a menu close (clicking
  // outside, clicking a menu item) call closeMenus() explicitly via
  // their own handlers, so nothing user-visible is lost.
  const openMenu = document.querySelector(".action-menu:not(.hidden)");
  if (!openMenu) closeMenus();
  renderStats();
  renderNav();
  renderDrawers();
  renderDetail();
  renderFacts();
  writeHash();
}

// When the detail panel would just show the empty "Select a memory"
// state, collapse it to 0 width via a CSS class on .content-grid so the
// memories panel expands to fill the freed area. As soon as a drawer
// or tunnel is selected, drop the class — the grid template animates
// back to its default 3-column layout, sliding the detail panel in from
// the right and pushing the memories list back to its base width.
//
// Called from renderDetail (not render) so every path that updates the
// detail pane — including the drawer-card click handler that bypasses
// full render() — keeps the grid layout in sync.
function updateGridLayout() {
  const grid = document.querySelector(".content-grid");
  if (!grid || !els.detail) return;
  const isEmpty = els.detail.dataset.detailKind === "empty"
    || !els.detail.dataset.detailKind;
  grid.classList.toggle("detail-hidden", isEmpty);
  // Mirror the current detail kind onto the grid so CSS can branch
  // on it. Tunnel detail uses this to keep its floating delete button
  // always visible (no enlarged state to gate it behind) and to hide
  // the maximize affordance — the tunnel inspector is already a
  // compact, focused view and the enlarged variant adds nothing.
  // Both classes are mutually exclusive at runtime; "empty" gets
  // neither, so the floating buttons stay invisible.
  const detailKind = els.detail.dataset.detailKind || "";
  grid.classList.toggle("detail-kind-drawer", detailKind === "drawer");
  grid.classList.toggle("detail-kind-tunnel", detailKind === "tunnel");
  // detail-enlarged is mutually exclusive with detail-hidden — if
  // detail collapses (no memory selected), force-clear the enlarged
  // bit so the user doesn't open another memory and find themselves
  // in a leftover full-screen state. Tunnel detail also force-clears
  // it (the maximize button is hidden in tunnel kind, so any leftover
  // enlarged state from a previous drawer view would persist as a
  // wide-open layout the user can't minimize). The maximize button
  // click handler updates state.detailEnlarged + calls
  // updateGridLayout, so this is the single source of truth for the
  // class.
  if (isEmpty || detailKind === "tunnel") state.detailEnlarged = false;
  grid.classList.toggle("detail-enlarged", state.detailEnlarged && !isEmpty);
  // Browse mode is independent of Detail's content state. When the user
  // enters browse with Detail open, the CSS pushes Detail off the
  // right edge with the same translate+fade Rooms uses on the left —
  // the middle panel expands and "pushes" both siblings off the
  // screen. State.selectedDrawerId persists during browse, so exiting
  // (close X / minimize) slides Detail back in with the same memory
  // still active. The drawer-card click handler clears drawersEnlarged
  // explicitly when a memory is selected so opening a memory always
  // returns to the 3-panel reading layout.
  grid.classList.toggle("drawers-enlarged", state.drawersEnlarged);
  // Inline-editor state — drives the pencil→check / trash→X icon
  // swaps and the blue/grey colour morph on the floating action
  // buttons. CSS animates the check-draw on this class transition.
  //
  // editClosing short-circuits the class the MOMENT the user clicks
  // save/cancel, so the button morph back to view-mode (red trash +
  // blue pencil) plays in parallel with the chip-cascade exit
  // animation instead of waiting ~550ms for the cascade to finish.
  // The editor itself stays mounted (state.isEditing is still true)
  // until the cascade resolves and the post-cascade re-render tears
  // it down cleanly. Without this short-circuit the buttons appeared
  // to "wait" for the chips before changing back.
  grid.classList.toggle(
    "detail-editing",
    Boolean(state.isEditing && state.editBuffer && !state.editClosing),
  );
  // No mask class needed during enlarge/minimize: the drawers panel
  // resize triggers only ~10 cards' reflow because JS virtualization
  // (renderDrawerWindow) keeps the DOM size bounded regardless of
  // total room size. See the earlier mask-class history in git if
  // resurrecting is ever needed — it was made obsolete by switching
  // to true windowing.
  // Mirror the current detail kind onto the floating edit + delete
  // buttons (bottom-right of the detail panel, visible only when
  // enlarged AND when a drawer is in view). The edit button's
  // data-edit-drawer-id remains the wiring for the existing global
  // click delegation; the delete button's dataset is shaped for
  // deleteRequestFromButton. CSS reveals the buttons only when both
  // the .detail-enlarged class on .content-grid AND the data
  // attribute are present, so they stay hidden in non-enlarged view
  // or above a tunnel inspector / empty state.
  const editBtn = document.querySelector("#detailPanelEdit");
  const deleteBtn = document.querySelector("#detailPanelDelete");
  const retryBtn = document.querySelector("#detailPanelRetry");
  if (editBtn && deleteBtn) {
    const kind = els.detail.dataset.detailKind;
    // Always clear leading state first — keeps the dataset shape
    // simple regardless of which branch (drawer/tunnel/none) wins.
    editBtn.removeAttribute("data-edit-drawer-id");
    delete deleteBtn.dataset.deleteScope;
    delete deleteBtn.dataset.drawerId;
    delete deleteBtn.dataset.tunnelId;
    if (retryBtn) {
      retryBtn.removeAttribute("data-retry-drawer-id");
      retryBtn.classList.add("hidden");
    }
    if (kind === "drawer") {
      const drawerId = (state.detailOverride && state.detailOverride.drawerId) || state.selectedDrawerId;
      if (drawerId) {
        editBtn.setAttribute("data-edit-drawer-id", drawerId);
        deleteBtn.dataset.deleteScope = "drawer";
        deleteBtn.dataset.drawerId = drawerId;
        // Retry button wiring: only present when the current drawer
        // has a cached failedSave entry. data-retry-drawer-id is the
        // CSS reveal gate (same pattern as edit's data-edit-drawer-id),
        // and the click handler reads it to look up the cached
        // attemptedContent on state.failedSaves.
        if (retryBtn) {
          const hasFailure = Array.isArray(state.failedSaves)
            && state.failedSaves.some((e) => e.drawer_id === drawerId);
          if (hasFailure) {
            retryBtn.setAttribute("data-retry-drawer-id", drawerId);
            retryBtn.classList.remove("hidden");
          }
        }
      }
    } else if (kind === "tunnel") {
      // Tunnel inspector → no edit affordance (tunnel's label has its
      // own inline edit pencil in the body), but the floating delete
      // button gets wired so the user can trash the tunnel from the
      // standard corner affordance like they do for memories.
      const tunnelId = state.previousTunnelData && state.previousTunnelData.id;
      if (tunnelId) {
        deleteBtn.dataset.deleteScope = "tunnel";
        deleteBtn.dataset.tunnelId = tunnelId;
      }
    }
  }
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

// Notification bell wiring. The bell button uses the existing
// data-menu="notifications-menu" attribute so it routes through the
// shared toggleMenu / closeMenus delegation (same pattern as the
// theme picker + action-menu dropdowns). No separate open/close
// handler needed — only the per-action listeners below.
//
// Notification-item click delegation: any .notif-item inside the
// notifications-list navigates to the referenced drawer. Closing
// the dropdown happens via closeMenus() since the click escapes the
// .action-menu boundary (state changes + render() rebuild the menu
// content anyway).
  const notificationsList = on("notificationsList", "click", (event) => {
    const item = event.target.closest(".notif-item");
    if (!item) return;
    const factEventId = item.dataset.notifFactId;
    if (factEventId) {
      markFactEventSeen(factEventId);
      markBellItemsSeen([factEventId]);
      const sourceDrawer = item.dataset.notifSourceDrawerId
        ? drawerById(item.dataset.notifSourceDrawerId)
        : null;
      clearDrawerNavStack();
      state.detailOverride = null;
      state.detailDismissed = false;
      if (sourceDrawer) {
        state.selectedWing = sourceDrawer.wing;
        state.selectedRoom = sourceDrawer.room;
        state.selectedDrawerId = sourceDrawer.drawer_id;
        state.query = "";
      } else {
        state.selectedDrawerId = null;
        state.query = item.dataset.notifFactQuery || "";
      }
      if (els.searchInput) els.searchInput.value = state.query;
      closeMenus();
      render();
      return;
    }
    const drawerId = item.dataset.notifDrawerId;
    if (!drawerId) return;
    const drawer = drawerById(drawerId);
    if (!drawer) return;
    const isFailure = item.classList.contains("notif-item-failure");
    // Clicking a (non-failure) drawer notification acknowledges it in
    // the bell. Failures stay sticky until retried/cleared (see below),
    // so they are NOT bell-dismissed on click.
    if (!isFailure) markBellItemsSeen([drawerId]);
    // For failure entries we DO NOT auto-clear on click. The failure
    // stays in state.failedSaves so the retry button on the detail
    // panel + the red .is-failed tint on the card remain visible
    // until the user either retries successfully OR dismisses via
    // Mark-all-as-seen. Auto-clearing before retry would also drop
    // the cached attemptedContent we stash on the entry, losing the
    // user's typed edit forever.
    // Navigate exactly like a wikilink follow: clear override, set
    // selection to the target drawer + its wing/room, drop any
    // active query so the destination is reachable in the filtered
    // list. Closing the menu also happens via the closeMenus
    // helper invoked by the outside-click handler in render().
    // Notification jumps are NOT a wikilink follow — they're a
    // fresh nav initiated from outside the current memory chain,
    // so wipe the back stack.
    clearDrawerNavStack();
    state.detailOverride = null;
    state.detailDismissed = false;
    state.selectedWing = drawer.wing;
    state.selectedRoom = drawer.room;
    state.selectedDrawerId = drawer.drawer_id;
    state.query = "";
    if (els.searchInput) els.searchInput.value = "";
    // Maximize the detail panel for failure-click navigation so the
    // user gets full view of the drawer they need to fix — the
    // retry button + the failed content both deserve the wider
    // reading column. Idempotent if already enlarged.
    if (isFailure && !state.detailEnlarged) {
      state.detailEnlarged = true;
      const maxBtn = document.querySelector("#detailPanelMaximize");
      if (maxBtn) {
        maxBtn.setAttribute("aria-label", "Minimize detail");
        maxBtn.setAttribute("title", "Minimize");
      }
    }
    closeMenus();
    render();
    if (isFailure) {
      // writeHash AFTER render so the URL reflects the now-maximized
      // panel — a refresh restores the same layout.
      writeHash();
    }
  });

// Mark-all-as-seen button at the bottom of the notification panel.
// Stamps every CURRENTLY-visible info notification's seenAt to now AND
// clears every failed-save entry. The bulk-acknowledge semantic
// covers both notification kinds so one click takes the bell to
// fully-empty. The Settings version of this action stamps EVERY
// drawer (heavier hammer); this in-panel button is scoped to "the
// things showing in the bell right now."
const notificationsMarkAll = on("notificationsMarkAll", "click", () => {
    if (!state.palace || !Array.isArray(state.palace.drawers)) return;
    const drawerIds = state.palace.drawers
      .filter(isBellUnseenDrawer)
      .map((d) => d.drawer_id);
    const factIds = ((state.palace && Array.isArray(state.palace.fact_events)) ? state.palace.fact_events : [])
      .filter(isBellUnseenFactEvent)
      .map(factEventSeenKey)
      .filter(Boolean);
    const ids = drawerIds.concat(factIds);
    if (ids.length) markBellItemsSeen(ids);
    // Clear failure entries too — same bulk-acknowledge intent.
    state.failedSaves = [];
    // Cache-invalidation dance so the next render rebuilds card
    // HTML without any .is-updated flags + clean badge state.
    invalidateCardCache();
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

function isMobileSheetViewport() {
  return window.matchMedia
    && (window.matchMedia("(max-width: 768px)").matches
      || window.matchMedia("(pointer: coarse)").matches);
}

function focusSheetField(el) {
  if (!el || isMobileSheetViewport()) return;
  el.focus();
}

function resetSheetScroll(sheet) {
  if (!sheet) return;
  requestAnimationFrame(() => {
    const scrollables = sheet.querySelectorAll(
      ".write-panel, .edit-panel, .settings-shell, .settings-content-pane, .settings-nav-list, .lab-output"
    );
    scrollables.forEach((el) => {
      el.scrollTop = 0;
      el.scrollLeft = 0;
    });
  });
}

function openWriteSheet() {
  setWriteSheetMode("create");
  renderWritePickers(
    state.selectedWing === "all" ? "" : state.selectedWing,
    state.selectedRoom === "all" ? "" : state.selectedRoom,
  );
  els.writeSheet.classList.remove("hidden");
  resetSheetScroll(els.writeSheet);
  setWriteStatus("");
  focusSheetField(els.writeTitle);
}

function openWriteSheetForDraft(draft) {
  setWriteSheetMode("edit-draft", draft);
  renderWritePickers(draft.wing || "", draft.room || "");
  els.writeTitle.value = draft.title || "";
  els.writeContent.value = draft.content || "";
  els.writeSheet.classList.remove("hidden");
  resetSheetScroll(els.writeSheet);
  setWriteStatus("");
  focusSheetField(els.writeTitle);
}

function closeWriteSheet() {
  dismissSheet(els.writeSheet, () => setWriteSheetMode("create"));
}

// ---------- sheet dismissal ----------
// Symmetric exit animation: adds .closing (CSS keyframes pop the panel
// UP past resting size first, then shrink + fade — mirror of the entry
// spring), waits for the keyframe to finish, then adds .hidden. After-
// callbacks run after the modal is gone so cleanup (status text, mode
// reset) doesn't visibly shift mid-animation.
//
// 280ms matches the `confirm-pop-out` duration in styles.css. Close runs
// faster than the .42s open because dismissal is a "you've moved on"
// gesture — equal-duration exit feels like the UI is making you wait.
// If you retime the keyframe, retime here too.
const SHEET_DISMISS_MS = 280;

function dismissSheet(sheet, after) {
  if (!sheet) { if (after) after(); return; }
  if (sheet.classList.contains("hidden")) {
    if (after) after();
    return;
  }
  sheet.classList.add("closing");
  // With reduce-motion enabled, the close keyframe completes in
  // 0.001s (via the global .reduce-motion override) so any delay
  // here just makes the sheet appear "stuck" before hiding. Skip
  // the wait entirely when reduce-motion is on.
  const dismissMs = getReduceMotion() ? 0 : SHEET_DISMISS_MS;
  window.setTimeout(() => {
    sheet.classList.remove("closing");
    sheet.classList.add("hidden");
    if (after) after();
  }, dismissMs);
}

// ---------- menus ----------
// Duration constant for the theme menu's animated close — has to match
// the CSS .theme-menu.closing animation's longest finish time
// (longest delay 60ms + 130ms duration + small buffer). Exits are
// deliberately faster than entries — entries set the scene, exits
// just clean up; lingering on the exit makes the whole interaction
// feel sluggish.
const THEME_MENU_CLOSE_MS = 210;

function closeMenus(exceptId = "") {
  document.querySelectorAll(".action-menu").forEach((menu) => {
    const open = menu.dataset.menuPanel === exceptId;
    const wasVisible = !menu.classList.contains("hidden");
    if (open) {
      // Make sure this menu is shown — clears any in-flight close
      // animation if the user re-opens the same menu before it
      // finishes hiding.
      menu.classList.remove("hidden", "closing");
    } else if (wasVisible && menu.classList.contains("theme-menu")) {
      // Animated close: the .closing class fires the theme-option-rise
      // cascade. After it plays, we add .hidden and clean up. If a
      // SECOND close request lands while a close is already in flight
      // we just overwrite — the timer fires once per the original
      // request and idempotently sets .hidden + drops .closing.
      menu.classList.add("closing");
      // Reduce-motion: skip the wait — CSS overrides duration to
      // 0.001s, so the visual close is instant and any timer here
      // just leaves the menu hanging on screen.
      const closeMs = getReduceMotion() ? 0 : THEME_MENU_CLOSE_MS;
      setTimeout(() => {
        // Skip the toggle if the user re-opened the menu in the
        // meantime (the open path above removed .closing).
        if (!menu.classList.contains("closing")) return;
        menu.classList.add("hidden");
        menu.classList.remove("closing");
      }, closeMs);
    } else {
      // Other menus close instantly — no animated-close for them yet.
      menu.classList.add("hidden");
      menu.classList.remove("closing");
    }
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
    // Only surface a warning for the edge cases where the deletion
    // ALSO removes a wing or room category (last memory in there).
    // Routine deletions get no warning — the static recovery hint
    // in the confirm panel covers reassurance.
    const derivedNote =
      wingCount === 1
        ? "This is the last memory using this wing — deleting removes the wing category."
        : roomCount === 1
          ? "This is the last memory using this room — deleting removes the room category."
          : "";
    return {
      payload: { scope, drawer_id: drawer.drawer_id },
      title: "Delete memory?",
      body: "Only this memory will be deleted.",
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
      body: `${count} memor${count === 1 ? "y" : "ies"} in this room will be deleted.`,
      warning: "",
      count,
    };
  }
  if (scope === "wing") {
    const wing = button.dataset.wing;
    const count = drawersInWing(wing).length;
    return {
      payload: { scope, wing },
      title: `Delete wing ${humanizeName(wing)}?`,
      body: `${count} memor${count === 1 ? "y" : "ies"} across all rooms will be deleted.`,
      warning: "",
      count,
    };
  }
  if (scope === "tunnel") {
    const tunnelId = button.dataset.tunnelId;
    const tunnel = state.tunnels.find((t) => t.id === tunnelId);
    const route = tunnel
      ? `${humanizeName(tunnelWingForm(tunnel.source.wing))} / ${humanizeName(tunnel.source.room)} ↔ ${humanizeName(tunnelWingForm(tunnel.target.wing))} / ${humanizeName(tunnel.target.room)}`
      : tunnelId;
    return {
      payload: { scope, tunnel_id: tunnelId },
      title: "Delete tunnel?",
      body: `This tunnel will be removed: ${route}.`,
      warning: "Snapshots are kept in Recently deleted for recovery.",
      count: 1,
    };
  }
  return null;
}

function openDeleteSheet(request) {
  if (!request || request.count < 1) return;
  // Defense in depth: NEVER open the destructive delete confirmation
  // while the user is mid-edit on a memory. Multiple call sites can
  // reach this function (the floating trash button, the action-menu
  // Trash item, the global Backspace shortcut, programmatic flows);
  // checking state.isEditing at every individual call site was leaky.
  // One guard here catches them all — the inline cancel X is the
  // only sanctioned exit from edit mode, and stray "delete" gestures
  // are silently no-op'd rather than risking data loss on what the
  // user is actively editing.
  if (state.isEditing && state.editBuffer) return;
  state.deleteRequest = request;
  els.deleteTitle.textContent = request.title;
  els.deleteBody.textContent = request.body;
  els.deleteWarning.textContent = request.warning || "";
  // Optional overrides for the "recoverable from trash" hint and the
  // confirm-button label — used by permanent-deletion flows (clear
  // trash, etc.) where the standard "Recoverable from the trash bin."
  // reassurance is actively misleading.
  const hintEl = document.querySelector("#confirmHint");
  if (hintEl) {
    hintEl.textContent = request.hint != null
      ? request.hint
      : "Recoverable from the trash bin.";
    hintEl.classList.toggle("danger", !!request.hintDanger);
  }
  els.deleteConfirm.textContent = request.confirmLabel || "Delete";
  setDeleteStatus("");
  els.deleteConfirm.disabled = false;
  els.deleteSheet.classList.remove("hidden");
  resetSheetScroll(els.deleteSheet);
  focusSheetField(els.deleteConfirm);
}

function closeDeleteSheet() {
  state.deleteRequest = null;
  dismissSheet(els.deleteSheet, () => setDeleteStatus(""));
}

async function confirmDelete() {
  if (!state.deleteRequest) return;
  const request = state.deleteRequest;
  // Optimistic drawer-delete fast path: when the user confirms a
  // single-drawer delete we don't wait for the server. Snapshot the
  // drawer + its index, mutate state immediately, close the sheet,
  // and let the POST resolve in the background. On failure: re-insert
  // the drawer at its original position + push a failure entry to the
  // notification bell — same pattern as commitEditMode. Mass deletes
  // (scope=wing/room), tunnel deletes, and custom onConfirm callbacks
  // (trash clear, future flows) all keep the synchronous "Deleting…"
  // path below since their state-mutation surface is bigger and the
  // optimistic-revert math is more error-prone.
  const isDrawerDelete =
    !request.onConfirm
    && request.payload
    && request.payload.scope === "drawer"
    && request.payload.drawer_id;
  if (isDrawerDelete) {
    const drawerId = request.payload.drawer_id;
    const drawers = (state.palace && state.palace.drawers) || [];
    const idx = drawers.findIndex((d) => d.drawer_id === drawerId);
    const current = idx >= 0 ? drawers[idx] : null;
    if (!current) {
      // Drawer not in local state — fall through to the sync path
      // below which loadPalace()s after the server call. Should be
      // rare (the delete button can only be clicked on a drawer the
      // user is currently viewing, which by definition is in palace).
    } else {
      // Snapshot for revert. Position matters so the reverted drawer
      // lands back where it was — splice insert at the same index so
      // sort order and the visible card list don't shuffle on failure.
      const snapshot = { drawer: { ...current }, index: idx };
      const wasSelected = state.selectedDrawerId === drawerId;
      // Close the sheet immediately. closeDeleteSheet clears state.
      // deleteRequest so a second confirm-click can't double-fire.
      closeDeleteSheet();
      // OPTIMISTIC REMOVAL — splice the drawer out, clear selection
      // if it was the one being deleted, and invalidate the virtual-
      // list cache so the next render rebuilds the visible window
      // without the just-deleted card.
      state.palace.drawers.splice(idx, 1);
      if (wasSelected) state.selectedDrawerId = null;
      invalidateCardCache();
      state._filteredDrawersCache = null;
      render();
      writeHash();
      // BACKGROUND DELETE. Fire-and-handle: on success, do nothing
      // (the UI is already in the deleted state); on failure, re-
      // insert + notify via the bell.
      postJson("/api/delete", { ...request.payload, confirm: "DELETE" })
        .then(() => {
          // Success path: clear any prior failure entry for this
          // drawer that's no longer relevant. We don't loadPalace here
          // — the server's response just confirms the delete, and the
          // trash count isn't surfaced anywhere except inside the trash
          // sheet which the user has to open manually to see.
          clearFailedSave(drawerId);
        })
        .catch((error) => {
          // Revert: re-insert the snapshot at its original index. If
          // the palace shrunk for other reasons (loadPalace fired
          // concurrently, etc.) clamp the insert index to the current
          // length so the splice doesn't blow up.
          if (state.palace && Array.isArray(state.palace.drawers)) {
            const insertAt = Math.min(snapshot.index, state.palace.drawers.length);
            state.palace.drawers.splice(insertAt, 0, snapshot.drawer);
            if (wasSelected) state.selectedDrawerId = drawerId;
          }
          pushFailedSave({
            drawer_id: drawerId,
            title: snapshot.drawer.title || drawerId,
            wing: snapshot.drawer.wing,
            room: snapshot.drawer.room,
            error: `Delete failed: ${(error && error.message) || "unknown error"}`,
          });
          invalidateCardCache();
          state._filteredDrawersCache = null;
          render();
        });
      return;
    }
  }
  // Synchronous path: mass deletes, tunnel deletes, custom callbacks
  // (trash clear). Keep the "Deleting…" status + await semantics since
  // optimistic-revert for these branches is more state to track and
  // their round-trip is more variable.
  els.deleteConfirm.disabled = true;
  try {
    setDeleteStatus("Deleting…", "info");
    if (typeof request.onConfirm === "function") {
      await request.onConfirm();
    } else if (request.payload && request.payload.scope === "tunnel") {
      // Server already snapshots the tunnel into VERSIONS_LOG before
      // calling tool_delete_tunnel, so this single call gets it into the
      // Recently-deleted list and removes it from the live store.
      await postJson("/api/tunnels/delete", { tunnel_id: request.payload.tunnel_id });
      state.detailOverride = null;
      await loadTunnels();
      setDeleteStatus("Tunnel moved to Recently deleted.", "success");
    } else {
      const data = await postJson("/api/delete", { ...request.payload, confirm: "DELETE" });
      state.selectedDrawerId = null;
      setDeleteStatus(`Deleted ${data.deleted} ${data.deleted === 1 ? "memory" : "memories"}.`, "success");
      await loadPalace();
    }
    closeDeleteSheet();
    render();
    writeHash();
  } catch (error) {
    els.deleteConfirm.disabled = false;
    setDeleteStatus(error.message, "error");
  }
}

// ---------- inline visual editor ----------
// Replaces the old modal edit sheet (openEditSheet, kept below for
// reference / fallback wiring) with in-place editing inside the
// detail panel. The render path for "drawer detail, editing mode"
// lives inside renderDrawerDetail (it branches on state.isEditing).
// Save / cancel both route through the same /api/memories/update
// endpoint as the old sheet — only the surface changed.

/** Seed state.editBuffer from a drawer and flip into editing mode.
 * renderDetail() reads state.isEditing to swap the body for the
 * inline editor; updateGridLayout writes the .detail-editing class
 * on .content-grid which CSS uses to morph the edit/delete buttons. */
function enterEditMode(drawerId) {
  const drawer = drawerById(drawerId);
  if (!drawer) return;
  // Interrupt path: the user clicked Edit while a previous cancel /
  // save was still playing its chip-cascade exit. Same drawer?
  // Reverse the cascade in place — chips glide back from wherever
  // they currently are, buttons morph back to edit visuals, no
  // re-render. Different drawer? Hard-cancel the cascade so the
  // pending state-cleanup .then() doesn't fire (it would clobber
  // the edit we're about to set up), then fall through to normal
  // entry below.
  if (state.editClosing) {
    cancelChipsOut();
    state.editClosing = false;
    const sameDrawer = state.editBuffer && state.editBuffer.drawerId === drawer.drawer_id;
    if (sameDrawer) {
      updateGridLayout(); // re-adds .detail-editing → buttons morph back
      return;
    }
    // Different drawer: state.isEditing is still true and the buffer
    // is for the OLD drawer. Fall through — the state reset below
    // re-seeds for the new drawer and renderDetail rebuilds the
    // editor surface against it.
  }
  // Edit can be triggered from the floating pencil (drawer already
  // in detail view) OR from a card's action-menu Edit item (drawer
  // not yet shown). Always select the target drawer so the inline
  // editor renders against the correct memory.
  state.selectedDrawerId = drawer.drawer_id;
  state.detailOverride = null;
  state.detailDismissed = false;
  state.isEditing = true;
  state.editBuffer = {
    drawerId: drawer.drawer_id,
    etag: drawer.etag || "",
    title: drawer.title || "",
    content: drawer.content || "",
    wing: drawer.wing || "",
    room: drawer.room || "",
  };
  state.editError = "";
  render();
  updateGridLayout();
}

/** Discard the edit buffer and re-render the detail panel in
 * read-only mode. Triggered by clicking the cancel (X) button or
 * by navigating away to a different drawer mid-edit (renderDetail
 * detects the drawer mismatch and cancels for us — that path
 * bypasses the slide-out since the user already moved on). */
function cancelEditMode() {
  // Flip editClosing first + repaint the grid class so the floating
  // action buttons start morphing IMMEDIATELY back to view mode
  // (pencil + red trash). They animate in parallel with the chip
  // cascade exit instead of waiting for it to finish.
  state.editClosing = true;
  updateGridLayout();
  animateChipsOut().then(() => {
    state.isEditing = false;
    state.editBuffer = null;
    state.editError = "";
    state.editClosing = false;
    renderDetail();
    updateGridLayout();
  });
}

/** Triggers the .is-leaving slide-out animation on the editor chips
 * and resolves after the longest delay+duration completes. Used by
 * both cancelEditMode and commitEditMode (on success) so the chips
 * drift off-left before the editor surface is replaced with the
 * read-only view — pure pop-out feels too abrupt given how much
 * visual weight the chips carry while editing. */
/* Generation counter — every animateChipsOut bumps it. If the
 * counter changes before the timeout fires, the resolve() short-
 * circuits and the .then() callback (which tears down editing
 * state) never runs. cancelChipsOut bumps the counter to invalidate
 * any in-flight close, then strips .is-leaving so the CSS
 * transition reverses the chips smoothly back into view. */
let chipsOutGen = 0;

/** Per-element stagger delays (in ms) keyed by a stable index so we
 * always assign the same delay to the same slot regardless of how
 * the row of toolGroups/chips is laid out. Order matches the DOM
 * order inside .detail-editor-chips: chip(Wing), chip(Room), sep,
 * tool-group-1, tool-group-2, tool-group-3.
 *
 * Tightened from 80–680ms entry stagger to 40–240ms (50ms per slot)
 * so the cascade reads in roughly the same time the main-page
 * panel slides take, instead of feeling sluggish compared to the
 * rest of the UI. Total entry time = 240ms delay + 280ms transition
 * = ~520ms tail, vs the old 680 + 420 = 1100ms. Exit and reverse
 * staggers also tightened proportionally. */
const CHIP_ENTRY_DELAYS = [40, 90, 140, 190, 240, 290];
const CHIP_EXIT_DELAYS  = [0, 25, 50, 75, 100, 125];

function getChipCascadeItems() {
  return document.querySelectorAll(
    ".detail-edit-grid .detail-editor-chip, .detail-edit-grid .detail-editor-toolbar-sep, .detail-edit-grid .detail-editor-tool-group",
  );
}

/** Triggers the side-floating chips' entrance transition. The chips
 * are rendered with their default invisible state (opacity:0,
 * translateX(-24px)); adding .is-entered transitions them into
 * resting position with the staggered cascade. We force a reflow
 * via `void el.offsetHeight` before adding the class because
 * otherwise the browser may collapse "render at default state +
 * immediately add .is-entered" into a single commit, skipping the
 * transition entirely. Called from wireInlineEditorInputs after
 * the editor surface mounts.
 *
 * Stagger delays are set INLINE (not in CSS) so that if the user
 * later interrupts an in-flight close, cancelChipsOut can zero out
 * the delays — making the reverse-to-entered instantaneous on
 * every chip rather than each chip waiting its original entry
 * delay before reversing. */
function triggerChipsEntry() {
  const items = getChipCascadeItems();
  if (!items.length) return;
  items.forEach((item, i) => {
    item.style.transitionDelay = `${CHIP_ENTRY_DELAYS[i] ?? 0}ms`;
  });
  // Force a reflow so the default invisible state is committed
  // before .is-entered changes the specified values.
  items.forEach((item) => void item.offsetHeight);
  items.forEach((item) => item.classList.add("is-entered"));
}

function animateChipsOut() {
  return new Promise((resolve) => {
    const myGen = ++chipsOutGen;
    const items = getChipCascadeItems();
    if (!items.length) { resolve(); return; }
    // Respect reduce-motion — skip the animation entirely and
    // resolve on the next tick so callers don't hold up rendering.
    if (getReduceMotion()
        || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setTimeout(resolve, 0);
      return;
    }
    // Apply exit-stagger delays inline (overriding whatever delay
    // was inline from the entry pass) THEN flip the class. Doing it
    // in that order means the cascade runs with the new exit
    // delays, not lingering entry delays.
    items.forEach((item, i) => {
      item.style.transitionDelay = `${CHIP_EXIT_DELAYS[i] ?? 0}ms`;
    });
    items.forEach((item) => item.classList.add("is-leaving"));
    // Longest exit time = tool-group-3's 125ms delay + 240ms
    // transition = 365ms. Add 35ms buffer for paint-frame slack.
    setTimeout(() => {
      if (myGen === chipsOutGen) resolve();
      // else: cancelled by interrupt — leave promise pending so the
      // caller's .then() (state cleanup) never fires.
    }, 400);
  });
}

/** Aborts the in-flight chip exit cascade. Used when the user re-
 * clicks Edit while the chips are mid-slide-out. Strips .is-leaving
 * (so .is-entered's specified values take over again) AND assigns
 * a small uniform reverse stagger to each chip.
 *
 * Why the stagger isn't 0: when the user interrupts BEFORE the
 * entry cascade had completed (e.g. clicks edit, waits just long
 * enough for the wing/room chips to appear, then cancel-then-edit
 * fast), the not-yet-entered tool-groups are still at opacity 0.
 * Zeroing their delay made them all snap-cascade into view as one
 * lump with no cascade feel — "animation completely gone". A small
 * 30ms-per-item stagger restores the waterfall feel for those
 * chips while keeping the response snappy enough for chips that
 * WERE visible (they're already at opacity:1, so the delay is
 * effectively a no-op for them — there's no value to transition
 * to). Longest reverse delay = 5 * 30 = 150ms, plenty fast.
 *
 * The generation bump kills any pending close — animateChipsOut's
 * setTimeout still fires but resolves nothing, so the .then() that
 * tears down editing state never runs. */
function cancelChipsOut() {
  chipsOutGen++;
  const items = Array.from(
    document.querySelectorAll(".detail-edit-grid .is-leaving"),
  );
  // Set the new (small uniform) delays FIRST so when the class is
  // removed the transition fires with the right delay. Two passes
  // because we want the inline-style mutation batched before any
  // class change triggers transition recalculation.
  items.forEach((el, i) => {
    el.style.transitionDelay = `${i * 20}ms`;
  });
  items.forEach((el) => el.classList.remove("is-leaving"));
}

/** Extract the title line from a markdown body — the leading `#`
 * heading, with the `#` markers + surrounding whitespace stripped.
 * Mirrors the server's extract_title so the optimistic title update
 * matches what the server will derive on commit. Falls back to the
 * first non-empty line truncated to 80 chars when no heading exists. */
function deriveTitleFromContent(content) {
  if (!content) return "";
  for (const line of String(content).split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) return trimmed.replace(/^#+\s*/, "").trim();
    if (trimmed) return trimmed.slice(0, 80);
  }
  return "";
}

/** Push a save-failed entry onto state.failedSaves. The bell renders
 * these as red error items above the recently-updated notifications.
 * Replaces any existing entry for the same drawer_id (most-recent
 * failure wins — old attempts are no longer interesting once the
 * user has triggered a newer save attempt). */
function pushFailedSave(entry) {
  state.failedSaves = (state.failedSaves || []).filter(
    (e) => e.drawer_id !== entry.drawer_id,
  );
  state.failedSaves.push({
    id: `fail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    when: new Date().toISOString(),
    ...entry,
  });
}

/** Remove a save-failed entry by drawer_id. Called when a SUBSEQUENT
 * save for the same drawer succeeds — clearing the old failure so
 * the bell reflects current truth (the drawer is now saved, no error
 * to surface). Also called by mark-all-as-seen as a bulk dismiss. */
function clearFailedSave(drawerId) {
  if (!Array.isArray(state.failedSaves)) return;
  state.failedSaves = state.failedSaves.filter((e) => e.drawer_id !== drawerId);
}

/** POST the edit buffer to /api/memories/update OPTIMISTICALLY:
 * apply the change to state.palace.drawers immediately so the user
 * sees their edit land in zero perceptible time, then fire the
 * actual API call in the background. On success: refresh from the
 * server to pick up any canonical normalization (etag bump,
 * server-derived title, etc.). On failure: revert the drawer to its
 * pre-edit snapshot and push a save-failed entry to the notification
 * bell so the user is alerted that their change didn't persist.
 *
 * The earlier version awaited postJson + loadPalace serially before
 * exiting edit mode — that meant ~500ms-1s of "Saving… Refreshing…"
 * UI lag between the click and the visible result on a normal Pi.
 * This version is instant, with the trade-off that failures appear
 * as bell notifications instead of inline error text under the
 * editor. That's intentional: a failure after-the-fact needs the
 * user's attention via the global alert surface, not just at the
 * editor location (which the user has already moved away from).
 *
 * Race-condition note: if the user fires two saves back-to-back
 * for the same drawer before the first POST has resolved, the
 * second optimistic update overwrites the first, and the second
 * POST race-condition wins server-side too (last-write semantics).
 * If the FIRST POST fails after the SECOND one succeeded, we'd
 * incorrectly revert to the first attempt's snapshot. This is
 * intentionally not guarded — back-to-back saves are rare in
 * practice and the simpler code path is worth the small risk.
 * If this becomes a real-world problem, the fix is to track an
 * in-flight save id per drawer and only revert when the failing
 * save is still the most-recent one. */
async function commitEditMode() {
  if (!state.editBuffer) return;
  const buf = state.editBuffer;
  const current = drawerById(buf.drawerId);
  // Pull the freshest content from the contenteditable surface in
  // case an input event was missed (paste/drop/IME composition
  // commits don't always fire input reliably across browsers).
  const liveBody = document.getElementById("inlineEditBody");
  if (liveBody) buf.content = htmlToMarkdown(liveBody.innerHTML);
  const newContent = buf.content;
  // Title is edited inline inside the contenteditable's H1, so
  // buf.title stays in sync via wireInlineEditorInputs reading the
  // first H1 of the live body. No separate applyTitleToContent step
  // is needed — the H1 IS the title source.
  const payload = { drawer_id: buf.drawerId, etag: buf.etag };
  if (current) {
    if (newContent !== (current.content || "")) payload.content = newContent;
    if (buf.wing && buf.wing !== current.wing) payload.wing = buf.wing.trim();
    if (buf.room && buf.room !== current.room) payload.room = buf.room.trim();
  } else {
    payload.content = newContent;
    if (buf.wing) payload.wing = buf.wing.trim();
    if (buf.room) payload.room = buf.room.trim();
  }
  if (!payload.content && !payload.wing && !payload.room) {
    // No changes — just exit edit mode silently.
    cancelEditMode();
    return;
  }

  // Snapshot the original drawer state BEFORE applying the
  // optimistic update. If the background save fails, we restore
  // from this snapshot. Only fields the user could have modified
  // need to be captured.
  const snapshot = current ? {
    drawer_id: current.drawer_id,
    content: current.content,
    title: current.title,
    wing: current.wing,
    room: current.room,
    updated_at: current.updated_at,
    etag: current.etag,
  } : null;

  // OPTIMISTIC UPDATE — mutate the drawer in state.palace.drawers
  // in place with the new values. The dashboard renders directly
  // from this array, so the next render() call after this point
  // will show the user's edit immediately.
  if (current) {
    if ("content" in payload) {
      current.content = payload.content;
      // Title is derived client-side from the first heading to match
      // what extract_title on the server will produce. Falls back to
      // the prior title if the new content has no heading.
      current.title = deriveTitleFromContent(payload.content) || current.title;
    }
    if (payload.wing) current.wing = payload.wing;
    if (payload.room) current.room = payload.room;
    // updated_at bump means isRecentlyUpdated / isBellUnseenDrawer would
    // return true for this drawer on the next render. This is the user's
    // OWN edit, so suppress both the card "Updated" dot AND the bell in the
    // SAME frame — otherwise the edit flashes in the bell during the
    // optimistic window before the server's seen-stamp arrives on the next
    // /api/palace poll. Stamp updated_at first, then mark seen (>= it) in
    // both namespaces. The server's update_memory mirrors this so other LAN
    // clients stay consistent; this is the local-instant half.
    current.updated_at = new Date().toISOString();
    markDrawerSeen(buf.drawerId);
    markBellItemsSeen([buf.drawerId]);
  }

  // Reflect the post-edit selection state.
  state.selectedDrawerId = buf.drawerId;
  if (payload.wing) state.selectedWing = payload.wing;
  if (payload.room) state.selectedRoom = payload.room;

  // Tear down the editor. Same chip-cascade-out animation as
  // before so the visual exit reads identically — only the API
  // wait is gone.
  state.editClosing = true;
  updateGridLayout();
  await animateChipsOut();
  state.isEditing = false;
  state.editBuffer = null;
  state.editError = "";
  state.editClosing = false;
  render();

  // BACKGROUND SAVE — fire and handle the resolution asynchronously.
  // No await: the UI is already in the "saved" state. The promise
  // chain below either confirms success (refresh palace to pick up
  // server-side normalization) or reverts + notifies on failure.
  postJson("/api/memories/update", payload)
    .then(() => {
      // Success — clear any prior failure entry for this drawer
      // (a previous attempt that errored is no longer relevant
      // now that this one succeeded). Then sync from the server
      // so the local state matches the canonical form (etag bump,
      // any server-side title cleanup, etc).
      clearFailedSave(buf.drawerId);
      return loadPalace().then(() => render());
    })
    .catch((error) => {
      // Save failed — restore the drawer to its pre-edit snapshot
      // so the UI no longer claims the change persisted. Then push
      // a save-failed entry to the notification bell so the user
      // is alerted via the global surface (they've already moved
      // on from the editor location).
      if (snapshot) {
        const d = drawerById(snapshot.drawer_id);
        if (d) {
          d.content = snapshot.content;
          d.title = snapshot.title;
          d.wing = snapshot.wing;
          d.room = snapshot.room;
          d.updated_at = snapshot.updated_at;
          d.etag = snapshot.etag;
        }
      }
      // Cache the user's attempted edit on the failure entry so the
      // retry button on the detail panel can re-fire the save without
      // requiring the user to retype anything. attemptedContent /
      // attemptedWing / attemptedRoom are the values the user tried
      // to save (from the edit buffer + the payload above), separate
      // from the snapshot fields which hold the PRE-edit state we'd
      // revert to. attemptedEtag piggy-backs on the snapshot.etag
      // because we haven't yet learned the server's new etag (the
      // save failed) — retry will send the same etag and let the
      // server's conflict logic re-check.
      pushFailedSave({
        drawer_id: buf.drawerId,
        title: (snapshot && snapshot.title) || buf.drawerId,
        wing: snapshot && snapshot.wing,
        room: snapshot && snapshot.room,
        error: (error && error.message) || "Save failed.",
        attemptedContent: ("content" in payload) ? payload.content : null,
        attemptedWing: payload.wing || null,
        attemptedRoom: payload.room || null,
        attemptedEtag: snapshot && snapshot.etag,
      });
      // Invalidate card-html cache so the reverted state propagates
      // through the virtualized window on the next render.
      invalidateCardCache();
      render();
    });
}

/** Build the inline-editor HTML. The body is the FULL markdown render
 * with contenteditable="true" — visually identical to read-only mode
 * (same .markdown class, same callouts, same code blocks, same
 * wiki-links), but the user can click anywhere and type. Wing/Room
 * stay as small chip-style fields below since they aren't part of
 * the markdown body. No separate Title field — the title lives as
 * the H1 inside the contenteditable, edited inline like everything
 * else. */
function renderInlineEditorHtml(buf) {
  const err = state.editError
    ? `<p class="detail-editor-error">${escapeHtml(state.editError)}</p>`
    : "";
  // In enlarged mode, chips float in the LEFT padding area (next to
  // the centered markdown column) as a stacked sticky group. The
  // grid layout puts chips in column 1 and markdown in column 2,
  // both centered relative to the viewport. CSS makes the chips
  // sticky inside their grid cell so they stay in view as the user
  // scrolls. In non-enlarged mode the grid degrades to block layout
  // and the chips render as a sticky-top horizontal bar (CSS-only
  // fallback — no separate HTML structure needed).
  return `
    <div class="detail-edit-grid">
      <div class="detail-editor-chips">
        <label class="detail-editor-chip">
          <span>Wing</span>
          <span class="detail-editor-chip-field">
            <input id="inlineEditWing" type="text" autocomplete="off" spellcheck="false" value="${escapeHtml(buf.wing || "")}" />
            <div class="detail-editor-chip-menu hidden" id="inlineEditWingMenu" role="listbox" aria-label="Wing suggestions"></div>
          </span>
        </label>
        <label class="detail-editor-chip">
          <span>Room</span>
          <span class="detail-editor-chip-field">
            <input id="inlineEditRoom" type="text" autocomplete="off" spellcheck="false" value="${escapeHtml(buf.room || "")}" />
            <div class="detail-editor-chip-menu hidden" id="inlineEditRoomMenu" role="listbox" aria-label="Room suggestions"></div>
          </span>
        </label>
        <div class="detail-editor-toolbar-sep"></div>
        <div class="detail-editor-tool-group detail-editor-tool-group-1" role="toolbar" aria-label="Inline formatting">
          <button type="button" class="detail-editor-tool" data-format="bold" title="Bold (⌘B)"><strong>B</strong></button>
          <button type="button" class="detail-editor-tool" data-format="italic" title="Italic (⌘I)"><em>I</em></button>
          <button type="button" class="detail-editor-tool" data-format="strikethrough" title="Strikethrough (⌘⇧X)"><s>S</s></button>
          <button type="button" class="detail-editor-tool detail-editor-tool-mono" data-format="code" title="Inline code (⌘E)">&lt;/&gt;</button>
        </div>
        <div class="detail-editor-tool-group detail-editor-tool-group-2" role="toolbar" aria-label="Block formatting">
          <button type="button" class="detail-editor-tool" data-format="h2" title="Heading">H</button>
          <button type="button" class="detail-editor-tool" data-format="ul" title="Bulleted list">•</button>
          <button type="button" class="detail-editor-tool" data-format="ol" title="Numbered list">1.</button>
          <button type="button" class="detail-editor-tool" data-format="quote" title="Quote">&ldquo;</button>
        </div>
        <div class="detail-editor-tool-group detail-editor-tool-group-3" role="toolbar" aria-label="Insert">
          <!-- Link button wrapped like the callout one so the inline
               URL popover can sit in a sibling div instead of inside
               the button (where the button's :active scale(0.9) would
               also shrink the popover). -->
          <div class="detail-editor-tool-link-wrap">
            <button type="button" class="detail-editor-tool" data-format="link" title="Hyperlink selected text (⌘K)" aria-label="Hyperlink selected text">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
          <!-- Callout is the rightmost tool so its popover opens into
               empty space to the right, with no sibling for it to cover.
               The menu sits in a wrapper div (not inside the button) so
               the button's :active scale(0.9) tap-feedback doesn't
               propagate into the menu and visually shrink it. -->
          <div class="detail-editor-tool-callout-wrap">
            <button type="button" class="detail-editor-tool detail-editor-tool-callout" data-format="callout" title="Insert callout">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4v9M12 17v.01" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/>
              </svg>
            </button>
            <div class="detail-editor-callout-menu hidden" id="inlineEditCalloutMenu" role="menu" aria-label="Callout types"></div>
          </div>
        </div>
      </div>
      <div class="markdown markdown-editing" id="inlineEditBody"
           contenteditable="true" spellcheck="true"
           data-placeholder="Write your memory…">${markdownLite(buf.content || "")}</div>
    </div>
    ${err}
  `;
}

/** Wire handlers so edits in the contenteditable body and the chip
 * inputs flow into state.editBuffer on every keystroke. The body's
 * HTML is converted back to markdown on each input so the buffer
 * always holds the canonical source — that way an unrelated re-
 * render restores the exact state via markdownLite(buf.content).
 * Paste handler strips foreign HTML to plain text so paste-from-
 * Word doesn't bring in alien styles. */
function wireInlineEditorInputs() {
  const body = document.getElementById("inlineEditBody");
  const w = document.getElementById("inlineEditWing");
  const r = document.getElementById("inlineEditRoom");

  // Kick off the chips' staggered entrance transition. Done
  // BEFORE any input wiring so the visible transition starts the
  // moment the editor mounts; wiring takes microseconds and won't
  // block the next paint.
  triggerChipsEntry();

  if (body) {
    // Inject the X-to-remove button into every existing callout (those
    // rendered by markdownLite from the saved markdown). Freshly
    // inserted callouts get the button at construction time inside
    // insertEditorCallout — this catches the rest.
    decorateEditorCallouts(body);
    // Click handler for those X buttons. Delegated on the body so we
    // only attach once even as callouts come and go. mousedown (not
    // click) so the contenteditable doesn't grab focus mid-removal.
    body.addEventListener("mousedown", (event) => {
      const removeBtn = event.target.closest(".callout-remove");
      if (!removeBtn || !body.contains(removeBtn)) return;
      event.preventDefault();
      event.stopPropagation();
      const callout = removeBtn.closest("blockquote.callout");
      if (callout) {
        // Capture sibling refs BEFORE removal so we can re-place the
        // caret at the end of the block above (or start of the block
        // below). Without this, the selection is left dangling
        // inside the detached subtree — browsers fall back to the
        // very first text-insertion point in the body, which lands
        // ABOVE the H1 title in an un-stylable position and the
        // user's next keystroke ends up rendering as bare text
        // before the title. Same pattern Notion/Apple Notes use:
        // after a block-delete, place caret at the natural reading-
        // order successor (end-of-prev > start-of-next > body-end).
        const prev = callout.previousElementSibling;
        const next = callout.nextElementSibling;
        callout.remove();
        placeCaretAfterBlockRemoval(body, prev, next);
        syncEditBufferFromBody();
      }
    });
    body.addEventListener("input", () => {
      if (!state.editBuffer) return;
      state.editBuffer.content = htmlToMarkdown(body.innerHTML);
      // Keep buf.title synced from the first H1 so other code (e.g.
      // breadcrumb in the meta strip) sees a current title without
      // waiting for save. Falls through to "" if there's no H1.
      const h1 = body.querySelector("h1");
      state.editBuffer.title = h1 ? h1.textContent.trim() : state.editBuffer.title;
      // Defensive: if anything ever introduces a callout without
      // running through insertEditorCallout, this catches it on the
      // next keystroke so users aren't stuck without a remove
      // affordance. No-op when all callouts already have the button.
      decorateEditorCallouts(body);
    });
    // Paste handler: insert plain text only so external-source
    // formatting (Google Docs, Word, web pages) doesn't pollute the
    // contenteditable with unsupported HTML. execCommand is the only
    // cross-browser way to insert text at the caret while preserving
    // the undo stack.
    body.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text");
      document.execCommand("insertText", false, text);
    });
    // Formatting shortcuts. Originally we relied on the browser to
    // handle Cmd+B / Cmd+I natively in contenteditable — that's been
    // the convention forever, but modern Safari (and increasingly
    // other browsers) have started ignoring these as execCommand
    // gets deprecated. Explicit handlers fix that, and put Cmd+B and
    // Cmd+I on the same code path as the custom commands. metaKey
    // covers Mac, ctrlKey covers Windows/Linux — same combo both
    // platforms; shiftKey distinguishes Cmd+X (cut) from Cmd+Shift+X
    // (strikethrough) and similar.
    body.addEventListener("keydown", (event) => {
      // Markdown-style autoformat: typing `* ` / `- ` / `+ ` / `1. `
      // at the start of a block converts that block into a list. Same
      // vocabulary every Notion/Bear/iA Writer user already knows.
      // Runs before the modifier-key short-circuit below because this
      // path doesn't use Cmd/Ctrl.
      if (event.key === " "
          && !event.metaKey && !event.ctrlKey && !event.altKey
          && !event.isComposing) {
        if (tryAutoformatListAtCaret(body)) {
          event.preventDefault();
          syncEditBufferFromBody();
          return;
        }
      }
      // Backspace inside an empty callout body removes the whole
      // callout block (label + remove-button frame included). The
      // alternative — leaving an empty callout with no text — is a
      // dead-end state where the user has visually "deleted" their
      // content but the chrome lingers. Notion/Bear/Apple Notes all
      // collapse the parent block in this situation.
      if (event.key === "Backspace"
          && !event.metaKey && !event.ctrlKey && !event.altKey
          && !event.isComposing) {
        if (tryBackspaceEmptyCallout(body)) {
          event.preventDefault();
          syncEditBufferFromBody();
          return;
        }
      }
      // Plain Enter inside a callout escapes the box — a new paragraph
      // appears beneath it and the caret moves there. Without this the
      // caret is trapped inside the blockquote with no keyboard way
      // out. Shift+Enter is intentionally NOT caught, so it keeps the
      // browser default (a line break WITHIN the box) — the LLM-chat
      // convention (Enter leaves, Shift+Enter newlines).
      if (event.key === "Enter" && !event.shiftKey
          && !event.metaKey && !event.ctrlKey && !event.altKey
          && !event.isComposing) {
        if (tryEnterExitCallout(body)) {
          event.preventDefault();
          syncEditBufferFromBody();
          return;
        }
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "b" && !event.shiftKey) {
        event.preventDefault();
        document.execCommand("bold");
        syncEditBufferFromBody();
        return;
      }
      if (key === "i" && !event.shiftKey) {
        event.preventDefault();
        document.execCommand("italic");
        syncEditBufferFromBody();
        return;
      }
      if (key === "x" && event.shiftKey) {
        event.preventDefault();
        document.execCommand("strikethrough");
        syncEditBufferFromBody();
        return;
      }
      if (key === "e" && !event.shiftKey) {
        event.preventDefault();
        wrapEditorSelectionWith("code");
        syncEditBufferFromBody();
        return;
      }
      // Cmd+K opens the hyperlink popover on the selected text.
      // stopPropagation prevents the document-level handler from
      // hijacking ⌘K to focus the search bar — the editor wins for
      // its in-context shortcut.
      if (key === "k" && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        const linkBtn = document.querySelector('.detail-editor-tool[data-format="link"]');
        if (linkBtn) showLinkPopover(linkBtn);
        return;
      }
    });
    // Intentionally NOT auto-focusing the body. Auto-focus on a
    // contenteditable triggers the browser's scroll-into-view
    // behaviour which would snap the panel back to the top of the
    // memory the moment the user clicked the pencil — defeating
    // the scroll-preservation we just added. The user will click
    // wherever they want to edit, and that click both focuses the
    // body AND places the caret at the intended spot in one action,
    // which is what they want.
  }
  if (w) w.addEventListener("input", () => {
    if (state.editBuffer) state.editBuffer.wing = w.value;
  });
  if (r) r.addEventListener("input", () => {
    if (state.editBuffer) state.editBuffer.room = r.value;
  });

  // Apple-native dropdown autocomplete on the wing + room chips.
  // Pattern: as user types, a small popover lists matching existing
  // names below the chip; ↑↓ navigates, Tab/Enter accepts the
  // highlighted entry, Esc dismisses. Mouse click accepts. Room
  // candidates are scoped to the typed wing so suggestions stay
  // relevant when changing both fields at once.
  const wingMenu = document.getElementById("inlineEditWingMenu");
  const roomMenu = document.getElementById("inlineEditRoomMenu");
  if (w && wingMenu) {
    setupChipAutocomplete(w, wingMenu, () => existingWings());
  }
  if (r && roomMenu) {
    setupChipAutocomplete(r, roomMenu, () => {
      const wingFilter = state.editBuffer ? state.editBuffer.wing : "";
      return roomsForWing(wingFilter);
    });
  }

  // Formatting toolbar — each button triggers a markdown-equivalent
  // edit on the contenteditable body. mousedown (not click) so the
  // editor doesn't lose focus + selection before the command runs.
  document.querySelectorAll(".detail-editor-tool[data-format]").forEach((btn) => {
    btn.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const format = btn.dataset.format;
      if (format === "callout") {
        // Special: open the callout-type dropdown anchored to this button.
        toggleCalloutMenu(btn);
        return;
      }
      applyEditorFormat(format);
      // Clear any visual focus state that may have stuck on the
      // button — notably the link button, where the window.prompt
      // returns focus weirdly and the button ended up in :hover /
      // :focus state long after the user moved on. Deferred so the
      // blur happens after the browser has finished any focus
      // handling triggered by the click/prompt sequence.
      setTimeout(() => btn.blur(), 0);
    });
  });
}

/** Run a formatting command against the current editor selection.
 * Bold/italic/strike/lists/quote/heading delegate to the browser's
 * execCommand (still works in modern browsers for contenteditable
 * even though deprecated for general use). Code, link, and callout
 * have custom paths because execCommand doesn't ship a direct
 * equivalent that matches our markdown roundtrip. After every
 * edit, syncEditBufferFromBody re-reads the live HTML so the
 * editBuffer stays in lockstep. */
function applyEditorFormat(format) {
  const body = document.getElementById("inlineEditBody");
  if (!body) return;
  body.focus();
  switch (format) {
    case "bold": document.execCommand("bold"); break;
    case "italic": document.execCommand("italic"); break;
    case "strikethrough": document.execCommand("strikethrough"); break;
    case "code": wrapEditorSelectionWith("code"); break;
    case "h2": toggleBlockFormat(body, "h2"); break;
    case "ul": document.execCommand("insertUnorderedList"); break;
    case "ol": document.execCommand("insertOrderedList"); break;
    case "quote": toggleBlockFormat(body, "blockquote"); break;
    case "link": {
      // Open the inline URL popover anchored to the link button.
      // showLinkPopover handles its own syncEditBufferFromBody after
      // the user confirms a URL, so return early here to skip the
      // unconditional sync at the end of this function.
      const btn = document.querySelector('.detail-editor-tool[data-format="link"]');
      if (btn) showLinkPopover(btn);
      return;
    }
    default: return;
  }
  syncEditBufferFromBody();
}

/** Render a visual "fake" selection highlight that mimics the
 * browser's native ::selection rectangles. Used by showLinkPopover
 * (and any other UI that grabs focus away from the editor body) so
 * the user's highlight doesn't appear to disappear the moment they
 * click a toolbar button. getClientRects() returns one DOMRect per
 * visual line of the range — we paint a position:fixed overlay div
 * over each rect. position:fixed is fine here because the popover-
 * open interaction is brief; users don't scroll the editor while
 * typing a URL. Cleaned up via removeSelectionOverlay(). */
function renderSelectionOverlay(range) {
  removeSelectionOverlay();
  const rects = Array.from(range.getClientRects());
  if (!rects.length) return;
  const overlay = document.createElement("div");
  overlay.className = "detail-editor-selection-overlay";
  overlay.setAttribute("aria-hidden", "true");
  rects.forEach((rect) => {
    if (rect.width === 0 || rect.height === 0) return;
    const r = document.createElement("div");
    r.className = "detail-editor-selection-rect";
    r.style.top = `${rect.top}px`;
    r.style.left = `${rect.left}px`;
    r.style.width = `${rect.width}px`;
    r.style.height = `${rect.height}px`;
    overlay.appendChild(r);
  });
  document.body.appendChild(overlay);
}
function removeSelectionOverlay() {
  document
    .querySelectorAll(".detail-editor-selection-overlay")
    .forEach((el) => el.remove());
}

/** Inline URL input popover for the link button. Replaces the
 * window.prompt() path, which (a) was visually un-Apple-native and
 * (b) blocked the main thread synchronously — the latter is why the
 * button's :active style got "stuck" on blue after cancel: mousedown
 * fired and entered :active, the prompt blocked, the trailing mouseup
 * never reached the button, so :active never cleared until the next
 * click somewhere else.
 *
 * Popover lives in the wrapper div as a sibling of the button (NOT
 * inside the button) so the button's :active scale(0.9) doesn't
 * propagate into the popover via transforms. Toggle behaviour: a
 * second click on the button while the popover is open dismisses
 * it without applying anything. Enter applies, Esc cancels,
 * outside-click cancels. */
function showLinkPopover(triggerBtn) {
  // Toggle: if a popover is already open anywhere, close it +
  // dismiss the selection overlay. Popover is now top-level in
  // document.body (not nested under the wrap) so we look it up
  // globally.
  const existing = document.querySelector(".detail-editor-link-popover");
  if (existing) {
    existing.remove();
    removeSelectionOverlay();
    return;
  }
  const body = document.getElementById("inlineEditBody");
  if (!body) return;
  // Snapshot the current selection inside the body. The popover's
  // input is going to grab focus (and therefore lose the body's
  // selection), so we save the range now and restore it before
  // running execCommand("createLink") on apply.
  const sel = window.getSelection();
  let savedRange = null;
  if (sel && sel.rangeCount && body.contains(sel.anchorNode)) {
    savedRange = sel.getRangeAt(0).cloneRange();
  }
  // Render a visual "fake" selection highlight before the popover
  // opens. The moment input.focus() runs the editor body loses focus
  // and the browser stops painting its native selection — without
  // this overlay the user would see their highlight disappear the
  // instant they clicked the link button.
  if (savedRange && !savedRange.collapsed) {
    renderSelectionOverlay(savedRange);
  }
  const popover = document.createElement("div");
  popover.className = "detail-editor-link-popover";
  popover.innerHTML = (
    `<input type="url" class="detail-editor-link-input" placeholder="Paste link…" autocomplete="off" spellcheck="false" />` +
    `<button type="button" class="detail-editor-link-apply">Apply</button>`
  );
  // Append to document.body so the popover can be positioned near
  // the user's selection rather than way up where the toolbar
  // button lives in the chips column. Without this, selecting
  // text 800px down the page made the popover appear at the top
  // of the page next to the link button — inconvenient.
  document.body.appendChild(popover);

  // Compute popover position from the selection rect; fall back to
  // the button rect when there's no selection. Default placement
  // is BELOW the anchor with 8px gap.
  const anchorRect = (savedRange && !savedRange.collapsed)
    ? savedRange.getBoundingClientRect()
    : triggerBtn.getBoundingClientRect();
  popover.style.position = "fixed";
  popover.style.top = `${anchorRect.bottom + 8}px`;
  popover.style.left = `${anchorRect.left}px`;

  // Clamp inside the viewport so the popover never spills off
  // screen on tight layouts or near-bottom selections.
  const pRect = popover.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (pRect.right > vw - 12) {
    popover.style.left = `${Math.max(12, vw - pRect.width - 12)}px`;
  }
  if (pRect.bottom > vh - 12) {
    // No room below — flip to above the anchor.
    popover.style.top = `${Math.max(12, anchorRect.top - pRect.height - 8)}px`;
  }

  const input = popover.querySelector(".detail-editor-link-input");
  const applyBtn = popover.querySelector(".detail-editor-link-apply");
  setTimeout(() => input.focus(), 0);

  const cleanup = () => {
    popover.remove();
    removeSelectionOverlay();
    document.removeEventListener("mousedown", outsideHandler, true);
  };
  const apply = () => {
    const url = input.value.trim();
    if (url && savedRange) {
      sel.removeAllRanges();
      sel.addRange(savedRange);
      body.focus();
      document.execCommand("createLink", false, url);
      syncEditBufferFromBody();
    }
    cleanup();
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      apply();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cleanup();
    }
  });
  applyBtn.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    apply();
  });
  // Outside-click dismiss. Trigger button counts as "inside" so
  // clicking it doesn't re-open immediately (the toggle at the
  // top handles that path).
  const outsideHandler = (event) => {
    if (popover.contains(event.target)) return;
    if (triggerBtn.contains(event.target)) return;
    cleanup();
  };
  setTimeout(() => document.addEventListener("mousedown", outsideHandler, true), 0);
}

/** Toggle a block-level format on the current selection. If the
 * caret is already inside the target tag (e.g. clicking H while
 * inside an H2), revert to a plain paragraph. Otherwise apply the
 * target tag. This is the toggle semantics every modern editor
 * uses for heading/quote toolbar buttons (Notion, Bear, Google
 * Docs all behave this way). execCommand("formatBlock") alone
 * only applies — it doesn't auto-revert on second click. */
function toggleBlockFormat(body, targetTag) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) {
    document.execCommand("formatBlock", false, targetTag);
    return;
  }
  let node = sel.getRangeAt(0).startContainer;
  if (node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode;
  const enclosing = node && node.closest ? node.closest(targetTag) : null;
  if (enclosing && body.contains(enclosing) && enclosing !== body) {
    // Already in target → unwrap by changing to paragraph.
    document.execCommand("formatBlock", false, "p");
  } else {
    document.execCommand("formatBlock", false, targetTag);
  }
}

/** Callout types — the five GitHub-flavored markdown callouts that
 * markdownLite renders with .callout + .callout-label styling. */
const EDITOR_CALLOUT_TYPES = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"];

/** Toggle the callout-type popover anchored to the toolbar button.
 * Click any type to insert a fresh callout block at the cursor;
 * click anywhere else to dismiss. */
function toggleCalloutMenu(toolButton) {
  // Menu now lives in a wrapper div alongside the button, not inside
  // the button itself — that way the button's :active scale(0.9) tap
  // feedback doesn't propagate into the menu's transform and visually
  // shrink the popover. Look up the menu via the wrap, not the button.
  const wrap = toolButton.closest(".detail-editor-tool-callout-wrap");
  const menu = wrap ? wrap.querySelector(".detail-editor-callout-menu") : null;
  if (!menu) return;
  if (!menu.classList.contains("hidden")) {
    menu.classList.add("hidden");
    return;
  }
  menu.innerHTML = EDITOR_CALLOUT_TYPES.map((type) =>
    `<button type="button" data-callout-type="${type}" role="menuitem">${type}</button>`
  ).join("");
  menu.querySelectorAll("button[data-callout-type]").forEach((opt) => {
    opt.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      menu.classList.add("hidden");
      insertEditorCallout(opt.dataset.calloutType);
    });
  });
  menu.classList.remove("hidden");
  // Dismiss on any outside mousedown. Scope is the WRAP (button +
  // menu) so clicking inside the menu doesn't dismiss it.
  const dismiss = (event) => {
    if (wrap && wrap.contains(event.target)) return;
    menu.classList.add("hidden");
    document.removeEventListener("mousedown", dismiss, true);
  };
  setTimeout(() => document.addEventListener("mousedown", dismiss, true), 0);
}

/** Build a fresh callout blockquote and insert it after the user's
 * current block-level element (paragraph, heading, etc.). The
 * structure (blockquote.callout + span.callout-label + paragraph)
 * matches what markdownLite produces, so on save htmlToMarkdown's
 * callout rule re-emits `> [!TYPE]\n> content` cleanly. */
function insertEditorCallout(type) {
  const body = document.getElementById("inlineEditBody");
  if (!body) return;
  body.focus();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;

  // If cursor is inside an existing callout, move it to AFTER the
  // callout so the new callout is inserted as a sibling instead of
  // nested. This is what stops repeated NOTE clicks from stacking
  // callouts inside callouts.
  const startNode = sel.getRangeAt(0).startContainer;
  const startEl = startNode.nodeType === Node.ELEMENT_NODE ? startNode : startNode.parentNode;
  const enclosingCallout = startEl && startEl.closest
    ? startEl.closest("blockquote.callout")
    : null;
  if (enclosingCallout && body.contains(enclosingCallout)) {
    const r = document.createRange();
    r.setStartAfter(enclosingCallout);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  // Unique marker ID lets us locate the freshly inserted blockquote
  // after execCommand returns. Random suffix avoids any clash if the
  // user mashes the button.
  const markerId = "_apricity_cb_" + Date.now() + "_" + Math.floor(Math.random() * 1e9);
  const calloutHtml = (
    `<blockquote id="${markerId}" class="callout callout-${type.toLowerCase()}">` +
    `<span class="callout-label" contenteditable="false">${type}</span>` +
    `<p>Write your callout here</p>` +
    `<button type="button" class="callout-remove" contenteditable="false" aria-label="Remove callout" title="Remove callout" data-callout-remove>&times;</button>` +
    `</blockquote>`
  );

  // execCommand("insertHTML") puts the insertion on the browser's
  // undo stack so Cmd+Z can reverse it. Direct DOM mutation
  // (appendChild / insertBefore) does NOT enter the undo stack,
  // which is why the old callout-insert path wasn't undoable.
  // Returns true if the command was executed; false means the
  // browser refused (rare in contenteditable on modern engines).
  const ok = document.execCommand("insertHTML", false, calloutHtml);
  let inserted = ok ? document.getElementById(markerId) : null;

  if (!inserted) {
    // execCommand path failed or browser stripped the marker —
    // fall back to manual DOM insertion. The user loses the
    // ability to Cmd+Z this single callout but at least the
    // feature still works.
    inserted = document.createElement("blockquote");
    inserted.className = "callout callout-" + type.toLowerCase();
    const lbl = document.createElement("span");
    lbl.className = "callout-label";
    lbl.setAttribute("contenteditable", "false");
    lbl.textContent = type;
    const para = document.createElement("p");
    para.textContent = "Write your callout here";
    inserted.appendChild(lbl);
    inserted.appendChild(para);
    inserted.appendChild(buildCalloutRemoveButton());
    let anchor = sel.getRangeAt(0).startContainer;
    while (anchor && anchor !== body && (anchor.nodeType !== Node.ELEMENT_NODE
        || !["P", "H1", "H2", "H3", "H4", "H5", "H6", "DIV", "LI", "BLOCKQUOTE", "PRE"].includes(anchor.tagName))) {
      anchor = anchor.parentNode;
    }
    if (anchor && anchor !== body && anchor.parentNode) {
      anchor.parentNode.insertBefore(inserted, anchor.nextSibling);
    } else {
      body.appendChild(inserted);
    }
  } else {
    // execCommand path succeeded. Clean up the marker ID and re-
    // apply contenteditable=false on the label + remove button
    // defensively in case the browser's HTML sanitizer stripped
    // those attributes (most don't, but Firefox has historically
    // been strict here).
    inserted.removeAttribute("id");
    const label = inserted.querySelector(".callout-label");
    if (label) label.setAttribute("contenteditable", "false");
    const removeBtn = inserted.querySelector(".callout-remove");
    if (removeBtn) removeBtn.setAttribute("contenteditable", "false");
  }

  // Place caret inside the new paragraph so the user can immediately
  // start typing the callout content.
  const p = inserted.querySelector("p");
  if (p) {
    const range = document.createRange();
    range.selectNodeContents(p);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  syncEditBufferFromBody();
}

/* ============================================================
   Markdown autoformat — inline-typing shortcuts inside the editor.
   ============================================================ */

/** Block-level tags eligible for autoformat conversion. Excludes
 * <li> (already a list) and <pre> (code blocks own their own
 * grammar). Callouts are checked separately via .closest. */
const AUTOFORMAT_BLOCK_TAGS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6"]);

/** If the caret is at the end of a leading bullet/number marker
 * (e.g. block text reads exactly "*" or "1." up to the caret),
 * convert the containing block into the corresponding list, eating
 * the marker. Returns true if the autoformat fired (caller should
 * preventDefault + sync the buffer). Returns false otherwise.
 *
 * Conditions:
 *   - selection must be collapsed (no marker work mid-selection)
 *   - containing block must be a plain paragraph/heading/div, NOT
 *     an <li> (no nested-list disasters) and NOT inside a callout
 *     (callouts shouldn't sprout lists from a leading asterisk
 *     while the user is composing prose)
 *   - leading text from block start to caret must match exactly:
 *       /^[-*+]$/   → unordered list
 *       /^\d+\.$/   → ordered list
 *
 * We build the <ul>/<ol><li> manually instead of using
 * document.execCommand("insertUnorderedList"). execCommand here
 * was unreliable in practice — after deleteContents the selection
 * is anchored to a node that just got removed, and the browser's
 * conversion ended up placing the caret OUTSIDE the new list
 * (typing then landed under the bullet instead of inside it).
 * Manual construction lets us explicitly set the selection at the
 * start of the new <li> so typing flows naturally. */
function tryAutoformatListAtCaret(body) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return false;

  // Walk up to the nearest block-level element.
  let block = range.startContainer;
  if (block.nodeType !== Node.ELEMENT_NODE) block = block.parentNode;
  while (block && block !== body && !AUTOFORMAT_BLOCK_TAGS.has(block.tagName)) {
    block = block.parentNode;
  }
  if (!block || block === body) return false;
  // Skip lists, code blocks, callouts.
  if (block.closest("li")) return false;
  if (block.closest("pre")) return false;
  if (block.closest("blockquote.callout")) return false;

  // Read the text content from the block's start up to the caret.
  const preRange = document.createRange();
  preRange.selectNodeContents(block);
  preRange.setEnd(range.startContainer, range.startOffset);
  const leading = preRange.toString();

  let listTag = null;
  if (/^[-*+]$/.test(leading)) listTag = "ul";
  else if (/^\d+\.$/.test(leading)) listTag = "ol";
  if (!listTag) return false;

  // Delete the leading marker.
  preRange.deleteContents();

  // Move any remaining children of the block into a new <li>.
  // Empty blocks produce an empty <li> with caret inside.
  const list = document.createElement(listTag);
  const li = document.createElement("li");
  while (block.firstChild) {
    li.appendChild(block.firstChild);
  }
  list.appendChild(li);
  block.parentNode.replaceChild(list, block);

  // Place caret at the START of the new <li> — for an empty <li>
  // this is the only sensible spot; for a non-empty one (text was
  // already present after the marker) we want the user to keep
  // typing where they left off, which is at the start of that
  // text.
  const newRange = document.createRange();
  newRange.selectNodeContents(li);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
  return true;
}

/** If the caret is inside a callout whose editable content (i.e.
 * everything except the type label and the X remove button) is
 * empty, removes the whole callout. Caret is re-placed at end of
 * the previous block (or start of next) via the same helper used
 * by the X-button handler. Returns true if a deletion happened. */
function tryBackspaceEmptyCallout(body) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return false;
  const node = sel.getRangeAt(0).startContainer;
  const startEl = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
  if (!startEl) return false;
  const callout = startEl.closest("blockquote.callout");
  if (!callout || !body.contains(callout)) return false;

  // Compute "editable text" = textContent minus the label and the
  // X-button. We clone instead of mutating live DOM so user-visible
  // state isn't disturbed if we decide not to act.
  const clone = callout.cloneNode(true);
  clone.querySelectorAll(".callout-label, .callout-remove").forEach((n) => n.remove());
  if (clone.textContent.trim() !== "") return false;

  const prev = callout.previousElementSibling;
  const next = callout.nextElementSibling;
  callout.remove();
  placeCaretAfterBlockRemoval(body, prev, next);
  return true;
}

/** Plain Enter inside a callout/admonition EXITS the box: drop a new
 * empty paragraph directly beneath the blockquote and move the caret
 * there. The browser default keeps inserting lines *inside* the
 * blockquote, which traps the caret with no keyboard way out (you can
 * only escape by clicking below the box with the mouse). Shift+Enter is
 * deliberately NOT routed here by the caller, so it keeps the browser
 * default — a line break WITHIN the box — matching the LLM-chat
 * convention (Enter leaves, Shift+Enter newlines). htmlToMarkdown turns
 * that <br> back into a continued `> ` line, so it round-trips.
 * Returns true if it acted; the caller then preventDefaults + syncs. */
function tryEnterExitCallout(body) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return false;
  const node = sel.getRangeAt(0).startContainer;
  const startEl = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
  if (!startEl || !startEl.closest) return false;
  const callout = startEl.closest("blockquote.callout");
  if (!callout || !body.contains(callout)) return false;
  // New empty paragraph after the box. The <br> is the standard way to
  // give an empty contenteditable paragraph height + a landable caret.
  const p = document.createElement("p");
  p.appendChild(document.createElement("br"));
  callout.after(p);
  const range = document.createRange();
  range.setStart(p, 0);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
  // contenteditable won't always scroll to a programmatically-placed
  // caret; nudge the new line into view.
  if (p.scrollIntoView) p.scrollIntoView({ block: "nearest" });
  return true;
}

/** Build a "remove this callout" X button. Marked contenteditable=
 * false so the caret can't land in it (would otherwise break typing
 * flow); class is in HTML_TO_MD_SKIP_CLASSES so it's stripped at
 * serialization time. type=button so it doesn't accidentally submit
 * any enclosing form (defensive — we don't currently have one). */
function buildCalloutRemoveButton() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "callout-remove";
  btn.setAttribute("contenteditable", "false");
  btn.setAttribute("aria-label", "Remove callout");
  btn.setAttribute("title", "Remove callout");
  btn.setAttribute("data-callout-remove", "");
  btn.textContent = "×"; // multiplication sign — heavier/better than ASCII x
  return btn;
}

/** Pass over every .callout inside the editor body and append an X
 * remove button if missing. Called once after the editor mounts
 * (so callouts rendered by markdownLite from the saved markdown get
 * the button too) and again after every input event for safety
 * (e.g. if the user pastes content that smuggles a callout DIV in,
 * though the paste handler already strips to plain text). Cheap —
 * just a querySelectorAll + conditional appendChild. */
function decorateEditorCallouts(body) {
  if (!body) return;
  body.querySelectorAll("blockquote.callout").forEach((q) => {
    // Lock the label against editing — it's the callout type, not
    // user prose. Idempotent setAttribute call.
    const label = q.querySelector(":scope > .callout-label");
    if (label && label.getAttribute("contenteditable") !== "false") {
      label.setAttribute("contenteditable", "false");
    }
    if (q.querySelector(":scope > .callout-remove")) return;
    q.appendChild(buildCalloutRemoveButton());
  });
}

/** Place the caret somewhere sensible after a block-level element
 * was removed from the editor. Tries, in order:
 *
 *   1. End of the previous sibling element (natural cursor-follows-
 *      reading-order behavior after delete)
 *   2. Start of the next sibling element (when removing the first
 *      block in the body)
 *   3. End of the body (last resort — empty document)
 *
 * Explicitly focuses the body since mousedown handlers that called
 * preventDefault would have suppressed the implicit focus shift.
 * Without this restoration, the selection still references the
 * detached DOM and the browser silently falls back to position
 * (0,0) of the body — which in our editor renders ABOVE the H1
 * title in a spot that isn't part of any visible block. */
function placeCaretAfterBlockRemoval(body, prevSibling, nextSibling) {
  const sel = window.getSelection();
  if (!sel) return;
  body.focus();
  const range = document.createRange();
  let target = null;
  let collapseToEnd = true;
  if (prevSibling && body.contains(prevSibling)) {
    target = prevSibling;
    collapseToEnd = true;
  } else if (nextSibling && body.contains(nextSibling)) {
    target = nextSibling;
    collapseToEnd = false;
  } else {
    target = body;
    collapseToEnd = true;
  }
  range.selectNodeContents(target);
  range.collapse(collapseToEnd);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Attach a popover-style autocomplete to an input.
 *
 * Behaviour:
 *   - Focus / input: re-filter candidates (prefix matches sort
 *     first, then alphabetical). Show top 8 in a popover below the
 *     input. Highlight the first prefix match by default.
 *   - ↓ / ↑: cycle through visible suggestions (wraps).
 *   - Tab or Enter: accept the highlighted suggestion.
 *   - Esc: dismiss the popover (doesn't bubble out to close the
 *     edit mode — stopPropagation).
 *   - Click on a suggestion: accept.
 *   - Blur: hide after a short delay (lets click-to-accept fire
 *     first; pure blur-then-hide would race the click).
 *   - Article scroll: hide (popover uses fixed positioning so it
 *     wouldn't follow the article anyway).
 *
 * The popover uses position:fixed so it can render outside the
 * scrollable article without getting clipped by overflow:hidden /
 * overflow:auto on the parent. Position is recalculated from the
 * input's bounding rect on every show.
 */
function setupChipAutocomplete(input, menu, candidatesFn) {
  let activeIdx = -1;
  let items = [];

  function refresh() {
    const valRaw = input.value.trim();
    const val = valRaw.toLowerCase();
    const all = (candidatesFn() || []).filter((c) => typeof c === "string");
    let filtered;
    if (val) {
      filtered = all.filter((c) => c.toLowerCase().includes(val));
      filtered.sort((a, b) => {
        const aPrefix = a.toLowerCase().startsWith(val) ? 0 : 1;
        const bPrefix = b.toLowerCase().startsWith(val) ? 0 : 1;
        if (aPrefix !== bPrefix) return aPrefix - bPrefix;
        return a.localeCompare(b);
      });
    } else {
      filtered = [...all].sort((a, b) => a.localeCompare(b));
    }
    items = filtered.slice(0, 8);
    // Hide when there's only one suggestion and it exactly matches
    // what the user already typed — no useful action to offer.
    if (!items.length || (val && items.length === 1 && items[0].toLowerCase() === val)) {
      hide();
      return;
    }
    // Highlight the first prefix match (top of list when val present).
    activeIdx = val
      ? Math.max(0, items.findIndex((i) => i.toLowerCase().startsWith(val)))
      : 0;
    render();
    show();
  }

  function render() {
    menu.innerHTML = items.map((item, idx) =>
      `<button type="button" class="detail-editor-chip-option${idx === activeIdx ? " is-active" : ""}" data-idx="${idx}" role="option" aria-selected="${idx === activeIdx ? "true" : "false"}">${escapeHtml(item)}</button>`
    ).join("");
    menu.querySelectorAll(".detail-editor-chip-option").forEach((el) => {
      // mousedown (not click) so the option's selection fires BEFORE
      // the input's blur event hides the menu.
      el.addEventListener("mousedown", (event) => {
        event.preventDefault();
        const idx = parseInt(el.dataset.idx, 10);
        if (!Number.isNaN(idx) && items[idx]) accept(items[idx]);
      });
    });
  }

  function show() { menu.classList.remove("hidden"); }
  function hide() {
    menu.classList.add("hidden");
    activeIdx = -1;
    items = [];
  }

  function accept(value) {
    input.value = value;
    // Fire input event so downstream handlers (state.editBuffer
    // sync, room-candidate recompute on wing change) treat the
    // accept like a normal typed entry.
    input.dispatchEvent(new Event("input", { bubbles: true }));
    hide();
  }

  input.addEventListener("input", refresh);
  input.addEventListener("focus", refresh);
  input.addEventListener("keydown", (event) => {
    if (menu.classList.contains("hidden")) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIdx = (activeIdx + 1) % items.length;
      render();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIdx = (activeIdx - 1 + items.length) % items.length;
      render();
      return;
    }
    if ((event.key === "Tab" || event.key === "Enter") && activeIdx >= 0) {
      event.preventDefault();
      accept(items[activeIdx]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation(); // don't bubble to the close-cascade
      hide();
      return;
    }
  });
  input.addEventListener("blur", () => {
    // Brief delay so option mousedown can land before the menu vanishes.
    setTimeout(hide, 120);
  });
  // No scroll/resize listeners needed — menu is now position:absolute
  // anchored to the chip-field, so it moves with the field naturally
  // as the sticky chip column repositions during scroll. This also
  // means the menu DOES NOT dismiss on scroll (user typing + glancing
  // at content shouldn't accidentally close suggestions).
}

/** Re-read the live editor's HTML and update state.editBuffer.content.
 * Called after programmatic edits (formatting shortcuts) that mutate
 * the DOM through paths that don't always fire the input event the
 * browser would fire for normal typing. Cheap idempotent operation. */
function syncEditBufferFromBody() {
  const body = document.getElementById("inlineEditBody");
  if (body && state.editBuffer) {
    state.editBuffer.content = htmlToMarkdown(body.innerHTML);
  }
}

/** Wrap the current selection range in a new element of the given
 * tag name. Used for "inline code" since execCommand doesn't ship
 * a built-in for it. Falls back to extractContents + insertNode
 * when the selection spans element boundaries (Range.surroundContents
 * throws in that case). Leaves the caret immediately after the
 * wrapped element so the next keystroke continues outside the
 * formatting — matches the convention every other editor uses for
 * inline-format toggles. */
function wrapEditorSelectionWith(tagName) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed) return; // nothing selected, nothing to wrap
  const wrapper = document.createElement(tagName);
  try {
    range.surroundContents(wrapper);
  } catch (e) {
    const frag = range.extractContents();
    wrapper.appendChild(frag);
    range.insertNode(wrapper);
  }
  const cursor = document.createRange();
  cursor.setStartAfter(wrapper);
  cursor.collapse(true);
  sel.removeAllRanges();
  sel.addRange(cursor);
}

/* ============================================================
   HTML → Markdown converter
   ------------------------------------------------------------
   Walks the DOM tree produced by markdownLite() (and by user
   contenteditable edits) and emits the corresponding markdown
   source. Scope is intentionally narrow: only the syntax the
   Apricity renderer actually produces. MemPalace-specific
   patterns (callouts, wiki-links) get explicit rules so they
   roundtrip cleanly.

   If you add a new markdown construct to markdownLite (custom
   block, new inline syntax), add a matching handler here or it
   will be silently lost on save.
   ============================================================ */

const HTML_TO_MD_SKIP_CLASSES = new Set([
  "code-copy-btn",     // UI chrome inside fenced code blocks
  "callout-label",     // handled by parent .callout blockquote
  "callout-remove",    // edit-mode X button — never persisted
  "drawer-id-copy",    // not present in body but defensive
]);

function htmlToMarkdown(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const out = walkHtmlToMarkdown(tmp);
  // Trim leading whitespace; collapse runs of 3+ newlines to exactly
  // two so the stored source stays tight per the project's "no
  // gratuitous blank lines" markdown convention.
  return out.replace(/^\n+/, "").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
}

function walkHtmlToMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  // Skip nodes that are pure UI chrome rather than content
  // (code-copy button inside fenced blocks, callout label that the
  // parent blockquote handles itself, etc.).
  if (node.classList) {
    for (const c of HTML_TO_MD_SKIP_CLASSES) {
      if (node.classList.contains(c)) return "";
    }
  }

  const tag = node.tagName.toLowerCase();
  const kids = () => Array.from(node.childNodes).map(walkHtmlToMarkdown).join("");

  // --- block headings -------------------------------------------
  if (tag === "h1") return "# " + kids().trim() + "\n\n";
  if (tag === "h2") return "## " + kids().trim() + "\n\n";
  if (tag === "h3") return "### " + kids().trim() + "\n\n";
  if (tag === "h4") return "#### " + kids().trim() + "\n\n";
  if (tag === "h5") return "##### " + kids().trim() + "\n\n";
  if (tag === "h6") return "###### " + kids().trim() + "\n\n";

  // --- inline formatting ----------------------------------------
  if (tag === "strong" || tag === "b") return "**" + kids() + "**";
  if (tag === "em" || tag === "i") return "*" + kids() + "*";
  // <strike> is deprecated but still emitted by some browsers'
  // execCommand("strikethrough"). Some browsers emit a <span> with
  // an inline `text-decoration: line-through` style instead — catch
  // that too so strikethrough roundtrips on every engine.
  if (tag === "del" || tag === "s" || tag === "strike") return "~~" + kids() + "~~";
  if (tag === "span" && node.style && /line-through/.test(node.style.textDecoration || node.style.textDecorationLine || "")) {
    return "~~" + kids() + "~~";
  }
  if (tag === "code") {
    // Inside a <pre>? Let the <pre> handler emit the fenced block —
    // don't double-wrap this code element in backticks.
    if (node.parentElement && node.parentElement.tagName === "PRE") return kids();
    return "`" + node.textContent + "`";
  }

  // --- fenced code blocks ---------------------------------------
  if (tag === "pre") {
    const codeEl = node.querySelector("code");
    const langMatch = codeEl ? codeEl.className.match(/language-(\S+)/) : null;
    const lang = langMatch ? langMatch[1] : "";
    const body = codeEl ? codeEl.textContent : node.textContent;
    return "```" + lang + "\n" + body.replace(/\n+$/, "") + "\n```\n\n";
  }

  // --- callouts + blockquotes -----------------------------------
  if (tag === "blockquote") {
    // GitHub-style callout? markdownLite renders > [!TYPE] as a
    // blockquote with a .callout class and a .callout-label span.
    if (node.classList.contains("callout")) {
      const label = node.querySelector(".callout-label");
      const type = label ? label.textContent.trim().toUpperCase() : "NOTE";
      // Clone so we can strip the label from the content walk
      // without mutating the live DOM the user is still editing.
      // Walk the clone's CHILDREN (not the clone itself) so we
      // don't recursively re-enter this same blockquote handler.
      const clone = node.cloneNode(true);
      const cloneLabel = clone.querySelector(".callout-label");
      if (cloneLabel) cloneLabel.remove();
      const inner = Array.from(clone.childNodes)
        .map(walkHtmlToMarkdown).join("").trim();
      const quoted = inner.split("\n").map((l) => l.length ? "> " + l : ">").join("\n");
      return "> [!" + type + "]\n" + quoted + "\n\n";
    }
    // Regular blockquote
    const inner = kids().trim();
    return inner.split("\n").map((l) => l.length ? "> " + l : ">").join("\n") + "\n\n";
  }

  // --- lists ----------------------------------------------------
  if (tag === "ul") {
    const items = Array.from(node.children)
      .filter((li) => li.tagName === "LI")
      .map((li) => "- " + walkHtmlToMarkdown(li).trim().replace(/\n/g, "\n  "));
    return items.join("\n") + "\n\n";
  }
  if (tag === "ol") {
    const items = Array.from(node.children)
      .filter((li) => li.tagName === "LI")
      .map((li, i) => (i + 1) + ". " + walkHtmlToMarkdown(li).trim().replace(/\n/g, "\n   "));
    return items.join("\n") + "\n\n";
  }
  if (tag === "li") return kids();

  // --- links + wiki-links ---------------------------------------
  if (tag === "a") {
    if (node.classList.contains("wiki-link")) {
      const link = node.dataset.link || node.textContent;
      return "[[" + link + "]]";
    }
    const href = node.getAttribute("href") || "";
    return "[" + kids() + "](" + href + ")";
  }

  // --- images ---------------------------------------------------
  if (tag === "img") {
    const alt = node.getAttribute("alt") || "";
    const src = node.getAttribute("src") || "";
    return "![" + alt + "](" + src + ")";
  }

  // --- paragraph + line break + rule ----------------------------
  if (tag === "p") return kids() + "\n\n";
  if (tag === "br") return "\n";
  if (tag === "hr") return "\n---\n\n";

  // --- div fallback ---------------------------------------------
  // contenteditable browsers wrap new lines in <div> by default
  // (Chrome) or <p> (Firefox). Treat unmarked div as a paragraph;
  // structural divs from markdownLite (code-block-wrap) pass
  // through transparently so their children render unchanged.
  if (tag === "div") {
    if (node.classList.contains("code-block-wrap")) return kids();
    return kids() + "\n\n";
  }

  // span + everything unknown: walk children transparently
  return kids();
}

// ---------- edit (legacy modal — tombstone cluster) -----------------
// openEditSheet was the only public entry point into the modal edit
// sheet, and it had zero call sites — removed 2026-05-28. The rest of
// this cluster (closeEditSheet / saveEdit / setEditStatus /
// applyTitleToContent + the #editSheet HTML + event listeners around
// line ~6995) is still wired but unreachable: nothing opens the modal,
// so nothing ever closes or submits it either. The whole subtree is
// safe to delete in a future cleanup pass — coordinated changes
// across app.js (remove the cluster + els.edit* lookups + the three
// listeners at els.editClose / els.editBackdrop / els.editForm) and
// index.html (drop the #editSheet markup). Kept here for now because
// the cluster is internally consistent and the perf cost is zero
// (no code paths reach it, the only cost is the parse weight of
// dead bytes — single-digit KB, indistinguishable at runtime).
// The live edit path is enterEditMode → inline contenteditable, see
// elsewhere in this file.

function closeEditSheet() {
  state.editDrawerId = null;
  dismissSheet(els.editSheet, () => setEditStatus(""));
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
  resetSheetScroll(els.draftsSheet);
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
            <strong>${escapeHtml(cleanTitle(d.title))}</strong>
            <span>${escapeHtml(d.wing)} / ${escapeHtml(d.room)} · ${escapeHtml(d.created_at)}</span>
          </div>
          <div class="draft-actions">
            <button class="icon-button icon-only" type="button" data-edit-draft="${escapeHtml(d.id)}" aria-label="Edit draft" title="Edit">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14.06 4.94a2.25 2.25 0 0 1 3.18 0l1.82 1.82a2.25 2.25 0 0 1 0 3.18L9.5 19.5l-4.5 1 1-4.5 8.06-11.06Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
                <path d="m13 6 5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              </svg>
            </button>
            <button class="icon-button icon-only danger-button" type="button" data-delete-draft="${escapeHtml(d.id)}" data-delete-label="${escapeHtml(cleanTitle(d.title))}" aria-label="Delete draft" title="Delete">
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
          dismissSheet(els.draftsSheet, () => openWriteSheetForDraft(detail.draft));
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
  dismissSheet(els.draftsSheet);
}

// ---------- trash / versions ----------
// One Trash for memories and tunnels. The server writes both kinds of
// snapshots to the same JSONL (drawer records carry drawer_id at top
// level; tunnel records carry kind:"tunnel" with the full tunnel nested
// under "tunnel"). Filtering keeps drawer delete/edit snapshots and
// tunnel delete snapshots — restores dispatch by kind on the server.
// Trash bin only surfaces actual deletions. Edit snapshots
// (update-before) and rename snapshots (rename-before) are NOT in
// this set per the new policy: snapshots are only kept for explicitly
// deleted content. Going forward the server no longer writes those
// snapshot kinds either, but the filter stays defensive so any
// historical entries still in dashboard-versions.jsonl don't
// re-appear in the UI.
const TRASH_ACTIONS = new Set(["delete", "delete_tunnel"]);

function trashRowHtml(v, idx) {
  if (v.kind === "tunnel") {
    const t = v.tunnel || {};
    const src = t.source || {};
    const tgt = t.target || {};
    const sourceLabel = `${escapeHtml(humanizeName(tunnelWingForm(src.wing || "?")))} / ${escapeHtml(humanizeName(src.room || "?"))}`;
    const targetLabel = `${escapeHtml(humanizeName(tunnelWingForm(tgt.wing || "?")))} / ${escapeHtml(humanizeName(tgt.room || "?"))}`;
    const labelPreview = t.label
      ? `<span class="trash-tunnel-label">${escapeHtml(t.label.slice(0, 140))}${t.label.length > 140 ? "…" : ""}</span>`
      : "";
    return `<div class="draft-item trash-tunnel-row">
        <div class="draft-info">
          <strong>${sourceLabel} <span class="trash-tunnel-arrow">↔</span> ${targetLabel}</strong>
          <span>tunnel · ${escapeHtml(formatTimestamp(v.logged_at) || v.logged_at)}</span>
          ${labelPreview}
        </div>
        <div class="draft-actions">
          <button class="icon-button icon-only danger-button" type="button" data-trash-delete="${idx}" aria-label="Permanently delete this snapshot" title="Delete forever">
            ${TRASH_GLYPH_SVG}
          </button>
          <button class="primary-action" type="button" data-restore-version="${idx}">Restore</button>
        </div>
      </div>`;
  }
  return `<div class="draft-item">
      <div class="draft-info">
        <strong>${escapeHtml(cleanTitle(v.title) || v.drawer_id)}</strong>
        <span>${escapeHtml(v.action)} · ${escapeHtml(v.wing || "?")}/${escapeHtml(v.room || "?")} · ${escapeHtml(formatTimestamp(v.logged_at) || v.logged_at)}</span>
      </div>
      <div class="draft-actions">
        <button class="icon-button icon-only danger-button" type="button" data-trash-delete="${idx}" aria-label="Permanently delete this snapshot" title="Delete forever">
          ${TRASH_GLYPH_SVG}
        </button>
        <button class="primary-action" type="button" data-restore-version="${idx}">Restore</button>
      </div>
    </div>`;
}

const TRASH_GLYPH_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 7h14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
    <path d="M10 7V5.5A1.5 1.5 0 0 1 11.5 4h1A1.5 1.5 0 0 1 14 5.5V7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/>
    <path d="M7 7h10l-.9 11.2A1.8 1.8 0 0 1 14.3 20H9.7a1.8 1.8 0 0 1-1.8-1.8L7 7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
    <path d="M10.5 10.5v6M13.5 10.5v6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`;

async function openTrashSheet() {
  els.trashSheet.classList.remove("hidden");
  resetSheetScroll(els.trashSheet);
  setTrashStatus("");
  els.trashList.innerHTML = `<div class="empty-list">Loading…</div>`;
  els.trashClearAll.classList.add("hidden");
  try {
    // The server reads the trash auto-delete preference itself and
    // prunes before returning the list — the client no longer needs
    // to pass it. Whatever's in the response is what's actually still
    // on disk post-prune.
    const data = await fetchJson("/api/versions");
    const versions = (data.versions || []).filter((v) => TRASH_ACTIONS.has(v.action));
    if (!versions.length) {
      els.trashList.innerHTML = `<div class="empty-list">No deleted memories or tunnels logged yet.</div>`;
      return;
    }
    els.trashClearAll.classList.remove("hidden");
    els.trashList.innerHTML = versions.map((v, idx) => trashRowHtml(v, idx)).join("");
    els.trashList.querySelectorAll("[data-restore-version]").forEach((btn) => {
      btn.addEventListener("click", () => {
        // Disable immediately so a rapid double-click can't fire two
        // restore POSTs — the server consumes the snapshot on the first
        // success (delete_version), and the second call would either
        // duplicate the drawer or fail confusingly.
        if (btn.disabled) return;
        btn.disabled = true;
        const idx = parseInt(btn.dataset.restoreVersion, 10);
        const v = versions[idx];
        if (v.kind === "tunnel") {
          // Tunnel restore: keep the synchronous path. Tunnel
          // placeholders would have to fake source/target objects with
          // correct drawer-id references, and there's no equivalent of
          // markDrawerSeen for tunnels, so the optimistic-with-revert
          // payoff is much smaller. The tunnel restore round-trip is
          // also typically fast enough that a brief "Restoring…" status
          // covers it.
          (async () => {
            setTrashStatus("Restoring…", "info");
            try {
              const tid = (v.tunnel && (v.tunnel.id || v.tunnel.tunnel_id)) || "";
              await postJson("/api/versions/restore", { tunnel_id: tid, logged_at: v.logged_at });
              await loadTunnels();
              render();
              await openTrashSheet();
              setTrashStatus("Tunnel restored.", "success");
            } catch (error) {
              setTrashStatus(error.message, "error");
              btn.disabled = false;
            }
          })();
          return;
        }
        // Drawer restore: OPTIMISTIC PATH. Mirror commitEditMode —
        // snapshot, close sheet, mutate state, fire-and-handle in the
        // background, revert + notify on failure. The user sees the
        // restored memory appear in the main list with zero perceived
        // wait; the trash row is gone the moment the sheet closes.
        if (!state.palace || !Array.isArray(state.palace.drawers)) {
          // No palace loaded yet — fall back to the old synchronous
          // path. Shouldn't happen in practice (trash sheet requires
          // the palace to be loaded to render anything) but defensive.
          (async () => {
            try {
              const data = await postJson("/api/versions/restore", { drawer_id: v.drawer_id, logged_at: v.logged_at });
              const newId = data && data.new_drawer_id;
              if (newId) markDrawerSeen(newId);
              await loadPalace();
              await openTrashSheet();
              setTrashStatus("Restored as a fresh copy.", "success");
            } catch (error) {
              setTrashStatus(error.message, "error");
            }
          })();
          return;
        }
        // Build a placeholder drawer from the snapshot fields the
        // versions log captured at delete time (wing, room, title,
        // content, added_by, source_file, filed_at). updated_at is
        // clamped equal to filed_at so isUpdateEvent treats it as a
        // creation event — restore is recovery, not an edit, so the
        // bell + Updated badge should stay quiet.
        const placeholderId = `__pending_restore_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const placeholder = {
          drawer_id: placeholderId,
          wing: v.wing || "",
          room: v.room || "",
          title: v.title || deriveTitleFromContent(v.content) || "Untitled",
          content: v.content || "",
          added_by: v.added_by || "",
          source_file: v.source_file || "",
          filed_at: v.filed_at || new Date().toISOString(),
          updated_at: v.filed_at || new Date().toISOString(),
          etag: "",
          _pendingRestore: true, // marker — currently unused by render
                                  // but reserved for a "syncing…" badge
                                  // if we want one later
        };
        // Mark seen up-front so even if loadPalace returns the real
        // drawer before the placeholder swap below has a chance to
        // run, the bell never sees it as new. Both namespaces: a
        // recently-filed restored drawer is within the recency window,
        // so the card-dot key alone won't keep it out of the bell.
        markDrawerSeen(placeholderId);
        markBellItemsSeen([placeholderId]);
        state.palace.drawers.push(placeholder);
        // Snapshot for revert: we don't need to remember a position
        // since the placeholder is appended. On failure we just filter
        // it back out.
        // Close the trash sheet immediately and re-render so the
        // placeholder appears in the main list right away.
        dismissSheet(els.trashSheet, () => setTrashStatus(""));
        invalidateCardCache();
        state._filteredDrawersCache = null;
        render();
        // BACKGROUND RESTORE. On success: swap placeholder id for the
        // real new drawer_id the server returns (so card click /
        // selection work against the canonical id), markSeen the real
        // id, then sync from server to pick up server-side normalization
        // (etag, any title cleanup). On failure: remove the placeholder
        // and push a failure entry to the bell.
        postJson("/api/versions/restore", { drawer_id: v.drawer_id, logged_at: v.logged_at })
          .then((data) => {
            const realId = (data && data.new_drawer_id)
              || (data && data.result && data.result.drawer_id)
              || "";
            if (realId) {
              const ph = drawerById(placeholderId);
              if (ph) ph.drawer_id = realId;
              // Also seen the real id — loadPalace below will replace
              // the placeholder with the server's canonical row whose
              // drawer_id is realId, and we want THAT row to also be
              // pre-seen so the bell stays quiet after the refresh.
              // (Server also self-seens on restore; this is the local half.)
              markDrawerSeen(realId);
              markBellItemsSeen([realId]);
              if (state.selectedDrawerId === placeholderId) {
                state.selectedDrawerId = realId;
              }
            }
            return loadPalace().then(() => {
              if (realId) markDrawerSeen(realId);
              invalidateCardCache();
              state._filteredDrawersCache = null;
              render();
            });
          })
          .catch((error) => {
            // Restore failed — drop the placeholder + push a failed-
            // save entry to the notification bell so the user gets a
            // visible signal of what didn't go through.
            if (state.palace && Array.isArray(state.palace.drawers)) {
              state.palace.drawers = state.palace.drawers.filter(
                (d) => d.drawer_id !== placeholderId,
              );
            }
            if (state.selectedDrawerId === placeholderId) {
              state.selectedDrawerId = null;
            }
            pushFailedSave({
              drawer_id: placeholderId,
              title: placeholder.title,
              wing: placeholder.wing,
              room: placeholder.room,
              error: `Restore failed: ${(error && error.message) || "unknown error"}`,
            });
            invalidateCardCache();
            state._filteredDrawersCache = null;
            render();
          });
      });
    });
    els.trashList.querySelectorAll("[data-trash-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = parseInt(btn.dataset.trashDelete, 10);
        const v = versions[idx];
        const label = v.kind === "tunnel"
          ? `${(v.tunnel && v.tunnel.label) ? v.tunnel.label.slice(0, 80) : "this tunnel"}`
          : (v.title || v.drawer_id);
        if (!confirm(`Permanently delete this snapshot of "${label}"? It will not be restorable.`)) return;
        btn.disabled = true;
        setTrashStatus("Deleting snapshot…", "info");
        try {
          if (v.kind === "tunnel") {
            const tid = (v.tunnel && (v.tunnel.id || v.tunnel.tunnel_id)) || "";
            await postJson("/api/versions/delete", { tunnel_id: tid, logged_at: v.logged_at });
          } else {
            await postJson("/api/versions/delete", { drawer_id: v.drawer_id, logged_at: v.logged_at });
          }
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
  els.trashClearAll.addEventListener("click", () => {
    // Route through the standard confirm-sheet instead of the native
    // browser confirm() — same chrome as every other destructive action
    // in the app, plus an explicit "this cannot be undone" treatment
    // (the standard sheet's "Recoverable from the trash bin" hint is
    // replaced with a danger-styled permanence warning, and the
    // confirm button reads "Delete forever").
    openDeleteSheet({
      title: "Empty Recently deleted?",
      body: "Every snapshot in the trash bin will be permanently removed.",
      warning: "",
      hint: "This cannot be undone — restoration won't be possible after this.",
      hintDanger: true,
      confirmLabel: "Delete forever",
      count: 1,
      onConfirm: async () => {
        await postJson("/api/versions/clear", { confirm: "CLEAR" });
        setDeleteStatus("Trash bin emptied.", "success");
        // Refresh the trash sheet so the now-empty state is visible
        // behind / under the confirm sheet that's about to close.
        openTrashSheet();
      },
    });
  });
}

function closeTrashSheet() {
  dismissSheet(els.trashSheet);
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
  resetSheetScroll(els.factSheet);
  focusSheetField(els.factSubject);
}

function closeFactSheet() {
  dismissSheet(els.factSheet, () => { state.factEditing = null; });
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
  // Clear .is-opened so the freshly-opened sheet plays its pop-in
  // animation. .is-opened gets re-added once the animation finishes
  // (or after a short delay if animationend doesn't fire) — that
  // guards against re-triggering the animation on subsequent class
  // changes while the sheet stays open (notably the reduce-motion
  // toggle, which previously made the panel "pop" as if first opening).
  els.settingsSheet.classList.remove("is-opened");
  els.settingsSheet.classList.remove("hidden");
  resetSheetScroll(els.settingsSheet);
  const settle = () => els.settingsSheet.classList.add("is-opened");
  // Listen on .settings-shell-wrap because that's the actual animation
  // root since 2026-05-28 — the entry/exit pop animations were moved
  // off the shell onto the wrap so the wrap (shell + floating close
  // pill) animate as one rigid unit. Listening on .settings-shell here
  // meant animationend never fired, and `is-opened` was only added via
  // the 500ms fallback timeout — a window where toggling reduce-motion
  // could re-trigger the entry animation mid-frame.
  const animRoot = els.settingsSheet.querySelector(".settings-shell-wrap")
    || els.settingsSheet.querySelector(".settings-shell");
  if (animRoot) {
    animRoot.addEventListener("animationend", settle, { once: true });
    // Defensive timeout in case animationend never fires (reduce-
    // motion path completes the animation in 0.001s and may not
    // dispatch the event reliably across all browsers).
    setTimeout(settle, 500);
  } else {
    settle();
  }
  // Reset to the Display pane on every open so the user has a
  // predictable starting point (matches macOS Settings, which always
  // opens to the same first pane regardless of where you were
  // before). If we later persist last-pane, swap "display" for the
  // stored value here.
  setSettingsPane("display");
  // Refresh server-stored preferences each time Settings opens so
  // values updated from another browser (the prefs are machine-wide)
  // show their latest state here, not the boot-time snapshot. After
  // re-sync we also re-apply the visual preferences in case another
  // device toggled them (e.g. footer info visibility, reduce motion).
  fetchPreferences().then(() => {
    syncPreferenceControls();
    applyReduceMotion();
    applyFooterInfoVisibility();
  }).catch(() => {});
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
  focusSheetField(els.settingsUsername);
}

function closeSettingsSheet() {
  dismissSheet(els.settingsSheet);
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

// ---------- Settings sheet: sidebar nav pane switching ----------
// The new sheet renders all five panes (Display / Shortcuts / Trash /
// Backup / Account) but only one is visible at a time — clicking a
// sidebar item swaps which .settings-pane has the .hidden class and
// updates the .is-active marker on the nav buttons. Pure DOM, no
// state stored — each open of the sheet starts on the Display pane.
function setSettingsPane(targetPane) {
  document.querySelectorAll(".settings-pane[data-settings-pane]").forEach((pane) => {
    pane.classList.toggle("hidden", pane.dataset.settingsPane !== targetPane);
  });
  document.querySelectorAll(".settings-nav-item[data-settings-pane]").forEach((item) => {
    const active = item.dataset.settingsPane === targetPane;
    item.classList.toggle("is-active", active);
    item.setAttribute("aria-selected", active ? "true" : "false");
  });
  // Reset scroll on the content pane so a long pane the user
  // previously visited doesn't leave the new pane scrolled mid-way.
  const contentPane = document.querySelector(".settings-content-pane");
  if (contentPane) contentPane.scrollTop = 0;
  // Lazy-fetch /api/version the first time the About pane is shown.
  // Server-side cache makes subsequent panes near-free; doing it
  // here (vs on boot) avoids one network call for the majority of
  // sessions where the user never opens Settings → About.
  if (targetPane === "about") populateAboutVersion();
}

/** Fetches /api/version once per page load (cached in a module-level
 * promise) and returns the installed/latest payload. Failures resolve
 * to null so callers can fall back to leaving the version chip
 * un-updated instead of throwing into the open settings flow. */
let _versionInfoPromise = null;
function fetchVersionInfo() {
  if (!_versionInfoPromise) {
    _versionInfoPromise = fetchJson("/api/version").catch(() => null);
  }
  return _versionInfoPromise;
}

/** Compare two semver-ish version strings — returns true if `a` is
 * strictly newer than `b`. Handles "0.6.0-rc1" / "0.6.0+build" by
 * splitting on . - + and only comparing the first three components
 * numerically (non-numeric parts treated as 0). */
function versionIsNewer(a, b) {
  const parse = (v) => String(v || "").split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 > b1;
  if (a2 !== b2) return a2 > b2;
  return a3 > b3;
}

/** Populate the About pane's version badge from /api/version. When
 * GitHub returns a newer release tag than what's installed, also
 * unhide the "update available" link and point it at the releases
 * page URL the server sent (avoids hardcoding the URL in two
 * places). Silent no-op on fetch failure — the user sees the
 * placeholder "v…" text rather than a broken state. */
async function populateAboutVersion() {
  const data = await fetchVersionInfo();
  if (!data) return;
  const badge = document.getElementById("aboutVersion");
  if (badge && data.installed) {
    badge.textContent = data.installed === "unknown" ? "dev" : `v${data.installed}`;
  }
  const updateLink = document.getElementById("aboutUpdate");
  const updateText = document.getElementById("aboutUpdateVersion");
  if (!updateLink || !updateText) return;
  const hasUpdate = data.latest_github
    && data.installed
    && data.installed !== "unknown"
    && versionIsNewer(data.latest_github, data.installed);
  if (hasUpdate) {
    updateText.textContent = `v${data.latest_github}`;
    if (data.releases_url) updateLink.href = data.releases_url;
    updateLink.setAttribute("title", `Update available: v${data.latest_github}`);
    updateLink.classList.remove("hidden");
  } else {
    updateLink.classList.add("hidden");
  }
}
document.querySelectorAll(".settings-nav-item[data-settings-pane]").forEach((item) => {
  item.addEventListener("click", (event) => {
    event.preventDefault();
    setSettingsPane(item.dataset.settingsPane);
  });
});
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

const exportBtn = on("exportBtn", "click", exportPalace);

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
  dismissSheet(els.loginSheet);
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
  const mobileProxy = event.target.closest("[data-mobile-proxy]");
  if (mobileProxy) {
    event.preventDefault();
    event.stopPropagation();
    const target = document.getElementById(mobileProxy.dataset.mobileProxy || "");
    closeMenus();
    if (target) target.click();
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
    // Pencil click → enter inline edit mode (default). When ALREADY
    // editing (the button is now the blue save check), commit the
    // pending changes via /api/memories/update. Same button, two
    // roles based on state — mirrors the maximize/minimize toggle.
    //
    // editClosing guard: when the user clicks the button during the
    // close-cascade (after pressing cancel/save), state.isEditing is
    // still true but we're on our way out. The click should be
    // treated as "interrupt and stay in edit" — route to
    // enterEditMode, which detects editClosing and reverses the
    // cascade. Without this guard the click would fall into the
    // commitEditMode branch and fire another save instead of
    // canceling the close.
    if (state.isEditing && state.editBuffer
        && !state.editClosing
        && state.editBuffer.drawerId === editButton.dataset.editDrawerId) {
      commitEditMode();
    } else {
      enterEditMode(editButton.dataset.editDrawerId);
    }
    return;
  }
  if (!event.target.closest(".action-menu")) {
    closeMenus();
  }
});

// Shared "select drawer #N from the filtered list" routine — used by
// the arrow-key keyboard navigation handler below. Computes the
// target card's pixel position (the list is virtualized, so the card
// may not be in the DOM yet), scrolls it into the visible viewport
// if it's currently above or below, then re-runs the window render
// so the new card is in the DOM. Finally toggles the active class
// + fires the click-pop animation for visual continuity with a
// mouse click.
function selectDrawerByIndex(idx, direction) {
  const drawers = state._virtDrawers;
  if (!drawers || idx < 0 || idx >= drawers.length) return;
  const drawer = drawers[idx];
  // Arrow-key navigation through the memories list is a fresh nav
  // (browsing siblings), not a wikilink follow — drop any pending
  // back-stack so the newly-opened memory's back button doesn't
  // surface a stale link-chain destination.
  clearDrawerNavStack();
  state.selectedDrawerId = drawer.drawer_id;
  state.detailOverride = null;
  state.detailDismissed = false;
  state.detailDirection = direction;
  renderDetail();
  // Bring the target card into view. With virtualization, this means
  // adjusting drawer-list.scrollTop based on the card's calculated
  // pixel position (idx * VIRT_ROW), then re-rendering the window so
  // the freshly-visible card is actually in the DOM. Buffer of one
  // gap keeps a sliver of breathing room above/below.
  const list = els.drawerList;
  const cardTop = idx * VIRT_ROW;
  const cardBottom = cardTop + VIRT_CARD_HEIGHT;
  const visibleTop = list.scrollTop || 0;
  const visibleBottom = visibleTop + (list.clientHeight || 600);
  if (cardTop < visibleTop) {
    list.scrollTop = Math.max(0, cardTop - VIRT_CARD_GAP);
  } else if (cardBottom > visibleBottom) {
    list.scrollTop = cardBottom - (list.clientHeight || 600) + VIRT_CARD_GAP;
  }
  renderDrawerWindow();
  // Activate the newly-rendered card + fire the same pop animation
  // a click would trigger.
  const prev = list.querySelector(".drawer-card.active");
  if (prev) prev.classList.remove("active");
  const next = list.querySelector(`.drawer-card[data-id="${CSS.escape(drawer.drawer_id)}"]`);
  if (next) {
    next.classList.add("active");
    next.classList.remove("clicked-pop");
    requestAnimationFrame(() => next.classList.add("clicked-pop"));
    setTimeout(() => next.classList.remove("clicked-pop"), 360);
  }
  writeHash();
}

// ---------- keyboard shortcuts ----------
document.addEventListener("keydown", (event) => {
  const isMod = event.metaKey || event.ctrlKey;
  if (isMod && event.key.toLowerCase() === "k") {
    // Don't hijack ⌘K when the user is inside the inline editor or
    // its link popover — there ⌘K is the hyperlink shortcut. The
    // editor body's own keydown handler stops propagation, so this
    // check is mostly defensive (and also catches the popover's
    // text input, which isn't a contenteditable).
    const active = document.activeElement;
    if (active) {
      if (active.isContentEditable) return;
      if (active.closest && active.closest(".detail-editor-link-popover")) return;
    }
    event.preventDefault();
    els.searchInput.focus();
    els.searchInput.select();
    return;
  }
  // Close-cascade trigger: the user-remappable "close" shortcut (X by
  // default) is the primary, Esc is kept as a non-remappable fallback.
  // Browsers reserve Esc for exiting fullscreen, so in fullscreen mode
  // only the remappable key reaches this handler. The fallback covers
  // non-fullscreen users who already know the convention. The combobox
  // input handler (Write form) still uses Esc locally to close its
  // dropdown — it has its own keydown listener inside the input.
  if (
    event.key === "Escape"
    || (shortcutMatches(event, "close") && !isMod)
  ) {
    // For any non-Esc trigger, bail if the user is typing in a form
    // control or contenteditable — the close-shortcut might be a
    // printable character (X by default, but any letter after remap)
    // that would otherwise dismiss sheets while the user types.
    // Esc skips this check; it's not a printable character.
    if (event.key !== "Escape") {
      const target = event.target;
      const isTyping = target && (
        target.matches?.("input, textarea, select")
        || target.isContentEditable
      );
      if (isTyping) return;
    }
    if (state.renaming) {
      state.renaming = null;
      render();
      return;
    }
    // Cascade closing — close the topmost overlay first, leave the
    // rest alone. Press the close key again to close the next layer
    // down. Matches macOS / iOS convention: each press dismisses one
    // thing.
    //
    // Order: open sheet → open menu → active inline edit → open detail panel.
    const anySheetOpen = document.querySelector(
      ".write-sheet:not(.hidden), .confirm-sheet:not(.hidden), .edit-sheet:not(.hidden), .drafts-sheet:not(.hidden), .trash-sheet:not(.hidden), .fact-sheet:not(.hidden), .settings-overlay:not(.hidden)"
    );
    if (anySheetOpen) {
      [els.writeSheet, els.editSheet, els.deleteSheet, els.draftsSheet, els.trashSheet, els.factSheet, els.settingsSheet]
        .forEach((sheet) => sheet && dismissSheet(sheet));
      return;
    }
    const anyMenuOpen = document.querySelector(".action-menu:not(.hidden)");
    if (anyMenuOpen) {
      closeMenus();
      return;
    }
    // Active inline editor → cancel the edit (same as clicking the
    // grey X). Sits BEFORE the "close detail panel" branch so users
    // mid-edit don't accidentally dump both the edit buffer AND the
    // open memory in one keypress.
    if (state.isEditing && state.editBuffer) {
      cancelEditMode();
      return;
    }
    // No overlays → close the detail panel if a memory is in view.
    // Mirrors the close-X button's handler exactly so keyboard and
    // click paths produce the same final state (selectedDrawerId
    // cleared, detailDismissed set so the auto-tunnel-show on the
    // selected room doesn't snap the panel right back open,
    // detailEnlarged reset so re-opening starts from default size).
    if (state.selectedDrawerId || state.detailOverride) {
      state.selectedDrawerId = null;
      state.detailOverride = null;
      state.detailDismissed = true;
      state.detailEnlarged = false;
      render();
      writeHash();
      return;
    }
    return;
  }
  // F — toggle the detail panel between default and enlarged sizes.
  // Mirrors the maximize/minimize floating button click. Single
  // key, single purpose; the button itself toggles too (icon
  // swaps to ⊟ when enlarged) so there's no separate "minimize"
  // key — the same press undoes the enlarge. Skipped when typing
  // in a text field / form control / contenteditable, when any
  // sheet/menu is open, and when no memory is in the detail pane
  // to act on.
  if (shortcutMatches(event, "maximize") && !isMod) {
    const target = event.target;
    const isTyping = target && (
      target.matches?.("input, textarea, select")
      || target.isContentEditable
    );
    if (isTyping) return;
    const anySheetOpenF = document.querySelector(
      ".write-sheet:not(.hidden), .confirm-sheet:not(.hidden), .edit-sheet:not(.hidden), .drafts-sheet:not(.hidden), .trash-sheet:not(.hidden), .fact-sheet:not(.hidden), .settings-overlay:not(.hidden)"
    );
    if (anySheetOpenF) return;
    const anyMenuOpenF = document.querySelector(".action-menu:not(.hidden)");
    if (anyMenuOpenF) return;
    // Context-aware target: when a memory is in view, F toggles the
    // Detail panel's enlarged state (original behavior). When no
    // memory is selected, F toggles the Memories panel's browse mode
    // — symmetric "maximize whatever panel is currently in focus"
    // semantic. The browse-mode path delegates to the existing
    // drawersPanelMaximize click handler so all of its bookkeeping
    // (per-mode scroll anchors, two-pass spacer rebuild, cascade
    // trigger, button label sync) runs through one source of truth.
    if (state.selectedDrawerId || state.detailOverride) {
      const maxBtn = document.querySelector("#detailPanelMaximize");
      if (!maxBtn) return;
      event.preventDefault();
      // Delegate to the maximize button's click handler (single source of
      // truth) so F inherits its edit-mode-aware behavior: when the inline
      // editor is open, that handler exits edit mode + collapses rather
      // than just toggling size and stranding the editor toolbar. Mirrors
      // how the browse-mode branch below delegates to drawersMaxBtn.click().
      maxBtn.click();
      return;
    }
    const drawersMaxBtn = document.querySelector("#drawersPanelMaximize");
    if (!drawersMaxBtn) return;
    event.preventDefault();
    drawersMaxBtn.click();
    return;
  }
  // E — open the inline editor for the currently-selected drawer.
  // Symmetric with the pencil floating-button click: routes through the
  // same #detailPanelEdit element so all of the editor's bookkeeping
  // (data-edit-drawer-id resolution, editClosing-aware enter vs commit,
  // .clicked-pop animation, edit-mode chip cascade) runs through one
  // source of truth. Gated identically to F (maximize): skipped while
  // typing, while any sheet/menu is open, when no drawer is selected,
  // and when already editing (so E doesn't accidentally toggle commit
  // — the user has Cmd/Ctrl+Enter for that inside the editor).
  //
  // 2026-05-28: also maximizes the Detail panel before opening the
  // editor. Rationale: editing is the most demanding read+write task
  // the panel does, and the default narrow Detail column makes
  // markdown editing cramped (especially tables, code blocks, longer
  // paragraphs). Auto-maximizing on E gives the editor the full
  // content width without an extra keystroke. If the user wants to
  // edit in the narrow column anyway, they can hit F (or click the
  // maximize button) to collapse back at any time — the maximize
  // state is independent of edit mode. Idempotent when already
  // maximized (the second arm of the guard skips the layout flip).
  if (shortcutMatches(event, "edit") && !isMod) {
    const target = event.target;
    const isTyping = target && (
      target.matches?.("input, textarea, select")
      || target.isContentEditable
    );
    if (isTyping) return;
    if (state.isEditing) return;
    const anySheetOpenE = document.querySelector(
      ".write-sheet:not(.hidden), .confirm-sheet:not(.hidden), .edit-sheet:not(.hidden), .drafts-sheet:not(.hidden), .trash-sheet:not(.hidden), .fact-sheet:not(.hidden), .settings-overlay:not(.hidden)"
    );
    if (anySheetOpenE) return;
    const anyMenuOpenE = document.querySelector(".action-menu:not(.hidden)");
    if (anyMenuOpenE) return;
    if (!state.selectedDrawerId) return;
    const editBtn = document.querySelector("#detailPanelEdit");
    if (!editBtn || !editBtn.dataset.editDrawerId) return;
    event.preventDefault();
    // Maximize first if not already. Mirrors the bookkeeping the F
    // shortcut + #detailPanelMaximize click handler do: flip the
    // state flag, sync the button's aria-label/title for screen
    // readers, repaint the grid layout, and persist via writeHash so
    // a refresh keeps the layout.
    if (!state.detailEnlarged) {
      state.detailEnlarged = true;
      const maxBtn = document.querySelector("#detailPanelMaximize");
      if (maxBtn) {
        maxBtn.setAttribute("aria-label", "Minimize detail");
        maxBtn.setAttribute("title", "Minimize");
      }
      updateGridLayout();
      writeHash();
    }
    editBtn.click();
    return;
  }
  // Arrow up/down — navigate the memories list. Selects the next /
  // previous drawer in the currently-filtered state._virtDrawers
  // array, scrolls it into view (the list is virtualized, so the
  // target card might not be in the DOM yet), and routes through the
  // same selectedDrawerId state path as a click — detail panel
  // updates, pop animation fires. Skipped when typing in any input
  // or any modal sheet is open, so it doesn't fight form fields.
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const target = event.target;
    const isTyping = target && (
      target.matches?.("input, textarea, select")
      || target.isContentEditable
    );
    if (isTyping) return;
    const anySheetOpen = document.querySelector(
      ".write-sheet:not(.hidden), .confirm-sheet:not(.hidden), .edit-sheet:not(.hidden), .drafts-sheet:not(.hidden), .trash-sheet:not(.hidden), .fact-sheet:not(.hidden), .settings-overlay:not(.hidden)"
    );
    if (anySheetOpen) return;
    const drawers = state._virtDrawers;
    if (!drawers || !drawers.length) return;
    event.preventDefault();
    const currentIdx = state.selectedDrawerId
      ? drawers.findIndex((d) => d.drawer_id === state.selectedDrawerId)
      : -1;
    let newIdx;
    if (event.key === "ArrowDown") {
      newIdx = currentIdx < 0 ? 0 : Math.min(drawers.length - 1, currentIdx + 1);
    } else {
      newIdx = currentIdx < 0 ? 0 : Math.max(0, currentIdx - 1);
    }
    if (newIdx === currentIdx) return;
    selectDrawerByIndex(newIdx, event.key === "ArrowDown" ? "forward" : "backward");
    return;
  }
  // ArrowLeft — keyboard shortcut for the "← Back to wings" affordance
  // in the rooms-of-wing view. Only fires when:
  //   • The rooms panel is currently showing a specific wing (i.e.
  //     state.selectedWing is set to something other than "all"),
  //     which is exactly the condition under which the back bar
  //     itself is rendered.
  //   • No form input is focused (don't fight cursor navigation in
  //     text fields).
  //   • No modal sheet is open (don't pull the user out from under
  //     a write / edit / settings dialog).
  // Mirrors the back button's click handler exactly — same state
  // resets, same backward slide direction — so the keyboard path
  // and the click path produce identical motion.
  if (event.key === "ArrowLeft") {
    const target = event.target;
    const isTyping = target && (
      target.matches?.("input, textarea, select")
      || target.isContentEditable
    );
    if (isTyping) return;
    const anySheetOpen = document.querySelector(
      ".write-sheet:not(.hidden), .confirm-sheet:not(.hidden), .edit-sheet:not(.hidden), .drafts-sheet:not(.hidden), .trash-sheet:not(.hidden), .fact-sheet:not(.hidden), .settings-overlay:not(.hidden)"
    );
    if (anySheetOpen) return;
    // Only meaningful when we're drilled into a specific wing.
    if (state.selectedWing === "all" || !state.selectedWing) return;
    event.preventDefault();
    state.selectedWing = "all";
    state.selectedRoom = "all";
    state.selectedDrawerId = null;
    state.detailOverride = null;
    state.detailDismissed = false;
    state.roomsPanelDirection = "backward";
    render();
    return;
  }
  // Backspace = delete the focused thing. Three cases handled here:
  //   1. A wing accordion header is keyboard-focused → delete that
  //      whole wing (every drawer in it).
  //   2. A room item is keyboard-focused → delete that whole room.
  //   3. Nothing nav-focused but a drawer is open in detail pane →
  //      delete that single memory.
  //
  // ALL three paths route through openDeleteSheet → confirmDelete →
  // /api/delete, which on the server calls log_version("delete", ...)
  // for every affected drawer BEFORE removing from the live store.
  // Every delete (single memory, whole room, whole wing) is therefore
  // snapshotted into the dashboard-versions.jsonl trash and can be
  // restored from the Recently-deleted view. NEVER bypass openDeleteSheet
  // for keyboard-initiated deletes — direct deletion would skip both
  // the confirmation AND the trash snapshot.
  //
  // Skip the whole thing while typing in a text field / contenteditable,
  // or when any modal sheet is already open (don't double-fire prompts).
  // preventDefault stops the legacy browser-back behavior some browsers
  // still ship in non-input contexts.
  if (shortcutMatches(event, "delete")) {
    const target = event.target;
    const isTyping = target && (
      target.matches?.("input, textarea, select")
      || target.isContentEditable
    );
    if (isTyping) return;
    // Suppress the delete shortcut while inline-edit mode is active —
    // the user is editing a memory, not navigating; a stray Backspace
    // outside the textarea (e.g. focus on the panel chrome) should
    // NOT open the destructive delete sheet for the memory currently
    // being edited. Cancelling the edit must be an explicit click on
    // the grey X button. event.preventDefault stops the legacy
    // browser-back behaviour Safari still ships for unguarded back-
    // space presses.
    if (state.isEditing && state.editBuffer) {
      event.preventDefault();
      return;
    }
    const anySheetOpen = document.querySelector(
      ".write-sheet:not(.hidden), .confirm-sheet:not(.hidden), .edit-sheet:not(.hidden)"
    );
    if (anySheetOpen) return;

    // Rooms-panel focus mapping after the drill-down rewrite:
    //   • Wings view: each wing row is a .wing-drill-item button with
    //     data-wing only (no data-room). Backspace → delete wing.
    //   • Rooms view: each room is a .room-item with data-wing AND
    //     data-room. Backspace → delete room.
    //   • Pseudo-rows: "All Memory" (data-wing="all" only) and
    //     "All rooms" (data-room="all") are inert — Backspace just
    //     swallowed to suppress browser-back.
    //   • The back button has no data-wing, so it falls through.
    const focused = document.activeElement;
    const navButton = focused && focused.closest && focused.closest("[data-wing]");
    if (navButton) {
      const wingName = navButton.dataset.wing;
      const roomName = navButton.dataset.room;
      // "All Memory" / "All rooms" — inert.
      if (wingName === "all" || roomName === "all") {
        event.preventDefault();
        return;
      }
      // Has both wing + room → delete that specific room.
      if (wingName && roomName) {
        event.preventDefault();
        openDeleteSheet(deleteRequestFromButton({
          dataset: { deleteScope: "room", wing: wingName, room: roomName },
        }));
        return;
      }
      // Just a wing (no room) → delete the whole wing.
      if (wingName) {
        event.preventDefault();
        openDeleteSheet(deleteRequestFromButton({
          dataset: { deleteScope: "wing", wing: wingName },
        }));
        return;
      }
    }

    // 3) Drawer in detail pane → delete that memory (also routed
    //    through the trash-snapshotted /api/delete flow).
    const activeDrawerId = (state.detailOverride && state.detailOverride.drawerId)
      || state.selectedDrawerId;
    if (!activeDrawerId) return;
    event.preventDefault();
    openDeleteSheet(deleteRequestFromButton({
      dataset: { deleteScope: "drawer", drawerId: activeDrawerId },
    }));
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

// Floating close X overlaid on the detail panel's top-left corner.
// Static element (wired once at init, not in render fn) — single
// handler covers both drawer-detail and tunnel-inspector views. Clears
// any selected drawer + override and sets detailDismissed so the
// auto-tunnel-show on the current room doesn't immediately re-fill
// the panel. Also clears detailEnlarged so re-opening a memory
// doesn't drop into a leftover full-screen view. detailDismissed
// re-arms on the next nav click.
const detailPanelClose = on("detailPanelClose", "click", () => {
    // Discard any in-flight edit when the user closes the panel —
    // otherwise re-opening the same memory from the main list would
    // drop them back into a stale editing session with the old
    // buffer (and the floating action buttons in their edit-mode
    // morph). Treat panel-close as a "drop everything" exit, same
    // way cancel does but without the chip-cascade animation since
    // the entire panel is going away.
    state.isEditing = false;
    state.editBuffer = null;
    state.editError = "";
    state.editClosing = false;
    state.selectedDrawerId = null;
    state.detailOverride = null;
    state.detailDismissed = true;
    state.detailEnlarged = false;
    render();
    writeHash();
  });

// Floating maximize / minimize button between the close X and the
// edit pencil. Toggles state.detailEnlarged and re-applies the grid
// class via updateGridLayout — same single source of truth the close
// X and the drawer-card click handler rely on. CSS swaps the icon
// (maximize → minimize) based on the .content-grid.detail-enlarged
// class, so there's nothing for the JS to update on the button itself.
// aria-label is updated so screen readers know what the toggle does
// in each state.
const detailPanelMaximize = on("detailPanelMaximize", "click", () => {
    // If the inline editor is open, this button doubles as an "exit edit
    // mode" affordance. Opening the editor auto-maximizes the panel (see
    // the E shortcut / edit pencil), so the natural gesture to leave is
    // to press minimize — and the user expects that to drop them back
    // into view mode, not just resize while the editor toolbar + chips
    // linger (the reported bug). Mirror the close-X's instant edit
    // teardown, but KEEP the memory selected (we're leaving the editor,
    // not the memory) and collapse to the normal view size in one press.
    // previousDrawerData is nulled so renderDrawerDetail's no-op
    // short-circuit can't keep the stale editor markup mounted — it
    // forces a clean view-mode rebuild.
    if (state.isEditing && state.editBuffer) {
      state.isEditing = false;
      state.editBuffer = null;
      state.editError = "";
      state.editClosing = false;
      state.detailEnlarged = false;
      state.previousDrawerData = null;
      detailPanelMaximize.setAttribute("aria-label", "Maximize detail");
      detailPanelMaximize.setAttribute("title", "Maximize");
      render();
      writeHash();
      return;
    }
    state.detailEnlarged = !state.detailEnlarged;
    detailPanelMaximize.setAttribute(
      "aria-label",
      state.detailEnlarged ? "Minimize detail" : "Maximize detail",
    );
    detailPanelMaximize.setAttribute(
      "title",
      state.detailEnlarged ? "Minimize" : "Maximize",
    );
    updateGridLayout();
    // Persist enlarged state to the URL so refresh keeps the layout.
    writeHash();
  });

// Browse-mode toggle on the Memories panel. Same pattern as the
// detail maximize handler — flip state, sync the button's a11y
// labels, hand off to updateGridLayout for the class swap, then
// re-render the drawer list so the 4-col grid populates with the
// selective waterfall (renderDrawerWindow's browse-mode branch).
// Mutual exclusion: entering browse forces detailEnlarged off so
// the layout transitions cleanly even from the detail-enlarged
// state (which, given mutual exclusion in updateGridLayout, only
// happens transiently mid-state-change).
const drawersPanelMaximize = on("drawersPanelMaximize", "click", () => {
    // Adaptive-browse guard: when the filtered list is below the
    // hide threshold, the toggle is .is-hidden + pointer-events:none
    // (CSS handles user clicks). But programmatic invocations —
    // including the F-key handler that delegates here via .click()
    // — bypass pointer-events. Guard explicitly so "press F on a
    // 4-memory wing" doesn't enter a browse mode the user can't see
    // an exit affordance for. Skip the guard when we're already in
    // browse mode (otherwise the user couldn't ever exit if the
    // count crossed the threshold mid-session — though syncAdaptive-
    // Browse should normally beat them to it).
    if (!state.drawersEnlarged && browseModeProfile().hideToggle) return;
    const list = els.drawerList;
    // Per-mode scroll anchors. Save the scroll position in the mode
    // we're LEAVING so the next return to that mode lands the user
    // exactly where they were. Without this the browser clamps
    // scrollTop when the layout shrinks (4-col has ~1/4 the rows of
    // 1-col), and the pre-shrink position is silently lost — exiting
    // browse after entering from the bottom of 1-col would dump the
    // user at the top, which reads as buggy. With the save/restore
    // the bottom is preserved; a re-entry into browse also picks up
    // the user's last browse scroll instead of always snapping to top.
    state._scrollByMode = state._scrollByMode || { normal: 0, browse: 0 };
    if (list) {
      const oldKey = state.drawersEnlarged ? "browse" : "normal";
      state._scrollByMode[oldKey] = list.scrollTop || 0;
    }

    state.drawersEnlarged = !state.drawersEnlarged;
    if (state.drawersEnlarged) state.detailEnlarged = false;
    drawersPanelMaximize.setAttribute(
      "aria-label",
      state.drawersEnlarged ? "Exit browse mode" : "Browse all memories",
    );
    drawersPanelMaximize.setAttribute(
      "title",
      state.drawersEnlarged ? "Exit browse" : "Browse all",
    );
    updateGridLayout();

    if (!list) {
      if (state.drawersEnlarged) state._waterfallNext = true;
      renderDrawerWindow();
      return;
    }

    // Two-pass scroll restore. Necessary because the OLD-mode render
    // left virt spacers sized for the OLD cols — e.g. when exiting
    // browse the bottom spacer is ~1340px (the 4-col tail), but a
    // proper 71-card 1-col layout needs ~5240px of tail spacer for
    // scrollHeight to reach ~10640. Until the spacers are rebuilt
    // for the new cols, drawer-list.scrollHeight underreports and
    // any scrollTop assignment gets silently clamped to the stale
    // max. (The earlier offsetHeight-only fix flushed the class
    // change but not the spacer rebuild — the clamp still happened
    // because the spacer DIVs in the DOM kept their old heights.)
    //
    // Pass 1: render at scrollTop=0 in the new cols. This invokes
    // renderDrawerWindow, which writes fresh spacer heights for the
    // new col count, expanding scrollHeight to the correct total.
    // Pass 2: set scrollTop to the saved anchor (now within valid
    // bounds — no clamp) and render the visible window with the
    // cascade. Both passes run synchronously in a single JS frame,
    // so the browser only paints the final pass-2 state — no
    // visible flash of pass-1's top-of-list cards.
    list.scrollTop = 0;
    renderDrawerWindow();
    // Flush layout so the pass-1 spacer heights are reflected in
    // scrollHeight before the next scrollTop write.
    void list.offsetHeight;
    const newKey = state.drawersEnlarged ? "browse" : "normal";
    let target = state._scrollByMode[newKey] || 0;
    if (state.drawersEnlarged) {
      // On ENTRY to browse, the saved browse anchor alone is rarely
      // what the user wants — it's 0 the first time they maximize,
      // so they always land at the top of 4-col regardless of where
      // they were in 1-col. That's why the previous behavior felt
      // wrong even with the anchor restore in place. Fix: also
      // compute the EQUIVALENT 4-col scrollTop for the user's
      // current 1-col position. With 4 cols per row, the same
      // logical card sits at scrollTop / 4 in 4-col coordinates,
      // so dividing maps the user's vertical context cleanly across
      // the mode change. Take MAX of saved and computed so a
      // deliberately deeper browse anchor (e.g. user previously
      // scrolled past their current 1-col context in browse) still
      // wins, while first entries land near the user's 1-col view.
      const savedNormal = state._scrollByMode.normal || 0;
      const computed = Math.floor(savedNormal / 4);
      target = Math.max(target, computed);
    }
    // If the user has a selected card, that's the better anchor than
    // any saved scroll: a mode toggle should keep their active card
    // in view, regardless of where the saved scroll happened to be.
    // Falls back to the saved/computed target when nothing is
    // selected (e.g. user toggles browse with no memory open).
    if (state.selectedDrawerId
        && state._virtDrawers
        && state._virtDrawers.some((d) => d.drawer_id === state.selectedDrawerId)) {
      // scrollDrawerListToSelected handles the scroll math against
      // the active cols and re-flushes renderDrawerWindow.
      state._lastStartIdx = -1;
      state._lastEndIdx = -1;
      if (state.drawersEnlarged) state._waterfallNext = true;
      scrollDrawerListToSelected();
    } else {
      list.scrollTop = target;
      // Force pass 2 to actually render even when the visible window
      // happens to match pass 1 (e.g. first entry into browse where
      // target is 0 and pass 1 already rendered the top). The cascade
      // flag is set just before pass 2 so it fires on the cards the
      // user will actually see, not on pass 1's top-of-list cards.
      state._lastStartIdx = -1;
      state._lastEndIdx = -1;
      if (state.drawersEnlarged) state._waterfallNext = true;
      renderDrawerWindow();
    }
  });

// Floating delete (trash) button in the top-right action cluster.
// updateGridLayout keeps the dataset shaped for deleteRequestFromButton
// (which expects `deleteScope` + `drawerId`); we just translate the
// click into the same openDeleteSheet path the Backspace shortcut and
// the action-menu trash item use, so the confirmation modal is the
// single source of truth for actually destroying the memory.
const detailPanelDelete = on("detailPanelDelete", "click", (event) => {
    // CRITICAL: stop propagation so the document-level delegated
    // delete-scope handler (line ~4990) doesn't ALSO fire for this
    // click. Without this, the chain becomes:
    //   1. This local handler runs → cancelEditMode → isEditing=false
    //   2. Event bubbles up to document
    //   3. Delegated handler reads data-delete-scope on this same
    //      button, calls openDeleteSheet
    //   4. The safety guard inside openDeleteSheet checks isEditing
    //      → now false (we just cleared it in step 1) → guard fails
    //      → delete confirmation appears AFTER user clicked cancel
    // stopPropagation breaks step 2 so the delegated handler never
    // sees the click for THIS button. Other delete-scope sources
    // (action-menu Trash items) still work fine — they don't have
    // local handlers and continue to route through the delegate.
    event.stopPropagation();
    // In edit mode the trash button is morphed into a grey cancel X
    // (CSS-driven via .content-grid.detail-editing). Click discards
    // the edit buffer and exits edit mode — destructive role flips
    // to non-destructive cancel role; same physical button.
    if (state.isEditing && state.editBuffer) {
      cancelEditMode();
      return;
    }
    // Guard on deleteScope rather than drawerId — the dataset shape
    // differs per kind: drawers get data-drawer-id, tunnels get
    // data-tunnel-id (see updateGridLayout's per-kind branch). An
    // earlier check that hardcoded `dataset.drawerId` silently no-op'd
    // the tunnel delete button because tunnels never set that
    // attribute. deleteScope is set whenever EITHER kind is in view,
    // so it's the right "is anything here to delete?" signal.
    if (!detailPanelDelete.dataset.deleteScope) return;
    const request = deleteRequestFromButton(detailPanelDelete);
    if (request) openDeleteSheet(request);
  });

// Click-pop tactile feedback for the floating edit + delete buttons —
// brief scale-up keyframe via the .clicked-pop class. Same pattern as
// the memory cards' click feedback. Separate listener so it plays
// regardless of what the action click handler does (the edit button's
// actual edit-open path runs via the global data-edit-drawer-id
// delegation, which we don't want to entangle with the visual feedback).
[document.querySelector("#detailPanelEdit"), document.querySelector("#detailPanelDelete"), document.querySelector("#detailPanelRetry")]
  .forEach((btn) => {
    if (!btn) return;
    btn.addEventListener("click", () => {
      btn.classList.remove("clicked-pop");
      requestAnimationFrame(() => btn.classList.add("clicked-pop"));
      setTimeout(() => btn.classList.remove("clicked-pop"), 360);
    });
  });

// Retry-failed-save handler — POSTs the cached attemptedContent /
// attemptedWing / attemptedRoom from the matching state.failedSaves
// entry to /api/memories/update. On success: clear the failure (which
// also strips .is-failed from the card and hides the retry button on
// the next render), update the in-memory drawer with the attempted
// values so the UI reflects the now-saved state, then render. On
// failure: re-push the failure with a fresh timestamp + new error
// message so the bell stays red and the user can see what went wrong
// this time.
const detailPanelRetry = on("detailPanelRetry", "click", async () => {
    const drawerId = detailPanelRetry.dataset.retryDrawerId;
    if (!drawerId) return;
    const failure = (state.failedSaves || []).find((e) => e.drawer_id === drawerId);
    if (!failure) return;
    // Build the same payload shape commitEditMode used originally.
    // Etag piggybacks on the snapshot's etag (the server's tracked
    // version is whatever was there before the failed attempt).
    const payload = { drawer_id: drawerId };
    if (failure.attemptedEtag) payload.etag = failure.attemptedEtag;
    if (failure.attemptedContent != null) payload.content = failure.attemptedContent;
    if (failure.attemptedWing) payload.wing = failure.attemptedWing;
    if (failure.attemptedRoom) payload.room = failure.attemptedRoom;
    if (!payload.content && !payload.wing && !payload.room) {
      // Nothing cached to retry — defensive guard. Just clear the
      // failure since there's no real fix to attempt.
      clearFailedSave(drawerId);
      render();
      return;
    }
    try {
      await postJson("/api/memories/update", payload);
      // Success — sync the drawer in state to the attempted values
      // before clearing the failure, so the card reflects the now-
      // saved state instead of the pre-attempt snapshot.
      const d = drawerById(drawerId);
      if (d) {
        if (payload.content != null) {
          d.content = payload.content;
          d.title = deriveTitleFromContent(payload.content) || d.title;
        }
        if (payload.wing) d.wing = payload.wing;
        if (payload.room) d.room = payload.room;
        d.updated_at = new Date().toISOString();
      }
      clearFailedSave(drawerId);
      // loadPalace to pick up the server's canonical normalization
      // (etag bump, any title cleanup) — same pattern commitEditMode
      // uses on its own success path.
      loadPalace().then(() => render()).catch(() => render());
    } catch (error) {
      // Re-push the failure with a fresh timestamp so the bell visibly
      // updates and the chime fires again. Preserve the cached attempt
      // so the user can try once more.
      pushFailedSave({
        ...failure,
        error: (error && error.message) || "Save failed.",
      });
      render();
    }
  });

// Click-pop for every top-row action button (Tools, Drafts, Write,
// Trash, Theme, Settings, Notifications bell). Matches the floating
// edit/delete pattern above so the whole "button family" — top toolbar
// + detail-panel floats — shares one cohesive press-feedback vocabulary.
// Class-add on click triggers the top-action-click-pop keyframe in CSS
// (scale 1 → 1.12 → 1, 320ms spring). Separate listener so the pop
// plays regardless of what the action's primary click handler does,
// matching how the detail-panel wiring stays out of the way of
// data-edit-drawer-id / data-delete-scope delegation.
// The buttons in this row are static (the top bar isn't re-rendered),
// so a one-shot querySelectorAll on init is enough — no MutationObserver.
document.querySelectorAll(".top-actions .write-open, .top-actions .icon-button")
  .forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.classList.remove("clicked-pop");
      requestAnimationFrame(() => btn.classList.add("clicked-pop"));
      setTimeout(() => btn.classList.remove("clicked-pop"), 360);
    });
  });

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

// Theme button is now a .menu-button — the document-level click router
// (see ".menu-button" branch around line 4407) calls toggleMenu for it.
// The dropdown's option items are wired below.
//
// Click sequence is choreographed so the spring on the tapped row
// is visible but the close fires quickly afterwards — exits should
// feel snappy:
//   1. Add .clicked-pop class → 280ms spring keyframe fires
//   2. Apply theme immediately (no latency between tap and effect)
//   3. After 90ms (peak of the spring's compression) close the menu
//      — the rise cascade overlaps the spring's bounce-back, which
//      reads as "the row was confirmed and the menu got out of the
//      way fast" instead of "menu lingered".
document.querySelectorAll("[data-theme-option]").forEach((btn) => {
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    btn.classList.add("clicked-pop");
    setTimeout(() => btn.classList.remove("clicked-pop"), 300);
    setThemeMode(btn.dataset.themeOption);
    setTimeout(() => closeMenus(), 90);
  });
});

// Show-Tools preference (gates the labBtn in the top bar). Default is
// false — the Tools panel is power-user surface and shouldn't be in
// every user's first-run view. Settings sheet has a checkbox to flip
// it on; preference persists in localStorage.
const SHOW_TOOLS_STORAGE_KEY = "apricity-show-tools";
function getShowTools() {
  try { return localStorage.getItem(SHOW_TOOLS_STORAGE_KEY) === "1"; }
  catch { return false; }
}
function setShowTools(value) {
  try { localStorage.setItem(SHOW_TOOLS_STORAGE_KEY, value ? "1" : "0"); }
  catch {}
  applyShowTools();
}
function applyShowTools() {
  const show = getShowTools();
  const labBtn = document.querySelector("#labBtn");
  const mobileLabAction = document.querySelector("#mobileLabAction");
  if (labBtn) labBtn.hidden = !show;
  if (mobileLabAction) mobileLabAction.hidden = !show;
}
applyShowTools();

const showToolsToggle = document.querySelector("#showToolsToggle");
if (showToolsToggle) {
  showToolsToggle.checked = getShowTools();
  showToolsToggle.addEventListener("change", () => {
    setShowTools(showToolsToggle.checked);
  });
}

// Show-KG-Graph preference (gates the Graph tab on the Knowledge
// Graph panel). Default is FALSE because the force-directed physics
// simulation is CPU-heavy and the user's Pi struggles with it.
// When enabled, the view-toggle (List | Graph) appears; when off, the
// toggle is hidden entirely and the panel always renders the list.
const SHOW_KG_GRAPH_STORAGE_KEY = "apricity-show-kg-graph";
function getShowKgGraph() {
  try { return localStorage.getItem(SHOW_KG_GRAPH_STORAGE_KEY) === "1"; }
  catch { return false; }
}
function setShowKgGraph(value) {
  try { localStorage.setItem(SHOW_KG_GRAPH_STORAGE_KEY, value ? "1" : "0"); }
  catch {}
  applyShowKgGraph();
}
function applyShowKgGraph() {
  const enabled = getShowKgGraph();
  const toggle = document.querySelector("#factsViewToggle");
  if (toggle) toggle.hidden = !enabled;
  if (!enabled) {
    // Force back to list view in case the user had Graph active when
    // they disabled the setting, and quiesce any in-flight simulation
    // so the rAF loop stops the moment the toggle is flipped off.
    if (state.factsView === "graph") {
      state.factsView = "list";
      // Only re-render if palace data is loaded. On boot this runs
      // before loadPalace() resolves, so filteredFacts would NPE on
      // state.palace.triples — leave it to the first natural render
      // after the boot finishes.
      if (state.palace && typeof renderFacts === "function") renderFacts();
    }
    if (kg && kg.raf) {
      cancelAnimationFrame(kg.raf);
      kg.raf = null;
    }
  }
}
applyShowKgGraph();

const showKgGraphToggle = document.querySelector("#showKgGraphToggle");
if (showKgGraphToggle) {
  showKgGraphToggle.checked = getShowKgGraph();
  showKgGraphToggle.addEventListener("change", () => {
    setShowKgGraph(showKgGraphToggle.checked);
  });
}

// Trash bin auto-delete preference. Server-stored (machine-wide) at
// ~/.mempalace/dashboard-preferences.json so the policy is shared
// across browsers and devices instead of fragmenting per-localStorage.
// The server enforces it silently on every /api/versions GET — the
// client just reads/writes the preference value.
//
// state._preferences is the cached copy of the server's prefs object.
// Populated lazily on first read; refreshed when the user changes the
// setting. Treat as authoritative-ish — the server is the source of
// truth, but for read-only UI rendering the cache is fine.
const TRASH_AUTODELETE_ALLOWED = new Set([0, 1, 7, 14, 30]);
const LEGACY_TRASH_LOCALSTORAGE_KEY = "apricity-trash-auto-delete-days";

async function fetchPreferences() {
  try {
    const data = await fetchJson("/api/preferences");
    state._preferences = (data && data.preferences) || {};
  } catch {
    state._preferences = {};
  }
  return state._preferences;
}

async function updatePreferences(patch) {
  try {
    const data = await postJson("/api/preferences", patch);
    state._preferences = (data && data.preferences) || state._preferences || {};
  } catch (error) {
    console.error("Failed to update preferences:", error);
  }
  return state._preferences;
}

function getTrashAutoDeleteDays() {
  const v = state._preferences && state._preferences.trash_auto_delete_days;
  const n = Number(v);
  return TRASH_AUTODELETE_ALLOWED.has(n) ? n : 0;
}

/** Read legacy localStorage value (set by a previous client version)
 *  so we can migrate it to the server on first boot, then clear it. */
function readLegacyTrashAutoDeleteFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LEGACY_TRASH_LOCALSTORAGE_KEY);
    if (raw == null) return null;
    const n = parseInt(raw, 10);
    return TRASH_AUTODELETE_ALLOWED.has(n) ? n : null;
  } catch { return null; }
}
function clearLegacyTrashAutoDeleteFromLocalStorage() {
  try { localStorage.removeItem(LEGACY_TRASH_LOCALSTORAGE_KEY); } catch {}
}

/** Sync the Trash bin select in Settings to the current cached value. */
function syncTrashAutoDeleteSelect() {
  const sel = document.querySelector("#trashAutoDeleteSelect");
  if (sel) sel.value = String(getTrashAutoDeleteDays());
}

const trashAutoDeleteSelect = on("trashAutoDeleteSelect", "change", async () => {
    const n = parseInt(trashAutoDeleteSelect.value, 10);
    const days = TRASH_AUTODELETE_ALLOWED.has(n) ? n : 0;
    await updatePreferences({ trash_auto_delete_days: days });
    syncTrashAutoDeleteSelect();
  });

// ---------- New preferences: reduce motion / default sort / footer info ----------
// All three are server-stored (machine-wide) via the same /api/preferences
// flow used by trash retention. Cached locally on state._preferences;
// changes POST immediately and re-apply.

const SORT_ALLOWED = new Set(["filed-desc", "filed-asc", "title", "wing"]);

// ---------- user-remappable keyboard shortcuts ----------
// SHORTCUT_DEFAULTS mirrors server.py's PREFERENCES_DEFAULTS.shortcuts.
// Values are KeyboardEvent.key strings — letters as their literal char
// ("f", "x"), named keys as their .key value ("Backspace", "Enter").
// getShortcut() returns the user's stored binding or the default if
// none is set. shortcutMatches() compares an event against an action
// case-insensitively for letters and exact-match for named keys.
const SHORTCUT_DEFAULTS = { maximize: "f", close: "x", delete: "Backspace", edit: "e" };
const SHORTCUT_ACTIONS = ["maximize", "close", "delete", "edit"];

function getShortcut(action) {
  const stored = state._preferences && state._preferences.shortcuts;
  if (stored && typeof stored[action] === "string" && stored[action].length > 0) {
    return stored[action];
  }
  return SHORTCUT_DEFAULTS[action];
}

/** Normalize a KeyboardEvent.key for comparison: lowercase single-char
 * keys (letters/digits/symbols), preserve named keys as-is. Keeps
 * shortcut matching case-insensitive for letters while exact-matching
 * "Backspace", "Enter", "ArrowUp", etc. */
function normalizeShortcutKey(key) {
  if (typeof key !== "string" || !key) return "";
  return key.length === 1 ? key.toLowerCase() : key;
}

function shortcutMatches(event, action) {
  return normalizeShortcutKey(event.key) === normalizeShortcutKey(getShortcut(action));
}

/** Display label for a key in the Settings shortcut button. Letters
 * uppercase ("F"), Space spelled out, named keys verbatim. */
function formatShortcutKey(key) {
  if (typeof key !== "string" || !key) return "";
  if (key === " ") return "Space";
  return key.length === 1 ? key.toUpperCase() : key;
}

function getReduceMotion() {
  return Boolean(state._preferences && state._preferences.reduce_motion);
}
function getDefaultSort() {
  const v = state._preferences && state._preferences.default_sort;
  return SORT_ALLOWED.has(v) ? v : "filed-desc";
}
function getShowFooterInfo() {
  // Default to TRUE when not explicitly set, matching PREFERENCES_DEFAULTS
  // on the server. The `!== false` form keeps the default visible if the
  // preference object exists but lacks the key.
  return !(state._preferences && state._preferences.show_footer_info === false);
}
function getAdaptiveBrowse() {
  // Default TRUE — server default is also true. The `!== false` form
  // keeps the default-on behavior when state._preferences is missing
  // entirely (initial page load before fetchPreferences resolves).
  return !(state._preferences && state._preferences.adaptive_browse === false);
}
function getPolishText() {
  // Default TRUE. When false, cleanTitle / humanizeName /
  // prettifyActorName all return their raw inputs (after only the
  // bare-minimum String-coerce + trim) so the user sees the literal
  // stored text. Useful for debugging title weirdness, or for users
  // who prefer "show me what's actually on disk."
  return !(state._preferences && state._preferences.polish_text === false);
}
function getRelativeTime() {
  // Default TRUE. When false, formatCardDate returns the absolute
  // date for ALL ages (not just >7d), and formatRelativeTime returns
  // the full formatTimestamp form so the meta-strip "Updated" cell
  // matches its sibling "Filed" cell when both are absolute.
  return !(state._preferences && state._preferences.relative_time === false);
}
function getPanelControlsAlwaysVisible() {
  // Default FALSE — note the inverted form vs. the other getters here.
  // The preference defaults to OFF (hover-only) on the server, so the
  // default-when-missing case must also return false. !! coerces a
  // truthy preference value to true and everything else (undefined,
  // missing _preferences) to false.
  return !!(state._preferences && state._preferences.panel_controls_always_visible);
}
function getSuppressUpdateNotifications() {
  // Default FALSE — show all notifications including drawer updates.
  // !! form so a missing preferences object yields false.
  return !!(state._preferences && state._preferences.suppress_update_notifications);
}
function getNotificationSounds() {
  // Default TRUE — short two-tone chime plays on new notifications.
  // The `!== false` form keeps the default-on behavior when state.
  // _preferences is missing or the key hasn't been explicitly set.
  return !(state._preferences && state._preferences.notification_sounds === false);
}
const NOTIFICATION_POLL_ALLOWED = new Set([15, 30, 60]);
function getNotificationPollIntervalSeconds() {
  // Default 30 — matches server PREFERENCES_DEFAULTS. Allow-list
  // checked client-side too so a hand-edited preferences file with
  // a junk value falls back to the default instead of breaking the
  // poll cadence.
  const v = state._preferences && state._preferences.notification_poll_interval;
  const n = Number(v);
  return NOTIFICATION_POLL_ALLOWED.has(n) ? n : 30;
}

/** Synthesized two-tone notification chime via Web Audio API. Sine
 * waves only (no harshness), brief attack + exponential decay so each
 * note plays under ~250ms total. Two-tone arpeggio (F5 → A5, minor
 * third up) lands as gentle modern-Apple territory — not the harsh
 * 90s alert sound, not the playful Slack chime, just a quiet "you
 * have a new thing" marker.
 *
 * Lazy AudioContext: creating one before the user has interacted with
 * the page is blocked by every modern browser's autoplay policy.
 * Lazy-init + try/catch means we degrade silently when the context
 * can't start. unlockNotificationAudio (below) installs one-shot
 * listeners that resume the context on the first real user gesture
 * so subsequent background-triggered chimes (from the live-notification
 * poll) actually play instead of being silently dropped. */
let _notifAudioCtx = null;
let _notifAudioUnlocked = false;
let _notifFallbackAudio = null;

function isSafariBrowser() {
  const ua = navigator.userAgent || "";
  return /Safari/i.test(ua)
    && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Android/i.test(ua);
}

function getNotificationAudioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!_notifAudioCtx) _notifAudioCtx = new AudioCtx();
  return _notifAudioCtx;
}

async function resumeNotificationAudioContext(ctx) {
  if (!ctx || ctx.state !== "suspended") return ctx && ctx.state === "running";
  try {
    await Promise.race([
      ctx.resume(),
      new Promise((resolve) => setTimeout(resolve, 250)),
    ]);
  } catch {
    return false;
  }
  return ctx.state === "running";
}

async function unlockNotificationAudio() {
  // Two-tier behaviour:
  //  • First gesture: create context + resume + play 1ms silent tone
  //    to fully unlock per Safari/Chrome autoplay policy. Set the flag
  //    only after the context is genuinely running.
  //  • Subsequent gestures: if context exists AND is suspended (browser
  //    re-suspended after tab idle, OS audio interruption, etc.),
  //    re-resume. Cheap — does nothing when already running.
  try {
    const ctx = getNotificationAudioContext();
    if (!ctx) return false;
    await resumeNotificationAudioContext(ctx);
    if (ctx.state !== "running") return false;
    if (!_notifAudioUnlocked) {
      // First-gesture unlock — play a 1ms zero-volume tone. Some
      // browsers require an actual node operation (not just resume)
      // inside the gesture to fully unlock the context. Inaudible.
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.001);
      _notifAudioUnlocked = true;
    }
    return true;
  } catch {
    // Audio unavailable — sound just won't play this session.
    return false;
  }
}

// Persistent listeners on the three gesture types most likely to
// fire: keyboard, mouse, touch. Each gesture re-attempts the unlock
// — idempotent via _notifAudioUnlocked, so this is a no-op once the
// initial unlock succeeded. Kept persistent (no `once: true`) so a
// context that got somehow re-suspended (browser policy, tab idle
// state, etc.) can re-resume on the next gesture instead of staying
// silent forever. Capture phase to catch even events with downstream
// stopPropagation. */
["pointerdown", "keydown", "touchstart"].forEach((evt) => {
  document.addEventListener(evt, () => { void unlockNotificationAudio(); }, { capture: true });
});

function playNotificationSound() {
  // Ascending two-tone (F5 → A5, minor third up) — "something good
  // happened" cadence. See _playTones for the actual scheduling.
  return _playTones([
    { freq: 698.46, start: 0    },  // F5
    { freq: 880,    start: 0.09 },  // A5
  ], { decay: 0.25, gain: 0.12 });
}

/** Failure notification sound — descending two-tone (G5 → D5, perfect
 * fourth DOWN) with a slightly longer decay. The downward interval is
 * the universal "uh-oh" signal across decades of UI sound design
 * (Apple's Bottle, Funk; Windows' chord), distinct from the ascending
 * success chime so the user can tell what kind of notification fired
 * without looking at the bell. Same sine-wave family as the success
 * sound so they read as siblings rather than two unrelated audio
 * vocabularies. */
function playNotificationErrorSound() {
  return _playTones([
    { freq: 783.99, start: 0    },  // G5
    { freq: 587.33, start: 0.12 },  // D5 (descending perfect fourth)
  ], { decay: 0.32, gain: 0.13 });
}

/** Shared tone-scheduling helper for the notification chime family.
 * Sine waves only, 10ms linear attack, exponential decay to near-
 * silent at `decay` seconds, peak gain `gain`. Async because we
 * MUST await ctx.resume() before scheduling oscillators — scheduling
 * on a still-suspended context queues them at ctx.currentTime which
 * stops advancing while suspended, so they never play even after a
 * later resume. The earlier fire-and-forget `ctx.resume().catch(…)`
 * pattern was the silent-sound regression: oscillators landed before
 * resume completed and were lost. */
async function _playTones(tones, { decay = 0.25, gain = 0.12 } = {}) {
  if (isSafariBrowser()) {
    return playToneAudioFallback(tones, { decay, gain });
  }
  try {
    const unlocked = await unlockNotificationAudio();
    if (!unlocked) return playToneAudioFallback(tones, { decay, gain });
    const ctx = _notifAudioCtx;
    const now = ctx.currentTime;
    tones.forEach(({ freq, start }) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, now + start);
      g.gain.linearRampToValueAtTime(gain, now + start + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, now + start + decay);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + decay + 0.02);
    });
    return true;
  } catch {
    return playToneAudioFallback(tones, { decay, gain });
  }
}

function writeAscii(view, offset, value) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function toneWavBytes(tones, { decay = 0.25, gain = 0.12 } = {}) {
  const sampleRate = 22050;
  const duration = Math.max(...tones.map((t) => t.start + decay + 0.04));
  const sampleCount = Math.ceil(sampleRate * duration);
  const buffer = new ArrayBuffer(44 + sampleCount * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + sampleCount * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, sampleCount * 2, true);
  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / sampleRate;
    let sample = 0;
    for (const tone of tones) {
      const local = t - tone.start;
      if (local < 0 || local > decay) continue;
      const attack = Math.min(0.012, decay / 3);
      const envelope = local < attack
        ? local / attack
        : Math.pow(0.001, (local - attack) / Math.max(0.001, decay - attack));
      sample += Math.sin(2 * Math.PI * tone.freq * local) * gain * envelope;
    }
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }
  return new Uint8Array(buffer);
}

function toneWavSource(tones, options = {}) {
  const bytes = toneWavBytes(tones, options);
  if (typeof Blob !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    const src = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
    return { src, revoke: () => URL.revokeObjectURL(src) };
  }
  return { src: `data:audio/wav;base64,${bytesToBase64(bytes)}`, revoke: () => {} };
}

function getNotificationFallbackAudio() {
  if (_notifFallbackAudio) return _notifFallbackAudio;
  const audio = document.createElement("audio");
  audio.preload = "auto";
  audio.setAttribute("playsinline", "");
  audio.playsInline = true;
  audio.style.display = "none";
  document.body.appendChild(audio);
  _notifFallbackAudio = audio;
  return audio;
}

async function playToneAudioFallback(tones, options = {}) {
  let source = null;
  try {
    if (typeof btoa !== "function") return false;
    const audio = getNotificationFallbackAudio();
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {}
    source = toneWavSource(tones, options);
    audio.src = source.src;
    audio.volume = 1;
    await audio.play();
    return true;
  } catch {
    if (source) source.revoke();
    return false;
  }
  finally {
    if (source) setTimeout(source.revoke, 1500);
  }
}

/** Decide browse-mode column count from the currently filtered drawer
 * total. Returns null when the list is short enough that browse mode
 * shouldn't be reachable at all (the maximize toggle gets hidden,
 * and the user just scrolls the single-column view). Returns the
 * column count otherwise.
 *
 * Thresholds — chosen so the maximize button only appears when a
 * single-column scroll would genuinely be tedious, and the grid
 * tightens as the list grows so dense scanning gets denser. Each
 * tier roughly maps to "how many rows would you have to scroll":
 *
 *   0–10 → null   (hide toggle — single col handles 10 cards in <2 scroll viewports)
 *   11–24 → 2     (6–12 rows of 2 cards — comfortable scan)
 *   25–50 → 3     (9–17 rows of 3 — denser but still readable)
 *   51+   → 4     (max density — wall-of-cards scan mode)
 *
 * When the adaptive_browse pref is OFF, this is bypassed and the
 * caller falls back to the legacy "always 4 cols, always show
 * toggle" path.
 */
function adaptiveBrowseCols(filteredCount) {
  const n = Number.isFinite(filteredCount) ? filteredCount : 0;
  if (n <= 10) return null;
  if (n <= 24) return 2;
  if (n <= 50) return 3;
  return 4;
}

/** The single source of truth for "how many columns does browse mode
 * use right now, and is browse mode even reachable?" Returns a small
 * object so every caller — renderDrawerWindow, scrollDrawerListTo-
 * Selected, the maximize click handler, the visibility sync — reads
 * from the same place. */
function browseModeProfile() {
  const adaptive = getAdaptiveBrowse();
  const count = (state.palace && Array.isArray(state.palace.drawers))
    ? filteredDrawers().length
    : 0;
  if (!adaptive) {
    // Legacy behavior: always 4 cols, always toggle-visible.
    return { adaptive: false, count, cols: 4, hideToggle: false };
  }
  const cols = adaptiveBrowseCols(count);
  return {
    adaptive: true,
    count,
    cols: cols || 4,    // never zero — used for grid math when forced into browse
    hideToggle: cols === null,
  };
}

/** Sync the drawers-panel maximize button's visibility to the current
 * adaptive-browse profile. Called from renderDrawers (after the
 * filter is recomputed) and from the Settings toggle (when the user
 * flips adaptive_browse on/off). Also force-exits browse mode if the
 * profile is now "hideToggle" while the user was in browse — without
 * this they'd be stuck in an enlarged grid with no way out. */
function syncAdaptiveBrowse() {
  const btn = document.querySelector("#drawersPanelMaximize");
  if (!btn) return;
  const profile = browseModeProfile();
  // .is-hidden on the button (rather than the hidden attr) so it
  // participates in the existing fade transitions on .detail-panel-
  // maximize without needing display: none / block toggles. CSS
  // below sets opacity 0 + pointer-events none on the class.
  btn.classList.toggle("is-hidden", profile.hideToggle);
  if (profile.hideToggle && state.drawersEnlarged) {
    // The user was already in browse mode but the filter just dropped
    // below the threshold — auto-exit. Flip the state, update the
    // grid layout class, and re-render the (now 1-col) window. No
    // animation cleanup is needed because updateGridLayout / render-
    // DrawerWindow handle that path the same way the click handler
    // would.
    state.drawersEnlarged = false;
    btn.setAttribute("aria-label", "Browse all memories");
    btn.setAttribute("title", "Browse all");
    updateGridLayout();
    renderDrawerWindow();
  }
}

/** Refresh the bell-button badge + the dropdown panel's contents to
 * reflect the current set of recently-updated unseen drawers. The
 * notification list is GLOBAL (not scoped to the current filter) —
 * the bell is meant to surface "what's new across the whole palace,"
 * not "what's new in this wing." Each entry shows the drawer
 * author's model avatar, the cleaned title, and the relative time
 * since the last update. Sorted newest-first.
 *
 * Called from renderDrawers (after the filter pass) so the badge
 * count tracks any state change that could mark a drawer as seen.
 * Also called directly after Mark-all-as-seen + after the bell is
 * opened so the panel reflects fresh state without waiting for a
 * filter change. */
function renderNotifications() {
  const bell = document.querySelector("#notificationsBell");
  const badge = document.querySelector("#notificationsBadge");
  const list = document.querySelector("#notificationsList");
  const empty = document.querySelector("#notificationsEmpty");
  const count = document.querySelector("#notificationsCount");
  const markAll = document.querySelector("#notificationsMarkAll");
  if (!bell || !list) return;
  const drawers = (state.palace && state.palace.drawers) ? state.palace.drawers : [];
  // Suppress update notifications when the user has the preference on
  // (Settings → Notifications → Suppress update notifications). Failed-
  // save entries always surface regardless — those are errors the user
  // needs to see. The card-level "Updated" marker on individual cards
  // is a separate signal and isn't affected by this preference.
  const suppressUpdates = getSuppressUpdateNotifications();
  const updates = suppressUpdates ? [] : drawers
    .filter(isBellUnseenDrawer)
    .slice()
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  const factUpdates = suppressUpdates ? [] : ((state.palace && Array.isArray(state.palace.fact_events)) ? state.palace.fact_events : [])
    .filter(isBellUnseenFactEvent)
    .slice()
    .sort((a, b) => (factEventTimestamp(b) || "").localeCompare(factEventTimestamp(a) || ""));
  // Failed-save entries are higher-priority than info notifications —
  // they represent something the user thought succeeded but didn't,
  // so they always sit at the top of the dropdown and contribute
  // their own count to the badge. Sorted newest-first within the
  // group so the most-recent failure is closest to the bell click.
  const failures = (state.failedSaves || [])
    .slice()
    .sort((a, b) => (b.when || "").localeCompare(a.when || ""));
  // Badge: combined count of failures + updates. Bell pulses (has-
  // unseen class) when EITHER signal is present. Failures alone keep
  // the bell active even after all info notifications are dismissed,
  // which is correct — a failure is unresolved until acknowledged.
  const infoCount = updates.length + factUpdates.length;
  const n = infoCount + failures.length;
  // Notification-sound trigger: play the synthesized chime when the
  // count grows from a known baseline (not on first render — initial
  // count establishes the baseline, no sound). Debounced 500ms to
  // avoid back-to-back tones if multiple notifications arrive within
  // the same render cycle. _lastNotifCount = -1 sentinel means "no
  // baseline yet"; we capture it without sound on the first run.
  //
  // Sound selection: track failure count separately from total so we
  // can pick the right tone. New failures → descending error chime
  // (G5→D5); new updates only → ascending success chime (F5→A5).
  // If both fire in the same render (rare), failure wins because
  // errors deserve the more attention-grabbing signal.
  const prevTotal = state._lastNotifCount;
  const prevFailures = state._lastFailureCount || 0;
  const failureCount = failures.length;
  if (prevTotal === -1 || prevTotal === undefined) {
    // First render — establish baseline silently.
    state._lastNotifCount = n;
    state._lastFailureCount = failureCount;
  } else if (n > prevTotal) {
    if (getNotificationSounds()) {
      const now = Date.now();
      if (!state._lastNotifSoundAt || (now - state._lastNotifSoundAt) > 500) {
        if (failureCount > prevFailures) {
          playNotificationErrorSound();
        } else {
          playNotificationSound();
        }
        state._lastNotifSoundAt = now;
      }
    }
    state._lastNotifCount = n;
    state._lastFailureCount = failureCount;
  } else {
    state._lastNotifCount = n;
    state._lastFailureCount = failureCount;
  }
  if (badge) {
    if (n > 0) {
      badge.textContent = n > 99 ? "99+" : String(n);
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }
  // The badge tints red regardless of source, but the bell adds a
  // .has-failures class when ANY failure is present so CSS can
  // optionally style the badge or the bell differently for the
  // error case (currently they share the same red since --danger is
  // the standard alert colour either way).
  bell.classList.toggle("has-unseen", n > 0);
  bell.classList.toggle("has-failures", failures.length > 0);
  if (count) {
    count.textContent = n > 0
      ? (failures.length > 0
        ? `${failures.length} failed · ${infoCount} new`
        : `${infoCount} new`)
      : "";
  }
  if (empty) empty.classList.toggle("hidden", n > 0);
  if (markAll) markAll.classList.toggle("hidden", n === 0);
  if (n === 0) {
    list.innerHTML = "";
    return;
  }
  // Distinguish "this drawer was just created" from "this drawer was
  // edited later" — the difference matters for honest attribution.
  // MemPalace's update path (tool_update_drawer) takes no actor
  // parameter, so neither the MP WAL nor the dashboard versions log
  // records WHO edited a drawer — only the original `added_by` is
  // captured at creation and preserved forever after. That means we
  // can confidently say "Claude created this" but we CANNOT say
  // "Claude edited this" — if Codex (or any external MCP client)
  // bumped the drawer, the notification would still show the
  // original creator's avatar. So for update events we drop the
  // actor attribution entirely and use a neutral "pencil edit"
  // avatar + "Updated …" text instead. Creation events keep the
  // brand avatar + author name since that IS knowable.
  //
  // 10-second grace window between filed_at and updated_at counts as
  // "creation" — a fresh add stamps filed_at then logs the WAL entry
  // microseconds later, and we don't want clock-skew rounding to
  // turn every creation into a misleading "Updated" entry.
  function isUpdateEvent(drawer) {
    if (!drawer.filed_at || !drawer.updated_at) return false;
    const filed = Date.parse(drawer.filed_at);
    const updated = Date.parse(drawer.updated_at);
    if (Number.isNaN(filed) || Number.isNaN(updated)) return false;
    return (updated - filed) > 10_000;
  }
  // Failures rendered first (top of panel), then info updates. Drawer
  // updates and fact lifecycle events are each newest-first within their
  // group.
  // Failure layout differs from update layout: the error message can
  // be long (full sentence with context) and needs its own full-width
  // line to wrap cleanly. So we put title + timestamp on a header row
  // (timestamp right-aligned via .notif-header-row), then the error
  // reason on a second line with no competing inline elements. The
  // .notif-title gets nowrap+ellipsis to never break the header row.
  const failureHtml = failures.map((fail) => {
    const title = escapeHtml(cleanTitle(fail.title || fail.drawer_id));
    const when = escapeHtml(formatRelativeTime(fail.when) || "");
    const reason = escapeHtml(fail.error || "Save failed.");
    return `<button class="notif-item notif-item-failure" type="button"
      data-notif-drawer-id="${escapeHtml(fail.drawer_id)}"
      data-notif-failure-id="${escapeHtml(fail.id)}"
      title="Save failed — click to open the memory">
      <span class="notif-avatar notif-avatar-failure" aria-hidden="true">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 8v5M12 16.5v.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/>
          <path d="M10.6 3.4 2.5 18a1.6 1.6 0 0 0 1.4 2.4h16.2a1.6 1.6 0 0 0 1.4-2.4L13.4 3.4a1.6 1.6 0 0 0-2.8 0Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" fill="none"/>
        </svg>
      </span>
      <span class="notif-body">
        <span class="notif-header-row">
          <span class="notif-title">${title}</span>
          <span class="notif-when">${when}</span>
        </span>
        <span class="notif-failure-reason">Save failed: ${reason}</span>
      </span>
    </button>`;
  }).join("");
  const updateHtml = updates.map((drawer) => {
    const title = escapeHtml(cleanTitle(drawer.title || drawer.drawer_id));
    const when = escapeHtml(formatRelativeTime(drawer.updated_at) || "");
    const isUpdate = isUpdateEvent(drawer);
    if (isUpdate) {
      // Edit event — actor unknown (see comment above), use a
      // neutral pencil avatar + "Updated" text. The drawer's
      // original-creator name is still in drawer.added_by but we
      // deliberately don't surface it here to avoid implying that
      // creator made the edit.
      return `<button class="notif-item" type="button" data-notif-drawer-id="${escapeHtml(drawer.drawer_id)}">
        <span class="notif-avatar notif-avatar-edit" aria-hidden="true">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 20h4l10-10-4-4L4 16v4Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
            <path d="m14 6 4 4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
          </svg>
        </span>
        <span class="notif-body">
          <span class="notif-title">${title}</span>
          <span class="notif-meta"><span class="notif-author">Updated</span> · <span class="notif-when">${when}</span></span>
        </span>
      </button>`;
    }
    // Creation event — actor IS knowable (drawer.added_by is the
    // original creator stamped at write time, never overwritten).
    // Show their brand avatar + name.
    const avatar = notificationAvatarHtml(drawer.added_by);
    const author = escapeHtml(prettifyActorName(drawer.added_by) || "Unknown");
    return `<button class="notif-item" type="button" data-notif-drawer-id="${escapeHtml(drawer.drawer_id)}">
      ${avatar}
      <span class="notif-body">
        <span class="notif-title">${title}</span>
        <span class="notif-meta"><span class="notif-author">${author}</span> · <span class="notif-when">${when}</span></span>
      </span>
    </button>`;
  }).join("");
  const factHtml = factUpdates.map((event) => {
    const eventId = factEventSeenKey(event);
    const title = escapeHtml(factEventTitle(event) || event.fact_id || "Fact");
    const when = escapeHtml(formatRelativeTime(factEventTimestamp(event)) || "");
    const label = escapeHtml(factEventMetaLabel(event));
    const sourceDrawerId = event.source_drawer_id || "";
    return `<button class="notif-item" type="button"
      data-notif-fact-id="${escapeHtml(eventId)}"
      data-notif-source-drawer-id="${escapeHtml(sourceDrawerId)}"
      data-notif-fact-query="${title}">
      <span class="notif-avatar notif-avatar-edit" aria-hidden="true">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="6" cy="12" r="2.4" fill="currentColor"/>
          <circle cx="18" cy="6" r="2.4" fill="currentColor"/>
          <circle cx="18" cy="18" r="2.4" fill="currentColor"/>
          <path d="M8.2 11.1 15.8 7M8.2 12.9l7.6 4.1" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
        </svg>
      </span>
      <span class="notif-body">
        <span class="notif-title">${title}</span>
        <span class="notif-meta"><span class="notif-author">${label}</span> · <span class="notif-when">${when}</span></span>
      </span>
    </button>`;
  }).join("");
  list.innerHTML = failureHtml + updateHtml + factHtml;
}

function applyReduceMotion() {
  // No-op if the class state already matches the desired preference
  // — openSettingsSheet calls this on every open to re-sync from
  // the server, and unconditionally adding/removing apricity-no-anim
  // in those no-op calls was cutting the settings panel's in-flight
  // open animation mid-flight, then re-triggering it when no-anim
  // came off → visible flicker. Skip the work when nothing changes.
  const wanted = getReduceMotion();
  const current = document.documentElement.classList.contains("reduce-motion");
  if (wanted === current) return;
  // Wrap the .reduce-motion class flip in a brief no-anim window so
  // toggling the setting at runtime doesn't replay animations on
  // already-mounted elements. Specifically: removing .reduce-motion
  // re-enables the original CSS transitions/animations, and any
  // element that currently has a "started" animation rule would
  // appear to restart. The suppression bubble lasts two RAFs which
  // absorbs the class change without freezing the UI noticeably.
  suppressAnimationsBriefly();
  document.documentElement.classList.toggle("reduce-motion", wanted);
}

/** Toggle the body.apricity-panel-controls-always class based on the
 * current preference. CSS rule for the class lives in styles.css —
 * presence forces .detail-panel-actions opacity:1; absence keeps the
 * default hover-reveal behavior (opacity:0 at rest, :hover/:focus-
 * within → opacity:1). */
function applyPanelControlsAlwaysVisible() {
  document.body.classList.toggle(
    "apricity-panel-controls-always",
    getPanelControlsAlwaysVisible(),
  );
}

function applyFooterInfoVisibility() {
  const show = getShowFooterInfo();
  document.querySelectorAll(".footer-info").forEach((el) => {
    el.hidden = !show;
  });
}

/** Seed state.sortBy from the preference IF the URL hash didn't
 *  already specify one (URL hash takes precedence for the session so
 *  deep-links keep working). Also keeps the dropdown in sync. */
function applyDefaultSort() {
  const pref = getDefaultSort();
  // If URL hash explicitly set a sort (state.sortBy already differs
  // from the previous default), respect it. Otherwise adopt the
  // preference as the current sort.
  const hash = readHash();
  if (!hash.s) {
    state.sortBy = pref;
    if (els.sortSelect) els.sortSelect.value = pref;
  }
}

function syncPreferenceControls() {
  // Re-syncs every preference-bound input from the cached
  // state._preferences. Called after fetchPreferences() so the
  // Settings sheet always shows current values.
  syncTrashAutoDeleteSelect();
  const showFooter = document.querySelector("#showFooterInfoToggle");
  if (showFooter) showFooter.checked = getShowFooterInfo();
  const reduceMotion = document.querySelector("#reduceMotionToggle");
  if (reduceMotion) reduceMotion.checked = getReduceMotion();
  const defaultSort = document.querySelector("#defaultSortSelect");
  if (defaultSort) defaultSort.value = getDefaultSort();
  const adaptiveBrowse = document.querySelector("#adaptiveBrowseToggle");
  if (adaptiveBrowse) adaptiveBrowse.checked = getAdaptiveBrowse();
  const polishText = document.querySelector("#polishTextToggle");
  if (polishText) polishText.checked = getPolishText();
  const relativeTime = document.querySelector("#relativeTimeToggle");
  if (relativeTime) relativeTime.checked = getRelativeTime();
  const panelControlsAlways = document.querySelector("#panelControlsAlwaysToggle");
  if (panelControlsAlways) panelControlsAlways.checked = getPanelControlsAlwaysVisible();
  const suppressUpdates = document.querySelector("#suppressUpdatesToggle");
  if (suppressUpdates) suppressUpdates.checked = getSuppressUpdateNotifications();
  const notifSounds = document.querySelector("#notificationSoundsToggle");
  if (notifSounds) notifSounds.checked = getNotificationSounds();
  const notifPollSelect = document.querySelector("#notificationPollIntervalSelect");
  if (notifPollSelect) notifPollSelect.value = String(getNotificationPollIntervalSeconds());
  syncShortcutButtons();
}

/** Refresh each Settings shortcut button's label to reflect the
 * current binding from state._preferences. Skips buttons that are
 * mid-recording so the "Press a key…" prompt isn't clobbered. Also
 * re-localizes the Editing mode shortcut display so Windows / Linux
 * users see "Ctrl+B" instead of the Mac "⌘B" — kept here (not
 * hardcoded in HTML) so the page renders correctly regardless of
 * what platform served it. */
function syncShortcutButtons() {
  SHORTCUT_ACTIONS.forEach((action) => {
    const btn = document.querySelector(`[data-shortcut="${action}"]`);
    if (!btn || btn.classList.contains("listening")) return;
    btn.textContent = formatShortcutKey(getShortcut(action));
  });
  localizeEditShortcutLabels();
}

/** Swap the Mac ⌘⇧ glyphs for "Ctrl+" / "Shift+" on non-Mac platforms
 * so the editing-mode shortcuts read natively on whatever OS the
 * user is on. The HTML ships with the Mac forms (visually cleaner),
 * this re-writes them at runtime when needed. */
function localizeEditShortcutLabels() {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  if (isMac) return; // HTML already correct
  const map = {
    bold: "Ctrl+B",
    italic: "Ctrl+I",
    strikethrough: "Ctrl+Shift+X",
    code: "Ctrl+E",
  };
  document.querySelectorAll("[data-edit-shortcut]").forEach((el) => {
    const label = map[el.dataset.editShortcut];
    if (label) el.textContent = label;
  });
}

// Wire each new control.
const showFooterInfoToggle = on("showFooterInfoToggle", "change", async () => {
    await updatePreferences({ show_footer_info: showFooterInfoToggle.checked });
    applyFooterInfoVisibility();
  });

const reduceMotionToggle = on("reduceMotionToggle", "change", async () => {
    await updatePreferences({ reduce_motion: reduceMotionToggle.checked });
    applyReduceMotion();
  });

const adaptiveBrowseToggle = on("adaptiveBrowseToggle", "change", async () => {
    await updatePreferences({ adaptive_browse: adaptiveBrowseToggle.checked });
    // Re-sync immediately so the maximize button hides/shows and the
    // grid column count flips without waiting for a filter change.
    // syncAdaptiveBrowse handles the auto-exit case (browse-on while
    // the new profile says hide), and renderDrawerWindow re-paints
    // with the new --browse-cols value.
    syncAdaptiveBrowse();
    renderDrawerWindow();
  });

const polishTextToggle = on("polishTextToggle", "change", async () => {
    await updatePreferences({ polish_text: polishTextToggle.checked });
    // Polish state affects every site that runs cleanTitle /
    // humanizeName / prettifyActorName: drawer card titles, the
    // drawer detail header, the rooms-panel wing/room labels, the
    // detail meta strip's author cell, search results, and so on.
    // Invalidate the drawer-card HTML cache (state._virtCardsHtml)
    // and the rooms-panel structural signature so the next render()
    // rebuilds both layouts with the new polish setting in effect.
    // Then a full render() repaints every other surface.
    state._lastDrawerFilterSig = null;
    invalidateCardCache();
    if (els.roomNav) els.roomNav.dataset.structuralSig = "";
    render();
  });

// Settings → "Send test notification". Pushes a fake failed-save
// entry onto state.failedSaves, shows the browser notification preview
// when permission is granted, plays the error chime directly from the
// click handler, then re-renders so the bell receives it. The direct
// playback is intentional: relying only on renderNotifications' count-
// delta branch made the test button silent whenever the baseline count
// was still uninitialized (first render is intentionally quiet).
//
// The fake drawer_id is prefixed `__test_failure_` so it never collides
// with a real drawer's id, and the timestamp suffix lets the user fire
// the test repeatedly (pushFailedSave dedupes by drawer_id).
const sendTestNotifBtn = on("sendTestNotifBtn", "click", async () => {
    pushFailedSave({
      drawer_id: `__test_failure_${Date.now()}`,
      title: "Test notification",
      wing: "test",
      room: "demo",
      error: "Simulated failure — this is a preview, no real save was attempted.",
    });
    if (getNotificationSounds()) {
      await playNotificationErrorSound();
      state._lastNotifSoundAt = Date.now();
    }
    // Render so the bell badge + dropdown reflect the new failure
    // entry. The debounce timestamp above prevents a second immediate
    // chime if renderNotifications also sees the count increase.
    renderNotifications();
  });

// Settings → "Mark all memories as seen". Unconditional companion to
// the inline button — works regardless of filter, regardless of count.
// Iterates every drawer in the palace, not just visible ones, so the
// user can clear the WHOLE marker map from one place. The inline
// button still exists for the common case (a bunch of visible cards
// got bumped); this is the "I just want it ALL gone" hammer.
const markAllSeenSettingsBtn = on("markAllSeenSettingsBtn", "click", () => {
    if (!state.palace || !Array.isArray(state.palace.drawers)) return;
    // Stamp every drawer — even ones that aren't currently "recently
    // updated" — so the local seen map stays consistent for a future
    // edit. Filtering to just isRecentlyUpdated would technically be
    // cheaper but leaves stale entries lingering in the map.
    const ids = state.palace.drawers.map((d) => d.drawer_id).filter(Boolean);
    markDrawersSeen(ids);
    // Invalidate card cache + re-render so any visible blue markers
    // clear immediately without waiting for a filter change.
    invalidateCardCache();
    render();
  });

const relativeTimeToggle = on("relativeTimeToggle", "change", async () => {
    await updatePreferences({ relative_time: relativeTimeToggle.checked });
    // Same invalidation surface as polish_text: card kickers bake
    // the formatted date into the cached HTML, and the meta-strip
    // UPDATED cell is part of the detail render. Wipe the drawer-
    // card cache and re-render. (Rooms panel doesn't use either
    // date formatter, so its structuralSig stays valid.)
    state._lastDrawerFilterSig = null;
    invalidateCardCache();
    render();
  });

const panelControlsAlwaysToggle = on("panelControlsAlwaysToggle", "change", async () => {
    await updatePreferences({ panel_controls_always_visible: panelControlsAlwaysToggle.checked });
    // Pure CSS effect — flip the body class and let the existing
    // 0.2s opacity transition on .detail-panel-actions handle the
    // visual change. No re-render needed (the controls are static
    // DOM that doesn't depend on app state for layout).
    applyPanelControlsAlwaysVisible();
  });

const suppressUpdatesToggle = on("suppressUpdatesToggle", "change", async () => {
    await updatePreferences({ suppress_update_notifications: suppressUpdatesToggle.checked });
    // Re-render notifications so the bell badge + dropdown reflect
    // the new filter immediately. Drawer cards' own update markers
    // are unaffected — this only gates the bell.
    renderNotifications();
  });

const notificationSoundsToggle = on("notificationSoundsToggle", "change", async () => {
    const enabled = notificationSoundsToggle.checked;
    // Audible preview when the user FLIPS ON sounds — plays the
    // success chime then, ~400ms later, the descending error chime
    // so they hear BOTH vocabularies the preference now controls.
    // No ping on flip-off (silence-on-disable is the expected
    // feedback).
    if (enabled) {
      await playNotificationSound();
      setTimeout(() => playNotificationErrorSound(), 450);
    }
    await updatePreferences({ notification_sounds: enabled });
  });

const notificationPollIntervalSelect = on("notificationPollIntervalSelect", "change", async () => {
    const n = parseInt(notificationPollIntervalSelect.value, 10);
    const seconds = NOTIFICATION_POLL_ALLOWED.has(n) ? n : 30;
    await updatePreferences({ notification_poll_interval: seconds });
    // Restart polling so the new cadence takes effect on the next
    // tick instead of waiting for the in-flight setInterval to fire
    // at its old interval. startNotificationPolling reads the
    // freshly-cached preference value via getNotificationPollIntervalSeconds.
    startNotificationPolling();
  });

const defaultSortSelect = on("defaultSortSelect", "change", async () => {
    const v = SORT_ALLOWED.has(defaultSortSelect.value) ? defaultSortSelect.value : "filed-desc";
    await updatePreferences({ default_sort: v });
    // Don't auto-apply to the current view — the user might be
    // mid-browse with a different sort. The new default kicks in
    // on the next page load / hashchange that has no explicit sort.
  });

// ---------- Settings: keyboard-shortcut remapping ----------
// Each Settings shortcut button enters a "listening" state on click,
// captures the next non-modifier keydown via a capture-phase listener
// (so it runs BEFORE the global keydown that drives shortcuts —
// otherwise rebinding to "x" would dismiss the Settings sheet via
// the close cascade before we could capture). Esc cancels recording
// without saving. Cmd/Ctrl-modified keys are ignored so we don't
// stomp browser shortcuts (Cmd+K, Cmd+R, etc.).
const SHORTCUT_MODIFIER_KEYS = new Set([
  "Shift", "Control", "Alt", "Meta", "CapsLock", "Dead", "Process", "Unidentified",
]);

function startShortcutListening(btn, action) {
  btn.classList.add("listening");
  btn.dataset.priorLabel = btn.textContent;
  btn.textContent = "Press a key…";

  const onKey = (event) => {
    // Esc cancels recording. stopPropagation keeps it from hitting
    // the global close-cascade handler (which would also dismiss the
    // open Settings sheet — confusing during a binding flow).
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelShortcutListening(btn);
      return;
    }
    // Modifier keys alone aren't bindable — wait for the next combo.
    if (SHORTCUT_MODIFIER_KEYS.has(event.key)) return;
    // Disallow Cmd/Ctrl-combinations so the user can't bind something
    // that collides with the browser's built-in shortcuts (Cmd+K is
    // search-focus, Cmd+R reloads, etc.). Plain keys only.
    if (event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    event.stopPropagation();
    document.removeEventListener("keydown", onKey, true);
    btn.__cancelListen = null;
    btn.classList.remove("listening");
    delete btn.dataset.priorLabel;
    btn.textContent = formatShortcutKey(event.key);
    // Mirror locally so the rebound shortcut takes effect immediately,
    // even before the server POST resolves.
    if (!state._preferences) state._preferences = {};
    if (!state._preferences.shortcuts) {
      state._preferences.shortcuts = { ...SHORTCUT_DEFAULTS };
    }
    state._preferences.shortcuts[action] = event.key;
    updatePreferences({ shortcuts: { [action]: event.key } }).catch(() => {});
  };
  document.addEventListener("keydown", onKey, true);
  // Stash a cancel hook so cancelShortcutListening can find and
  // remove this specific listener (each invocation creates a fresh
  // closure, so we can't just removeEventListener without the ref).
  btn.__cancelListen = () => {
    document.removeEventListener("keydown", onKey, true);
  };
}

function cancelShortcutListening(btn) {
  btn.classList.remove("listening");
  const prior = btn.dataset.priorLabel;
  btn.textContent = prior !== undefined
    ? prior
    : formatShortcutKey(getShortcut(btn.dataset.shortcut));
  delete btn.dataset.priorLabel;
  if (btn.__cancelListen) {
    btn.__cancelListen();
    btn.__cancelListen = null;
  }
}

SHORTCUT_ACTIONS.forEach((action) => {
  const btn = document.querySelector(`[data-shortcut="${action}"]`);
  if (!btn) return;
  // Initial label — overwritten by syncShortcutButtons() once prefs
  // load, but this prevents a brief HTML-default flash for users on
  // the default bindings.
  btn.textContent = formatShortcutKey(getShortcut(action));
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    if (btn.classList.contains("listening")) {
      cancelShortcutListening(btn);
      return;
    }
    startShortcutListening(btn, action);
  });
});

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

// ---------- live notification polling ----------
// Background re-fetch of /api/palace every N seconds so the bell catches
// drawer-update events that originated OUTSIDE this dashboard session
// (Codex editing via MCP, another Claude session, the sync tool,
// etc.). Without this, the bell only refreshes on dashboard-mediated
// writes + the bootstrap loadPalace — meaning a user could sit on the
// page for an hour and miss every cross-session notification.
//
// Cadence is user-configurable via Settings → Notifications →
// Refresh interval (15 / 30 / 60s, default 30). Each poll first checks
// a tiny /api/palace-version token and only fetches /api/palace when
// the server says one of the palace inputs changed.
//
// Gating: skipped while the tab is hidden (Page Visibility API saves
// CPU when the user can't see the result anyway), and skipped while
// the inline editor is open (belt-and-suspenders against focus loss).
//
// When the tab transitions from hidden → visible, an immediate poll
// fires so the notification state catches up the moment the user
// looks at it instead of waiting up to N seconds for the next tick.
let _notifPollTimer = null;
let _palacePollInFlight = false;

async function pollPalaceQuiet() {
  if (document.hidden) return;
  if (state.isEditing) return;
  if (_palacePollInFlight) return;
  _palacePollInFlight = true;
  try {
    const version = await fetchPalaceVersion();
    if (version && state._palaceVersion && version === state._palaceVersion) {
      await loadTunnels();
      return;
    }
    await loadPalace();
  } catch {
    // Network blip / auth expired / etc. — next tick will retry.
    // No UI feedback on poll failures (would be noisier than useful
    // for a background sync).
  } finally {
    _palacePollInFlight = false;
  }
}

function startNotificationPolling() {
  // Read the cadence from preferences each time we (re)start so
  // toggling the Refresh interval select takes effect on the next
  // tick without waiting for the in-flight setInterval to fire.
  if (_notifPollTimer) clearInterval(_notifPollTimer);
  const ms = getNotificationPollIntervalSeconds() * 1000;
  _notifPollTimer = setInterval(pollPalaceQuiet, ms);
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    // Tab just got focus — kick off an immediate refresh so the bell
    // reflects whatever fired while the tab was in the background.
    pollPalaceQuiet();
  }
});

(async function boot() {
  // Safety net: no matter how boot exits (early return, fatal error,
  // login prompt), make sure both suppression classes eventually
  // come off so the page isn't permanently stripped of transitions.
  // Two suppression mechanisms in play:
  //   • .page-loading (added inline in HTML) — pre-existing, covers
  //     the init script's DOM/class mutations
  //   • .apricity-no-anim (added by this script's top) — added later,
  //     belt-and-suspenders for any keyframe animation that the
  //     page-loading rule (which uses duration:0 not animation:none)
  //     might let slip through
  // Both come off in the same RAF×2 after first render so the
  // enlarged-detail restoration, callout-chip cascades, etc. don't
  // animate while we're just restoring state from the URL hash.
  const releaseAnim = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.documentElement.classList.remove("apricity-no-anim");
        document.documentElement.classList.remove("page-loading");
      });
    });
  };
  // Fire the independent boot requests IN PARALLEL instead of three
  // serial awaits (session → preferences → palace). Each is ~1ms
  // server-side, but on a LAN each serial await still pays a full
  // round-trip, so the old chain held the content hidden
  // (.page-loading sets visibility:hidden on .content-grid) for ~3
  // RTTs. Requesting them together collapses that to ~1 RTT — the
  // content appears as soon as the slowest single response lands.
  // session/preferences/palace don't depend on each other's BODIES
  // (only on auth, which we re-check below before using palace); if
  // auth turns out to be required, the speculative palace/prefs
  // results are simply discarded.
  const sessionP = fetchJson("/api/session");
  const prefsP = fetchPreferences().catch(() => {});
  const palaceP = fetchJson("/api/palace").catch(() => null);
  // Tunnels too — start it now so it overlaps with everything else
  // and the tunnel-bind chip is ready for the first paint. loadTunnels
  // populates state.tunnels + sets tunnelsLoaded; its internal
  // `if (state.palace) render()` is a no-op here because palace isn't
  // set yet, so it won't paint a half-loaded UI ahead of us.
  const tunnelsP = loadTunnels().catch(() => {});

  let sessionInfo = null;
  try {
    sessionInfo = await sessionP;
  } catch (error) {
    document.body.innerHTML = `<main class="fatal"><h1>Unable to reach MemPalace</h1><p>${escapeHtml(error.message)}</p></main>`;
    releaseAnim();
    return;
  }
  if (sessionInfo.credentials_required && !sessionInfo.authenticated) {
    openLoginSheet();
    releaseAnim();
    return;
  }
  // Preferences must be applied BEFORE the first palace render so the
  // memories list uses the correct default sort + visual prefs. Also
  // handles the localStorage → server migration for the legacy trash
  // retention key.
  await prefsP;
  const legacyTrash = readLegacyTrashAutoDeleteFromLocalStorage();
  if (legacyTrash != null && !(state._preferences && "trash_auto_delete_days" in state._preferences)) {
    await updatePreferences({ trash_auto_delete_days: legacyTrash }).catch(() => {});
  }
  if (legacyTrash != null) clearLegacyTrashAutoDeleteFromLocalStorage();
  syncPreferenceControls();
  applyReduceMotion();
  applyFooterInfoVisibility();
  applyPanelControlsAlwaysVisible();
  applyDefaultSort();
  // INSTANT PAINT FROM CACHE: if a previous visit cached the palace,
  // render it RIGHT NOW — before the network fetch resolves — so the
  // memories list/detail is on screen immediately on reload instead of
  // waiting on the round-trip. Preferences are already applied above, so
  // the cached render uses the correct sort + visual prefs. The live
  // fetch below then overwrites state.palace and re-renders with the
  // canonical server data (stale-while-revalidate). Skipped if the live
  // payload is already in hand (LAN is fast — palaceP often resolves
  // before we get here, in which case the cache paint would just be an
  // extra render of slightly older data).
  // Suppress the detail panel's slide/fade for the entire boot data
  // phase so neither the cache paint nor the live-fetch render replays
  // the meta-strip cross-fade (grey-banner flicker on cached reload).
  // Cleared after the live render below.
  state._suppressDetailTransition = true;
  let paintedFromCache = false;
  if (palaceP) {
    // Peek without awaiting: only use the cache if the live fetch hasn't
    // landed yet. Promise.race against an already-resolved sentinel tells
    // us synchronously-ish whether to bother.
    const cached = readPalaceCache();
    if (cached) {
      // Don't block on the network: if palaceP is still pending, paint
      // the cache now. We detect "still pending" by racing it against a
      // microtask-resolved marker.
      const PENDING = Symbol("pending");
      const liveOrPending = await Promise.race([
        palaceP.then((v) => v ?? null),
        Promise.resolve(PENDING),
      ]);
      if (liveOrPending === PENDING) {
        // Live fetch not ready → paint the cache for an instant first view.
        state.palace = cached;
        // Seen-state precedence: the dedicated seen cache is written on
        // EVERY dismissal, whereas cached.seen is only as fresh as the
        // last full palace fetch. So prefer the dedicated cache — without
        // this, dismissing a notification then refreshing would briefly
        // repaint the "Updated" gradient + bell entry from the stale
        // palace-embedded seen map before the live fetch reconciles.
        const freshSeen = readSeenCache();
        if (freshSeen) {
          state._seenMap = freshSeen;
        } else if (cached.seen && typeof cached.seen === "object") {
          state._seenMap = cached.seen;
        }
        // Hydrate tunnel indicators from THEIR cache too, so the instant
        // paint draws the meta-strip watermark + wing/room connection
        // counts instead of popping them in when /api/tunnels resolves.
        // The live tunnels fetch (already in flight from boot) overwrites
        // this right after.
        if (!state.tunnelsLoaded) {
          const cachedTunnels = readTunnelsCache();
          if (cachedTunnels) applyTunnelItems(cachedTunnels);
        }
        reconcileSelection();
        render();
        paintedFromCache = true;
        // Lift the boot gate immediately — we have content on screen now.
        releaseAnim();
      }
    }
  }
  // Hand the already-in-flight palace payload to loadPalace so it
  // doesn't re-fetch. If the speculative fetch failed (null),
  // loadPalace falls back to fetching fresh. This always runs (even
  // after a cache paint) so the canonical server data overwrites the
  // possibly-stale cache.
  try {
    // Make sure the in-flight tunnels fetch has landed so the first
    // render includes the chip (loadPalace would otherwise await its
    // own tunnels call, but ours is already running — just join it).
    await tunnelsP;
    const palacePayload = await palaceP;
    await loadPalace(palacePayload || undefined);
  } catch (error) {
    if (error.message === "Authentication required.") {
      state._suppressDetailTransition = false;
      return;
    }
    // If we already painted from cache, a failed live fetch is non-fatal
    // — the user still sees their (slightly stale) memories. Only show
    // the fatal screen when we have nothing on screen at all.
    if (!paintedFromCache) {
      document.body.innerHTML = `<main class="fatal"><h1>Unable to load MemPalace</h1><p>${escapeHtml(error.message)}</p></main>`;
    }
  }
  // Boot renders done — re-enable detail transitions so genuine user
  // navigation (card→card, open/close, maximize) animates again.
  state._suppressDetailTransition = false;
  // Sync previousDetailKind to whatever the detail panel actually
  // rendered during boot. applyDetailTransition early-returns on the
  // boot renders (no detailDirection is set during boot), so it never
  // advanced previousDetailKind — leaving it null. Without this, the
  // FIRST post-reload navigation would compute layoutSwitch =
  // ("drawer" !== "") = true and play the kind-CHANGE slide-from-right
  // instead of the same-kind body-rise. Seeding it from the live DOM
  // makes drawer→drawer correctly read as a same-kind value update.
  if (els.detail) {
    state.previousDetailKind = els.detail.dataset.detailKind || "empty";
  }
  // First render is complete — release the no-anim class so future
  // user interactions get their proper transitions. (Idempotent — may
  // have already fired in the cache-paint branch above.)
  releaseAnim();
  // Server prunes the trash on every /api/versions GET using its
  // stored retention preference — kick off a no-arg fetch so the
  // sweep runs on boot even if the user never opens Recently
  // deleted. Response discarded; only the side effect matters.
  fetchJson("/api/versions").catch(() => {});
  // Kick off the live-notification polling loop so the bell catches
  // drawer-update events from external MCP clients (Codex, other
  // Claude sessions, sync tool) without requiring a manual page
  // refresh. See startNotificationPolling for cadence + gating.
  startNotificationPolling();
})();
