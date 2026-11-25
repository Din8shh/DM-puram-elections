import { STRINGS } from "./i18n.js";
import { hasTelugu, searchKey, translit, voterKey } from "./translit.js";

const CFG = window.APP_CONFIG || {};
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const main = $("#main");
const LEANINGS = ["strong", "leaning", "undecided", "opposed", "unknown"];
const PAGE = 40;
const BASE_COLS = "serial,ward,hamlet_id,name,name_en,relation_type,relation_name,age,gender,house_no,epic,photo_path," +
  "needs_review,phone,leaning,contacted,notes,needs_transport,away,assigned_to,voted,voted_at,updated_at,slip_delivered,follow_up_on";
// Transport columns exist only after supabase/migrations/004_transport.sql has been run; boot() checks.
let hasTransport = false;
let VOTER_COLS = BASE_COLS;
const TRAVEL = ["unknown", "coming", "needs_help", "not_coming"];

// ───────── small helpers ─────────
const store = {
  get(k, d) { try { const v = localStorage.getItem("dmp." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("dmp." + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
let lang = store.get("lang", "te");
const t = (k) => (STRINGS[lang] && STRINGS[lang][k]) || STRINGS.en[k] || k;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtTime = (iso) => iso ? new Date(iso).toLocaleString(lang === "te" ? "te-IN" : "en-IN",
  { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const pct = (a, b) => b ? Math.round((a / b) * 100) : 0;
// Today's date in India, as YYYY-MM-DD (for follow-ups).
const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

let toastTimer;
function toast(msg, isErr = false) {
  const el = $("#toast");
  el.textContent = msg;
  el.className = "show" + (isErr ? " err" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), isErr ? 4000 : 1800);
}
function fail(error) {
  console.error(error);
  toast(navigator.onLine ? `${t("err")}: ${error?.message || error}` : t("offline"), true);
}

// ───────── state ─────────
let sb = null;
let me = null;              // profile row
let hamlets = [];           // [{id,name_te,name_en}]
let team = [];              // profiles
const photoCache = new Map();
const isSuper = () => me?.role === "superadmin";
const isAdmin = () => me?.role === "admin" || isSuper();
const canAssign = () => isAdmin() || me?.role === "incharge";
const canTransport = canAssign;
let vehicles = [];          // poll-day vehicles
async function loadVehicles() {
  if (!hasTransport) return;
  const { data } = await sb.from("vehicles").select("*").order("id");
  vehicles = data || [];
}
const vehicleName = (id) => vehicles.find((x) => x.id === id)?.label || "";
const hamletName = (id) => { const h = hamlets.find((x) => x.id === id); return h ? (lang === "te" ? h.name_te : h.name_en || h.name_te) : ""; };
const personName = (id) => team.find((p) => p.id === id)?.full_name || "";
const pollMode = () => store.get("pollMode", false);

function leanChip(l) {
  return l && l !== "unknown" ? `<span class="chip ${l}">${esc(t("lean_" + l))}</span>` : "";
}

async function photoUrls(paths) {
  const need = [...new Set(paths.filter((p) => p && !photoCache.has(p)))];
  if (need.length) {
    const { data, error } = await sb.storage.from("photos").createSignedUrls(need, 60 * 60 * 6);
    if (!error) data.forEach((d) => d.signedUrl && photoCache.set(d.path, d.signedUrl));
  }
  return (p) => photoCache.get(p) || "";
}

// ───────── chrome ─────────
function applyStaticText() {
  document.documentElement.lang = lang;
  $("#langBtn").textContent = lang === "te" ? "EN" : "తె";
  $$("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
  $("#brand").textContent = CFG.TITLE || "DM Puram";
}
$("#langBtn").addEventListener("click", () => {
  lang = lang === "te" ? "en" : "te";
  store.set("lang", lang);
  applyStaticText();
  route();
});
$("#logoutBtn").addEventListener("click", async () => {
  if (!confirm(t("logout_q"))) return;
  await sb.auth.signOut();
  me = null;
  location.hash = "#/";
  boot();
});

function setTab(name) {
  $$("#tabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === name));
}

// ───────── login ─────────
function viewLogin(msg = "") {
  $("#tabs").hidden = true;
  $("#logoutBtn").hidden = true;
  $("#who").textContent = "";
  main.innerHTML = `
    <form class="card login stack" id="loginForm" autocomplete="on">
      <h1>${esc(t("login_title"))}</h1>
      ${msg ? `<p class="small" style="color:var(--danger)">${esc(msg)}</p>` : ""}
      <label class="f">${esc(t("username"))}<input name="u" autocapitalize="none" autocomplete="username" required></label>
      <label class="f">${esc(t("password"))}<input name="p" type="password" autocomplete="current-password" required></label>
      <button class="primary big" type="submit">${esc(t("sign_in"))}</button>
    </form>`;
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = $("button", f);
    btn.disabled = true;
    const username = f.u.value.trim().toLowerCase();
    const email = username.includes("@") ? username : `${username}@${CFG.EMAIL_DOMAIN || "team.dmpuram.local"}`;
    const { error } = await sb.auth.signInWithPassword({ email, password: f.p.value });
    btn.disabled = false;
    if (error) return viewLogin(t("login_failed"));
    boot();
  });
}

// ───────── voter list / search ─────────
const filters = store.get("filters", { q: "", hamlet: "", lean: "", status: "", gender: "" });

function applyFilters(qb, f) {
  if (f.hamlet) qb = qb.eq("hamlet_id", Number(f.hamlet));
  if (f.lean === "ours") qb = qb.in("leaning", ["strong", "leaning"]);
  else if (f.lean) qb = qb.eq("leaning", f.lean);
  if (f.gender) qb = qb.eq("gender", f.gender);
  switch (f.status) {
    case "not_contacted": qb = qb.eq("contacted", false); break;
    case "contacted": qb = qb.eq("contacted", true); break;
    case "voted": qb = qb.eq("voted", true); break;
    case "not_voted": qb = qb.eq("voted", false); break;
    case "ours_not_voted": qb = qb.eq("voted", false).in("leaning", ["strong", "leaning"]); break;
    case "transport": qb = qb.eq("needs_transport", true); break;
    case "away": qb = qb.eq("away", true); break;
    case "review": qb = qb.eq("needs_review", true); break;
    case "mine": qb = qb.eq("assigned_to", me.id); break;
    case "has_phone": qb = qb.not("phone", "is", null).neq("phone", ""); break;
    case "follow_up_due": qb = qb.lte("follow_up_on", todayIST()); break;
    case "slip_pending": qb = qb.eq("slip_delivered", false); break;
    case "slip_done": qb = qb.eq("slip_delivered", true); break;
    case "unassigned": qb = qb.is("assigned_to", null); break;
    case "away_needs_help": qb = qb.eq("away", true).eq("travel_plan", "needs_help"); break;
    case "away_unknown": qb = qb.eq("away", true).eq("travel_plan", "unknown"); break;
    case "ride_unbooked": qb = qb.eq("needs_transport", true).is("vehicle_id", null); break;
  }
  const q = (f.q || "").replace(/[,()"'%*\\:]/g, " ").trim();
  if (!q) return qb;
  if (/^\d+$/.test(q)) return qb.or(`serial.eq.${q},house_no.eq.${q}`);
  if (/^[A-Za-z]{2,4}\d{3,}$/.test(q)) return qb.ilike("epic", `%${q}%`);
  if (/\d/.test(q)) return qb.ilike("house_no", `%${q}%`);
  if (hasTelugu(q)) return qb.or(`name.ilike.%${q}%,relation_name.ilike.%${q}%`);
  const key = searchKey(q);
  return key ? qb.ilike("search_key", `%${key}%`) : qb;
}

function voterItem(v, url) {
  const rel = v.relation_name ? `${t("rel_" + (v.relation_type || "other"))}: ${v.relation_name}` : "";
  const sub2 = [v.age && `${v.age}${v.gender === "F" ? " స్త్రీ/F" : v.gender === "M" ? " పు/M" : ""}`,
    v.house_no && `🏠 ${v.house_no}`, hamletName(v.hamlet_id)].filter(Boolean).join(" · ");
  const quick = pollMode() ? `<button class="small ${v.voted ? "" : "primary"}" data-quickvote="${v.serial}" ${v.voted ? "disabled" : ""}>✓</button>` : "";
  return `<li><a class="vitem" href="#/v/${v.serial}">
    <img class="ph" alt="" loading="lazy" src="${esc(url(v.photo_path))}">
    <div class="main">
      <div class="nm"><span class="sn">${v.serial}</span> ${esc(v.name || "—")}</div>
      <div class="sub">${esc(rel)}</div>
      <div class="sub">${esc(sub2)}</div>
    </div>
    <div class="side">
      ${v.voted ? `<span class="chip voted">✓ ${esc(t("st_voted"))}</span>` : ""}
      ${leanChip(v.leaning)}
      ${v.contacted ? `<span class="chip">☎</span>` : ""}
      ${v.slip_delivered ? `<span class="chip" title="${esc(t("slip"))}">🧾</span>` : ""}
      ${v.follow_up_on && v.follow_up_on <= todayIST() ? `<span class="chip undecided">📅 ${esc(v.follow_up_on.slice(5))}</span>` : ""}
      ${v.needs_review ? `<span class="chip review">!</span>` : ""}
      ${quick}
    </div></a></li>`;
}

async function viewSearch() {
  setTab("search");
  const opt = (val, label, cur) => `<option value="${esc(val)}" ${String(cur) === String(val) ? "selected" : ""}>${esc(label)}</option>`;
  main.innerHTML = `
    <div class="searchbar">
      <input type="search" id="q" placeholder="${esc(t("search_ph"))}" value="${esc(filters.q)}" enterkeyhint="search" autocomplete="off">
      <div class="filters">
        <select id="fHamlet">${opt("", t("all_hamlets"), filters.hamlet)}${hamlets.map((h) => opt(h.id, `${h.id}. ${hamletName(h.id)}`, filters.hamlet)).join("")}</select>
        <select id="fLean">${opt("", t("all_leanings"), filters.lean)}${opt("ours", t("ours"), filters.lean)}${LEANINGS.map((l) => opt(l, t("lean_" + l), filters.lean)).join("")}</select>
        <select id="fStatus">${opt("", t("all_status"), filters.status)}${["follow_up_due", "not_contacted", "contacted", "slip_pending", "slip_done", "not_voted", "voted", "ours_not_voted", "transport", ...(hasTransport ? ["ride_unbooked"] : []), "away", ...(hasTransport ? ["away_unknown", "away_needs_help"] : []), "has_phone", "mine", ...(canAssign() ? ["unassigned"] : []), "review"].map((s) => opt(s, t("st_" + s), filters.status)).join("")}</select>
        <select id="fGender">${opt("", t("all_genders"), filters.gender)}${opt("M", t("male"), filters.gender)}${opt("F", t("female"), filters.gender)}</select>
      </div>
    </div>
    <div class="row" style="margin:2px 0 6px;gap:6px">
      ${[["follow_up_due", "📅"], ["slip_pending", "🧾"], ["mine", "👤"], ["not_contacted", "☎"]].map(([s, ic]) =>
        `<button class="small ${filters.status === s ? "primary" : ""}" data-quick="${s}">${ic} ${esc(t("st_" + s))}</button>`).join("")}
    </div>
    ${canAssign() ? `<div class="row small" style="margin:0 0 8px">
      <span class="muted">${esc(t("assign_shown"))}</span>
      <select id="bulkWorker" style="width:auto;min-height:36px;font-size:14px;flex:1"><option value="">—</option><option value="__none">${esc(t("nobody"))}</option>${team.filter((p) => p.active).map((p) => `<option value="${p.id}">${esc(p.full_name || p.username)}</option>`).join("")}</select>
      <button class="small" id="bulkAssign">${esc(t("assign"))}</button>
    </div>` : ""}
    <div class="row small muted" style="justify-content:space-between;margin:4px 2px 8px">
      <span id="count"></span>
      <a class="btn small" href="#/print" style="min-height:32px;padding:4px 10px;font-size:13px">🖨 ${esc(t("walk_list"))}</a>
      ${isSuper() ? `<button class="small" id="csvBtn">⬇ ${esc(t("export_csv"))}</button>` : ""}
    </div>
    <ul class="vlist" id="list"></ul>
    <div class="center"><button id="more" hidden>${esc(t("load_more"))}</button></div>`;

  let offset = 0, total = 0, seq = 0;
  const list = $("#list");
  async function load(reset) {
    const my = ++seq;
    if (reset) { offset = 0; list.innerHTML = ""; }
    let qb = sb.from("voters").select(VOTER_COLS, { count: reset ? "exact" : undefined });
    qb = applyFilters(qb, filters).order("serial").range(offset, offset + PAGE - 1);
    const { data, error, count } = await qb;
    if (my !== seq) return;
    if (error) return fail(error);
    if (reset) total = count ?? 0;
    const url = await photoUrls(data.map((v) => v.photo_path));
    list.insertAdjacentHTML("beforeend", data.map((v) => voterItem(v, url)).join(""));
    offset += data.length;
    $("#count").textContent = `${total} ${t("results")}`;
    $("#more").hidden = offset >= total;
    if (!total) list.innerHTML = `<li class="empty">${esc(t("no_results"))}</li>`;
  }
  let deb;
  $("#q").addEventListener("input", (e) => {
    filters.q = e.target.value; store.set("filters", filters);
    clearTimeout(deb); deb = setTimeout(() => load(true), 300);
  });
  for (const [id, key] of [["fHamlet", "hamlet"], ["fLean", "lean"], ["fStatus", "status"], ["fGender", "gender"]]) {
    $("#" + id).addEventListener("change", (e) => { filters[key] = e.target.value; store.set("filters", filters); load(true); });
  }
  $("#more").addEventListener("click", () => load(false));
  list.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-quickvote]");
    if (!b) return;
    e.preventDefault();
    b.disabled = true;
    const serial = Number(b.dataset.quickvote);
    const { error } = await sb.from("voters").update({ voted: true }).eq("serial", serial);
    if (error) { b.disabled = false; return fail(error); }
    b.classList.remove("primary");
    b.closest(".side").insertAdjacentHTML("afterbegin", `<span class="chip voted">✓ ${esc(t("st_voted"))}</span>`);
    toast(`${serial} ✓ ${t("st_voted")}`);
  });
  $("#csvBtn")?.addEventListener("click", () => exportCsv());
  $$("[data-quick]").forEach((b) => b.addEventListener("click", () => {
    filters.status = filters.status === b.dataset.quick ? "" : b.dataset.quick;
    store.set("filters", filters);
    viewSearch();
  }));
  $("#bulkAssign")?.addEventListener("click", async () => {
    const who = $("#bulkWorker").value;
    if (!who) return;
    if (!total) return;
    const name = who === "__none" ? t("nobody") : personName(who);
    if (!confirm(`${t("assign_confirm")} ${total} → ${name}?`)) return;
    const { error } = await applyFilters(sb.from("voters").update({ assigned_to: who === "__none" ? null : who }), filters);
    if (error) return fail(error);
    toast(`${total} → ${name}`);
    load(true);
  });
  load(true);
}

// ───────── printable walk list (uses the current Voters filters) ─────────
async function viewPrint() {
  setTab("search");
  main.innerHTML = `<p class="center muted">…</p>`;
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await applyFilters(sb.from("voters").select(VOTER_COLS), filters).order("serial").range(from, from + 999);
    if (error) return fail(error);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const desc = [filters.hamlet ? hamletName(Number(filters.hamlet)) : t("all_hamlets"),
    filters.lean ? (filters.lean === "ours" ? t("ours") : t("lean_" + filters.lean)) : "",
    filters.status ? t("st_" + filters.status) : "", filters.q ? `"${filters.q}"` : ""].filter(Boolean).join(" · ");
  const leanShort = { strong: "✓✓", leaning: "✓", undecided: "?", opposed: "✗", unknown: "" };
  let lastHouse = null;
  const body = rows.map((v) => {
    const key = `${v.hamlet_id}|${v.house_no}`;
    const newHouse = key !== lastHouse; lastHouse = key;
    return `<tr class="${newHouse ? "hs" : ""}">
      <td>${v.serial}</td><td>${newHouse ? esc(v.house_no || "") : ""}</td>
      <td><b>${esc(v.name)}</b><div class="pm">${esc(t("rel_" + (v.relation_type || "other")))}: ${esc(v.relation_name || "")}</div></td>
      <td>${esc(v.age ?? "")}${v.gender ? " " + v.gender : ""}</td><td class="pm">${esc(v.epic || "")}</td>
      <td>${esc(v.phone || "")}</td><td class="c">${leanShort[v.leaning] || ""}</td>
      <td class="c">${v.contacted ? "☑" : "☐"}</td><td class="c">${v.slip_delivered ? "☑" : "☐"}</td><td></td></tr>`;
  }).join("");
  main.innerHTML = `
    <div class="noprint row" style="justify-content:space-between;margin-bottom:10px">
      <a class="btn small" href="#/">← ${esc(t("back"))}</a>
      <button class="primary" onclick="window.print()">🖨 ${esc(t("print"))}</button>
    </div>
    <div class="printsheet">
      <h1>${esc(CFG.TITLE || "DM Puram")} · ${esc(t("walk_list"))}</h1>
      <p class="small">${esc(desc)} · ${rows.length} ${esc(t("results"))} · ${esc(fmtTime(new Date().toISOString()))} · ${esc(me.full_name || me.username)}</p>
      <p class="small muted">${esc(t("support"))}: ✓✓ ${esc(t("lean_strong"))} · ✓ ${esc(t("lean_leaning"))} · ? ${esc(t("lean_undecided"))} · ✗ ${esc(t("lean_opposed"))}</p>
      <div class="tablewrap"><table class="walk">
        <thead><tr><th>#</th><th>🏠</th><th>${esc(t("name"))}</th><th>${esc(t("age"))}</th><th>${esc(t("epic"))}</th><th>${esc(t("phone"))}</th><th>${esc(t("support"))}</th><th>☎</th><th>🧾</th><th>${esc(t("notes"))}</th></tr></thead>
        <tbody>${body || `<tr><td colspan="10">${esc(t("no_results"))}</td></tr>`}</tbody>
      </table></div>
    </div>`;
}

async function exportCsv() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await applyFilters(sb.from("voters").select("*"), filters).order("serial").range(from, from + 999);
    if (error) return fail(error);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const cols = ["serial", "ward", "hamlet", "name", "name_en", "relation_type", "relation_name", "age", "gender", "house_no",
    "epic", "phone", "leaning", "contacted", "needs_transport", "away", "assigned", "voted", "voted_at", "notes"];
  const cell = (x) => { const s = String(x ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [cols.join(",")].concat(rows.map((r) => cols.map((c) =>
    cell(c === "hamlet" ? hamletName(r.hamlet_id) : c === "assigned" ? personName(r.assigned_to) : r[c])).join(",")));
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `voters-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ───────── single voter ─────────
async function viewVoter(serial) {
  setTab("search");
  main.innerHTML = `<p class="center muted">…</p>`;
  const [{ data: v, error }] = await Promise.all([sb.from("voters").select("*").eq("serial", serial).maybeSingle(), loadVehicles()]);
  if (error) return fail(error);
  if (!v) { main.innerHTML = `<p class="empty">${esc(t("not_found"))}</p>`; return; }

  const [{ data: house }, { data: hist }] = await Promise.all([
    v.house_no ? sb.from("voters").select("serial,name,age,gender,leaning,voted,photo_path,relation_type,relation_name,house_no,hamlet_id,contacted,needs_review")
      .eq("hamlet_id", v.hamlet_id).eq("house_no", v.house_no).neq("serial", v.serial).order("serial") : { data: [] },
    sb.from("activity").select("at,action,detail,user_id").eq("voter_serial", v.serial).order("at", { ascending: false }).limit(15),
  ]);
  const url = await photoUrls([v.photo_path, ...(house || []).map((h) => h.photo_path)]);
  const tel = (v.phone || "").replace(/[^\d+]/g, "");

  main.innerHTML = `
    <div class="row" style="margin-bottom:8px"><button class="small ghost" id="backBtn">← ${esc(t("back"))}</button></div>
    <div class="card">
      <div class="vhead">
        <img class="photo" alt="" src="${esc(url(v.photo_path))}">
        <div class="grow">
          <div class="sn">#${v.serial}</div>
          <h1>${esc(v.name)}</h1>
          <div class="muted small">${esc(v.name_en || "")}</div>
          <div class="row" style="margin-top:6px">${leanChip(v.leaning)}${v.voted ? `<span class="chip voted">✓ ${esc(t("st_voted"))}</span>` : ""}</div>
        </div>
      </div>
      ${v.needs_review ? `<p class="small chip review" style="display:block;margin-top:10px">⚠ ${esc(t("review_flag"))}</p>` : ""}
      <dl class="kv">
        <dt>${esc(t("rel_" + (v.relation_type || "other")))}</dt><dd>${esc(v.relation_name || "—")}</dd>
        <dt>${esc(t("age"))} / ${esc(t("gender"))}</dt><dd>${esc(v.age ?? "—")} / ${v.gender === "F" ? esc(t("female")) : v.gender === "M" ? esc(t("male")) : "—"}</dd>
        <dt>${esc(t("house"))}</dt><dd>${esc(v.house_no || "—")}</dd>
        <dt>${esc(t("hamlet"))}</dt><dd>${esc(hamletName(v.hamlet_id))} · ${esc(t("ward"))} ${esc(v.ward ?? "")}</dd>
        <dt>${esc(t("epic"))}</dt><dd>${esc(v.epic || "—")}</dd>
      </dl>
    </div>

    <div class="card ${v.voted ? "votedbox" : ""}" style="margin-top:12px" id="voteCard">
      ${v.voted
        ? `<div class="row" style="justify-content:space-between"><strong>✓ ${esc(t("st_voted"))}</strong><span class="small muted">${esc(fmtTime(v.voted_at))}${v.voted_by ? " · " + esc(personName(v.voted_by)) : ""}</span></div>
           <button class="small danger" id="unvoteBtn" style="margin-top:8px">${esc(t("undo_voted"))}</button>`
        : `<button class="primary big" id="voteBtn">${esc(t("mark_voted"))}</button>`}
    </div>

    <form class="card stack" style="margin-top:12px" id="campForm">
      <div><div class="small muted" style="margin-bottom:6px">${esc(t("support"))}</div>
        <div class="seg" id="leanSeg">${LEANINGS.map((l) => `<button type="button" class="${l} ${v.leaning === l ? "on" : ""}" data-l="${l}">${esc(t("lean_" + l))}</button>`).join("")}</div>
      </div>
      <label class="check"><input type="checkbox" name="contacted" ${v.contacted ? "checked" : ""}> ${esc(t("contacted"))}</label>
      <div class="row">
        <label class="f grow">${esc(t("phone"))}<input name="phone" type="tel" inputmode="tel" value="${esc(v.phone || "")}"></label>
        ${tel ? `<a class="btn" style="margin-top:18px" href="tel:${esc(tel)}">📞 ${esc(t("call"))}</a>` : ""}
      </div>
      <label class="check"><input type="checkbox" name="slip_delivered" ${v.slip_delivered ? "checked" : ""}> 🧾 ${esc(t("slip"))}</label>
      <div class="row">
        <label class="f grow">📅 ${esc(t("follow_up"))}<input type="date" name="follow_up_on" value="${esc(v.follow_up_on || "")}"></label>
        <button type="button" class="small" style="margin-top:18px" id="fuClear">✕</button>
      </div>
      <label class="check"><input type="checkbox" name="needs_transport" ${v.needs_transport ? "checked" : ""}> ${esc(t("transport"))}</label>
      ${hasTransport ? `<label class="f" id="vehBox" ${v.needs_transport || v.vehicle_id ? "" : "hidden"}>🚗 ${esc(t("vehicle"))}<select name="vehicle_id"><option value="">${esc(t("not_booked"))}</option>${vehicles.map((x) => `<option value="${x.id}" ${x.id === v.vehicle_id ? "selected" : ""}>${esc(x.label)}${x.driver_name ? " · " + esc(x.driver_name) : ""}</option>`).join("")}</select></label>` : ""}
      <label class="check"><input type="checkbox" name="away" ${v.away ? "checked" : ""}> ${esc(t("away"))}</label>
      ${hasTransport ? `<div class="row" id="awayBox" ${v.away ? "" : "hidden"}>
        <label class="f grow">📍 ${esc(t("away_place"))}<input name="away_place" value="${esc(v.away_place || "")}" placeholder="${esc(t("away_place_ph"))}"></label>
        <label class="f grow">${esc(t("travel_plan"))}<select name="travel_plan">${TRAVEL.map((x) => `<option value="${x}" ${v.travel_plan === x ? "selected" : ""}>${esc(t("tp_" + x))}</option>`).join("")}</select></label>
      </div>` : ""}
      ${canAssign() ? `<label class="f">${esc(t("assigned"))}<select name="assigned_to"><option value="">${esc(t("nobody"))}</option>${team.filter((p) => p.active).map((p) => `<option value="${p.id}" ${p.id === v.assigned_to ? "selected" : ""}>${esc(p.full_name || p.username)}</option>`).join("")}</select></label>`
        : v.assigned_to ? `<div class="small muted">${esc(t("assigned"))}: ${esc(personName(v.assigned_to))}</div>` : ""}
      <label class="f">${esc(t("notes"))}<textarea name="notes">${esc(v.notes || "")}</textarea></label>
      <button class="primary" type="submit">${esc(t("save"))}</button>
    </form>

    ${house?.length ? `<h2>${esc(t("household"))} (${esc(v.house_no)})</h2>
      <div class="row small" style="margin-bottom:8px">
        <button class="small" id="houseLean">🏠 ${esc(t("house_same_support"))}</button>
        <button class="small" id="houseSlip">🧾 ${esc(t("house_slips"))}</button>
      </div>
      <ul class="vlist">${house.map((h) => voterItem(h, url)).join("")}</ul>` : ""}

    ${isSuper() ? `
    <details class="card" style="margin-top:12px"><summary>${esc(t("edit_details"))}</summary>
      <form class="stack" id="rollForm" style="margin-top:10px">
        <label class="f">${esc(t("name"))}<input name="name" value="${esc(v.name)}"></label>
        <div class="row">
          <label class="f grow"><select name="relation_type">${["father", "husband", "mother", "other"].map((r) => `<option value="${r}" ${v.relation_type === r ? "selected" : ""}>${esc(t("rel_" + r))}</option>`).join("")}</select></label>
          <label class="f grow"><input name="relation_name" value="${esc(v.relation_name || "")}"></label>
        </div>
        <div class="row">
          <label class="f grow">${esc(t("age"))}<input name="age" type="number" min="18" max="120" value="${esc(v.age ?? "")}"></label>
          <label class="f grow">${esc(t("gender"))}<select name="gender"><option value="M" ${v.gender === "M" ? "selected" : ""}>${esc(t("male"))}</option><option value="F" ${v.gender === "F" ? "selected" : ""}>${esc(t("female"))}</option><option value="O" ${v.gender === "O" ? "selected" : ""}>O</option></select></label>
        </div>
        <label class="f">${esc(t("house"))}<input name="house_no" value="${esc(v.house_no || "")}"></label>
        <label class="f">${esc(t("epic"))}<input name="epic" value="${esc(v.epic || "")}" autocapitalize="characters"></label>
        <label class="check"><input type="checkbox" name="needs_review" ${v.needs_review ? "checked" : ""}> ${esc(t("st_review"))}</label>
        <button type="submit">${esc(t("save"))}</button>
      </form>
    </details>` : ""}

    ${hist?.length ? `<h2>${esc(t("history"))}</h2><ul class="hist">${hist.map((h) => `<li>${esc(fmtTime(h.at))} · ${esc(personName(h.user_id) || "—")} · ${esc(describe(h))}</li>`).join("")}</ul>` : ""}
  `;

  $("#fuClear").addEventListener("click", () => { $("#campForm").follow_up_on.value = ""; });
  const cf = $("#campForm");
  cf.needs_transport.addEventListener("change", () => { if ($("#vehBox")) $("#vehBox").hidden = !cf.needs_transport.checked && !cf.vehicle_id.value; });
  cf.away.addEventListener("change", () => { if ($("#awayBox")) $("#awayBox").hidden = !cf.away.checked; });
  const houseUpdate = async (patch) => {
    const { error } = await sb.from("voters").update(patch).eq("hamlet_id", v.hamlet_id).eq("house_no", v.house_no);
    if (error) return fail(error);
    toast(t("saved"));
    viewVoter(v.serial);
  };
  $("#houseLean")?.addEventListener("click", () => {
    if (v.leaning === "unknown") return toast(t("set_support_first"), true);
    if (!confirm(`${t("house_same_support")}: ${t("lean_" + v.leaning)} (${house.length + 1})?`)) return;
    houseUpdate({ leaning: v.leaning, contacted: true });
  });
  $("#houseSlip")?.addEventListener("click", () => {
    if (!confirm(`${t("house_slips")} (${house.length + 1})?`)) return;
    houseUpdate({ slip_delivered: true });
  });
  $("#backBtn").addEventListener("click", () => (history.length > 1 ? history.back() : (location.hash = "#/")));
  let leaning = v.leaning;
  $("#leanSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-l]");
    if (!b) return;
    leaning = b.dataset.l;
    $$("#leanSeg button").forEach((x) => x.classList.toggle("on", x === b));
  });
  $("#campForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const patch = {
      leaning, contacted: f.contacted.checked, phone: f.phone.value.trim() || null,
      needs_transport: f.needs_transport.checked, away: f.away.checked, notes: f.notes.value.trim() || null,
    };
    // Choosing a support level means someone spoke to them.
    if (leaning !== "unknown" && leaning !== v.leaning) patch.contacted = true;
    if (f.assigned_to) patch.assigned_to = f.assigned_to.value || null;
    patch.slip_delivered = f.slip_delivered.checked;
    patch.follow_up_on = f.follow_up_on.value || null;
    if (hasTransport) {
      patch.vehicle_id = f.vehicle_id.value ? Number(f.vehicle_id.value) : null;
      patch.away_place = f.away_place.value.trim() || null;
      patch.travel_plan = f.travel_plan.value;
    }
    const { error } = await sb.from("voters").update(patch).eq("serial", v.serial);
    if (error) return fail(error);
    toast(t("saved"));
    viewVoter(v.serial);
  });
  $("#voteBtn")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    const { error } = await sb.from("voters").update({ voted: true }).eq("serial", v.serial);
    if (error) { e.target.disabled = false; return fail(error); }
    rememberMark(v);
    toast(`${v.serial} ✓ ${t("st_voted")}`);
    viewVoter(v.serial);
  });
  $("#unvoteBtn")?.addEventListener("click", async () => {
    if (!confirm(t("confirm_undo"))) return;
    const { error } = await sb.from("voters").update({ voted: false }).eq("serial", v.serial);
    if (error) return fail(error);
    viewVoter(v.serial);
  });
  $("#rollForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const patch = {
      name: f.name.value.trim(), relation_type: f.relation_type.value, relation_name: f.relation_name.value.trim(),
      age: f.age.value ? Number(f.age.value) : null, gender: f.gender.value, house_no: f.house_no.value.trim(),
      epic: f.epic.value.trim().toUpperCase(), needs_review: f.needs_review.checked,
    };
    patch.name_en = translit(patch.name);
    patch.relation_name_en = translit(patch.relation_name);
    patch.search_key = voterKey(patch);
    const { error } = await sb.from("voters").update(patch).eq("serial", v.serial);
    if (error) return fail(error);
    toast(t("saved"));
    viewVoter(v.serial);
  });
}

function describe(h) {
  const d = h.detail || {};
  if (h.action === "voted") return "✓ " + t("st_voted");
  if (h.action === "unvoted") return "✗ " + t("undo_voted");
  return Object.entries(d).map(([k, val]) => {
    if (k === "leaning") return `${t("support")}: ${t("lean_" + val)}`;
    if (k === "assigned_to") return `${t("assigned")}: ${personName(val) || t("nobody")}`;
    if (typeof val === "boolean") return `${t(k === "needs_transport" ? "st_transport" : k === "away" ? "st_away" : k === "slip_delivered" ? "slip" : k)}: ${val ? "✓" : "✗"}`;
    if (k === "follow_up_on") return `${t("follow_up")}: ${val ?? "—"}`;
    if (k === "vehicle_id") return `🚗 ${t("vehicle")}: ${vehicleName(val) || t("not_booked")}`;
    if (k === "travel_plan") return `${t("travel_plan")}: ${t("tp_" + val)}`;
    return `${t(k === "house_no" ? "house" : k)}: ${val ?? "—"}`;
  }).join(", ");
}

// ───────── poll day ─────────
function rememberMark(v) {
  const marks = store.get("marks", []);
  marks.unshift({ serial: v.serial, name: v.name, at: Date.now() });
  store.set("marks", marks.slice(0, 15));
}

function viewPoll() {
  setTab("poll");
  let digits = "";
  const marks = store.get("marks", []);
  main.innerHTML = `
    <h1>${esc(t("poll_title"))}</h1>
    <p class="small muted">${esc(t("poll_help"))}</p>
    <div class="serial-display" id="sd">&nbsp;</div>
    <div class="numpad" style="margin-top:8px">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-d="${n}">${n}</button>`).join("")}
      <button data-d="C">${esc(t("clear"))}</button><button data-d="0">0</button><button data-d="B">⌫</button>
    </div>
    <button class="primary big" id="findBtn" style="margin-top:8px">${esc(t("find"))}</button>
    <div id="found" style="margin-top:12px"></div>
    <a class="btn" style="width:100%;margin-top:12px" href="#/" id="pendingLink">🙋 ${esc(t("ours_pending"))}</a>
    <label class="card check" style="margin-top:12px"><input type="checkbox" id="pm" ${pollMode() ? "checked" : ""}> ${esc(t("poll_mode"))}</label>
    ${marks.length ? `<h2>${esc(t("recent_marks"))}</h2><ul class="hist">${marks.map((m) => `<li><a href="#/v/${m.serial}">${m.serial}</a> · ${esc(m.name)} · ${esc(fmtTime(new Date(m.at).toISOString()))}</li>`).join("")}</ul>` : ""}
  `;
  const show = () => ($("#sd").textContent = digits || " ");
  $(".numpad").addEventListener("click", (e) => {
    const d = e.target.closest("button")?.dataset.d;
    if (!d) return;
    if (d === "C") digits = ""; else if (d === "B") digits = digits.slice(0, -1); else if (digits.length < 5) digits += d;
    show();
  });
  $("#pm").addEventListener("change", (e) => store.set("pollMode", e.target.checked));
  $("#pendingLink").addEventListener("click", () => {
    Object.assign(filters, { q: "", lean: "", status: "ours_not_voted" });
    store.set("filters", filters);
  });
  $("#findBtn").addEventListener("click", async () => {
    if (!digits) return;
    const serial = Number(digits);
    const box = $("#found");
    const { data: v, error } = await sb.from("voters").select(VOTER_COLS).eq("serial", serial).maybeSingle();
    if (error) return fail(error);
    if (!v) { box.innerHTML = `<p class="empty">${esc(t("not_found"))}</p>`; return; }
    const url = await photoUrls([v.photo_path]);
    box.innerHTML = `<ul class="vlist">${voterItem({ ...v }, url)}</ul>
      ${v.voted ? `<p class="center"><span class="chip voted">✓ ${esc(t("already_voted"))} ${esc(fmtTime(v.voted_at))}</span></p>`
        : `<button class="primary big" id="pv">${esc(t("mark_voted"))}</button>`}`;
    $("#pv")?.addEventListener("click", async (e) => {
      e.target.disabled = true;
      const { error: err } = await sb.from("voters").update({ voted: true }).eq("serial", v.serial);
      if (err) { e.target.disabled = false; return fail(err); }
      rememberMark(v);
      toast(`${v.serial} ✓ ${t("st_voted")}`);
      digits = ""; show();
      viewPoll();
    });
  });
}

// ───────── dashboard ─────────
let dashChannel = null;
async function viewDash() {
  setTab("dash");
  main.innerHTML = `<h1>${esc(t("dash_title"))}</h1><div id="dash"><p class="center muted">…</p></div>`;
  const draw = async () => {
    const el = $("#dash");
    if (!el) return;
    const { data: rows, error } = await sb.rpc("hamlet_stats");
    if (error) return fail(error);
    const sum = (k) => rows.reduce((a, r) => a + Number(r[k] || 0), 0);
    const T = Object.fromEntries(["total", "male", "female", "contacted", "strong", "leaning", "undecided", "opposed", "unknown", "voted", "ours_voted", "ours_total", "transport", "away", "slips", "follow_ups_due"].map((k) => [k, sum(k)]));
    const target = (id) => hamlets.find((h) => h.id === id)?.target_votes;
    const T_target = hamlets.reduce((a, h) => a + (h.target_votes || 0), 0);
    const bar = (r) => `<div class="bar">${["strong", "leaning", "undecided", "opposed"].map((l) => `<span style="width:${pct(r[l], r.total)}%;background:var(--${l})"></span>`).join("")}</div>`;
    let workers = "";
    if (canAssign()) {
      const { data: a } = await sb.rpc("assignment_stats");
      if (a?.length) workers += `<h2>${esc(t("worker_progress"))}</h2><div class="tablewrap"><table><thead><tr><th></th><th>${esc(t("assigned_n"))}</th><th>${esc(t("contacted_pct"))}</th><th>${esc(t("ours"))}</th><th>🧾</th><th>📅</th><th>${esc(t("st_voted"))}</th></tr></thead><tbody>
        ${a.map((r) => `<tr><td>${esc(r.full_name)}</td><td>${r.assigned}</td><td>${pct(r.contacted, r.assigned)}%</td><td>${r.ours}</td><td>${pct(r.slips, r.assigned)}%</td><td>${r.follow_ups_due}</td><td>${r.voted}</td></tr>`).join("")}</tbody></table></div>`;
    }
    if (isAdmin()) {
      const { data: w } = await sb.rpc("worker_stats");
      if (w?.length) workers += `<h2>${esc(t("by_worker"))}</h2><div class="tablewrap"><table><thead><tr><th></th><th>${esc(t("updates"))}</th><th>${esc(t("marks"))}</th><th>${esc(t("last"))}</th></tr></thead><tbody>
        ${w.map((r) => `<tr><td>${esc(r.full_name)}</td><td>${r.updates}</td><td>${r.voted_marks}</td><td>${esc(fmtTime(r.last_at))}</td></tr>`).join("")}</tbody></table></div>`;
    }
    el.innerHTML = `
      <div class="stat-grid">
        <div class="stat"><div class="n">${T.total}</div><div class="l">${esc(t("total"))} · ${T.male} ${esc(t("male"))} / ${T.female} ${esc(t("female"))}</div></div>
        <div class="stat"><div class="n">${pct(T.contacted, T.total)}%</div><div class="l">${esc(t("contacted_pct"))} (${T.contacted})</div></div>
        <div class="stat"><div class="n" style="color:var(--strong)">${T.ours_total}</div><div class="l">${esc(t("ours"))}</div>${bar(T)}</div>
        <div class="stat"><div class="n">${pct(T.slips, T.total)}%</div><div class="l">🧾 ${esc(t("slips_delivered"))} (${T.slips})</div></div>
        <div class="stat"><div class="n" style="color:var(--undecided)">${T.follow_ups_due}</div><div class="l">📅 ${esc(t("st_follow_up_due"))}</div></div>
        <div class="stat"><div class="n">${T_target ? pct(T.ours_total, T_target) + "%" : "—"}</div><div class="l">🎯 ${esc(t("of_target"))}${T_target ? ` (${T.ours_total}/${T_target})` : ""}</div></div>
        <div class="stat"><div class="n" style="color:var(--voted)">${pct(T.voted, T.total)}%</div><div class="l">${esc(t("turnout"))} (${T.voted}) · ${esc(t("ours_voted"))}: ${T.ours_voted}/${T.ours_total}</div></div>
      </div>
      <div class="row small" style="margin-top:8px;gap:12px">
        ${LEANINGS.map((l) => `<span><span class="chip ${l}">${esc(t("lean_" + l))}</span> ${T[l]}</span>`).join("")}
        <span>🚗 ${T.transport}</span><span>✈ ${T.away}</span>
      </div>
      ${hasTransport ? `<a class="btn" style="margin-top:10px;width:100%" href="#/transport">🚗 ${esc(t("transport_plan"))} →</a>` : ""}
      <h2>${esc(t("by_hamlet"))}</h2>
      <div class="tablewrap"><table>
        <thead><tr><th>${esc(t("hamlet"))}</th><th>${esc(t("total"))}</th><th>${esc(t("contacted_pct"))}</th><th>${esc(t("lean_strong"))}</th><th>${esc(t("lean_leaning"))}</th><th>${esc(t("lean_undecided"))}</th><th>${esc(t("lean_opposed"))}</th><th>🎯 ${esc(t("target"))}</th><th>🧾</th><th>📅</th><th>${esc(t("turnout"))}</th><th>${esc(t("ours_voted"))}</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${esc(hamletName(r.hamlet_id))}${bar(r)}</td><td>${r.total}</td><td>${pct(r.contacted, r.total)}%</td><td>${r.strong}</td><td>${r.leaning}</td><td>${r.undecided}</td><td>${r.opposed}</td><td>${target(r.hamlet_id) ? `${r.ours_total}/${target(r.hamlet_id)}` : "—"}</td><td>${pct(r.slips, r.total)}%</td><td>${r.follow_ups_due}</td><td>${r.voted} (${pct(r.voted, r.total)}%)</td><td>${r.ours_voted}/${r.ours_total}</td></tr>`).join("")}</tbody>
      </table></div>
      ${workers}
      <p class="small muted center">${esc(t("refreshed"))}: ${esc(fmtTime(new Date().toISOString()))}</p>`;
  };
  await draw();
  // Live refresh while the dashboard is open (poll day), at most every 5 seconds.
  if (dashChannel) sb.removeChannel(dashChannel);
  let pending = null;
  dashChannel = sb.channel("dash").on("postgres_changes", { event: "UPDATE", schema: "public", table: "voters" }, () => {
    if (pending) return;
    pending = setTimeout(() => { pending = null; if (location.hash.startsWith("#/dash")) draw(); }, 5000);
  }).subscribe();
}

// ───────── team (admin) ─────────
async function loadTeam() {
  const { data, error } = await sb.from("profiles").select("*").order("role").order("full_name");
  if (!error) team = data;
}

async function viewTeam() {
  setTab("team");
  if (!isAdmin()) { location.hash = "#/"; return; }
  await loadTeam();
  const roleList = isSuper() ? ["worker", "incharge", "admin"] : ["worker", "incharge"];
  const canManage = (p) => p.id !== me.id && (isSuper() || ["incharge", "worker"].includes(p.role));
  const roleOpts = (cur) => (cur === "superadmin" ? ["superadmin"] : roleList.includes(cur) ? roleList : [cur]).map((r) => `<option value="${r}" ${cur === r ? "selected" : ""}>${esc(t("role_" + r))}</option>`).join("");
  const hamletChecks = (sel = []) => `<div class="hamlet-checks">${hamlets.map((h) => `<label class="check small"><input type="checkbox" name="h" value="${h.id}" ${sel.includes(h.id) ? "checked" : ""}> ${esc(hamletName(h.id))}</label>`).join("")}</div>`;
  main.innerHTML = `
    <h1>${esc(t("team_title"))}</h1>
    <p class="small muted">${esc(t("team_help"))}</p>
    ${isSuper() ? `<details class="card" style="margin-bottom:12px"><summary><strong>🎯 ${esc(t("targets"))}</strong></summary>
      <form id="targetForm" class="stack" style="margin-top:10px">
        <p class="small muted">${esc(t("targets_help"))}</p>
        ${hamlets.map((h) => `<label class="row small"><span class="grow">${esc(hamletName(h.id))}</span><input type="number" min="0" name="t${h.id}" value="${esc(h.target_votes ?? "")}" style="width:110px"></label>`).join("")}
        <button type="submit">${esc(t("save"))}</button>
      </form>
    </details>` : ""}
    <details class="card"><summary><strong>＋ ${esc(t("add_member"))}</strong></summary>
      <form class="stack" id="addForm" style="margin-top:10px">
        <label class="f">${esc(t("full_name"))}<input name="full_name" required></label>
        <div class="row">
          <label class="f grow">${esc(t("username"))}<input name="username" required pattern="[a-zA-Z0-9_.\\-]{3,30}" autocapitalize="none"></label>
          <label class="f grow">${esc(t("password"))}<input name="password" required minlength="6"></label>
        </div>
        <div class="row">
          <label class="f grow">${esc(t("phone"))}<input name="phone" type="tel"></label>
          <label class="f grow">${esc(t("role"))}<select name="role">${roleOpts("worker")}</select></label>
        </div>
        <div class="small muted">${esc(t("hamlets"))}</div>${hamletChecks()}
        <button class="primary" type="submit">${esc(t("create"))}</button>
      </form>
    </details>
    <ul class="vlist" style="margin-top:12px" id="teamList">
      ${team.map((p) => `
        <li class="card" style="margin-bottom:8px">
          <div class="row" style="justify-content:space-between">
            <div><strong>${esc(p.full_name || p.username)}</strong> <span class="small muted">@${esc(p.username)}</span>
              ${p.active ? "" : `<span class="chip opposed">${esc(t("inactive"))}</span>`}
              <div class="small muted">${esc(t("role_" + p.role))}${p.phone ? " · " + esc(p.phone) : ""} · ${["admin", "superadmin"].includes(p.role) ? "—" : esc(p.hamlet_ids.map(hamletName).join(", ") || "—")}</div>
            </div>
            ${canManage(p) || p.id === me.id ? `<button class="small" data-edit="${p.id}">${esc(t("edit"))}</button>` : ""}
          </div>
          <form class="stack" data-form="${p.id}" hidden style="margin-top:10px">
            <label class="f">${esc(t("full_name"))}<input name="full_name" value="${esc(p.full_name)}"></label>
            <div class="row">
              <label class="f grow">${esc(t("phone"))}<input name="phone" value="${esc(p.phone || "")}"></label>
              <label class="f grow">${esc(t("role"))}<select name="role" ${canManage(p) ? "" : "disabled"}>${roleOpts(p.role)}</select></label>
            </div>
            <div class="small muted">${esc(t("hamlets"))}</div>${hamletChecks(p.hamlet_ids)}
            <div class="row"><button class="primary" type="submit">${esc(t("save"))}</button></div>
            <div class="row">
              <input name="newpw" placeholder="${esc(t("new_pw"))}" class="grow" style="flex:1">
              <button type="button" data-reset="${p.id}">${esc(t("reset_pw"))}</button>
            </div>
            ${!canManage(p) ? "" : `<button type="button" class="${p.active ? "danger" : ""}" data-active="${p.id}" data-to="${!p.active}">${esc(p.active ? t("deactivate") : t("activate"))}</button>`}
          </form>
        </li>`).join("")}
    </ul>`;

  const callFn = async (body) => {
    const { data, error } = await sb.functions.invoke(CFG.ADMIN_FUNCTION || "admin-users", { body });
    if (error) {
      let msg = error.message;
      try { msg = (await error.context.json()).error || msg; } catch { /* keep */ }
      throw new Error(msg);
    }
    return data;
  };
  $("#targetForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    for (const h of hamlets) {
      const val = e.target["t" + h.id].value;
      const tv = val === "" ? null : Number(val);
      if (tv === (h.target_votes ?? null)) continue;
      const { error } = await sb.from("hamlets").update({ target_votes: tv }).eq("id", h.id);
      if (error) return fail(error);
      h.target_votes = tv;
    }
    toast(t("saved"));
  });
  $("#addForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await callFn({
        action: "create", username: f.username.value, password: f.password.value, full_name: f.full_name.value,
        phone: f.phone.value || null, role: f.role.value, hamlet_ids: $$("input[name=h]:checked", f).map((x) => Number(x.value)),
      });
      toast(t("saved"));
      viewTeam();
    } catch (err) { fail(err); }
  });
  $("#teamList").addEventListener("click", async (e) => {
    const ed = e.target.closest("[data-edit]");
    if (ed) { const fm = $(`[data-form="${ed.dataset.edit}"]`); fm.hidden = !fm.hidden; return; }
    const rs = e.target.closest("[data-reset]");
    if (rs) {
      const pw = $("input[name=newpw]", rs.closest("form")).value;
      try { await callFn({ action: "reset_password", id: rs.dataset.reset, password: pw }); toast(t("saved")); } catch (err) { fail(err); }
      return;
    }
    const ac = e.target.closest("[data-active]");
    if (ac) {
      try { await callFn({ action: "set_active", id: ac.dataset.active, active: ac.dataset.to === "true" }); viewTeam(); } catch (err) { fail(err); }
    }
  });
  $$("form[data-form]").forEach((fm) => fm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const patch = {
      full_name: fm.full_name.value.trim(), phone: fm.phone.value.trim() || null,
      hamlet_ids: $$("input[name=h]:checked", fm).map((x) => Number(x.value)),
    };
    if (!fm.role.disabled) patch.role = fm.role.value;
    const { error } = await sb.from("profiles").update(patch).eq("id", fm.dataset.form);
    if (error) return fail(error);
    toast(t("saved"));
    viewTeam();
  }));
}

// ───────── outstation voters & poll-day transport ─────────
async function fetchAll(build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().order("serial").range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

async function viewTransport() {
  setTab("dash");
  main.innerHTML = `<p class="center muted">…</p>`;
  let away, riders;
  try {
    await loadVehicles();
    [away, riders] = await Promise.all([
      fetchAll(() => sb.from("voters").select(VOTER_COLS).eq("away", true)),
      fetchAll(() => sb.from("voters").select(VOTER_COLS).eq("needs_transport", true)),
    ]);
  } catch (e) { return fail(e); }
  const booked = (id) => riders.filter((r) => r.vehicle_id === id).length;
  const unbooked = riders.filter((r) => !r.vehicle_id && !r.voted);
  const plan = Object.fromEntries(TRAVEL.map((x) => [x, away.filter((v) => v.travel_plan === x)]));
  const planFilter = store.get("tpFilter", "");
  const awayShown = planFilter ? plan[planFilter] : away;
  const vOpts = vehicles.map((x) => `<option value="${x.id}">${esc(x.label)} (${booked(x.id)}${x.capacity ? "/" + x.capacity : ""})</option>`).join("");
  const line = (v, extra = "") => `<li class="vitem" style="align-items:flex-start">
      <div class="main"><a href="#/v/${v.serial}" style="text-decoration:none;color:inherit">
        <div class="nm"><span class="sn">${v.serial}</span> ${esc(v.name)}</div>
        <div class="sub">🏠 ${esc(v.house_no || "—")} · ${esc(hamletName(v.hamlet_id))}${v.away_place ? " · 📍 " + esc(v.away_place) : ""}</div></a>
        ${v.phone ? `<a class="small" href="tel:${esc(v.phone.replace(/[^\d+]/g, ""))}">📞 ${esc(v.phone)}</a>` : `<span class="small muted">${esc(t("no_phone"))}</span>`}
      </div>
      <div class="side">${v.voted ? `<span class="chip voted">✓ ${esc(t("st_voted"))}</span>` : ""}${extra}</div></li>`;

  main.innerHTML = `
    <div class="row" style="margin-bottom:8px"><a class="btn small" href="#/dash">← ${esc(t("back"))}</a></div>
    <h1>🚗 ${esc(t("transport_plan"))}</h1>
    <div class="stat-grid">
      <div class="stat"><div class="n">${riders.length}</div><div class="l">🚗 ${esc(t("st_transport"))}</div></div>
      <div class="stat"><div class="n" style="color:${unbooked.length ? "var(--danger)" : "var(--strong)"}">${unbooked.length}</div><div class="l">${esc(t("st_ride_unbooked"))}</div></div>
      <div class="stat"><div class="n">${away.length}</div><div class="l">✈ ${esc(t("st_away"))}</div></div>
      <div class="stat"><div class="n" style="color:var(--strong)">${plan.coming.length}</div><div class="l">${esc(t("tp_coming"))} · ${esc(t("tp_needs_help"))}: ${plan.needs_help.length}</div></div>
    </div>

    <h2>${esc(t("vehicles"))}</h2>
    ${vehicles.length ? `<ul class="vlist">${vehicles.map((x) => `<li class="vitem">
      <div class="main"><div class="nm">🚗 ${esc(x.label)}${x.hamlet_id ? ` <span class="small muted">· ${esc(hamletName(x.hamlet_id))}</span>` : ""}</div>
        <div class="sub">${esc(x.driver_name || "—")}${x.driver_phone ? ` · <a href="tel:${esc(x.driver_phone.replace(/[^\d+]/g, ""))}">📞 ${esc(x.driver_phone)}</a>` : ""}</div>
        ${x.notes ? `<div class="sub">${esc(x.notes)}</div>` : ""}</div>
      <div class="side"><span class="chip ${x.capacity && booked(x.id) > x.capacity ? "opposed" : ""}">👥 ${booked(x.id)}${x.capacity ? "/" + x.capacity : ""}</span>
        <div class="row" style="gap:4px"><a class="btn small" style="min-height:32px;padding:4px 10px;font-size:13px" href="#/transport/${x.id}">📋 ${esc(t("roster"))}</a>
        ${canTransport() ? `<button class="small" data-editveh="${x.id}">✎</button>` : ""}</div></div></li>`).join("")}</ul>`
      : `<p class="small muted">${esc(t("no_vehicles"))}</p>`}
    ${canTransport() ? `<details class="card" id="vehDetails"><summary id="vehSummary">➕ ${esc(t("add_vehicle"))}</summary>
      <form class="stack" id="vehForm" style="margin-top:10px">
        <input type="hidden" name="id">
        <label class="f">${esc(t("vehicle_label"))}<input name="label" required placeholder="${esc(t("vehicle_label_ph"))}"></label>
        <div class="row">
          <label class="f grow">${esc(t("driver"))}<input name="driver_name"></label>
          <label class="f grow">${esc(t("phone"))}<input name="driver_phone" type="tel" inputmode="tel"></label>
        </div>
        <div class="row">
          <label class="f grow">${esc(t("capacity"))}<input name="capacity" type="number" min="1" max="60"></label>
          <label class="f grow">${esc(t("hamlet"))}<select name="hamlet_id"><option value="">${esc(t("all_hamlets"))}</option>${hamlets.map((h) => `<option value="${h.id}">${esc(hamletName(h.id))}</option>`).join("")}</select></label>
        </div>
        <label class="f">${esc(t("notes"))}<input name="notes" placeholder="${esc(t("vehicle_notes_ph"))}"></label>
        <div class="row"><button class="primary grow" type="submit">${esc(t("save"))}</button><button type="button" class="danger" id="vehDelete" hidden>${esc(t("delete"))}</button></div>
      </form></details>` : ""}

    <h2>${esc(t("st_ride_unbooked"))} (${unbooked.length})</h2>
    ${unbooked.length ? `<ul class="vlist" id="unbookedList">${unbooked.map((v) => line(v, vehicles.length && canTransport()
      ? `<select data-book="${v.serial}" style="min-height:36px;font-size:13px;width:auto;max-width:150px"><option value="">${esc(t("book"))}…</option>${vOpts}</select>` : "")).join("")}</ul>`
      : `<p class="small muted">✓ ${esc(t("all_booked"))}</p>`}

    <h2>✈ ${esc(t("st_away"))} (${away.length})</h2>
    <div class="row small" style="gap:6px;margin-bottom:8px">
      ${["", ...TRAVEL].map((x) => `<button class="small ${planFilter === x ? "primary" : ""}" data-tp="${x}">${esc(x ? t("tp_" + x) : t("all_status"))} (${x ? plan[x].length : away.length})</button>`).join("")}
    </div>
    ${awayShown.length ? `<ul class="vlist">${awayShown.map((v) => line(v, `<span class="chip ${{ coming: "strong", needs_help: "undecided", not_coming: "opposed" }[v.travel_plan] || ""}">${esc(t("tp_" + v.travel_plan))}</span>${leanChip(v.leaning)}`)).join("")}</ul>`
      : `<p class="small muted">${esc(t("no_results"))}</p>`}
    <p class="small muted">${esc(t("away_help"))}</p>`;

  $$("[data-tp]").forEach((b) => b.addEventListener("click", () => { store.set("tpFilter", b.dataset.tp); viewTransport(); }));
  $("#unbookedList")?.addEventListener("change", async (e) => {
    const sel = e.target.closest("[data-book]");
    if (!sel || !sel.value) return;
    const { error } = await sb.from("voters").update({ vehicle_id: Number(sel.value) }).eq("serial", Number(sel.dataset.book));
    if (error) return fail(error);
    toast(`${sel.dataset.book} → ${vehicleName(Number(sel.value))}`);
    viewTransport();
  });
  const vf = $("#vehForm");
  if (!vf) return;
  main.addEventListener("click", (e) => {
    const b = e.target.closest("[data-editveh]");
    if (!b) return;
    const x = vehicles.find((y) => y.id === Number(b.dataset.editveh));
    for (const k of ["id", "label", "driver_name", "driver_phone", "capacity", "hamlet_id", "notes"]) vf[k].value = x[k] ?? "";
    $("#vehSummary").textContent = `✎ ${x.label}`;
    $("#vehDelete").hidden = false;
    $("#vehDetails").open = true;
    $("#vehDetails").scrollIntoView({ behavior: "smooth" });
  });
  vf.addEventListener("submit", async (e) => {
    e.preventDefault();
    const row = {
      label: vf.label.value.trim(), driver_name: vf.driver_name.value.trim() || null, driver_phone: vf.driver_phone.value.trim() || null,
      capacity: vf.capacity.value ? Number(vf.capacity.value) : null, hamlet_id: vf.hamlet_id.value ? Number(vf.hamlet_id.value) : null,
      notes: vf.notes.value.trim() || null,
    };
    const { error } = vf.id.value
      ? await sb.from("vehicles").update(row).eq("id", Number(vf.id.value))
      : await sb.from("vehicles").insert(row);
    if (error) return fail(error);
    toast(t("saved"));
    viewTransport();
  });
  $("#vehDelete").addEventListener("click", async () => {
    const id = Number(vf.id.value);
    if (!id || !confirm(`${t("delete")} ${vehicleName(id)}? ${booked(id)} ${t("riders_unbooked")}`)) return;
    const { error } = await sb.from("vehicles").delete().eq("id", id);
    if (error) return fail(error);
    toast(t("saved"));
    viewTransport();
  });
}

// Printable list of who one vehicle picks up, house by house.
async function viewRoster(id) {
  setTab("dash");
  main.innerHTML = `<p class="center muted">…</p>`;
  let rows;
  try {
    await loadVehicles();
    rows = await fetchAll(() => sb.from("voters").select(VOTER_COLS).eq("vehicle_id", id));
  } catch (e) { return fail(e); }
  const x = vehicles.find((y) => y.id === id);
  if (!x) { main.innerHTML = `<p class="empty">${esc(t("no_results"))}</p>`; return; }
  rows.sort((a, b) => a.hamlet_id - b.hamlet_id || String(a.house_no).localeCompare(String(b.house_no), "en", { numeric: true }) || a.serial - b.serial);
  main.innerHTML = `
    <div class="noprint row" style="justify-content:space-between;margin-bottom:10px">
      <a class="btn small" href="#/transport">← ${esc(t("back"))}</a>
      <button class="primary" onclick="window.print()">🖨 ${esc(t("print"))}</button>
    </div>
    <h1>🚗 ${esc(x.label)} · ${esc(t("roster"))}</h1>
    <p class="small">${esc(x.driver_name || "")}${x.driver_phone ? " · 📞 " + esc(x.driver_phone) : ""}${x.hamlet_id ? " · " + esc(hamletName(x.hamlet_id)) : ""} · 👥 ${rows.length}${x.capacity ? "/" + x.capacity : ""}${x.notes ? " · " + esc(x.notes) : ""}</p>
    <div class="tablewrap"><table class="walk">
      <thead><tr><th>#</th><th>${esc(t("hamlet"))}</th><th>🏠</th><th>${esc(t("name"))}</th><th>${esc(t("age"))}</th><th>${esc(t("phone"))}</th><th>${esc(t("picked_up"))}</th><th>${esc(t("st_voted"))}</th></tr></thead>
      <tbody>${rows.map((v) => `<tr><td>${v.serial}</td><td>${esc(hamletName(v.hamlet_id))}</td><td>${esc(v.house_no || "")}</td>
        <td><a href="#/v/${v.serial}" style="color:inherit;text-decoration:none"><b>${esc(v.name)}</b></a><div class="pm">${esc(t("rel_" + (v.relation_type || "other")))}: ${esc(v.relation_name || "")}</div></td>
        <td>${esc(v.age ?? "")}${v.gender ? " " + v.gender : ""}</td><td>${esc(v.phone || "")}</td><td class="c">☐</td><td class="c">${v.voted ? "☑" : "☐"}</td></tr>`).join("")
        || `<tr><td colspan="8">${esc(t("no_results"))}</td></tr>`}</tbody>
    </table></div>`;
}

// ───────── router & boot ─────────
function route() {
  if (!me) return;
  if (dashChannel && !location.hash.startsWith("#/dash")) { sb.removeChannel(dashChannel); dashChannel = null; }
  const h = location.hash.replace(/^#/, "") || "/";
  const m = h.match(/^\/v\/(\d+)/);
  window.scrollTo(0, 0);
  if (m) return viewVoter(Number(m[1]));
  if (h.startsWith("/poll")) return viewPoll();
  if (h.startsWith("/dash")) return viewDash();
  if (h.startsWith("/team")) return viewTeam();
  if (h.startsWith("/print")) return viewPrint();
  const rm = h.match(/^\/transport\/(\d+)/);
  if (rm && hasTransport) return viewRoster(Number(rm[1]));
  if (h.startsWith("/transport") && hasTransport) return viewTransport();
  return viewSearch();
}
window.addEventListener("hashchange", route);

async function boot() {
  applyStaticText();
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY || !window.supabase) {
    main.innerHTML = `<p class="card">${esc(t("not_configured"))}</p>`;
    return;
  }
  sb ??= window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return viewLogin();
  const { data: prof, error } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  if (error || !prof || !prof.active) {
    await sb.auth.signOut();
    return viewLogin(error ? t("err") : t("no_profile"));
  }
  me = prof;
  const [{ data: hs }, , { error: vErr }] = await Promise.all([sb.from("hamlets").select("*").order("id"), loadTeam(),
    sb.from("vehicles").select("id").limit(1)]);
  hasTransport = !vErr;
  VOTER_COLS = hasTransport ? BASE_COLS + ",away_place,travel_plan,vehicle_id" : BASE_COLS;
  await loadVehicles();
  hamlets = hs || [];
  $("#who").textContent = me.full_name || me.username;
  $("#logoutBtn").hidden = false;
  $("#tabs").hidden = false;
  $$("#tabs [data-admin]").forEach((a) => (a.hidden = !isAdmin()));
  route();
}
boot();
