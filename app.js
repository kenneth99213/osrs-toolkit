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
    timers: {}, timerSeed: {}, pets: [],
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
  const TABS = ["next", "stats", "quests", "diaries", "pvm", "slayer", "potions", "trees", "pets", "guilds", "alch"];
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
    const btn = document.querySelector(`#tabs button[data-tab="${tab}"]`);
    if (btn && btn.scrollIntoView) btn.scrollIntoView({ block: "nearest", inline: "center" });
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
    const cls = { Ready: "ready", READY: "ready", Grown: "ready", Close: "close", Almost: "close", Check: "close", Done: "done" }[kind] || "";
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
  const openRows = { quest: new Set(), diary: new Set(), pvm: new Set(), potion: new Set(), tree: new Set(), slayer: new Set(), pet: new Set(), guild: new Set() };
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
  function itemHtml({ id, kind, ticked, cls, title, sub, body, icon }) {
    const open = openRows[kind].has(id);
    const tick = ticked === undefined ? "" :
      `<button class="tick" aria-pressed="${ticked}" aria-label="${ticked ? "Mark not done" : "Mark done"}"><span></span></button>`;
    return `<li class="item ${cls}${open ? " open" : ""}${icon ? " has-icon" : ""}" data-id="${esc(id)}">
      <div class="item-head">${tick}${icon || ""}
        <button class="expand" aria-expanded="${open}"><span class="title">${esc(title)}</span><span class="sub">${sub}</span></button>
      </div><div class="body">${body}</div></li>`;
  }

  // ---------- images from the OSRS Wiki (small thumbnails, loaded only when scrolled into view)
  // Each icon has a list of candidate wiki files. If they're all missing, we ask the wiki's API which
  // image the page itself uses (handles odd file names and redirects), then fall back to initials.
  const WIKI = "https://oldschool.runescape.wiki";
  const wikiImg = (file) => `${WIKI}/w/Special:FilePath/` + encodeURIComponent(file.replace(/ /g, "_")) + "?width=64";
  function iconHtml(name, files, page) {
    const list = files.filter(Boolean).map(wikiImg);
    const initials = name.replace(/[^A-Za-z0-9 ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
    const cached = page ? imgCache[page] : undefined;
    if (cached) list.unshift(cached);                     // remembered from an earlier API lookup
    if (!list.length) return `<span class="ico ico-text" aria-hidden="true">${esc(initials)}</span>`;
    return `<img class="ico" src="${esc(list[0])}" data-next="${esc(list.slice(1).join("|"))}" data-initials="${esc(initials)}" ` +
      `data-page="${esc(cached === "" ? "" : page || "")}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`;
  }
  // page title -> thumbnail URL ("" = the wiki has no image for it), kept between visits
  const IMG_CACHE_KEY = "osrs-toolkit-img-v1";
  let imgCache = {};
  try { imgCache = JSON.parse(localStorage.getItem(IMG_CACHE_KEY) || "{}"); } catch (e) { imgCache = {}; }
  const saveImgCache = () => { try { localStorage.setItem(IMG_CACHE_KEY, JSON.stringify(imgCache)); } catch (e) { /* ignore */ } };
  function toInitials(img) {
    const span = document.createElement("span");
    span.className = "ico ico-text"; span.setAttribute("aria-hidden", "true");
    span.textContent = img.dataset.initials || "";
    img.replaceWith(span);
  }
  // batch API lookups: up to 50 page titles per request
  const pending = new Map(); // title -> [img, ...]
  let lookupTimer = null;
  function lookupPageImage(title, img) {
    if (!pending.has(title)) pending.set(title, []);
    pending.get(title).push(img);
    clearTimeout(lookupTimer);
    lookupTimer = setTimeout(flushLookups, 150);
  }
  async function flushLookups() {
    const titles = [...pending.keys()].slice(0, 50);
    const waiting = titles.map((t) => [t, pending.get(t)]);
    titles.forEach((t) => pending.delete(t));
    if (pending.size) lookupTimer = setTimeout(flushLookups, 150);
    const found = {};
    try {
      const url = `${WIKI}/api.php?action=query&prop=pageimages&piprop=thumbnail&pithumbsize=64&redirects=1` +
        `&format=json&formatversion=2&origin=*&titles=${encodeURIComponent(titles.join("|"))}`;
      const data = await (await fetch(url)).json();
      const q = data.query || {};
      const alias = {};
      for (const r of [...(q.normalized || []), ...(q.redirects || [])]) alias[r.to] = r.from;
      for (const pg of q.pages || []) {
        let t = pg.title;
        const seen = new Set([t]);
        while (alias[t] && !seen.has(alias[t])) { t = alias[t]; seen.add(t); }
        const thumb = pg.thumbnail && pg.thumbnail.source;
        for (const s of seen) found[s] = thumb || "";
      }
    } catch (e) { /* offline or API unavailable: fall through to initials, don't cache */ }
    for (const [title, imgs] of waiting) {
      const url = found[title];
      if (url !== undefined) imgCache[title] = url;
      for (const img of imgs) {
        if (!img.isConnected) continue;
        if (url) { img.dataset.page = ""; img.src = url; } else toInitials(img);
      }
    }
    saveImgCache();
  }
  document.addEventListener("error", (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains("ico")) return;
    const rest = (img.dataset.next || "").split("|").filter(Boolean);
    if (rest.length) { img.dataset.next = rest.slice(1).join("|"); img.src = rest[0]; return; }
    const page = img.dataset.page;
    if (page) {
      img.dataset.page = "";
      if (imgCache[page]) { delete imgCache[page]; saveImgCache(); } // a cached URL went stale
      lookupPageImage(page, img);
      return;
    }
    toInitials(img);
  }, true);

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
    renderTimerPanel($("next-timers"), true);
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
    skillsBuilt = true;
  }

  // These listeners live on the #skills container, which is never replaced, so they're added ONCE.
  // (Adding them inside buildSkills made every rebuild stack another copy, so + went up by 2, 3, ...)
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

  // ---------- boss / monster icons
  // Wiki image names usually match the page name. Raids and minigames have no single NPC image,
  // so they use a picture of a boss inside them, or their pet.
  const PVM_FILE = {
    "Barrows Chests": "Dharok the Wretched.png", "Lunar Chests": "Blood Moon.png", "Nightmare": "The Nightmare.png",
    "Phosani's Nightmare": "Phosani's Nightmare.png", "Mimic": "The Mimic.png", "TzKal-Zuk": "TzKal-Zuk.png",
    "The Royal Titans": "Branda the Fire Queen.png", "Tombs of Amascut": "Tumeken's Warden.png",
    "Tombs of Amascut: Expert Mode": "Elidinis' Warden.png", "Chambers of Xeric": "Great Olm.png",
    "Chambers of Xeric: Challenge Mode": "Great Olm.png", "Theatre of Blood": "Verzik Vitur.png",
    "Theatre of Blood: Hard Mode": "Verzik Vitur.png", "The Gauntlet": "Crystalline Hunllef.png",
    "The Corrupted Gauntlet": "Corrupted Hunllef.png", "Wintertodt": "Wintertodt.png", "Tempoross": "Tempoross.png",
  };
  const PET_IMG = {};
  for (const p of window.OSRS_GUIDES.PETS) PET_IMG[p.name] = p.img || p.name + ".png";
  const PVM_PET = {};
  for (const p of window.OSRS_GUIDES.PETS) for (const [act] of p.src || []) PVM_PET[act] = p.name;
  Object.assign(PVM_PET, {
    "Chambers of Xeric": "Olmlet", "Chambers of Xeric: Challenge Mode": "Olmlet", "Theatre of Blood": "Lil' Zik",
    "Theatre of Blood: Hard Mode": "Lil' Zik", "Tombs of Amascut": "Tumeken's guardian", "Tombs of Amascut: Expert Mode": "Tumeken's guardian",
    "The Gauntlet": "Youngllef", "The Corrupted Gauntlet": "Youngllef", "Nightmare": "Little Nightmare", "Phosani's Nightmare": "Little Nightmare",
    "The Royal Titans": "Bran", "Wintertodt": "Phoenix", "Tempoross": "Tiny tempor", "Doom of Mokhaiotl": "Dom",
    "Maggot King": "Maggot marquess", "Araxxor": "Nid", "Orion": "Orion",
  });
  // monsters whose wiki page isn't simply their name here
  const PVM_PAGE = { "Fossil Island wyvern": "Spitting wyvern", "Mutated zygomite": "Mutated Zygomite", "Sulphur nagua": "Sulphur Nagua" };
  function pvmIcon(name) {
    const info = O.PVM[name] || {};
    const pet = PVM_PET[name];
    return iconHtml(name, [PVM_FILE[name], (info.wiki || name) + ".png", pet && PET_IMG[pet]], PVM_PAGE[name] || info.wiki || name);
  }

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
      return itemHtml({ id: r.name, kind: "pvm", cls, title: r.name, sub, body, icon: pvmIcon(r.name) });
    }).join("") || `<p class="hint">Nothing here.</p>`;
  }
  $("pvm-search").addEventListener("input", () => renderPvm());
  wireList($("pvm-list"), "pvm", () => {});

  // ================================================================ POTIONS
  const G = window.OSRS_GUIDES;
  const HERB_NAMES = new Set(G.HERBS.map(([h]) => h));
  function renderPotions() {
    const a = account, f = state.ui.potions || "all";
    const herb = a.levels.Herblore;
    const ritual = a.questDone("Druidic Ritual");
    const search = $("potion-search").value.trim().toLowerCase();
    const can = (p) => ritual && herb >= p.lvl;
    const all = G.POTIONS;
    const counts = { all: all.length, can: all.filter(can).length,
                     soon: all.filter((p) => !can(p) && p.lvl > herb && p.lvl <= herb + 10).length };
    chips($("potion-chips"), [["all", "All"], ["can", "Can make"], ["soon", "Next 10 levels"]], f, counts,
      (k) => { state.ui.potions = k; save(); renderPotions(); });
    let rows = all;
    if (f === "can") rows = rows.filter(can);
    if (f === "soon") rows = rows.filter((p) => !can(p) && p.lvl > herb && p.lvl <= herb + 10);
    if (search) rows = rows.filter((p) => (p.name + " " + p.ing.join(" ") + " " + p.effect).toLowerCase().includes(search));
    $("potion-status").innerHTML = `Your Herblore: <b>${herb}</b> · ${counts.can} of ${all.length} potions available` +
      (ritual ? "" : ` · <span class="warn">Finish Druidic Ritual to start Herblore</span>`);
    $("potion-list").innerHTML = rows.map((p) => {
      const ok = can(p);
      const status = ok ? "Ready" : p.lvl <= herb + 5 ? "Close" : "Locked";
      const cls = ok ? "is-ready" : status === "Close" ? "is-close" : "is-locked";
      const usesHerb = HERB_NAMES.has(p.ing[0]);
      const recipe = (usesHerb ? ["Vial of water"] : []).concat(p.ing).map(esc).join(" + ");
      const sub = `${statusBadge(status)}<span>Level ${p.lvl}</span><span>· ${fmt(p.xp)} XP</span>` +
        `<span>· ${esc(p.ing.slice(0, 2).join(" + "))}${p.ing.length > 2 ? " + …" : ""}</span>`;
      const body = `<dl>
          <dt>Recipe</dt><dd>${recipe}${usesHerb ? `<br><span class="muted">Herb + vial of water first makes an unfinished potion.</span>` : ""}</dd>
          <dt>Effect</dt><dd>${esc(p.effect)}</dd>
          ${p.note ? `<dt>Note</dt><dd>${esc(p.note)}</dd>` : ""}
          <dt>Needs</dt><dd>${reqList({ skills: { Herblore: p.lvl }, pre: ["Druidic Ritual"] })}</dd>
        </dl><a class="wiki" href="${wikiUrl(p.name)}" target="_blank" rel="noopener">Open wiki page ↗</a>`;
      return itemHtml({ id: p.name, kind: "potion", cls, title: p.name, sub, body });
    }).join("") || `<p class="hint">No potions match.</p>`;
    $("herb-table").innerHTML = G.HERBS.map(([h, lvl]) =>
      `<span class="herb ${herb >= lvl ? "ok" : ""}"><b>${lvl}</b> ${esc(h)}</span>`).join("");
  }
  $("potion-search").addEventListener("input", () => renderPotions());
  wireList($("potion-list"), "potion", () => {});

  // ================================================================ TREES
  const TREE_WIKI = { tree: "Tree patch", fruit: "Fruit tree patch", hardwood: "Hardwood tree patch",
                      calquat: "Calquat tree patch", spirit: "Spirit tree patch", crystal: "Crystal tree patch",
                      celastrus: "Celastrus patch", redwood: "Redwood tree patch" };
  // ---------------------------------------------------------------- tree timers
  // Timers are manual: the game doesn't share patch states with websites. Stored in state.timers:
  // { "tree|Lumbridge": { type: "tree", patch: "Lumbridge", seed: "Magic", start: ms, end: ms, notified: bool } }
  const TYPE = Object.fromEntries(G.TREE_TYPES.map((t) => [t.id, t]));
  function growMinutes(text) {
    if (!text) return null;
    const part = (re) => { const m = re.exec(text); return m ? +m[1] : 0; };
    const mins = part(/(\d+)d/) * 1440 + part(/(\d+)h/) * 60 + part(/(\d+)m/);
    return mins || null;
  }
  function duration(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 1) return "under a minute";
    const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`;
  }
  function clockAt(ms) {
    const d = new Date(ms), now = new Date();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (d.toDateString() === now.toDateString()) return time;
    const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1);
    if (d.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`;
    return `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
  }
  const timerList = () => Object.entries(state.timers || {}).map(([key, t]) => Object.assign({ key }, t))
    .sort((x, y) => x.end - y.end);
  const isGrown = (t) => Date.now() >= t.end;

  function startTimer(key, typeId, seedName) {
    const seed = TYPE[typeId].seeds.find((x) => x[0] === seedName);
    const mins = seed && growMinutes(seed[4]);
    if (!mins) { toast("No growth time known for that seed."); return; }
    const now = Date.now();
    state.timers[key] = { type: typeId, patch: key.split("|")[1], seed: seedName, start: now, end: now + mins * 60000, notified: false };
  }

  function seedOptions(t, farm) {
    const best = t.seeds.filter((x) => farm >= x[1]).pop();
    const chosen = state.timerSeed[t.id] || (best ? best[0] : t.seeds[0][0]);
    return t.seeds.map(([name, lvl, , , grow]) =>
      `<option value="${esc(name)}" ${name === chosen ? "selected" : ""}>${esc(name)} — ${grow || "?"}${farm < lvl ? ` (needs ${lvl})` : ""}</option>`).join("");
  }

  function countdownHtml(t) {
    return isGrown(t)
      ? `<span class="countdown" data-end="${t.end}">Fully grown</span>`
      : `<span class="countdown" data-end="${t.end}">ready in ${duration(t.end - Date.now())}</span>`;
  }
  function barHtml(t) {
    const pct = Math.min(100, Math.max(0, (100 * (Date.now() - t.start)) / (t.end - t.start)));
    return `<div class="bar tbar"><i data-start="${t.start}" data-end="${t.end}" style="width:${pct.toFixed(1)}%"></i></div>`;
  }

  // Panel listing every running timer (Trees tab, and a compact version on Next)
  function renderTimerPanel(el, compact) {
    const list = timerList();
    if (!list.length) {
      el.innerHTML = compact ? "" : `<div class="card timers empty"><b>Tree timers</b>
        <p class="hint">Plant a tree, open its patch below and tap <b>Start timer</b> — or use <b>Start all</b> on a patch type after a tree run.</p></div>`;
      return;
    }
    const grown = list.filter(isGrown).length;
    const rows = (compact ? list.slice(0, 4) : list).map((t) => {
      const typeName = TYPE[t.type] ? TYPE[t.type].name.replace(/ patch(es)?$/, "") : t.type;
      return `<li class="timer ${isGrown(t) ? "grown" : ""}" data-key="${esc(t.key)}">
          <div class="trow"><span class="tname"><b>${esc(t.seed)}</b> · ${esc(t.patch)} <span class="muted">(${esc(typeName)})</span></span>
            <span class="twhen">${countdownHtml(t)}${isGrown(t) ? "" : `<span class="muted"> · ${clockAt(t.end)}</span>`}</span>
            ${compact ? "" : `<button class="tclear" data-act="clear" aria-label="Clear timer">✕</button>`}</div>
          ${barHtml(t)}</li>`;
    }).join("");
    const notifyBtn = !compact && "Notification" in window && Notification.permission === "default"
      ? `<button class="btn small" data-act="notify">🔔 Notify me when grown</button>` : "";
    el.innerHTML = `<div class="card timers">
        <div class="thead"><b>Tree timers</b><span class="muted">${list.length} running${grown ? ` · <span class="grown-n">${grown} ready to check</span>` : ""}</span>
          ${compact ? `<button class="btn small" data-act="goto-trees">Open</button>` :
            `${notifyBtn}${grown ? `<button class="btn small" data-act="clear-grown">Clear grown</button>` : ""}`}</div>
        <ul class="timer-list">${rows}</ul>
        ${compact && list.length > 4 ? `<p class="hint">+${list.length - 4} more on the Trees tab</p>` : ""}
      </div>`;
  }

  function renderTrees() {
    const a = account, f = state.ui.trees || "all";
    const farm = a.levels.Farming;
    const types = G.TREE_TYPES;
    const counts = { all: types.reduce((n, t) => n + t.patches.length, 0) };
    for (const t of types) counts[t.id] = t.patches.length;
    chips($("tree-chips"), [["all", "All"]].concat(types.map((t) => [t.id, t.name.replace(/ patch(es)?$/, "")])), f, counts,
      (k) => { state.ui.trees = k; save(); renderTrees(); });
    renderTimerPanel($("tree-timers"), false);
    let usable = 0;
    const html = types.filter((t) => f === "all" || t.id === f).map((t) => {
      const best = t.seeds.filter((x) => farm >= x[1]).pop();
      const seeds = t.seeds.map(([name, lvl, px, cx, grow, pay]) => `
        <tr class="${farm >= lvl ? "" : "locked"}"><td><b>${esc(name)}</b></td><td>${lvl}</td>
          <td>${px === null ? "—" : fmt(px) + " / " + fmt(cx)}</td><td>${grow ? esc(grow) : "—"}</td><td>${esc(pay)}</td></tr>`).join("");
      let reachable = 0;
      const patches = t.patches.map((p) => {
        const key = t.id + "|" + p.name;
        const [missing, notes] = p.req ? a.check(p.req) : [[], []];
        const ok = missing.length === 0;
        if (ok) { usable++; reachable++; }
        const timer = state.timers[key];
        const label = !ok ? "Locked" : notes.length ? "Check" : "Ready";
        const timerBadge = timer ? (isGrown(timer) ? statusBadge("Grown") : `<span class="badge growing">Growing</span>`) : statusBadge(label);
        const sub = `${timerBadge}` +
          (timer ? `<span>${esc(timer.seed)} · ${countdownHtml(timer)}</span>` : `<span>${esc(p.where)}</span>`) +
          (!timer && !ok ? `<span>· needs ${esc(missing.join(", "))}</span>` : "") +
          (!timer && notes.length ? `<span>· ${esc(notes.join(", "))}</span>` : "");
        const timerCtl = `<div class="timer-ctl" data-key="${esc(key)}" data-type="${t.id}">
            ${timer ? `<div class="tstate">${esc(timer.seed)} planted ${clockAt(timer.start)} · ${countdownHtml(timer)}${isGrown(timer) ? "" : ` (${clockAt(timer.end)})`}</div>${barHtml(timer)}` : ""}
            <div class="row wrap">
              <select class="seed-pick" aria-label="Seed planted">${seedOptions(t, farm)}</select>
              <button class="btn primary" data-act="start">${timer ? "Replant / restart" : "Start timer"}</button>
              ${timer ? `<button class="btn" data-act="clear">Clear</button>` : ""}
            </div></div>`;
        const body = `${timerCtl}<dl>
            <dt>Location</dt><dd>${esc(p.where)}</dd>
            <dt>Gardener</dt><dd>${esc(p.gardener)}</dd>
            <dt>Get there</dt><dd>${esc(p.tele)}</dd>
            <dt>Requires</dt><dd>${p.req ? reqList(p.req) : "None"}</dd>
            ${p.note ? `<dt>Note</dt><dd>${esc(p.note)}</dd>` : ""}
          </dl><a class="wiki" href="${wikiUrl(TREE_WIKI[t.id])}" target="_blank" rel="noopener">Open wiki page ↗</a>`;
        const cls = timer ? (isGrown(timer) ? "is-ready" : "is-close") : label === "Ready" ? "is-ready" : label === "Check" ? "is-close" : "is-locked";
        return itemHtml({ id: key, kind: "tree", cls, title: p.name, sub, body });
      }).join("");
      return `<section class="group">
          <h2>${esc(t.name)} <span class="muted">· ${t.patches.length} patch${t.patches.length === 1 ? "" : "es"}</span></h2>
          <p class="hint">${esc(t.blurb)} ${best ? `Best you can plant: <b>${esc(best[0])}</b>.` : `<span class="warn">Needs ${t.seeds[0][1]} Farming to plant anything.</span>`}</p>
          <div class="table-wrap"><table class="seeds">
            <thead><tr><th>Seed</th><th>Lvl</th><th>XP plant / check</th><th>Grows</th><th>Protect with</th></tr></thead>
            <tbody>${seeds}</tbody></table></div>
          ${reachable > 1 ? `<div class="timer-ctl group-ctl" data-type="${t.id}"><span class="muted">Just did a run?</span>
              <select class="seed-pick" aria-label="Seed planted">${seedOptions(t, farm)}</select>
              <button class="btn" data-act="start-all">Start all ${reachable} reachable</button></div>` : ""}
          <ul class="list">${patches}</ul>
          <p class="hint">Timers are estimates: the game grows ${esc(t.name.toLowerCase())} in ${t.cycle}-minute steps, so it can finish up to ${t.cycle} minutes sooner or later.</p>
        </section>`;
    }).join("");
    $("tree-groups").innerHTML = html;
    $("tree-status").innerHTML = `Your Farming: <b>${farm}</b> · you can reach ${usable} of the patches shown`;
    updateTreeDot();
  }

  function reachablePatches(typeId) {
    return TYPE[typeId].patches.filter((p) => !p.req || account.check(p.req)[0].length === 0);
  }

  function onTimerAction(e) {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "goto-trees") { showTab("trees", true); return; }
    if (act === "notify") {
      Notification.requestPermission().then((p) => { toast(p === "granted" ? "You'll get a notification when a tree is grown." : "Notifications are off."); renderTrees(); });
      return;
    }
    if (act === "clear-grown") {
      for (const t of timerList()) if (isGrown(t)) delete state.timers[t.key];
      save(); refreshTimersEverywhere(); return;
    }
    const ctl = b.closest(".timer-ctl"), row = b.closest("[data-key]");
    if (act === "clear" && row) {
      delete state.timers[row.dataset.key];
      save(); refreshTimersEverywhere(); return;
    }
    if (!ctl) return;
    const typeId = ctl.dataset.type, seed = ctl.querySelector("select").value;
    state.timerSeed[typeId] = seed;
    if (act === "start") {
      startTimer(ctl.dataset.key, typeId, seed);
      toast(`Timer started: ${seed} at ${ctl.dataset.key.split("|")[1]}`);
    }
    if (act === "start-all") {
      const list = reachablePatches(typeId);
      for (const p of list) startTimer(typeId + "|" + p.name, typeId, seed);
      toast(`Started ${list.length} ${seed} timers`);
    }
    save(); refreshTimersEverywhere();
  }
  $("tree-groups").addEventListener("click", onTimerAction);
  $("tree-timers").addEventListener("click", onTimerAction);
  $("next-timers").addEventListener("click", onTimerAction);
  $("tree-groups").addEventListener("change", (e) => {
    const ctl = e.target.closest(".timer-ctl");
    if (ctl && e.target.matches("select")) { state.timerSeed[ctl.dataset.type] = e.target.value; save(); }
  });

  function refreshTimersEverywhere() {
    renderTrees();
    renderTimerPanel($("next-timers"), true);
  }
  function updateTreeDot() {
    const btn = document.querySelector('#tabs button[data-tab="trees"]');
    if (btn) btn.classList.toggle("has-dot", timerList().some(isGrown));
  }

  // Tick: update countdowns in place, and re-render once when a tree finishes
  function notifyGrown(t) {
    const msg = `${t.seed} at ${t.patch} is fully grown`;
    toast("🌳 " + msg);
    if ("Notification" in window && Notification.permission === "granted") {
      const opts = { body: "Time to check its health and harvest.", icon: "icons/icon-192.png", tag: t.key };
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then((r) => r.showNotification(msg, opts)).catch(() => {});
      } else {
        try { new Notification(msg, opts); } catch (err) { /* some browsers only allow SW notifications */ }
      }
    }
  }
  function timerTick() {
    let changed = false;
    for (const t of timerList()) {
      if (isGrown(t) && !t.notified) {
        state.timers[t.key].notified = true;
        changed = true;
        notifyGrown(t);
      }
    }
    if (changed) { save(); refreshTimersEverywhere(); return; }
    document.querySelectorAll(".countdown[data-end]").forEach((el) => {
      const end = +el.dataset.end;
      el.textContent = Date.now() >= end ? "Fully grown" : `ready in ${duration(end - Date.now())}`;
    });
    document.querySelectorAll(".tbar i[data-start]").forEach((el) => {
      const s0 = +el.dataset.start, e0 = +el.dataset.end;
      el.style.width = Math.min(100, Math.max(0, (100 * (Date.now() - s0)) / (e0 - s0))).toFixed(1) + "%";
    });
  }
  setInterval(timerTick, 20000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") timerTick(); });

  wireList($("tree-groups"), "tree", () => {});

  // ================================================================ SLAYER
  const MASTER = Object.fromEntries(G.MASTERS.map((m) => [m.id, m]));
  function taskReq(t) {
    const r = t.req || {};
    return { skills: Object.assign({ Slayer: t.slayer }, r.skills || {}), pre: r.pre, started: r.started, combat: t.combat };
  }
  function renderSlayer() {
    const a = account, f = state.ui.slayer || "all";
    const search = $("slayer-search").value.trim().toLowerCase();
    const mine = $("slayer-mine").checked;
    let rows = G.TASKS.map((t) => {
      const [missing, notes] = a.check(taskReq(t));
      return { t, ok: missing.length === 0, missing, notes, codes: t.masters.split(" ") };
    });
    const counts = { all: rows.length };
    for (const m of G.MASTERS) counts[m.id] = rows.filter((r) => r.codes.includes(m.id)).length;
    chips($("slayer-chips"), [["all", "All tasks"]].concat(G.MASTERS.map((m) => [m.id, m.name.split(" / ")[0].replace(" quo Maten", "")])),
      f, counts, (k) => { state.ui.slayer = k; save(); renderSlayer(); });
    const m = MASTER[f];
    $("slayer-master").innerHTML = m ? `<div class="card master"><b>${esc(m.name)}</b> · ${esc(m.where)}<br>
        <span class="muted">Requirement: ${esc(m.req)}</span></div>` : "";
    if (m) rows = rows.filter((r) => r.codes.includes(f));
    if (mine) rows = rows.filter((r) => r.ok);
    if (search) rows = rows.filter((r) => (r.t.name + " " + r.t.locs.join(" ")).toLowerCase().includes(search));
    const canDo = G.TASKS.filter((t) => a.check(taskReq(t))[0].length === 0).length;
    $("slayer-status").innerHTML = `Your Slayer: <b>${a.levels.Slayer}</b> · Combat <b>${a.combat}</b> · ` +
      `you meet the requirements for ${canDo} of ${G.TASKS.length} tasks`;
    $("slayer-list").innerHTML = rows.map(({ t, ok, missing, notes, codes }) => {
      const status = ok ? (notes.length ? "Check" : "Ready") : missing.length <= 1 ? "Close" : "Locked";
      const cls = status === "Ready" ? "is-ready" : status === "Locked" ? "is-locked" : "is-close";
      const sub = `${statusBadge(status)}<span>Slayer ${t.slayer}</span>` +
        (notes.length ? `<span>· ${esc(notes.join(", "))}</span>` : "") +
        `<span>· ${esc(t.locs[0])}${t.locs.length > 1 ? ` +${t.locs.length - 1} more` : ""}</span>` +
        (!ok ? `<span>· needs ${esc(missing.slice(0, 2).join(", "))}${missing.length > 2 ? "…" : ""}</span>` : "");
      const masters = codes.map((c) => MASTER[c].name).join(", ");
      const body = `<dl>
          <dt>${t.konar ? "Locations" : "Where"}</dt><dd><ul class="locs">${t.locs.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
            ${t.konar ? `<span class="muted">Konar picks one of these for you.</span>` : ""}</dd>
          <dt>Requires</dt><dd>${reqList(taskReq(t))}</dd>
          ${t.note ? `<dt>Bring / note</dt><dd>${esc(t.note)}</dd>` : ""}
          <dt>Assigned by</dt><dd>${esc(masters)}</dd>
        </dl><a class="wiki" href="${wikiUrl("Slayer task/" + t.name)}" target="_blank" rel="noopener">Open wiki page ↗</a>`;
      return itemHtml({ id: t.name, kind: "slayer", cls, title: t.name, sub, body,
                        icon: iconHtml(t.name, [(t.npc || t.name) + ".png"], t.npc || t.name) });
    }).join("") || `<p class="hint">No tasks match.</p>`;
  }
  $("slayer-search").addEventListener("input", () => renderSlayer());
  $("slayer-mine").addEventListener("change", (e) => { state.ui.slayerMine = e.target.checked; save(); renderSlayer(); });
  $("slayer-mine").checked = !!state.ui.slayerMine;
  wireList($("slayer-list"), "slayer", () => {});

  // ================================================================ PETS
  function petOdds(p) {
    // chance an average player would have this pet by now, from synced kill counts
    if (!p.src) return null;
    let kc = 0, miss = 1;
    for (const [act, n] of p.src) {
      const k = state.kc[act] || 0;
      kc += k;
      miss *= Math.pow(1 - 1 / n, k);
    }
    return kc ? { kc, pct: (1 - miss) * 100 } : null;
  }
  function renderPets() {
    const f = state.ui.pets || "all";
    const owned = new Set((state.pets || []).map(O.norm));
    const has = (p) => owned.has(O.norm(p.name));
    const all = G.PETS;
    const logPets = all.filter((p) => p.cat !== "Generic");
    const counts = { all: all.length, todo: all.filter((p) => !has(p)).length, owned: all.filter(has).length };
    for (const c of ["Boss", "Skilling", "Other", "Generic"]) counts[c] = all.filter((p) => p.cat === c).length;
    chips($("pet-chips"), [["all", "All"], ["todo", "Still need"], ["owned", "Owned"], ["Boss", "Boss"],
      ["Skilling", "Skilling"], ["Other", "Other"], ["Generic", "Generic"]], f, counts,
      (k) => { state.ui.pets = k; save(); renderPets(); });
    const search = $("pet-search").value.trim().toLowerCase();
    let rows = all;
    if (f === "todo") rows = rows.filter((p) => !has(p));
    else if (f === "owned") rows = rows.filter(has);
    else if (f !== "all") rows = rows.filter((p) => p.cat === f);
    if (search) rows = rows.filter((p) => (p.name + " " + p.from).toLowerCase().includes(search));
    const logOwned = logPets.filter(has).length;
    $("pet-summary").innerHTML = `<div class="tile"><div class="big">${logOwned}<small> / ${logPets.length}</small></div>
        <div class="lbl">Collection log pets</div><div class="bar"><i style="width:${(100 * logOwned / logPets.length).toFixed(1)}%"></i></div></div>
      <div class="tile"><div class="big">${all.filter((p) => p.cat === "Generic" && has(p)).length}<small> / ${counts.Generic}</small></div>
        <div class="lbl">Generic pets</div><div class="bar"><i style="width:${(100 * all.filter((p) => p.cat === "Generic" && has(p)).length / counts.Generic).toFixed(1)}%"></i></div></div>`;
    $("pet-list").innerHTML = rows.map((p) => {
      const got = has(p);
      const odds = got ? null : petOdds(p);
      const dry = odds ? `<span>· ${fmt(odds.kc)} KC · ${odds.pct < 1 ? "<1" : Math.round(odds.pct)}% would have it by now</span>` : "";
      const sub = `${got ? statusBadge("Done") : `<span class="badge">${esc(p.cat)}</span>`}<span>${esc(p.from)}</span>${dry}`;
      const body = `<dl>
          <dt>From</dt><dd>${esc(p.from)}</dd>
          <dt>Drop rate</dt><dd>${esc(p.rate)}</dd>
          ${odds ? `<dt>Your luck</dt><dd>${fmt(odds.kc)} kill count — ${odds.pct.toFixed(1)}% of players would have it by now${odds.pct >= 63.2 ? " (you're past the drop rate — dry!)" : ""}</dd>` : ""}
          ${p.cat === "Generic" ? `<dt>Note</dt><dd>Not part of the collection log.</dd>` : ""}
        </dl><a class="wiki" href="${wikiUrl(p.name)}" target="_blank" rel="noopener">Open wiki page ↗</a>`;
      return itemHtml({ id: p.name, kind: "pet", ticked: got, cls: got ? "is-done" : "", title: p.name, sub, body,
                        icon: iconHtml(p.name, [p.img || p.name + ".png"], p.name) });
    }).join("") || `<p class="hint">No pets match.</p>`;
  }
  $("pet-search").addEventListener("input", () => renderPets());
  wireList($("pet-list"), "pet", (name) => {
    state.pets = state.pets || [];
    toggleIn(state.pets, name);
    save(); renderPets();
    if (state.pets.some((x) => O.norm(x) === O.norm(name))) toast(`🐾 ${name} added to your pets`);
  });

  // ================================================================ GUILDS
  const GUILD_ITEM = { "Cooks' Guild": "wear a chef's hat (or an alternative)", "Crafting Guild": "wear a brown apron (or an alternative)" };
  function guildStatus(g) {
    const a = account;
    let missing = [];
    if (g.req.attstr) {
      const sum = a.levels.Attack + a.levels.Strength;
      if (sum < g.req.attstr && a.levels.Attack < 99 && a.levels.Strength < 99) missing.push(`Attack + Strength ${sum}/${g.req.attstr}`);
    } else {
      missing = a.check(g.req)[0];
    }
    const ok = missing.length === 0;
    // "Close" only when the one thing missing is a level within 5
    const gap = missing.length === 1 && /(\d+)\/(\d+)$/.exec(missing[0]);
    const close = gap && +gap[2] - +gap[1] <= 5 && !/QP|quest points/i.test(missing[0]);
    const label = !ok ? (close ? "Close" : "Locked") : GUILD_ITEM[g.name] ? "Check" : "Ready";
    return { ok, missing, label };
  }
  function renderGuilds() {
    const f = state.ui.guilds || "all";
    const all = G.GUILDS.map((g) => Object.assign({ g }, guildStatus(g)));
    const counts = { all: all.length, can: all.filter((r) => r.ok).length, locked: all.filter((r) => !r.ok).length,
                     f2p: all.filter((r) => !r.g.members).length, members: all.filter((r) => r.g.members).length };
    chips($("guild-chips"), [["all", "All"], ["can", "Can enter"], ["locked", "Locked"], ["f2p", "Free-to-play"], ["members", "Members"]],
      f, counts, (k) => { state.ui.guilds = k; save(); renderGuilds(); });
    let rows = all;
    if (f === "can") rows = rows.filter((r) => r.ok);
    if (f === "locked") rows = rows.filter((r) => !r.ok);
    if (f === "f2p") rows = rows.filter((r) => !r.g.members);
    if (f === "members") rows = rows.filter((r) => r.g.members);
    $("guild-status").innerHTML = `You can enter <b>${counts.can}</b> of ${all.length} guilds`;
    $("guild-list").innerHTML = rows.map(({ g, ok, missing, label }) => {
      const cls = label === "Ready" ? "is-ready" : label === "Locked" ? "is-locked" : "is-close";
      const sub = `${statusBadge(label)}<span>${g.members ? "Members" : "F2P"} · ${esc(g.region)}</span>` +
        (!ok ? `<span>· needs ${esc(missing.join(", "))}</span>` : GUILD_ITEM[g.name] ? `<span>· ${esc(GUILD_ITEM[g.name])}</span>` : "");
      const req = g.req.attstr
        ? `<span class="req"><span class="${ok ? "ok" : "miss"}">${esc(g.reqText)}</span></span>`
        : `${reqList(g.req)}<br><span class="muted">${esc(g.reqText)}</span>`;
      const body = `<dl>
          <dt>Location</dt><dd>${esc(g.where)}</dd>
          <dt>Requires</dt><dd>${req}</dd>
          <dt>Get there</dt><dd><ul class="locs">${g.tele.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></dd>
          <dt>Inside</dt><dd><ul class="locs">${g.features.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></dd>
        </dl><a class="wiki" href="${wikiUrl(g.name)}" target="_blank" rel="noopener">Open wiki page ↗</a>`;
      return itemHtml({ id: g.name, kind: "guild", cls, title: g.name, sub, body });
    }).join("") || `<p class="hint">No guilds match.</p>`;
  }
  wireList($("guild-list"), "guild", () => {});

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
    renderSlayer();
    renderPotions();
    renderTrees();
    renderPets();
    renderGuilds();
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
      if (!desktop) { state.pets = data.pets || []; state.timers = data.timers || {}; state.timerSeed = data.timerSeed || {}; }
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
  timerTick();
  if (state.autoSync && state.rsn) sync(true);

  if ("serviceWorker" in navigator && window.isSecureContext) {
    // When an update you pushed to GitHub takes over, reload once so it shows straight away.
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
      .then((reg) => reg.update())
      .catch(() => {});
  }
})();
