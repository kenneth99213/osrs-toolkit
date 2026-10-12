// OSRS Toolkit - web app UI. Data in data.js, advice logic in logic.js.
(function () {
  "use strict";
  const O = window.OSRS;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => (n === null || n === undefined ? "—" : Number(n).toLocaleString("en-US"));
  const wikiUrl = (title) => "https://oldschool.runescape.wiki/w/" + encodeURIComponent(String(title).replace(/ /g, "_"));
  const sortName = (n) => O.norm(n.startsWith("The ") ? n.slice(4) : n);

  // ================================================================ state & storage
  const STORE_KEY = "osrs-toolkit-v1";
  const DEFAULT_STATE = () => ({
    v: 1, levels: {}, xp: {}, done: [], diaryDone: [], kc: {},
    rsn: "", proxy: "", autoSync: false, lastSync: null,
    ui: { tab: "next", quests: "notdone", diaries: "notdone", pvm: "all" },
    alch: { minProfit: 1, minVol: 0, mode: "instant", sort: "profit", members: true },
  });
  let state = load();

  function load() {
    const base = DEFAULT_STATE();
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return base;
      const s = JSON.parse(raw);
      return Object.assign(base, s, { ui: Object.assign(base.ui, s.ui), alch: Object.assign(base.alch, s.alch) });
    } catch (e) {
      return base;
    }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private mode etc. */ }
  }

  function levelOf(skill) {
    const v = parseInt(state.levels[skill], 10);
    return Number.isFinite(v) ? Math.min(99, Math.max(O.minLevel(skill), v)) : O.minLevel(skill);
  }

  let account = null;
  function rebuild() {
    const levels = {};
    for (const s of O.SKILLS) levels[s] = levelOf(s);
    account = new O.Account({ xp: state.xp, levels, done: state.done, diaryDone: state.diaryDone, kc: state.kc });
  }

  function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 2600);
  }

  // ================================================================ tabs
  const TABS = ["next", "stats", "quests", "diaries", "pvm", "alch"];
  function showTab(tab, push) {
    if (!TABS.includes(tab)) tab = "next";
    state.ui.tab = tab;
    save();
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + tab));
    document.querySelectorAll("#tabs button").forEach((b) => {
      if (b.dataset.tab === tab) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    if (push && location.hash !== "#" + tab) history.replaceState(null, "", "#" + tab);
    if (tab === "alch") alchStart();
    window.scrollTo({ top: 0 });
  }
  $("tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (b) showTab(b.dataset.tab, true);
  });
  window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));

  // ================================================================ shared pieces
  function chips(el, options, current, counts, onPick) {
    el.innerHTML = options.map(([key, label]) =>
      `<button class="chip" data-key="${key}" aria-pressed="${key === current}">${esc(label)}` +
      (counts && counts[key] !== undefined ? `<span class="n">${counts[key]}</span>` : "") + `</button>`).join("");
    el.onclick = (e) => {
      const b = e.target.closest(".chip");
      if (b) onPick(b.dataset.key);
    };
  }

  function statusBadge(kind) {
    const cls = { Ready: "ready", READY: "ready", Close: "close", Almost: "close", Done: "done" }[kind] || "";
    return `<span class="badge ${cls}">${esc(kind)}</span>`;
  }

  // requirement list with ✓ / ✗ marks
  function reqList(info) {
    const a = account, out = [];
    for (const [s, need] of Object.entries(info.skills || {})) {
      const ok = a.levels[s] >= need;
      out.push(`<span class="${ok ? "ok" : "miss"}">${esc(s)} ${need}${ok ? "" : ` (you ${a.levels[s]})`}</span>`);
    }
    for (const q of info.pre || []) out.push(`<span class="${a.questDone(q) ? "ok" : "miss"}">${esc(q)}</span>`);
    for (const q of info.started || []) out.push(`<span class="${a.questDone(q) ? "ok" : ""}">${esc(q)} (started)</span>`);
    if (info.qp) out.push(`<span class="${a.qp >= info.qp ? "ok" : "miss"}">${info.qp} quest points</span>`);
    if (info.combat) out.push(`<span class="${a.combat >= info.combat ? "ok" : "miss"}">Combat ${info.combat}</span>`);
    if (info.slayer) out.push(`<span class="${a.levels.Slayer >= info.slayer ? "ok" : "miss"}">Slayer ${info.slayer}</span>`);
    return out.length ? `<span class="req">${out.join(", ")}</span>` : "None";
  }

  // expanding rows: remember which are open per list
  const openRows = { quest: new Set(), diary: new Set(), pvm: new Set() };
  function wireList(el, kind, onTick) {
    el.onclick = (e) => {
      const item = e.target.closest(".item");
      if (!item) return;
      const id = item.dataset.id;
      if (e.target.closest(".tick")) { onTick(id); return; }
      if (e.target.closest(".expand")) {
        const open = !item.classList.contains("open");
        item.classList.toggle("open", open);
        item.querySelector(".expand").setAttribute("aria-expanded", open);
        if (open) openRows[kind].add(id); else openRows[kind].delete(id);
      }
    };
  }
  function itemHtml({ id, kind, ticked, cls, title, sub, body }) {
    const open = openRows[kind].has(id);
    const tick = ticked === undefined ? "" :
      `<button class="tick" aria-pressed="${ticked}" aria-label="${ticked ? "Mark not done" : "Mark done"}"><span></span></button>`;
    return `<li class="item ${cls}${open ? " open" : ""}" data-id="${esc(id)}">
      <div class="item-head">${tick}
        <button class="expand" aria-expanded="${open}"><span class="title">${esc(title)}</span><span class="sub">${sub}</span></button>
      </div><div class="body">${body}</div></li>`;
  }

  function toggleIn(list, value) {
    const k = O.norm(value);
    const i = list.findIndex((x) => O.norm(x) === k);
    if (i >= 0) list.splice(i, 1); else list.push(value);
  }

  // ================================================================ header + NEXT
  function renderHeader() {
    const a = account;
    const total = O.SKILLS.reduce((t, s) => t + a.levels[s], 0);
    $("pills").innerHTML =
      `<span class="pill">Combat <b>${a.combat}</b></span><span class="pill">Total <b>${total}</b></span>` +
      `<span class="pill">QP <b>${a.qp}</b>/${O.TOTAL_QP}</span>`;
  }

  function renderNext() {
    const a = account;
    const qDone = Object.keys(O.QUESTS).filter((q) => a.questDone(q)).length;
    const mDone = Object.keys(O.MINIQUESTS).filter((q) => a.questDone(q)).length;
    const ds = a.diarySummary();
    const dDone = Object.values(ds).reduce((x, y) => x + y, 0);
    const nQ = Object.keys(O.QUESTS).length, nM = Object.keys(O.MINIQUESTS).length;
    const nD = Object.keys(O.DIARIES).length * O.DIARY_TIERS.length;
    const tile = (big, of, lbl) =>
      `<div class="tile"><div class="big">${big}<small> / ${of}</small></div><div class="lbl">${lbl}</div>` +
      `<div class="bar"><i style="width:${(100 * big / of).toFixed(1)}%"></i></div></div>`;
    $("tiles").innerHTML = tile(qDone, nQ, "Quests") + tile(a.qp, O.TOTAL_QP, "Quest points") +
      tile(mDone, nM, "Miniquests") + tile(dDone, nD, "Diary tiers");
    $("steps").innerHTML = a.nextSteps(12).map((s) =>
      `<li><a href="${wikiUrl(s.link)}" target="_blank" rel="noopener"><span class="badge kind">${esc(s.kind)}</span>` +
      `<span class="txt">${esc(s.text)}</span></a></li>`).join("");
    const fresh = !Object.keys(state.levels).length && !state.done.length;
    $("first-run").hidden = !fresh;
  }

  // ================================================================ SKILLS
  let skillsBuilt = false;
  function buildSkills() {
    $("skills").innerHTML = O.SKILLS.map((s) => `
      <div class="skill" data-skill="${s}">
        <div class="skill-top">
          <a class="skill-name" href="${wikiUrl(`Pay-to-play ${s} training`)}" target="_blank" rel="noopener">${s}</a>
          <div class="stepper">
            <button data-step="-1" aria-label="Lower ${s}">−</button>
            <input type="number" inputmode="numeric" min="${O.minLevel(s)}" max="99" value="${levelOf(s)}" aria-label="${s} level">
            <button data-step="1" aria-label="Raise ${s}">+</button>
          </div>
        </div>
        <div class="bar"><i></i></div>
        <div class="lines"></div>
      </div>`).join("");
    const setLevel = (skill, value, input) => {
      const lvl = Math.min(99, Math.max(O.minLevel(skill), parseInt(value, 10) || O.minLevel(skill)));
      if (input && String(lvl) !== input.value && document.activeElement !== input) input.value = lvl;
      if (levelOf(skill) === lvl && state.levels[skill] !== undefined) return;
      state.levels[skill] = lvl;
      delete state.xp[skill]; // a typed level replaces synced XP
      save();
      scheduleRefresh();
    };
    $("skills").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-step]");
      if (!b) return;
      const card = b.closest(".skill"), input = card.querySelector("input"), s = card.dataset.skill;
      const v = Math.min(99, Math.max(O.minLevel(s), levelOf(s) + Number(b.dataset.step)));
      input.value = v;
      setLevel(s, v, input);
    });
    $("skills").addEventListener("input", (e) => {
      if (e.target.matches("input")) {
        const s = e.target.closest(".skill").dataset.skill;
        if (e.target.value !== "") setLevel(s, e.target.value);
      }
    });
    $("skills").addEventListener("change", (e) => {
      if (e.target.matches("input")) {
        const s = e.target.closest(".skill").dataset.skill;
        e.target.value = levelOf(s);
        setLevel(s, e.target.value, e.target);
      }
    });
    skillsBuilt = true;
  }

  function renderSkills() {
    if (!skillsBuilt) buildSkills();
    for (const r of account.skillRows()) {
      const card = $("skills").querySelector(`[data-skill="${r.skill}"]`);
      const input = card.querySelector("input");
      if (document.activeElement !== input) input.value = r.level;
      card.querySelector(".bar i").style.width = r.pct.toFixed(1) + "%";
      card.classList.toggle("maxed", r.level >= 99);
      card.classList.toggle("blocking", r.blockers.length > 0 && r.level < 99);
      const lines = [];
      if (r.level >= 99) lines.push(`<div>Maxed — nice.</div>`);
      else {
        lines.push(`<div><span>Now:</span> ${esc(r.method)}${r.rate ? ` (~${Math.round(r.rate / 1000)}k/hr)` : ""}${r.note ? ` <span>· ${esc(r.note)}</span>` : ""}</div>`);
        if (r.nextUnlock) lines.push(`<div><span>Next:</span> ${esc(r.nextUnlock)}</div>`);
        if (r.questTarget) lines.push(`<div><span>Target:</span> ${esc(r.questTarget)}</div>`);
        lines.push(`<div><span>${fmt(r.toNext)} XP to ${r.level + 1}${r.hours !== null ? ` · ~${fmt(Math.round(r.hours))} hrs to 99` : ""}</span></div>`);
      }
      card.querySelector(".lines").innerHTML = lines.join("");
    }
  }

  // ================================================================ QUESTS
  function renderQuests() {
    const a = account, f = state.ui.quests;
    const search = $("quest-search").value.trim().toLowerCase();
    let rows = a.questRows();
    const counts = {
      notdone: rows.filter((r) => !r.done).length, ready: rows.filter((r) => r.ready).length,
      all: rows.length, done: rows.filter((r) => r.done).length,
      f2p: rows.filter((r) => r.f2p).length, members: rows.filter((r) => !r.f2p && !r.mini).length,
      mini: rows.filter((r) => r.mini).length,
    };
    chips($("quest-chips"), [["notdone", "To do"], ["ready", "Ready"], ["all", "All A–Z"], ["done", "Done"],
      ["f2p", "F2P"], ["members", "Members"], ["mini", "Miniquests"]], f, counts,
      (k) => { state.ui.quests = k; save(); renderQuests(); });
    const keep = {
      notdone: (r) => !r.done, ready: (r) => r.ready, all: () => true, done: (r) => r.done,
      f2p: (r) => r.f2p, members: (r) => !r.f2p && !r.mini, mini: (r) => r.mini,
    }[f] || (() => true);
    rows = rows.filter(keep).filter((r) => !search || r.name.toLowerCase().includes(search));
    if (!["notdone", "ready"].includes(f)) rows.sort((x, y) => (sortName(x.name) < sortName(y.name) ? -1 : 1));
    $("quest-count").textContent =
      `${counts.done - Object.keys(O.MINIQUESTS).filter((q) => a.questDone(q)).length} / ${Object.keys(O.QUESTS).length} quests · ` +
      `${Object.keys(O.MINIQUESTS).filter((q) => a.questDone(q)).length} / ${Object.keys(O.MINIQUESTS).length} miniquests · ` +
      `${a.qp} / ${O.TOTAL_QP} QP`;
    $("quest-list").innerHTML = rows.map((r) => {
      const status = r.done ? "Done" : r.ready ? "Ready" : (r.missing.length <= 2 ? "Close" : "Locked");
      const cls = r.done ? "is-done" : r.ready ? "is-ready" : status === "Close" ? "is-close" : "is-locked";
      const type = r.mini ? "Miniquest" : r.f2p ? "F2P" : "Members";
      const xp = Object.entries(r.xp).map(([k, v]) => `${fmt(v)} ${esc(k)}`).join(", ");
      const sub = `${statusBadge(status)}<span>${type}</span>` + (r.mini ? "" : `<span>· ${r.qpReward} QP</span>`) +
        (!r.done && !r.ready && r.missing.length ? `<span>· needs ${esc(r.missing.slice(0, 2).join(", "))}${r.missing.length > 2 ? "…" : ""}</span>` : "") +
        (r.ready && r.totalXp ? `<span>· ${fmt(r.totalXp)} XP</span>` : "");
      const body = `<dl>
          <dt>Requires</dt><dd>${reqList(r.info)}</dd>
          ${xp ? `<dt>XP</dt><dd>${xp}</dd>` : ""}
          ${r.unlock ? `<dt>Unlocks</dt><dd>${esc(r.unlock)}</dd>` : ""}
        </dl><a class="wiki" href="${wikiUrl(r.name)}" target="_blank" rel="noopener">Open wiki page ↗</a>`;
      return itemHtml({ id: r.name, kind: "quest", ticked: r.done, cls, title: r.name, sub, body });
    }).join("") || `<p class="hint">Nothing here.</p>`;
  }
  $("quest-search").addEventListener("input", () => renderQuests());
  wireList($("quest-list"), "quest", (name) => { toggleIn(state.done, name); save(); refresh(); });

  // ================================================================ DIARIES
  function renderDiaries() {
    const a = account, f = state.ui.diaries;
    let rows = a.diaryRows();
    const sum = a.diarySummary(), n = Object.keys(O.DIARIES).length;
    $("diary-summary").innerHTML = O.DIARY_TIERS.map((t) =>
      `<div class="tile"><div class="big">${sum[t]}<small>/${n}</small></div><div class="lbl">${t}</div></div>`).join("");
    const counts = { notdone: rows.filter((r) => !r.done).length, ready: rows.filter((r) => r.ready).length,
                     done: rows.filter((r) => r.done).length, region: rows.length };
    chips($("diary-chips"), [["notdone", "To do"], ["ready", "Ready"], ["done", "Done"], ["region", "By region"]],
      f, counts, (k) => { state.ui.diaries = k; save(); renderDiaries(); });
    if (f === "notdone") rows = rows.filter((r) => !r.done);
    if (f === "ready") rows = rows.filter((r) => r.ready);
    if (f === "done") rows = rows.filter((r) => r.done);
    if (f === "region") {
      const order = Object.keys(O.DIARIES);
      rows.sort((x, y) => order.indexOf(x.region) - order.indexOf(y.region) || x.tierIndex - y.tierIndex);
    }
    $("diary-list").innerHTML = rows.map((r) => {
      const status = r.done ? "Done" : r.ready ? "Ready" : (r.missing.length <= 2 ? "Close" : "Locked");
      const cls = r.done ? "is-done" : r.ready ? "is-ready" : status === "Close" ? "is-close" : "is-locked";
      const sub = `${statusBadge(status)}<span>${fmt(r.lamp)} XP lamp</span>` +
        (!r.done && r.missing.length ? `<span>· needs ${esc(r.missing.slice(0, 2).join(", "))}${r.missing.length > 2 ? "…" : ""}</span>` : "") +
        (r.notes.length && !r.done ? `<span>· ${esc(r.notes.join(", "))}</span>` : "");
      const body = `<dl><dt>Requires</dt><dd>${reqList(r.info)}</dd>
          <dt>Rewards</dt><dd>${esc(r.unlock)}</dd></dl>
          <a class="wiki" href="${wikiUrl(r.region + " Diary")}" target="_blank" rel="noopener">Open wiki page ↗</a>`;
      return itemHtml({ id: O.diaryKey(r.region, r.tier), kind: "diary", ticked: r.done, cls,
                        title: `${r.region} — ${r.tier}`, sub, body });
    }).join("") || `<p class="hint">Nothing here.</p>`;
  }
  wireList($("diary-list"), "diary", (key) => { toggleIn(state.diaryDone, key); save(); refresh(); });

  // ================================================================ PVM
  function renderPvm() {
    const a = account, f = state.ui.pvm;
    const search = $("pvm-search").value.trim().toLowerCase();
    let rows = a.pvmRows();
    const kinds = { boss: ["Boss"], slayer: ["Slayer"], training: ["Training"], raid: ["Raid"],
                    wild: ["Wilderness"], skilling: ["Skilling"] };
    const counts = { all: rows.length, ready: rows.filter((r) => r.status === "Ready").length };
    for (const [k, v] of Object.entries(kinds)) counts[k] = rows.filter((r) => v.includes(r.kind)).length;
    chips($("pvm-chips"), [["all", "All"], ["ready", "Ready"], ["boss", "Bosses"], ["slayer", "Slayer"],
      ["training", "Training"], ["raid", "Raids"], ["wild", "Wilderness"], ["skilling", "Skilling"]], f, counts,
      (k) => { state.ui.pvm = k; save(); renderPvm(); });
    if (f === "ready") rows = rows.filter((r) => r.status === "Ready");
    else if (kinds[f]) rows = rows.filter((r) => kinds[f].includes(r.kind));
    if (search) rows = rows.filter((r) => r.name.toLowerCase().includes(search));
    $("pvm-count").textContent = `${rows.length} shown · ${counts.ready} of ${counts.all} ready for you` +
      (Object.keys(state.kc).length ? "" : " · kill counts show after a hiscores sync");
    $("pvm-list").innerHTML = rows.map((r) => {
      const cls = { Ready: "is-ready", Almost: "is-close", Locked: "is-locked", Later: "is-locked" }[r.status];
      const lv = r.style === "skill" ? "Skilling boss" : `${esc(r.style)} · rec ${r.rec} · you ${r.mine}`;
      const sub = `<span class="badge">${esc(r.kind)}</span>${statusBadge(r.status)}<span>${lv}</span>` +
        (r.kc !== null ? `<span>· ${fmt(r.kc)} KC</span>` : "");
      const info = O.PVM[r.name];
      const body = `<dl>
          <dt>Requires</dt><dd>${reqList(info)}</dd>
          ${r.problems.length ? `<dt>Still needed</dt><dd>${esc(r.problems.join(", "))}</dd>` : ""}
          ${r.note || r.onTask ? `<dt>Notes</dt><dd>${esc(r.note)}${r.onTask ? `${r.note ? " · " : ""}Slayer task only` : ""}</dd>` : ""}
        </dl><a class="wiki" href="${wikiUrl(r.wiki)}" target="_blank" rel="noopener">Open wiki page ↗</a>`;
      return itemHtml({ id: r.name, kind: "pvm", cls, title: r.name, sub, body });
    }).join("") || `<p class="hint">Nothing here.</p>`;
  }
  $("pvm-search").addEventListener("input", () => renderPvm());
  wireList($("pvm-list"), "pvm", () => {});

  // ================================================================ refresh everything
  let refreshTimer = null;
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 250);
  }
  function refresh() {
    rebuild();
    renderHeader();
    renderNext();
    renderSkills();
    renderQuests();
    renderDiaries();
    renderPvm();
  }

  // ================================================================ SYNC (hiscores + WikiSync)
  const HISCORE_URL = (n) => `https://secure.runescape.com/m=hiscore_oldschool/index_lite.json?player=${encodeURIComponent(n)}`;
  const WIKISYNC_URL = (n) => `https://sync.runescape.wiki/runelite/player/${encodeURIComponent(n)}/STANDARD`;

  async function fetchJson(url, viaProxy) {
    const proxy = (state.proxy || "").trim().replace(/\/+$/, "");
    const target = viaProxy && proxy ? `${proxy}/?url=${encodeURIComponent(url)}` : url;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(target, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      if (!res.ok) { const e = new Error(`HTTP ${res.status}`); e.status = res.status; throw e; }
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }
  const why = (e) => e.status === 404 ? "player not found" : e.status === "no data" ? "unexpected response" :
    e.status ? `error ${e.status}` : e.name === "AbortError" ? "timed out" : "blocked by the browser";

  async function sync(quiet) {
    const name = $("rsn").value.trim();
    state.rsn = name; save();
    if (!name) { if (!quiet) $("sync-status").textContent = "Type your RuneScape name first."; return; }
    const btn = $("sync-btn");
    btn.disabled = true;
    $("sync-status").textContent = "Syncing…";
    const parts = [];
    let hiscoresOk = false;
    try {
      const data = await fetchJson(HISCORE_URL(name), true);
      if (!Array.isArray(data.skills) || !data.skills.length) throw Object.assign(new Error("bad data"), { status: "no data" });
      let n = 0;
      for (const s of data.skills) {
        if (O.SKILLS.includes(s.name) && s.xp >= 0) { state.xp[s.name] = s.xp; state.levels[s.name] = O.levelForXp(s.xp); n++; }
      }
      state.kc = {};
      for (const act of data.activities || []) if (act.name && act.score >= 0) state.kc[act.name] = act.score;
      hiscoresOk = true;
      const k = Object.keys(state.kc).length;
      parts.push(`✓ hiscores: ${n} skill level${n === 1 ? "" : "s"}, ${k} kill count${k === 1 ? "" : "s"}` +
                 (n < O.SKILLS.length ? ` (${O.SKILLS.length - n} skills too low to be ranked — kept your typed levels)` : ""));
    } catch (e) {
      parts.push(`✗ hiscores: ${why(e)}`);
    }
    try {
      const data = await fetchJson(WIKISYNC_URL(name), true);
      if (!data.quests && !data.levels) throw Object.assign(new Error("bad data"), { status: 404 });
      let q = 0, d = 0;
      const byNorm = new Map(Object.keys(O.ALL_QUESTS).map((k) => [O.norm(k), k]));
      for (const [qn, st] of Object.entries(data.quests || {})) {
        const k = byNorm.get(O.norm(qn));
        if (k && st === 2 && !state.done.some((x) => O.norm(x) === O.norm(k))) { state.done.push(k); q++; }
      }
      const regions = new Map(Object.keys(O.DIARIES).map((r) => [O.norm(r), r]));
      for (const [region, tiers] of Object.entries(data.achievement_diaries || {})) {
        const r = regions.get(O.norm(region));
        if (!r || typeof tiers !== "object") continue;
        for (const [tier, info] of Object.entries(tiers)) {
          const complete = info && typeof info === "object" ? info.complete : !!info;
          const key = O.diaryKey(r, tier);
          if (complete && O.DIARY_TIERS.includes(tier) && !state.diaryDone.some((x) => O.norm(x) === O.norm(key))) {
            state.diaryDone.push(key); d++;
          }
        }
      }
      if (!hiscoresOk && data.levels) {
        for (const [s, lvl] of Object.entries(data.levels)) if (O.SKILLS.includes(s)) { state.levels[s] = lvl; delete state.xp[s]; }
      }
      parts.push(`✓ WikiSync: ${q} new quest${q === 1 ? "" : "s"}, ${d} new diar${d === 1 ? "y" : "ies"} ticked` +
                 (hiscoresOk ? "" : ", levels updated"));
    } catch (e) {
      parts.push(`✗ WikiSync: ${e.status === 400 || e.status === 404 ? "no data (install the WikiSync RuneLite plugin and log in)" : why(e)}`);
    }
    if (parts.some((p) => p.startsWith("✓"))) state.lastSync = new Date().toISOString();
    save();
    btn.disabled = false;
    const blocked = parts.some((p) => p.includes("blocked by the browser"));
    $("sync-status").innerHTML = parts.map(esc).join("<br>") +
      (blocked && !state.proxy ? `<br><span class="muted">The game's servers don't allow websites to read them directly. ` +
       `Add a free proxy in the settings below (see README) to enable live sync — or just type your levels.</span>` : "") +
      (state.lastSync ? `<br><span class="muted">Last successful sync: ${new Date(state.lastSync).toLocaleString()}</span>` : "");
    refresh();
  }
  $("sync-btn").addEventListener("click", () => sync(false));
  $("rsn").addEventListener("keydown", (e) => { if (e.key === "Enter") sync(false); });
  $("rsn").addEventListener("change", () => { state.rsn = $("rsn").value.trim(); save(); });
  $("auto-sync").addEventListener("change", (e) => { state.autoSync = e.target.checked; save(); });
  $("proxy").addEventListener("change", (e) => { state.proxy = e.target.value.trim(); save(); });

  // ================================================================ backup / import / reset
  $("export-btn").addEventListener("click", () => {
    const { ui, ...data } = state;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `osrs-toolkit-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $("import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const desktop = Array.isArray(data.quest_log) || Array.isArray(data.diary_log);
      const levels = data.levels || {};
      const done = desktop ? data.quest_log || [] : data.done || [];
      const diaryDone = desktop ? data.diary_log || [] : data.diaryDone || [];
      if (!confirm(`Import ${Object.keys(levels).length} levels, ${done.length} quests and ${diaryDone.length} diary tiers? ` +
                   `This replaces what's in the app now.`)) return;
      state.levels = {};
      for (const [s, v] of Object.entries(levels)) if (O.SKILLS.includes(s)) state.levels[s] = parseInt(v, 10);
      state.xp = desktop ? {} : data.xp || {};
      state.done = done.map((q) => (q === "Hero's Quest" ? "Heroes' Quest" : q));
      state.diaryDone = diaryDone;
      state.kc = desktop ? {} : data.kc || {};
      if (data.username || data.rsn) state.rsn = data.username || data.rsn;
      save(); skillsBuilt = false; $("rsn").value = state.rsn; refresh();
      toast(desktop ? "Imported from the desktop app" : "Backup restored");
    } catch (err) {
      toast("That file couldn't be read as a backup.");
    }
  });
  $("reset-btn").addEventListener("click", () => {
    if (!confirm("Clear all your levels, quests, diaries and settings from this browser?")) return;
    state = DEFAULT_STATE(); save(); skillsBuilt = false;
    $("rsn").value = ""; $("proxy").value = ""; $("auto-sync").checked = false;
    refresh(); showTab("stats", true); toast("Everything cleared");
  });

  // ================================================================ HIGH ALCH TRACKER
  const PRICES = "https://prices.runescape.wiki/api/v1/osrs";
  const NATURE_RUNE = 561, CASTS_PER_HOUR = 1200, ALCH_REFRESH = 60;
  const alch = { mapping: null, latest: {}, hourly: {}, started: false, fetching: false, next: 0, updated: null, error: null };

  function alchStart() {
    if (alch.started) return;
    alch.started = true;
    for (const [id, key] of [["alch-min-profit", "minProfit"], ["alch-min-vol", "minVol"]]) {
      $(id).value = state.alch[key];
      $(id).addEventListener("input", (e) => { state.alch[key] = e.target.value; save(); renderAlch(); });
    }
    for (const [id, key] of [["alch-mode", "mode"], ["alch-sort", "sort"]]) {
      $(id).value = state.alch[key];
      $(id).addEventListener("change", (e) => { state.alch[key] = e.target.value; save(); renderAlch(); });
    }
    $("alch-members").checked = state.alch.members;
    $("alch-members").addEventListener("change", (e) => { state.alch.members = e.target.checked; save(); renderAlch(); });
    $("alch-search").addEventListener("input", () => renderAlch());
    alchFetch();
  }

  async function alchFetch() {
    if (alch.fetching) return;
    alch.fetching = true;
    alch.next = Date.now() + ALCH_REFRESH * 1000;
    alchStatus();
    try {
      const get = (p) => fetchJson(`${PRICES}/${p}`, false);
      if (!alch.mapping) alch.mapping = await get("mapping");
      const [latest, hourly] = await Promise.all([get("latest"), get("1h")]);
      alch.latest = latest.data || {};
      alch.hourly = hourly.data || {};
      alch.updated = new Date();
      alch.error = null;
      renderAlch();
    } catch (e) {
      alch.error = navigator.onLine === false ? "You're offline" : `Couldn't load prices (${why(e)})`;
    }
    alch.fetching = false;
    alchStatus();
  }

  function natureRunePrice() {
    const p = alch.latest[NATURE_RUNE] || {};
    return p.high || p.low || null;
  }

  function alchRows() {
    const nat = natureRunePrice();
    if (!alch.mapping || !nat) return [];
    const minProfit = parseInt(state.alch.minProfit, 10), minVol = parseInt(state.alch.minVol, 10) || 0;
    const instant = state.alch.mode === "instant";
    const search = $("alch-search").value.trim().toLowerCase();
    const now = Date.now() / 1000;
    const rows = [];
    for (const item of alch.mapping) {
      const alchValue = item.highalch;
      if (!alchValue) continue;
      if (item.members && !state.alch.members) continue;
      if (search && !item.name.toLowerCase().includes(search)) continue;
      const p = alch.latest[item.id];
      if (!p) continue;
      const buy = instant ? p.high : p.low, ts = instant ? p.highTime : p.lowTime;
      if (!buy) continue;
      const profit = alchValue - buy - nat;
      if (Number.isFinite(minProfit) && profit < minProfit) continue;
      const h = alch.hourly[item.id] || {};
      const volume = (h.highPriceVolume || 0) + (h.lowPriceVolume || 0);
      if (volume < minVol) continue;
      const limit = item.limit || null;
      const casts = limit ? Math.min(CASTS_PER_HOUR, limit) : CASTS_PER_HOUR;
      rows.push({ id: item.id, name: item.name, buy, alch: alchValue, profit, roi: (profit / (buy + nat)) * 100,
                  limit, limitProfit: limit ? profit * limit : null, hourly: profit * casts, volume,
                  age: ts ? now - ts : null, members: !!item.members });
    }
    const key = state.alch.sort;
    rows.sort((a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity));
    return rows;
  }

  const ago = (s) => s === null ? "—" : s < 60 ? `${Math.floor(s)}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : `${Math.floor(s / 3600)}h ago`;

  function renderAlch() {
    const rows = alchRows();
    alch.shown = rows.length;
    const shown = rows.slice(0, 150);
    $("alch-list").innerHTML = shown.map((r, i) => `
      <li class="item ${r.profit >= 1000 ? "is-ready" : ""}">
        <div class="item-head">
          <span class="rank">${i + 1}</span>
          <a class="expand" href="https://prices.runescape.wiki/osrs/item/${r.id}" target="_blank" rel="noopener">
            <span class="title">${esc(r.name)}</span>
            <span class="sub">${r.members ? "Members" : "F2P"} · ${ago(r.age)}</span>
          </a>
          <span class="profit ${r.profit < 0 ? "neg" : ""}">${r.profit >= 0 ? "+" : ""}${fmt(r.profit)}</span>
        </div>
        <div class="nums">
          <span>GE <b>${fmt(r.buy)}</b></span><span>Alch <b>${fmt(r.alch)}</b></span><span>ROI <b>${r.roi.toFixed(1)}%</b></span>
          <span>Limit <b>${fmt(r.limit)}</b></span><span>GP/hr <b>${fmt(r.hourly)}</b></span><span>Vol 1h <b>${fmt(r.volume)}</b></span>
        </div>
      </li>`).join("") ||
      (alch.mapping ? `<p class="hint">No items match these filters.</p>` : "");
    alchStatus();
  }

  function alchStatus() {
    if (!alch.started) return;
    const parts = [];
    const nat = natureRunePrice();
    if (nat) parts.push(`Nature rune ${fmt(nat)} gp`);
    if (alch.mapping) parts.push(`${fmt(alch.shown || 0)} items${(alch.shown || 0) > 150 ? " (top 150 shown)" : ""}`);
    if (alch.updated) parts.push(`updated ${alch.updated.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
    parts.push(alch.fetching ? "loading…" : `next refresh in ${Math.max(0, Math.round((alch.next - Date.now()) / 1000))}s`);
    if (alch.error) parts.push(`⚠ ${alch.error}`);
    $("alch-status").textContent = parts.join(" · ");
  }

  setInterval(() => {
    if (!alch.started || document.visibilityState !== "visible") return;
    if (!alch.fetching && Date.now() >= alch.next) alchFetch();
    else alchStatus();
  }, 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && alch.started && Date.now() >= alch.next) alchFetch();
  });

  // another tab/window changed the saved data: pick it up instead of overwriting it
  window.addEventListener("storage", (e) => {
    if (e.key !== STORE_KEY) return;
    state = load(); skillsBuilt = false; refresh();
  });

  // ================================================================ start
  $("rsn").value = state.rsn || "";
  $("proxy").value = state.proxy || "";
  $("auto-sync").checked = !!state.autoSync;
  refresh();
  showTab(location.hash ? location.hash.slice(1) : state.ui.tab);
  if (state.lastSync) $("sync-status").textContent = `Last successful sync: ${new Date(state.lastSync).toLocaleString()}`;
  if (state.autoSync && state.rsn) sync(true);

  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
