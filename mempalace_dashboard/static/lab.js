// MemPalace Lab — wires the Lab sheet to every advanced MCP tool.
// Depends on fetchJson / postJson defined in app.js.
(function () {
  "use strict";

  const sheet = document.querySelector("#labSheet");
  const openBtn = document.querySelector("#labBtn");
  const closeBtn = document.querySelector("#labClose");
  const backdrop = document.querySelector("#labBackdrop");
  if (!sheet || !openBtn) return;

  // ---------- sheet open/close ----------
  function openLab() {
    sheet.classList.remove("hidden");
    document.body.classList.add("lab-open");
  }
  function closeLab() {
    sheet.classList.add("hidden");
    document.body.classList.remove("lab-open");
  }
  openBtn.addEventListener("click", openLab);
  closeBtn && closeBtn.addEventListener("click", closeLab);
  backdrop && backdrop.addEventListener("click", closeLab);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !sheet.classList.contains("hidden")) closeLab();
  });

  // ---------- tabs ----------
  const tabs = sheet.querySelectorAll(".lab-tab");
  const panes = sheet.querySelectorAll(".lab-pane");

  // Pane-init hooks: keyed by data-lab-tab. Called the FIRST time a tab is
  // shown so e.g. Tunnels auto-loads its list without an extra click. Each
  // hook fires exactly once per page load.
  const paneInit = {
    tunnels: () => {
      const btn = $("#tunListRun");
      if (btn) btn.click();
    },
  };
  const paneInitFired = new Set();
  function fireTabInit(target) {
    if (paneInitFired.has(target)) return;
    paneInitFired.add(target);
    const hook = paneInit[target];
    if (typeof hook === "function") hook();
  }

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.labTab;
      tabs.forEach((t) => {
        const active = t === tab;
        t.classList.toggle("active", active);
        t.setAttribute("aria-selected", active ? "true" : "false");
      });
      panes.forEach((p) => {
        const show = p.dataset.labPane === target;
        p.classList.toggle("active", show);
        if (show) p.removeAttribute("hidden");
        else p.setAttribute("hidden", "");
      });
      fireTabInit(target);
    });
  });

  // ---------- helpers ----------
  function $(id) { return document.querySelector(id); }
  function v(id) { return ($(id) && $(id).value !== undefined) ? $(id).value.trim() : ""; }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch]));
  }

  function renderJson(target, data) {
    const el = $(target);
    if (!el) return;
    el.innerHTML = `<pre class="lab-json">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  }

  function renderError(target, err) {
    const el = $(target);
    if (!el) return;
    const msg = (err && err.message) ? err.message : String(err);
    el.innerHTML = `<div class="lab-error">${escapeHtml(msg)}</div>`;
  }

  function renderLoading(target, label = "Loading…") {
    const el = $(target);
    if (!el) return;
    el.innerHTML = `<div class="lab-loading">${escapeHtml(label)}</div>`;
  }

  function renderEmpty(target, label = "No results.") {
    const el = $(target);
    if (!el) return;
    el.innerHTML = `<div class="lab-empty">${escapeHtml(label)}</div>`;
  }

  async function run(targetId, loadingLabel, work, renderer) {
    renderLoading(targetId, loadingLabel);
    try {
      const result = await work();
      renderer ? renderer(targetId, result) : renderJson(targetId, result);
    } catch (err) {
      renderError(targetId, err);
    }
  }

  function qs(params) {
    const out = new URLSearchParams();
    for (const [k, val] of Object.entries(params)) {
      if (val !== undefined && val !== null && val !== "") out.set(k, val);
    }
    const s = out.toString();
    return s ? `?${s}` : "";
  }

  // ---------- renderers ----------
  function renderFacts(target, data) {
    const el = $(target);
    if (!el) return;
    const facts = (data && (data.facts || data.triples || data.items)) || [];
    if (!facts.length) { renderEmpty(target, "No facts found."); return; }
    const rows = facts.map((f) => {
      const subj = escapeHtml(f.subject ?? "");
      const pred = escapeHtml(f.predicate ?? "");
      const obj = escapeHtml(f.object ?? "");
      const from = f.valid_from ? `<span class="lab-pill">from ${escapeHtml(f.valid_from)}</span>` : "";
      const to = f.valid_to ? `<span class="lab-pill lab-pill-warn">to ${escapeHtml(f.valid_to)}</span>` : "";
      const conf = (f.confidence !== undefined && f.confidence !== null) ? `<span class="lab-pill">conf ${escapeHtml(f.confidence)}</span>` : "";
      return `<div class="lab-fact"><div class="lab-fact-spo"><strong>${subj}</strong> <em>${pred}</em> <strong>${obj}</strong></div><div class="lab-fact-meta">${from}${to}${conf}</div></div>`;
    }).join("");
    const header = (data && data.count !== undefined) ? `<div class="lab-summary">${facts.length} fact(s) shown · ${escapeHtml(data.count)} total</div>` : `<div class="lab-summary">${facts.length} fact(s)</div>`;
    el.innerHTML = header + rows;
  }

  function renderTimeline(target, data) {
    const el = $(target);
    if (!el) return;
    const events = (data && (data.timeline || data.facts || data.events || data.items)) || [];
    if (!events.length) { renderEmpty(target, "No timeline entries."); return; }
    const rows = events.map((f) => {
      const date = f.valid_from || f.extracted_at || f.date || "";
      const subj = escapeHtml(f.subject ?? f.entity ?? "");
      const pred = escapeHtml(f.predicate ?? "");
      const obj = escapeHtml(f.object ?? "");
      const ended = f.valid_to ? ` <span class="lab-pill lab-pill-warn">ended ${escapeHtml(f.valid_to)}</span>` : "";
      return `<div class="lab-timeline-row"><div class="lab-timeline-date">${escapeHtml(date)}</div><div class="lab-timeline-body"><strong>${subj}</strong> <em>${pred}</em> <strong>${obj}</strong>${ended}</div></div>`;
    }).join("");
    el.innerHTML = `<div class="lab-summary">${events.length} event(s)</div>${rows}`;
  }

  // Extract a {wing, room} pair from a tunnel endpoint that may be either
  // nested ({source: {wing, room}}) or flat (legacy source_wing/source_room
  // or from_wing/from_room). MCP tool_list_tunnels returns the nested shape;
  // tool_find_tunnels / tool_follow_tunnels return similar nested objects.
  function tunnelEndpoint(t, side) {
    const nested = t && t[side];
    if (nested && typeof nested === "object") {
      return { wing: nested.wing || "?", room: nested.room || "?" };
    }
    if (side === "source") {
      return { wing: t.source_wing || t.from_wing || "?", room: t.source_room || t.from_room || "?" };
    }
    return { wing: t.target_wing || t.to_wing || "?", room: t.target_room || t.to_room || "?" };
  }

  // Jump to a wing/room in the main UI and close Lab. Works by clicking the
  // existing nav buttons, so we inherit whatever selection logic app.js uses.
  //
  // Tries name variants because tunnel-storage and drawer-storage normalize
  // wing names differently (tunnels: "home_assistant", drawers: "home-assistant").
  // Tracked upstream as MemPalace/mempalace#1621.
  function findNavButton(selector, name) {
    if (!name || name === "?") return null;
    const variants = [name, name.replace(/_/g, "-"), name.replace(/-/g, "_")];
    for (const variant of variants) {
      const btn = document.querySelector(`${selector}[data-${selector.includes("wing") ? "wing" : "room"}="${CSS.escape(variant)}"]`);
      if (btn) return btn;
    }
    return null;
  }

  function navigateToRoom(wing, room) {
    const wingBtn = findNavButton("#wingNav .nav-item", wing);
    if (!wingBtn) return false;
    wingBtn.click();
    if (room && room !== "?") {
      // app.js renders roomNav synchronously after a wing click.
      const roomBtn = findNavButton("#roomNav .room-item", room);
      if (roomBtn) roomBtn.click();
    }
    closeLab();
    return true;
  }

  function renderTunnels(target, data) {
    const el = $(target);
    if (!el) return;
    const tunnels = (data && (data.tunnels || data.connections || data.results || data.items)) || [];
    if (!tunnels.length) { renderEmpty(target, "No tunnels yet."); return; }
    const rows = tunnels.map((t, idx) => {
      const id = t.tunnel_id || t.id || "";
      const s = tunnelEndpoint(t, "source");
      const d = tunnelEndpoint(t, "target");
      const src = `${escapeHtml(s.wing)}/${escapeHtml(s.room)}`;
      const dst = `${escapeHtml(d.wing)}/${escapeHtml(d.room)}`;
      const label = t.label ? `<div class="lab-tunnel-label">${escapeHtml(t.label)}</div>` : "";
      const delBtn = id ? `<button class="icon-button danger-button lab-tunnel-del" data-tunnel-id="${escapeHtml(id)}" type="button">Delete</button>` : "";
      const srcAttr = `data-jump-wing="${escapeHtml(s.wing)}" data-jump-room="${escapeHtml(s.room)}"`;
      const dstAttr = `data-jump-wing="${escapeHtml(d.wing)}" data-jump-room="${escapeHtml(d.room)}"`;
      return `<div class="lab-tunnel" data-tunnel-idx="${idx}">`
        + `<div class="lab-tunnel-route">`
        +   `<button class="lab-tunnel-jump" type="button" ${srcAttr} title="Open ${src}">${src}</button>`
        +   `<span class="lab-arrow">→</span>`
        +   `<button class="lab-tunnel-jump" type="button" ${dstAttr} title="Open ${dst}">${dst}</button>`
        + `</div>`
        + `${label}`
        + `<div class="lab-tunnel-meta"><code>${escapeHtml(id)}</code>${delBtn}</div>`
        + `</div>`;
    }).join("");
    el.innerHTML = `<div class="lab-summary">${tunnels.length} tunnel(s)</div>${rows}`;
    el.querySelectorAll(".lab-tunnel-jump").forEach((btn) => {
      btn.addEventListener("click", () => {
        navigateToRoom(btn.dataset.jumpWing, btn.dataset.jumpRoom);
      });
    });
    el.querySelectorAll(".lab-tunnel-del").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm(`Delete tunnel ${btn.dataset.tunnelId}?`)) return;
        try {
          await postJson("/api/tunnels/delete", { tunnel_id: btn.dataset.tunnelId });
          btn.closest(".lab-tunnel").remove();
        } catch (err) { alert(err.message || err); }
      });
    });
  }

  function renderTaxonomy(target, data) {
    const el = $(target);
    if (!el) return;
    const tax = (data && (data.taxonomy || data.wings)) || data;
    if (!tax || typeof tax !== "object") { renderJson(target, data); return; }
    // tax is expected: { wing: { room: count, ... }, ... }
    const wings = Object.keys(tax).sort();
    if (!wings.length) { renderEmpty(target); return; }
    const html = wings.map((wing) => {
      const rooms = tax[wing] || {};
      if (typeof rooms !== "object") return `<div class="lab-tax-wing"><strong>${escapeHtml(wing)}</strong>: ${escapeHtml(rooms)}</div>`;
      const roomKeys = Object.keys(rooms).sort();
      const total = roomKeys.reduce((sum, r) => sum + (Number(rooms[r]) || 0), 0);
      const items = roomKeys.map((r) => `<li>${escapeHtml(r)} <span class="lab-pill">${escapeHtml(rooms[r])}</span></li>`).join("");
      return `<details class="lab-tax-wing" open><summary><strong>${escapeHtml(wing)}</strong> <span class="lab-pill">${total}</span></summary><ul>${items}</ul></details>`;
    }).join("");
    el.innerHTML = html;
  }

  function renderDiary(target, data) {
    const el = $(target);
    if (!el) return;
    const entries = (data && (data.entries || data.diary || data.drawers || data.items)) || [];
    if (!Array.isArray(entries) || !entries.length) { renderJson(target, data); return; }
    const rows = entries.map((e) => {
      const when = e.filed_at || e.created_at || e.timestamp || "";
      const topic = e.topic || e.room || "";
      const wing = e.wing || "";
      const body = e.content || e.entry || e.text || JSON.stringify(e);
      return `<div class="lab-diary"><div class="lab-diary-head"><span>${escapeHtml(when)}</span><span class="lab-pill">${escapeHtml(wing)}/${escapeHtml(topic)}</span></div><pre class="lab-diary-body">${escapeHtml(body)}</pre></div>`;
    }).join("");
    el.innerHTML = `<div class="lab-summary">${entries.length} entry(ies)</div>${rows}`;
  }

  function renderAaak(target, data) {
    const el = $(target);
    if (!el) return;
    const spec = (data && (data.spec || data.aaak || data.text)) || data;
    const text = typeof spec === "string" ? spec : JSON.stringify(spec, null, 2);
    el.innerHTML = `<pre class="lab-spec">${escapeHtml(text)}</pre>`;
  }

  function renderDup(target, data) {
    const el = $(target);
    if (!el) return;
    const matches = (data && (data.matches || data.duplicates || data.drawers || data.items)) || [];
    if (!Array.isArray(matches) || !matches.length) { renderEmpty(target, "No similar drawers above threshold."); return; }
    const rows = matches.map((m) => {
      const score = m.similarity ?? m.score ?? m.distance ?? "";
      const wing = m.wing ?? "";
      const room = m.room ?? "";
      const id = m.drawer_id || m.id || "";
      const preview = (m.content || m.preview || "").slice(0, 220);
      return `<div class="lab-dup"><div class="lab-dup-head"><strong>${escapeHtml(wing)}/${escapeHtml(room)}</strong> <span class="lab-pill">score ${escapeHtml(score)}</span></div><code>${escapeHtml(id)}</code><pre class="lab-dup-body">${escapeHtml(preview)}</pre></div>`;
    }).join("");
    el.innerHTML = `<div class="lab-summary">${matches.length} match(es)</div>${rows}`;
  }

  // ---------- KG tab ----------
  $("#kgRun").addEventListener("click", () => {
    const entity = v("#kgEntity");
    if (!entity) { renderError("#kgOutput", "entity is required."); return; }
    const params = { entity, direction: $("#kgDirection").value, as_of: v("#kgAsOf") };
    run("#kgOutput", "Querying…", () => fetchJson(`/api/kg/query${qs(params)}`), renderFacts);
  });

  // ---------- Timeline tab ----------
  $("#tlRun").addEventListener("click", () => {
    const entity = v("#tlEntity");
    run("#tlOutput", "Loading…", () => fetchJson(`/api/kg/timeline${qs({ entity })}`), renderTimeline);
  });

  // ---------- Tunnels tab ----------
  $("#tunListRun").addEventListener("click", () => {
    run("#tunListOutput", "Listing…",
      () => fetchJson(`/api/tunnels${qs({ wing: v("#tunListWing") })}`),
      renderTunnels);
  });

  $("#tunCreateRun").addEventListener("click", () => {
    const payload = {
      source_wing: v("#tunCreateSourceWing"),
      source_room: v("#tunCreateSourceRoom"),
      target_wing: v("#tunCreateTargetWing"),
      target_room: v("#tunCreateTargetRoom"),
      label: v("#tunCreateLabel"),
      source_drawer_id: v("#tunCreateSourceDrawer"),
      target_drawer_id: v("#tunCreateTargetDrawer"),
    };
    run("#tunCreateOutput", "Creating…", () => postJson("/api/tunnels", payload));
  });

  $("#tunFindRun").addEventListener("click", () => {
    run("#tunFindOutput", "Searching…",
      () => fetchJson(`/api/tunnels/find${qs({ wing_a: v("#tunFindA"), wing_b: v("#tunFindB") })}`));
  });

  $("#tunFollowRun").addEventListener("click", () => {
    run("#tunFollowOutput", "Following…",
      () => fetchJson(`/api/tunnels/follow${qs({ wing: v("#tunFollowWing"), room: v("#tunFollowRoom") })}`));
  });

  $("#tunTravRun").addEventListener("click", () => {
    run("#tunTravOutput", "Traversing…",
      () => fetchJson(`/api/traverse${qs({ start_room: v("#tunTravRoom"), max_hops: v("#tunTravHops") || "2" })}`));
  });

  // ---------- Diary tab ----------
  $("#diaryReadRun").addEventListener("click", () => {
    const params = {
      agent_name: v("#diaryReadAgent"),
      last_n: v("#diaryReadN") || "10",
      wing: v("#diaryReadWing"),
    };
    if (!params.agent_name) { renderError("#diaryReadOutput", "agent_name is required."); return; }
    run("#diaryReadOutput", "Reading…", () => fetchJson(`/api/diary${qs(params)}`), renderDiary);
  });

  $("#diaryWriteRun").addEventListener("click", () => {
    const payload = {
      agent_name: v("#diaryWriteAgent"),
      entry: v("#diaryWriteEntry"),
      topic: v("#diaryWriteTopic") || "general",
      wing: v("#diaryWriteWing"),
    };
    run("#diaryWriteOutput", "Writing…", () => postJson("/api/diary", payload));
  });

  // ---------- Stats tab ----------
  $("#statsKgRun").addEventListener("click", () => {
    run("#statsOutput", "Loading KG stats…", () => fetchJson("/api/kg/stats"));
  });
  $("#statsGraphRun").addEventListener("click", () => {
    run("#statsOutput", "Loading graph stats…", () => fetchJson("/api/graph/stats"));
  });
  $("#statsCheckpointRun").addEventListener("click", () => {
    run("#statsOutput", "Checking…", () => fetchJson("/api/checkpoint"));
  });

  // ---------- Maintenance tab ----------
  $("#taxonomyRun").addEventListener("click", () => {
    run("#taxonomyOutput", "Loading…", () => fetchJson("/api/taxonomy"), renderTaxonomy);
  });

  $("#dupRun").addEventListener("click", () => {
    const content = v("#dupContent");
    if (!content) { renderError("#dupOutput", "content is required."); return; }
    const threshold = parseFloat(v("#dupThreshold")) || 0.9;
    run("#dupOutput", "Checking…", () => postJson("/api/check-duplicate", { content, threshold }), renderDup);
  });

  $("#hooksLoadRun").addEventListener("click", async () => {
    renderLoading("#hooksOutput", "Loading…");
    try {
      const data = await fetchJson("/api/hooks");
      if (typeof data.silent_save === "boolean") $("#hookSilent").checked = data.silent_save;
      if (typeof data.desktop_toast === "boolean") $("#hookToast").checked = data.desktop_toast;
      renderJson("#hooksOutput", data);
    } catch (err) { renderError("#hooksOutput", err); }
  });

  $("#hooksSaveRun").addEventListener("click", () => {
    const payload = {
      silent_save: $("#hookSilent").checked,
      desktop_toast: $("#hookToast").checked,
    };
    run("#hooksOutput", "Saving…", () => postJson("/api/hooks", payload));
  });

  $("#syncDryRun").addEventListener("click", () => {
    const payload = { apply: false, wing: v("#syncWing"), project_dir: v("#syncDir") };
    run("#syncOutput", "Dry running…", () => postJson("/api/sync", payload));
  });

  $("#syncApplyRun").addEventListener("click", () => {
    if (!confirm("Apply sync — this will delete drawers whose source files are gone. Continue?")) return;
    const payload = { apply: true, wing: v("#syncWing"), project_dir: v("#syncDir") };
    run("#syncOutput", "Applying…", () => postJson("/api/sync", payload));
  });

  $("#reconnectRun").addEventListener("click", () => {
    run("#reconnectOutput", "Reconnecting…", () => postJson("/api/reconnect", {}));
  });

  $("#aaakRun").addEventListener("click", () => {
    run("#aaakOutput", "Loading…", () => fetchJson("/api/aaak-spec"), renderAaak);
  });
})();
