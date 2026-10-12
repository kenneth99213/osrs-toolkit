// OSRS Toolkit - advice logic (no UI code here, so it can be tested on its own).
// A straight port of the Account class from the desktop Python app.
(function (root) {
  "use strict";
  const D = root.OSRS_DATA || (typeof require !== "undefined" ? loadDataForNode() : null);
  const { SKILLS, QUESTS, MINIQUESTS, DIARY_TIERS, DIARIES, PVM, METHODS } = D;

  function loadDataForNode() {
    // In Node (tests), data.js sets window.OSRS_DATA; give it a window to write to.
    global.window = global.window || {};
    require("./data.js");
    return global.window.OSRS_DATA;
  }

  // ------------------------------------------------------------- XP maths
  const XP_TABLE = (() => {
    const table = [0, 0];
    let points = 0;
    for (let lvl = 1; lvl < 99; lvl++) {
      points += Math.floor(lvl + 300 * Math.pow(2, lvl / 7));
      table.push(Math.floor(points / 4));
    }
    return table; // table[level] = XP needed for that level
  })();
  const XP_99 = XP_TABLE[99];

  function levelForXp(xp) {
    for (let lvl = 99; lvl > 0; lvl--) if (xp >= XP_TABLE[lvl]) return lvl;
    return 1;
  }

  function combatLevel(lv) {
    const base = 0.25 * (lv.Defence + lv.Hitpoints + Math.floor(lv.Prayer / 2));
    const melee = 0.325 * (lv.Attack + lv.Strength);
    const rng = 0.325 * Math.floor((lv.Ranged * 3) / 2);
    const mag = 0.325 * Math.floor((lv.Magic * 3) / 2);
    return Math.floor(base + Math.max(melee, rng, mag));
  }

  const norm = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const diaryKey = (region, tier) => `${region}|${tier}`;
  const minLevel = (skill) => (skill === "Hitpoints" ? 10 : 1);

  // Quests and miniquests share one "done" list; miniquests give no quest points.
  const ALL_QUESTS = Object.assign({}, QUESTS);
  for (const [name, info] of Object.entries(MINIQUESTS)) {
    ALL_QUESTS[name] = Object.assign({}, info, { mini: true, qp_reward: 0 });
  }
  const TOTAL_QP = Object.values(QUESTS).reduce((a, q) => a + q.qp_reward, 0);

  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  // Compare arrays like Python tuples
  const tupleCmp = (a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const c = typeof a[i] === "boolean" ? cmp(+a[i], +b[i]) : cmp(a[i], b[i]);
      if (c) return c;
    }
    return a.length - b.length;
  };
  const sortBy = (arr, keyFn) =>
    arr.map((v, i) => [keyFn(v), i, v]).sort((x, y) => tupleCmp(x[0], y[0]) || x[1] - y[1]).map((x) => x[2]);

  // ------------------------------------------------------------- account model
  class Account {
    /**
     * @param {object} opts
     *   xp        {skill: xp}     (use levels instead if you only know levels)
     *   levels    {skill: level}
     *   done      [quest/miniquest names]
     *   diaryDone ["Region|Tier", ...]
     *   kc        {boss: kill count}
     */
    constructor(opts = {}) {
      this.xp = {};
      this.levels = {};
      for (const s of SKILLS) {
        let x = opts.xp ? opts.xp[s] : undefined;
        if (x === undefined || x === null || x < 0) {
          const lvl = Math.min(99, Math.max(minLevel(s), (opts.levels && opts.levels[s]) || minLevel(s)));
          x = XP_TABLE[lvl];
        }
        this.xp[s] = x;
        this.levels[s] = levelForXp(x);
      }
      this.done = new Set((opts.done || []).map(norm));
      this.qp = sum(Object.entries(QUESTS).filter(([q]) => this.done.has(norm(q))).map(([, i]) => i.qp_reward));
      this.combat = combatLevel(this.levels);
      this.diariesDone = new Set((opts.diaryDone || []).map(norm));
      this.kc = opts.kc || {};
    }

    // ---------- shared requirement check: [blocking missing things, non-blocking notes]
    check(info) {
      const missing = [], notes = [];
      for (const [skill, need] of Object.entries(info.skills || {})) {
        if (this.levels[skill] < need) missing.push(`${skill} ${this.levels[skill]}/${need}`);
      }
      for (const pre of info.pre || []) if (!this.questDone(pre)) missing.push(pre);
      if (this.qp < (info.qp || 0)) missing.push(`${info.qp} QP (you have ${this.qp})`);
      if (this.combat < (info.combat || 0)) missing.push(`Combat ${this.combat}/${info.combat}`);
      for (const q of info.started || []) if (!this.questDone(q)) notes.push(`start ${q}`);
      return [missing, notes];
    }

    // ---------- quests & miniquests
    questDone(q) { return this.done.has(norm(q)); }

    questStatus(q) {
      const [missing, notes] = this.check(ALL_QUESTS[q]);
      return [missing.length === 0, missing.concat(notes)];
    }

    questRows() {
      const rows = [];
      for (const [q, info] of Object.entries(ALL_QUESTS)) {
        const done = this.questDone(q);
        const [ready, missing] = done ? [false, []] : this.questStatus(q);
        const xp = Object.assign({}, info.xp || {});
        if (info.lamp) xp.Lamp = info.lamp;
        const totalXp = sum(Object.values(xp));
        const score = totalXp + (info.value || 1) * 15000; // unlocks count for a lot
        rows.push({ name: q, done, ready, missing, xp, mini: !!info.mini, f2p: !!info.f2p,
                    qpReward: info.qp_reward, totalXp, unlock: info.unlock || "", score, info });
      }
      return sortBy(rows, (r) => [r.done, !r.ready, r.ready ? -r.score : r.missing.length]);
    }

    // ---------- achievement diaries
    diaryDone(region, tier) { return this.diariesDone.has(norm(diaryKey(region, tier))); }

    diaryRows() {
      const rows = [];
      for (const [region, tiers] of Object.entries(DIARIES)) {
        DIARY_TIERS.forEach((tier, i) => {
          const info = tiers[tier];
          const done = this.diaryDone(region, tier);
          const [missing, notes] = done ? [[], []] : this.check(info);
          rows.push({ region, tier, tierIndex: i, done, ready: !done && missing.length === 0,
                      missing, notes, lamp: info.lamp || 0, unlock: info.unlock || "", info });
        });
      }
      return sortBy(rows, (r) => [r.done, !r.ready, r.tierIndex, r.missing.length, r.region]);
    }

    diarySummary() {
      const out = {};
      for (const t of DIARY_TIERS) out[t] = 0;
      for (const region of Object.keys(DIARIES))
        for (const t of DIARY_TIERS) out[t] += this.diaryDone(region, t) ? 1 : 0;
      return out;
    }

    // ---------- what each skill level unlocks
    targets() {
      const out = {};
      for (const [q, info] of Object.entries(ALL_QUESTS)) if (!this.questDone(q)) out[q] = info;
      for (const [region, tiers] of Object.entries(DIARIES))
        for (const t of DIARY_TIERS)
          if (!this.diaryDone(region, t)) out[`${region} ${t} diary`] = tiers[t];
      return out;
    }

    skillBlockers() {
      const out = {};
      for (const [label, info] of Object.entries(this.targets())) {
        for (const [skill, need] of Object.entries(info.skills || {})) {
          if (this.levels[skill] < need) (out[skill] = out[skill] || []).push([need, label]);
        }
      }
      for (const s of Object.keys(out)) out[s] = sortBy(out[s], (b) => b);
      return out;
    }

    // ---------- skills
    static methodsFor(skill) { return METHODS[skill] || []; }

    bestMethod(skill, level) {
      const lvl = level === undefined ? this.levels[skill] : level;
      let best = null;
      for (const m of Account.methodsFor(skill)) if (m[0] <= lvl && m[2] > 0 && (!best || m[2] > best[2])) best = m;
      return best;
    }

    nextMethod(skill) {
      const lvl = this.levels[skill];
      const best = this.bestMethod(skill);
      const rate = best ? best[2] : 0;
      let next = null;
      for (const m of Account.methodsFor(skill)) if (m[0] > lvl && m[2] > rate && (!next || m[0] < next[0])) next = m;
      return next;
    }

    hoursTo99(skill) {
      if (!Account.methodsFor(skill).length || skill === "Hitpoints") return null;
      let hours = 0;
      const xp = this.xp[skill];
      for (let lvl = this.levels[skill]; lvl < 99; lvl++) {
        const m = this.bestMethod(skill, lvl);
        if (!m) return null;
        const seg = XP_TABLE[lvl + 1] - Math.max(xp, XP_TABLE[lvl]);
        if (seg > 0) hours += seg / m[2];
      }
      return hours;
    }

    skillRows() {
      const blockers = this.skillBlockers();
      return SKILLS.map((s) => {
        const lvl = this.levels[s], xp = this.xp[s];
        const best = this.bestMethod(s), nxt = this.nextMethod(s);
        const b = blockers[s] || [];
        return {
          skill: s, level: lvl, xp,
          toNext: lvl < 99 ? XP_TABLE[lvl + 1] - xp : 0,
          to99: Math.max(0, XP_99 - xp),
          pct: Math.min(100, (xp / XP_99) * 100),
          method: best ? best[1] : s === "Hitpoints" ? "Comes from combat" : "See wiki guide",
          rate: best ? best[2] : 0,
          note: best ? best[3] : "",
          nextUnlock: nxt ? `${nxt[0]}: ${nxt[1]} (~${Math.floor(nxt[2] / 1000)}k/hr)` : "",
          questTarget: b.length ? `${b[0][0]} for ${b[0][1]}` + (b.length > 1 ? ` (+${b.length - 1} more)` : "") : "",
          blockers: b,
          hours: this.hoursTo99(s),
        };
      });
    }

    // ---------- PvM
    styleLevel(style) {
      const lv = this.levels;
      if (style === "melee") return Math.floor((lv.Attack + lv.Strength + lv.Defence) / 3);
      if (style === "ranged") return Math.floor((lv.Ranged * 2 + lv.Defence) / 3);
      if (style === "magic") return Math.floor((lv.Magic * 2 + lv.Defence) / 3);
      return Math.max(...["melee", "ranged", "magic"].map((s) => this.styleLevel(s)));
    }

    pvmRows() {
      const rows = [];
      const bestStyle = Math.max(...["melee", "ranged", "magic"].map((s) => this.styleLevel(s)));
      for (const [name, info] of Object.entries(PVM)) {
        const style = info.style;
        const generic = style === "any" || style === "skill";
        const mine = generic ? bestStyle : this.styleLevel(style);
        const effective = generic ? mine : Math.max(mine, bestStyle - 5);
        const [problems, notes] = this.check(info);
        if (this.levels.Slayer < (info.slayer || 0)) problems.unshift(`Slayer ${this.levels.Slayer}/${info.slayer}`);
        const gap = info.rec - effective;
        const status = problems.length ? "Locked" : gap <= 0 ? "Ready" : gap <= 8 ? "Almost" : "Later";
        const kc = this.kc[name];
        rows.push({ name, kind: info.kind, style, rec: info.rec, mine: style === "skill" ? null : mine, gap,
                    status, problems: problems.concat(notes), note: info.note || "", onTask: !!info.on_task,
                    slayer: info.slayer || 0, kc: kc !== undefined && kc >= 0 ? kc : null, wiki: info.wiki || name });
      }
      const order = { Ready: 0, Almost: 1, Locked: 2, Later: 3 };
      return sortBy(rows, (r) => [order[r.status], r.status === "Ready" ? -r.rec : r.gap, -r.slayer]);
    }

    // ---------- summary: [{score, kind, text, link}]
    nextSteps(limit = 8) {
      let steps = [];
      for (const r of this.questRows()) {
        if (!r.ready) continue;
        const xp = r.totalXp ? `${r.totalXp.toLocaleString("en-US")} XP` : "no XP";
        const extra = r.unlock ? ` — ${r.unlock}` : "";
        steps.push({ score: r.score - (r.mini ? 5000 : 0), kind: r.mini ? "Mini" : "Quest",
                     text: `${r.name} (${xp})${extra}`, link: r.name });
      }
      for (const r of this.diaryRows()) {
        if (!r.ready) continue;
        const note = r.notes.length ? ` (${r.notes.join(", ")})` : "";
        steps.push({ score: 30000 + r.lamp - r.tierIndex * 5000, kind: "Diary",
                     text: `${r.region} ${r.tier}: ${r.lamp.toLocaleString("en-US")} XP lamp — ${r.unlock}${note}`,
                     link: `${r.region} Diary` });
      }
      const targets = this.targets();
      for (const [s, blocks] of Object.entries(this.skillBlockers())) {
        const target = blocks[0][0];
        const gap = target - this.levels[s];
        if (gap > 15) continue;
        const labels = blocks.filter(([n]) => n <= target).map(([, l]) => l);
        // only "unlocks" it if this skill is the last thing it's missing
        const full = labels.filter((l) => this.check(targets[l])[0].length === 1);
        const partial = labels.filter((l) => !full.includes(l));
        const few = (arr) => arr.slice(0, 4).join(", ") + (arr.length > 4 ? " …" : "");
        let text = `${s} ${this.levels[s]} → ${target}: `;
        if (full.length) {
          text += "unlocks " + full.join(", ");
          if (partial.length) text += "; also needed for " + few(partial);
        } else {
          text += "needed for " + few(partial);
        }
        steps.push({ score: 25000 - gap * 2000 + full.length * 20000 + partial.length * 3000,
                     kind: "Train", text, link: `Pay-to-play ${s} training` });
      }
      // PvM gets its own reserved spots so it never gets crowded out by quests
      const pvmSteps = [];
      const ready = this.pvmRows().filter((r) => r.status === "Ready");
      const boss = ready.filter((r) => (r.kind === "Boss" || r.kind === "Raid") && !r.onTask);
      const slay = ready.filter((r) => r.kind === "Slayer" || r.kind === "Training");
      if (boss.length) {
        const top = boss[0];
        pvmSteps.push({ score: 0, kind: "PvM", link: top.wiki,
                        text: `Boss: ${top.name} (${top.style})` + (top.note ? ` — ${top.note}` : "") });
      }
      if (slay.length) {
        const top = slay.reduce((a, b) => (tupleCmp([b.rec, b.slayer], [a.rec, a.slayer]) > 0 ? b : a));
        pvmSteps.push({ score: 0, kind: "PvM", link: top.wiki,
                        text: `${top.kind}: ${top.name}` + (top.slayer ? ` (Slayer ${top.slayer})` : "") +
                              (top.note ? ` — ${top.note}` : "") });
      }
      steps = sortBy(steps, (t) => [-t.score]);
      return steps.slice(0, Math.max(0, limit - pvmSteps.length)).concat(pvmSteps);
    }
  }

  const api = { Account, XP_TABLE, XP_99, levelForXp, combatLevel, norm, diaryKey, minLevel,
                ALL_QUESTS, TOTAL_QP, SKILLS, QUESTS, MINIQUESTS, DIARIES, DIARY_TIERS, PVM, METHODS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.OSRS = api;
})(typeof window !== "undefined" ? window : globalThis);
