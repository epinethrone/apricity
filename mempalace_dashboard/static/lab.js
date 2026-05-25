// MemPalace Tools — wires the Tools sheet to write/destructive ops and a
// few advanced read queries. Read-style browsing (tunnel list, diary read)
// moved into the main UI in 0.5.0 (chips on room rows; diary as a wing).
// Depends on fetchJson / postJson / loadTunnels defined in app.js.
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

  // Tell app.js to re-fetch tunnels and re-render chips on room rows. Done
  // via a window function call (loadTunnels is exposed by app.js) so the
  // two scripts stay loosely coupled.
  function notifyTunnelsChanged() {
    if (typeof window.loadTunnels === "function") window.loadTunnels();
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
  // Browse / Find / Follow panes were removed in 0.5.0 — chips on each room
  // nav row now show the same connections inline. Only the write path
  // (create) and the advanced multi-hop traverse query remain here.

  $("#tunCreateRun").addEventListener("click", async () => {
    const payload = {
      source_wing: v("#tunCreateSourceWing"),
      source_room: v("#tunCreateSourceRoom"),
      target_wing: v("#tunCreateTargetWing"),
      target_room: v("#tunCreateTargetRoom"),
      label: v("#tunCreateLabel"),
      source_drawer_id: v("#tunCreateSourceDrawer"),
      target_drawer_id: v("#tunCreateTargetDrawer"),
    };
    renderLoading("#tunCreateOutput", "Creating…");
    try {
      const result = await postJson("/api/tunnels", payload);
      renderJson("#tunCreateOutput", result);
      notifyTunnelsChanged();
    } catch (err) { renderError("#tunCreateOutput", err); }
  });

  $("#tunTravRun").addEventListener("click", () => {
    run("#tunTravOutput", "Traversing…",
      () => fetchJson(`/api/traverse${qs({ start_room: v("#tunTravRoom"), max_hops: v("#tunTravHops") || "2" })}`));
  });

  // ---------- Diary tab ----------
  // Read pane was removed in 0.5.0 — diary is now browsable as a regular
  // wing (wing_{agent}) from the sidebar. Only the write op remains here.

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
