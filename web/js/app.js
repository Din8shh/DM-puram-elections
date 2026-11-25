import { STRINGS } from "./i18n.js";
import { hasTelugu, searchKey, translit, voterKey } from "./translit.js";

const CFG = window.APP_CONFIG || {};
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const main = $("#main");
const PAGE = 40;
const BASE_COLS = "serial,ward,hamlet_id,name,name_en,relation_type,relation_name,age,gender,house_no,epic,photo_path," +
  "needs_review,phone,leaning,contacted,contacted_at,notes,needs_transport,away,assigned_to,voted,voted_at,updated_at,slip_delivered,follow_up_on";
// Transport columns exist only after supabase/migrations/004_transport.sql has been run; boot() checks.
let hasTransport = false;
// "Unlikely" exists only after 005_support_scale.sql; boot() checks.
let hasUnlikely = false;
let VOTER_COLS = BASE_COLS;
const TRAVEL = ["unknown", "coming", "needs_help", "not_coming"];
// Support scale, lowest to highest.
const SCALE_ALL = ["opposed", "unlikely", "undecided", "leaning", "strong"];
const scale = () => (hasUnlikely ? SCALE_ALL : SCALE_ALL.filter((x) => x !== "unlikely"));
const LEANINGS = ["strong", "leaning", "undecided", "unlikely", "opposed", "unknown"];
const LEVEL = { opposed: 1, unlikely: 2, undecided: 3, leaning: 4, strong: 5, unknown: 0 };
const WEIGHT = { strong: 0.9, leaning: 0.7, undecided: 0.5, unlikely: 0.25, opposed: 0.05, unknown: 0 };
const SUP_COLOR = { strong: "#1F6B4A", leaning: "#8CC47E", undecided: "#E3B83F", unlikely: "#E58A54", opposed: "#8E2A2B", unknown: "#D6D1C4" };

// ───────── small helpers ─────────
const store = {
  get(k, d) { try { const v = localStorage.getItem("dmp." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("dmp." + k, JSON.stringify(v)); } catch { /* private mode */ } },
};
let lang = store.get("lang", "te");
const t = (k) => (STRINGS[lang] && STRINGS[lang][k]) || STRINGS.en[k] || k;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// English helper line under a Telugu label (only when the app is in Telugu).
const sub = (k) => (lang === "te" ? `<span class="en">${esc(STRINGS.en[k] || k)}</span>` : "");
const subIn = (k) => (lang === "te" ? `<span class="en in"> · ${esc(STRINGS.en[k] || k)}</span>` : "");
const loc = () => (lang === "te" ? "te-IN" : "en-IN");
const fmtTime = (iso) => iso ? new Date(iso).toLocaleString(loc(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
const fmtClock = (iso) => iso ? new Date(iso).toLocaleTimeString(loc(), { hour: "numeric", minute: "2-digit" }) : "";
const fmtDay = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" }) : "";
const fmtShort = (iso) => iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";
const pct = (a, b) => b ? Math.round((a / b) * 100) : 0;
const nf = (n) => Number(n || 0).toLocaleString("en-IN");
// Dates in India, as YYYY-MM-DD.
const todayIST = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const dayIST = (n) => new Date(Date.now() + 5.5 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400e3);
const relTime = (iso) => {
  if (!iso) return t("never");
  const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  const s = m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} hr` : `${Math.round(m / 1440)} d`;
  return `${s} ${t("ago")}`;
};
const initial = (s) => {
  s = String(s || "?").trim();
  try { return [...new Intl.Segmenter("te", { granularity: "grapheme" }).segment(s)][0]?.segment || "?"; } catch { return s[0] || "?"; }
};
const firstLine = (s) => String(s || "").split("\n")[0];

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M16 4a4 4 0 0 1 0 8M22 21c0-3-2-5-4-6"/>',
  userplus: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M16 11h6M19 8v6"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  phone: '<path d="M5 3h4l2 5-3 2a12 12 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A18 18 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  note: '<path d="M5 4h14v16H5zM8 9h8M8 13h8M8 17h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  ballot: '<path d="M4 12h16v8H4zM8 12V5h8v7M10 8.5l1.5 1.5L14 7"/>',
  car: '<path d="M5 17h14v-5l-2-5H7l-2 5zM5 12h14"/><circle cx="8" cy="17" r="1.5"/><circle cx="16" cy="17" r="1.5"/>',
  print: '<path d="M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z"/>',
  swap: '<path d="M7 7h12l-3-3M17 17H5l3 3"/>',
};
const icon = (name, style = "") => `<svg class="ic" ${style ? `style="${style}"` : ""} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
const bars = (n) => `<span class="bars">${[1, 2, 3, 4, 5].map((i) => `<i class="${i <= n ? "f" : ""}"></i>`).join("")}</span>`;
const supPill = (l, extra = "") => {
  l = l || "unknown";
  return `<span class="pill ${extra} s-${l}">${l !== "unknown" ? bars(LEVEL[l]) : ""}${esc(t("lean_" + l))}</span>`;
};
const leanChip = (l) => (l && l !== "unknown" ? supPill(l, "sm") : "");
const loading = `<p class="center muted" style="padding:40px 0">…</p>`;

let toastTimer;
function toast(msg, isErr = false, action = null) {
  const el = $("#toast");
  el.textContent = msg;
  if (action) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "toast-act"; b.textContent = action.label;
    b.addEventListener("click", () => { el.className = ""; action.run(); }, { once: true });
    el.append(b);
  }
  el.className = "show" + (isErr ? " err" : "") + (action ? " act" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), isErr ? 4000 : action ? 6000 : 1800);
}
function fail(error) {
  console.error(error);
  toast(navigator.onLine ? `${t("err")}: ${error?.message || error}` : t("offline"), true);
}

// ───────── state ─────────
let sb = null;
let me = null;              // profile row
let hamlets = [];           // [{id,name_te,name_en,serial_from,serial_to,target_votes}]
let team = [];              // profiles
let scopeMine = false;      // a worker with voters assigned sees "my voters" on Today and Follow-ups
const photoCache = new Map();
const isSuper = () => me?.role === "superadmin";
const isDesk = () => matchMedia("(min-width: 1000px)").matches;
const teamPeople = () => team;
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
const hamletSize = (h) => (h.serial_to && h.serial_from ? h.serial_to - h.serial_from + 1 : 0);
const personName = (id) => team.find((p) => p.id === id)?.full_name || "";
const pollMode = () => store.get("pollMode", false);
const scoped = (qb) => (scopeMine ? qb.eq("assigned_to", me.id) : qb);

async function photoUrls(paths) {
  const need = [...new Set(paths.filter((p) => p && !photoCache.has(p)))];
  if (need.length) {
    const { data, error } = await sb.storage.from("photos").createSignedUrls(need, 60 * 60 * 6);
    if (!error) data.forEach((d) => d.signedUrl && photoCache.set(d.path, d.signedUrl));
  }
  return (p) => photoCache.get(p) || "";
}

function rememberOpened(v) {
  const list = store.get("recent", []).filter((x) => x.serial !== v.serial);
  list.unshift({ serial: v.serial, name: v.name, house: v.house_no || "" });
  store.set("recent", list.slice(0, 6));
}

// ───────── chrome ─────────
function applyStaticText() {
  document.documentElement.lang = lang;
  $("#langBtn").textContent = lang === "te" ? "EN" : "తె";
  $("#langBtn").setAttribute("aria-label", lang === "te" ? "Switch to English" : "తెలుగులోకి మార్చు");
  $$("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
  $$("[data-sub]").forEach((el) => { el.textContent = lang === "te" ? STRINGS.en[el.dataset.sub] : ""; el.hidden = lang !== "te"; });
  $("#brand").textContent = CFG.TITLE || "DM Puram";
  renderInstall();
}

// ───────── install the app (home screen) ─────────
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function renderInstall() {
  const bar = $("#installBar");
  if (!bar) return;
  const snoozed = Date.now() < (store.get("installSnooze", 0) || 0);
  const evt = window.__installEvt;
  const ios = isIOS() && !evt;
  if (isStandalone() || snoozed || (!evt && !ios)) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = `
    <img src="icon-192.png" alt="" width="44" height="44">
    <div class="txt"><b>${esc(t("install_title"))}</b><span>${esc(ios ? t("install_ios") : t("install_sub"))}</span></div>
    ${ios ? "" : `<button class="primary" type="button" id="installBtn">${esc(t("install_btn"))}</button>`}
    <button class="x" type="button" id="installX" aria-label="${esc(t("close"))}">${icon("x", "width:18px;height:18px")}</button>`;
  $("#installBtn")?.addEventListener("click", async () => {
    const e = window.__installEvt;
    if (!e) return;
    e.prompt();
    const { outcome } = await e.userChoice;
    window.__installEvt = null;
    if (outcome !== "accepted") store.set("installSnooze", Date.now() + 3 * 864e5);
    renderInstall();
  });
  $("#installX").addEventListener("click", () => { store.set("installSnooze", Date.now() + 3 * 864e5); renderInstall(); });
}
window.addEventListener("installready", renderInstall);
window.addEventListener("appinstalled", () => { window.__installEvt = null; renderInstall(); toast(t("installed")); });
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
  main.classList.remove("has-bar", "wide");
  $("#actionbar")?.remove();
  $(".sheet-bg")?.remove();
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

// ───────── filters (shared by Voters, walk list, bulk assign) ─────────
const EMPTY_FILTERS = { q: "", hamlet: "", lean: "", status: "", gender: "", age: "", mine: false };
const filters = { ...EMPTY_FILTERS, ...store.get("filters", {}) };
if (filters.status === "mine") { filters.status = ""; filters.mine = true; }
function setFilters(patch) {
  Object.assign(filters, EMPTY_FILTERS, patch);
  store.set("filters", filters);
}

function applyFilters(qb, f) {
  if (f.hamlet) qb = qb.eq("hamlet_id", Number(f.hamlet));
  if (f.lean === "ours") qb = qb.in("leaning", ["strong", "leaning"]);
  else if (f.lean === "open") qb = qb.in("leaning", ["undecided", "unlikely", "unknown"]);
  else if (f.lean) qb = qb.eq("leaning", f.lean);
  if (f.gender) qb = qb.eq("gender", f.gender);
  if (f.age && AGE_FILTER[f.age]) qb = qb.gte("age", AGE_FILTER[f.age][0]).lte("age", AGE_FILTER[f.age][1]);
  if (f.mine) qb = qb.eq("assigned_to", me.id);
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

// Links anywhere with data-go='{"status":"..."}' open the Voters list with those filters.
document.addEventListener("click", (e) => {
  const a = e.target.closest("[data-go]");
  if (!a) return;
  e.preventDefault();
  setFilters(JSON.parse(a.dataset.go));
  location.hash = a.dataset.then || "#/voters";
});

// ───────── Today ─────────
async function viewToday() {
  setTab("today");
  main.innerHTML = loading;
  const today = todayIST();
  const count = (fn) => fn(scoped(sb.from("voters").select("serial", { count: "exact", head: true }))).then((r) => r.count ?? 0);
  const [total, visited, due, late, notVisited, ours, fifty] = await Promise.all([
    count((q) => q), count((q) => q.eq("contacted", true)), count((q) => q.lte("follow_up_on", today)),
    count((q) => q.lt("follow_up_on", today)), count((q) => q.eq("contacted", false)),
    count((q) => q.in("leaning", ["strong", "leaning"])), count((q) => q.eq("leaning", "undecided")),
  ]);
  const mine = scopeMine ? { mine: true } : {};
  const go = (patch) => esc(JSON.stringify({ ...mine, ...patch }));
  const recent = store.get("recent", []);
  const firstName = (me.full_name || me.username).split(" ")[0];
  const area = ["admin", "superadmin"].includes(me.role) ? t("all_hamlets") : (me.hamlet_ids || []).map(hamletName).join(", ");
  const task = (href, attrs, tile, title, sublabel) => `
    <a class="task" href="${href}" ${attrs}>
      ${tile}<span class="grow"><b>${title}</b><span class="en">${esc(sublabel)}</span></span>
      <span style="color:var(--muted)">${icon("chev")}</span>
    </a>`;
  const tasks = [
    due ? task("#/follow", "", `<span class="tile" style="background:var(--due-bg);color:var(--due)">${icon("cal")}</span>`,
      `${due} ${esc(t("dn_follow"))}`, `${STRINGS[lang === "te" ? "en" : lang].fu_due}${late ? ` · ${late} ${STRINGS.en.overdue.toLowerCase()}` : ""}`) : "",
    notVisited ? task("#/voters", `data-go="${go({ status: "not_contacted" })}"`, `<span class="tile">${icon("home")}</span>`,
      `${notVisited} ${esc(t("dn_notvisited"))}`, STRINGS.en.st_not_contacted) : "",
    fifty ? task("#/voters", `data-go="${go({ lean: "undecided" })}"`, `<span class="tile s-undecided">${bars(3)}</span>`,
      `${fifty} ${esc(t("dn_fifty"))}`, STRINGS.en.dn_fifty_sub) : "",
  ].join("");
  main.innerHTML = `
    <div style="margin:4px 0 16px">
      <div style="font-size:24px;font-weight:700;line-height:1.3">${esc(t("hello"))} ${esc(firstName)}</div>
      <span class="en" style="font-size:13px">${esc(t("role_" + me.role))}${area ? " · " + esc(area) : ""}</span>
    </div>
    <div class="searchbox" style="cursor:text">
      <a href="#/voters?focus" style="display:flex;align-items:center;gap:10px;flex:1;text-decoration:none;color:var(--muted);min-height:54px">
        <span style="color:var(--brand)">${icon("search")}</span>
        <span class="grow" style="font-size:16px">${esc(t("search_short"))}${sub("search_short")}</span>
      </a>
      <a class="btn k123 num" href="#/voters?num" aria-label="Search by number">123</a>
    </div>

    <div class="cols"><div class="col-a">
    <div class="card stack" style="margin-top:16px">
      <div class="row between" style="align-items:baseline">
        <div style="font-weight:700">${esc(t(scopeMine ? "my_voters" : "all_voters"))}${sub(scopeMine ? "my_voters" : "all_voters")}</div>
        <div class="num muted"><b style="font-size:26px;color:var(--ink)">${nf(visited)}</b> / ${nf(total)} ${esc(t("visited_word"))}</div>
      </div>
      <div class="track"><span style="width:${pct(visited, total)}%"></span></div>
      <div class="minis">
        <a class="mini" href="#/follow" style="background:var(--due-bg);color:var(--due)"><div class="n">${due}</div><b>${esc(t("fu_today"))}</b>${sub("fu_today")}</a>
        <a class="mini" href="#/voters" data-go="${go({ status: "not_contacted" })}"><div class="n">${nf(notVisited)}</div><b>${esc(t("st_not_contacted"))}</b>${sub("st_not_contacted")}</a>
        <a class="mini" href="#/voters" data-go="${go({ lean: "ours" })}" style="background:#E3F0DE;color:var(--s4)"><div class="n">${nf(ours)}</div><b>${esc(t("with_us"))}</b>${sub("with_us")}</a>
      </div>
    </div>

    ${tasks ? `<h2>${esc(t("do_next"))}${subIn("do_next")}</h2><div class="card flat">${tasks}</div>` : ""}
    </div><div class="col-b">
    <div class="card flat" style="margin-top:12px">
      <a class="task" href="#/poll"><span class="tile" style="background:var(--voted-bg);color:#1D3F6E">${icon("ballot")}</span>
        <span class="grow"><b>${esc(t("poll_card"))}</b>${sub("poll_card")}</span><span style="color:var(--muted)">${icon("chev")}</span></a>
    </div>

    ${recent.length ? `<h2>${esc(t("recent"))}${subIn("recent")}</h2>
      <div class="grid2">${recent.slice(0, 4).map((r) => `<a class="card row" href="#/v/${r.serial}" style="padding:12px;text-decoration:none;color:var(--ink);flex-wrap:nowrap">
        <span class="tile" style="width:40px;height:40px">${esc(initial(r.name))}</span>
        <span style="min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.name)}</b><span class="en">#${r.serial}${r.house ? " · " + esc(r.house) : ""}</span></span></a>`).join("")}</div>` : ""}
    </div></div>`;
}

// ───────── Voters (search) ─────────
function voterItem(v, url) {
  const rel = v.relation_name ? `${t("rel_" + (v.relation_type || "other"))}: ${v.relation_name}` : "";
  const today = todayIST();
  const bits = [v.name_en, rel, v.age && `${v.age} ${v.gender || ""}`.trim(), v.house_no && `${STRINGS.en.house} ${v.house_no}`, hamletName(v.hamlet_id)].filter(Boolean).join(" · ");
  const fu = v.follow_up_on ? (v.follow_up_on < today ? `<span class="pill sm p-late">${icon("cal", "width:14px;height:14px")}${esc(fmtDay(v.follow_up_on))}</span>`
    : v.follow_up_on === today ? `<span class="pill sm p-due">${icon("cal", "width:14px;height:14px")}${esc(t("today"))}</span>`
      : `<span class="pill sm">${icon("cal", "width:14px;height:14px")}${esc(fmtDay(v.follow_up_on))}</span>`) : "";
  const visit = v.contacted ? `<span class="pill sm p-done">${icon("check", "width:14px;height:14px")}${esc(t("st_contacted"))}${v.contacted_at ? " " + esc(fmtShort(v.contacted_at)) : ""}</span>`
    : `<span class="pill sm">${esc(t("st_not_contacted"))}</span>`;
  const quick = pollMode() ? `<button class="qv ${v.voted ? "" : "vote"}" data-quickvote="${v.serial}" ${v.voted ? "disabled" : ""} aria-label="Mark voted">${icon("check")}</button>` : "";
  return `<li><a class="vitem" href="#/v/${v.serial}">
    <img class="ph" alt="" loading="lazy" src="${esc(url(v.photo_path))}">
    <div class="main">
      <div class="nm"><span>${esc(v.name || "—")}</span><span class="sn">#${v.serial}</span></div>
      <div class="sub">${esc(bits)}</div>
      <div class="meta">${leanChip(v.leaning)}${v.voted ? `<span class="pill sm p-voted">${icon("check", "width:14px;height:14px")}${esc(t("st_voted"))}</span>` : visit}${fu}${v.needs_review ? `<span class="pill sm p-review">!</span>` : ""}</div>
    </div>${quick}</a></li>`;
}

async function viewSearch(params = "") {
  setTab("voters");
  if (isDesk() && canAssign()) return viewVotersDesk(params);
  const opt = (val, label, cur) => `<option value="${esc(val)}" ${String(cur) === String(val) ? "selected" : ""}>${esc(label)}</option>`;
  const numMode = params.includes("num") || store.get("numMode", false);
  const chip = (key, val, label) => `<button class="chip-btn ${String(filters[key]) === String(val) ? "on" : ""}" data-chip="${key}" data-val="${esc(val)}">${esc(label)}</button>`;
  const statusList = ["follow_up_due", "not_contacted", "contacted", "slip_pending", "slip_done", "not_voted", "voted", "ours_not_voted",
    "transport", ...(hasTransport ? ["ride_unbooked"] : []), "away", ...(hasTransport ? ["away_unknown", "away_needs_help"] : []),
    "has_phone", ...(canAssign() ? ["unassigned"] : []), "review"];
  main.innerHTML = `
    <h1>${esc(t("tab_voters"))}${subIn("tab_voters")}</h1>
    <label class="searchbox">
      <span style="color:var(--brand)">${icon("search")}</span>
      <input type="search" id="q" aria-label="${esc(t("search_ph"))}" placeholder="${esc(t("search_short"))}" value="${esc(filters.q)}" enterkeyhint="search" autocomplete="off" ${numMode ? 'inputmode="numeric"' : ""}>
      <button type="button" class="k123 num ${numMode ? "on" : ""}" id="numBtn" aria-pressed="${numMode}">123</button>
    </label>
    <div class="chips" style="margin-top:10px">
      <select class="chip-btn" id="fHamlet" aria-label="${esc(t("hamlet"))}">${opt("", t("all_hamlets"), filters.hamlet)}${hamlets.map((h) => opt(h.id, hamletName(h.id), filters.hamlet)).join("")}</select>
      ${chip("status", "not_contacted", t("st_not_contacted"))}
      ${chip("status", "follow_up_due", t("tab_follow"))}
      ${chip("gender", "F", t("women"))}
      ${chip("age", "youth", t("youth"))}
      ${me.role === "worker" || scopeMine ? chip("mine", "true", t("mine")) : ""}
      <button class="chip-btn" id="moreBtn" aria-expanded="false">${esc(t("more_filters"))} ${icon("down", "width:16px;height:16px")}</button>
    </div>
    <div class="chips">
      ${[...scale()].reverse().map((l) => `<button class="chip-btn ${filters.lean === l ? "on" : ""}" data-lean="${l}" style="padding:0 12px">${bars(LEVEL[l])} ${esc(t("lean_" + l))}</button>`).join("")}
      <button class="chip-btn ${filters.lean === "unknown" ? "on" : ""}" data-lean="unknown">${esc(t("lean_unknown"))}</button>
    </div>
    <div class="card stack" id="moreBox" hidden style="margin-top:8px">
      <label class="f">${esc(t("all_status"))}<select id="fStatus">${opt("", t("all_status"), filters.status)}${statusList.map((s) => opt(s, t("st_" + s), filters.status)).join("")}</select></label>
      <div class="grid2">
        <label class="f">${esc(t("support"))}<select id="fLean">${opt("", t("all_leanings"), filters.lean)}${opt("ours", t("ours"), filters.lean)}${LEANINGS.filter((l) => hasUnlikely || l !== "unlikely").map((l) => opt(l, t("lean_" + l), filters.lean)).join("")}</select></label>
        <label class="f">${esc(t("gender"))}<select id="fGender">${opt("", t("all_genders"), filters.gender)}${opt("M", t("male"), filters.gender)}${opt("F", t("female"), filters.gender)}</select></label>
      </div>
      ${canAssign() ? `<div class="row small">
        <span class="muted">${esc(t("assign_shown"))}</span>
        <select id="bulkWorker" style="flex:1;min-width:140px"><option value="">—</option><option value="__none">${esc(t("nobody"))}</option>${team.filter((p) => p.active).map((p) => `<option value="${p.id}">${esc(p.full_name || p.username)}</option>`).join("")}</select>
        <button class="small" id="bulkAssign">${esc(t("assign"))}</button>
      </div>` : ""}
      <div class="row">
        <a class="btn small" href="#/print">${icon("print", "width:18px;height:18px")} ${esc(t("walk_list"))}</a>
        ${isSuper() ? `<button class="small" id="csvBtn">⬇ ${esc(t("export_csv"))}</button>` : ""}
      </div>
    </div>
    <div class="row between small muted" style="margin:8px 2px">
      <span id="count" class="num"></span>
      <button class="ghost small" id="clearBtn" style="color:var(--brand)">${esc(t("clear_all"))}</button>
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
    $("#count").textContent = `${nf(total)} ${t("found")}`;
    $("#more").hidden = offset >= total;
    if (!total) list.innerHTML = `<li class="empty">${esc(t("no_results"))}</li>`;
  }
  const save = () => store.set("filters", filters);
  let deb;
  $("#q").addEventListener("input", (e) => {
    filters.q = e.target.value; save();
    clearTimeout(deb); deb = setTimeout(() => load(true), 300);
  });
  if (params.includes("focus") || params.includes("num")) setTimeout(() => $("#q").focus(), 50);
  $("#numBtn").addEventListener("click", () => {
    const on = !store.get("numMode", false);
    store.set("numMode", on);
    const q = $("#q");
    if (on) q.setAttribute("inputmode", "numeric"); else q.removeAttribute("inputmode");
    $("#numBtn").classList.toggle("on", on);
    q.blur(); q.focus();
  });
  $("#fHamlet").addEventListener("change", (e) => { filters.hamlet = e.target.value; save(); load(true); });
  for (const [id, key] of [["fStatus", "status"], ["fLean", "lean"], ["fGender", "gender"]]) {
    $("#" + id).addEventListener("change", (e) => { filters[key] = e.target.value; save(); viewSearch("more"); });
  }
  $$("[data-chip]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.chip, val = k === "mine" ? true : b.dataset.val;
    filters[k] = String(filters[k]) === String(val) ? EMPTY_FILTERS[k] : val;
    save(); viewSearch();
  }));
  $$("[data-lean]").forEach((b) => b.addEventListener("click", () => {
    filters.lean = filters.lean === b.dataset.lean ? "" : b.dataset.lean;
    save(); viewSearch();
  }));
  $("#moreBtn").addEventListener("click", () => {
    const box = $("#moreBox"); box.hidden = !box.hidden;
    $("#moreBtn").setAttribute("aria-expanded", String(!box.hidden));
  });
  if (params.includes("more")) { $("#moreBox").hidden = false; }
  $("#clearBtn").addEventListener("click", () => { setFilters({}); viewSearch(); });
  $("#more").addEventListener("click", () => load(false));
  list.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-quickvote]");
    if (!b) return;
    e.preventDefault();
    b.disabled = true;
    const serial = Number(b.dataset.quickvote);
    const { error } = await sb.from("voters").update({ voted: true }).eq("serial", serial);
    if (error) { b.disabled = false; return fail(error); }
    b.classList.remove("vote");
    toast(`${serial} ✓ ${t("st_voted")}`);
  });
  $("#csvBtn")?.addEventListener("click", () => exportCsv());
  $("#bulkAssign")?.addEventListener("click", async () => {
    const who = $("#bulkWorker").value;
    if (!who || !total) return;
    const name = who === "__none" ? t("nobody") : personName(who);
    if (!confirm(`${t("assign_confirm")} ${total} → ${name}?`)) return;
    const { error } = await applyFilters(sb.from("voters").update({ assigned_to: who === "__none" ? null : who }), filters);
    if (error) return fail(error);
    toast(`${total} → ${name}`);
    load(true);
  });
  load(true);
}

// ───────── single voter ─────────
async function viewVoter(serial, openVisit = false) {
  setTab("voters");
  main.innerHTML = loading;
  const [{ data: v, error }] = await Promise.all([sb.from("voters").select("*").eq("serial", serial).maybeSingle(), loadVehicles()]);
  if (error) return fail(error);
  if (!v) { main.innerHTML = `<p class="empty">${esc(t("not_found"))}</p>`; return; }
  rememberOpened(v);

  const [{ data: house }, { data: hist }] = await Promise.all([
    v.house_no ? sb.from("voters").select("serial,name,age,gender,leaning,voted,photo_path,relation_type,relation_name,house_no,hamlet_id,contacted,needs_review")
      .eq("hamlet_id", v.hamlet_id).eq("house_no", v.house_no).neq("serial", v.serial).order("serial") : { data: [] },
    sb.from("activity").select("at,action,detail,user_id").eq("voter_serial", v.serial).order("at", { ascending: false }).limit(15),
  ]);
  const url = await photoUrls([v.photo_path]);
  const tel = (v.phone || "").replace(/[^\d+]/g, "");
  const today = todayIST();
  const visitBy = (hist || []).find((h) => h.detail?.contacted === true)?.user_id;
  const fuClass = v.follow_up_on && v.follow_up_on <= today ? "due" : "";
  const fuSub = !v.follow_up_on ? "" : v.follow_up_on < today ? `${daysBetween(v.follow_up_on, today)} ${STRINGS.en.days_late}`
    : v.follow_up_on === today ? STRINGS.en.today : `in ${daysBetween(today, v.follow_up_on)} days`;
  const sc = scale();
  const showVote = pollMode() || v.voted;

  main.innerHTML = `
    <div class="topbar">
      <button class="iconbtn" id="backBtn" aria-label="${esc(t("back"))}">${icon("back")}</button>
      <span class="sn" style="font-size:18px">${esc(t("serial"))} #${v.serial}</span>
      ${tel ? `<a class="btn iconbtn callbtn" href="tel:${esc(tel)}" aria-label="${esc(t("call"))} ${esc(v.phone)}">${icon("phone")}</a>` : `<span style="width:48px"></span>`}
    </div>
    <div class="cols"><div class="col-a">
    <div class="card">
      <div class="vhead">
        <img class="photo" alt="" src="${esc(url(v.photo_path))}">
        <div class="grow">
          <h1>${esc(v.name)}</h1>
          <span class="en" style="font-size:14px">${esc(v.name_en || "")}</span>
          <dl class="kv">
            <dt>${esc(t("rel_" + (v.relation_type || "other")))}</dt><dd>${esc(v.relation_name || "—")}</dd>
            <dt>${esc(t("age"))}</dt><dd>${esc(v.age ?? "—")} · ${v.gender === "F" ? esc(t("female")) : v.gender === "M" ? esc(t("male")) : "—"}</dd>
            <dt>${esc(t("house"))}</dt><dd>${esc(v.house_no || "—")} · ${esc(hamletName(v.hamlet_id))}</dd>
            <dt>${esc(t("epic"))}</dt><dd class="num">${esc(v.epic || "—")}</dd>
          </dl>
        </div>
      </div>
      ${v.needs_review ? `<p class="pill p-review" style="margin:10px 0 0;height:auto;padding:4px 10px;white-space:normal">! ${esc(t("review_flag"))}</p>` : ""}
    </div>

    <div class="trio" style="margin-top:12px">
      <div class="card">${v.contacted
        ? `<span class="en">${esc(STRINGS.en.st_contacted)}</span><b style="color:var(--brand);display:flex;align-items:center;gap:4px">${icon("check", "width:16px;height:16px")}${esc(v.contacted_at ? fmtShort(v.contacted_at) : t("st_contacted"))}</b><span class="en">${visitBy ? "by " + esc(personName(visitBy)) : ""}</span>`
        : `<span class="en">${esc(STRINGS.en.st_contacted)}</span><b>${esc(t("not_yet"))}</b>`}</div>
      <div class="card ${fuClass}"><span class="en">${esc(STRINGS.en.tab_follow)}</span><b>${esc(v.follow_up_on ? fmtDay(v.follow_up_on) : "—")}</b><span class="en">${esc(fuSub)}</span></div>
      <div class="card"><span class="en">${esc(STRINGS.en.worker)}</span><b>${esc(personName(v.assigned_to) || "—")}</b></div>
    </div>

    ${showVote ? `<div class="card ${v.voted ? "votedbox" : ""}" style="margin-top:12px" id="voteCard">
      ${v.voted
        ? `<div class="row between"><strong style="color:var(--voted)">✓ ${esc(t("st_voted"))}</strong><span class="small muted">${esc(fmtTime(v.voted_at))}${v.voted_by ? " · " + esc(personName(v.voted_by)) : ""}</span></div>
           <button class="small danger" id="unvoteBtn" style="margin-top:8px">${esc(t("undo_voted"))}</button>`
        : `<button class="vote big" id="voteBtn">${icon("ballot")} ${esc(t("mark_voted"))}</button>`}
    </div>` : ""}

    <div class="card" style="margin-top:12px">
      <div class="row between" style="align-items:flex-start;margin-bottom:12px">
        <div style="font-weight:700">${esc(t("support_prob"))}${sub("support_prob")}</div>
        ${v.leaning && v.leaning !== "unknown" ? `<span class="pill s-${v.leaning}">${esc(t("lean_" + v.leaning))} · ${Math.round(WEIGHT[v.leaning] * 100)}%</span>` : supPill("unknown")}
      </div>
      <div class="supgrid ${sc.length === 4 ? "four" : ""}" id="supGrid">
        ${sc.map((l) => `<button type="button" class="sup c-${l} ${v.leaning === l ? "on" : ""}" data-l="${l}" aria-pressed="${v.leaning === l}">${bars(LEVEL[l])}<span class="lbl">${esc(t("lean_" + l))}</span></button>`).join("")}
      </div>
      ${lang === "te" ? `<div class="suplabels en ${sc.length === 4 ? "four" : ""}">${sc.map((l) => `<span>${esc(STRINGS.en["lean_" + l])}</span>`).join("")}</div>` : ""}
      ${v.leaning && v.leaning !== "unknown" ? `<div class="muted" style="font-size:13px;margin-top:8px">${esc(t("tap_clear"))}${sub("tap_clear")}</div>` : ""}
    </div>

    </div><div class="col-b">
    ${house?.length ? `<div class="card" style="margin-top:12px">
      <div class="row between">
        <div style="font-weight:700">${esc(t("same_house"))} (${house.length + 1})${sub("same_house")}</div>
        <div class="row" style="gap:6px">
          <button class="small" id="houseLean">${esc(t("same_all"))}</button>
          <button class="small" id="houseSlip">${esc(t("slips_all"))}</button>
        </div>
      </div>
      <div class="row" style="margin-top:10px;gap:6px">${house.map((h) => `<a class="pill s-${h.leaning || "unknown"}" style="height:34px;text-decoration:none" href="#/v/${h.serial}">${esc(h.name)} · ${esc(h.age ?? "")} ${esc(h.gender || "")}</a>`).join("")}</div>
    </div>` : ""}

    ${v.notes ? `<div class="card row" style="margin-top:12px;align-items:flex-start;flex-wrap:nowrap">
      <span style="color:var(--muted)">${icon("note")}</span>
      <div style="font-size:15px;white-space:pre-line">${esc(v.notes)}<span class="en">${esc(STRINGS.en.last_note)}</span></div>
    </div>` : ""}

    <details class="card" style="margin-top:12px" id="moreDetails">
      <summary>${esc(t("more_details"))}${subIn("more_details")}</summary>
      <form class="stack" id="campForm" style="margin-top:12px">
        <label class="f">${esc(t("phone"))}<input name="phone" type="tel" inputmode="tel" value="${esc(v.phone || "")}"></label>
        <label class="check"><input type="checkbox" name="contacted" ${v.contacted ? "checked" : ""}> ${esc(t("st_contacted"))}</label>
        <label class="check"><input type="checkbox" name="slip_delivered" ${v.slip_delivered ? "checked" : ""}> ${esc(t("slip"))}</label>
        <div class="row" style="flex-wrap:nowrap">
          <label class="f grow">${esc(t("follow_up"))}<input type="date" name="follow_up_on" value="${esc(v.follow_up_on || "")}"></label>
          <button type="button" class="iconbtn" style="margin-top:18px" id="fuClear" aria-label="Clear date">${icon("x")}</button>
        </div>
        <label class="check"><input type="checkbox" name="needs_transport" ${v.needs_transport ? "checked" : ""}> ${esc(t("transport"))}</label>
        ${hasTransport ? `<label class="f" id="vehBox" ${v.needs_transport || v.vehicle_id ? "" : "hidden"}>${esc(t("vehicle"))}<select name="vehicle_id"><option value="">${esc(t("not_booked"))}</option>${vehicles.map((x) => `<option value="${x.id}" ${x.id === v.vehicle_id ? "selected" : ""}>${esc(x.label)}${x.driver_name ? " · " + esc(x.driver_name) : ""}</option>`).join("")}</select></label>` : ""}
        <label class="check"><input type="checkbox" name="away" ${v.away ? "checked" : ""}> ${esc(t("away"))}</label>
        ${hasTransport ? `<div class="grid2" id="awayBox" ${v.away ? "" : "hidden"}>
          <label class="f">${esc(t("away_place"))}<input name="away_place" value="${esc(v.away_place || "")}" placeholder="${esc(t("away_place_ph"))}"></label>
          <label class="f">${esc(t("travel_plan"))}<select name="travel_plan">${TRAVEL.map((x) => `<option value="${x}" ${v.travel_plan === x ? "selected" : ""}>${esc(t("tp_" + x))}</option>`).join("")}</select></label>
        </div>` : ""}
        ${canAssign() ? `<label class="f">${esc(t("assigned"))}<select name="assigned_to"><option value="">${esc(t("nobody"))}</option>${team.filter((p) => p.active).map((p) => `<option value="${p.id}" ${p.id === v.assigned_to ? "selected" : ""}>${esc(p.full_name || p.username)}</option>`).join("")}</select></label>` : ""}
        <label class="f">${esc(t("notes"))}<textarea name="notes">${esc(v.notes || "")}</textarea></label>
        <button class="primary" type="submit">${esc(t("save"))}</button>
      </form>
    </details>

    ${isSuper() ? `
    <details class="card" style="margin-top:12px"><summary>${esc(t("edit_details"))}</summary>
      <form class="stack" id="rollForm" style="margin-top:10px">
        <label class="f">${esc(t("name"))}<input name="name" value="${esc(v.name)}"></label>
        <div class="grid2">
          <label class="f">${esc(t("relation_name"))}<select name="relation_type">${["father", "husband", "mother", "other"].map((r) => `<option value="${r}" ${v.relation_type === r ? "selected" : ""}>${esc(t("rel_" + r))}</option>`).join("")}</select></label>
          <label class="f">&nbsp;<input name="relation_name" value="${esc(v.relation_name || "")}"></label>
        </div>
        <div class="grid2">
          <label class="f">${esc(t("age"))}<input name="age" type="number" min="18" max="120" value="${esc(v.age ?? "")}"></label>
          <label class="f">${esc(t("gender"))}<select name="gender"><option value="M" ${v.gender === "M" ? "selected" : ""}>${esc(t("male"))}</option><option value="F" ${v.gender === "F" ? "selected" : ""}>${esc(t("female"))}</option><option value="O" ${v.gender === "O" ? "selected" : ""}>O</option></select></label>
        </div>
        <label class="f">${esc(t("house"))}<input name="house_no" value="${esc(v.house_no || "")}"></label>
        <label class="f">${esc(t("epic"))}<input name="epic" value="${esc(v.epic || "")}" autocapitalize="characters"></label>
        <label class="check"><input type="checkbox" name="needs_review" ${v.needs_review ? "checked" : ""}> ${esc(t("st_review"))}</label>
        <button type="submit">${esc(t("save"))}</button>
      </form>
    </details>` : ""}

    ${hist?.length ? `<h2>${esc(t("history"))}</h2><ul class="hist">${hist.map((h) => `<li>${esc(fmtTime(h.at))} · ${esc(personName(h.user_id) || "—")} · ${esc(describe(h))}</li>`).join("")}</ul>` : ""}
    </div></div>
  `;
  main.classList.add("has-bar");
  document.body.insertAdjacentHTML("beforeend", `<div class="actionbar" id="actionbar"><div>
    <button class="primary big" id="visitBtn">${icon("check")}<span>${esc(t("record_visit"))}${sub("record_visit")}</span></button>
  </div></div>`);

  const reload = () => viewVoter(v.serial);
  const update = async (patch) => {
    const { error: err } = await sb.from("voters").update(patch).eq("serial", v.serial);
    if (err) { fail(err); return false; }
    toast(t("saved"));
    return true;
  };
  $("#visitBtn").addEventListener("click", () => openVisitSheet(v));
  if (matchMedia("(min-width: 1000px)").matches) $("#moreDetails").open = true; // plenty of room on a laptop
  if (openVisit) openVisitSheet(v);
  $("#backBtn").addEventListener("click", () => (history.length > 1 ? history.back() : (location.hash = "#/voters")));
  $("#supGrid").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-l]");
    if (!b) return;
    const before = { leaning: v.leaning || "unknown", contacted: !!v.contacted };
    // Tapping the chosen level again clears it. Choosing a level means someone spoke to them.
    const patch = b.dataset.l === v.leaning ? { leaning: "unknown" } : { leaning: b.dataset.l, contacted: true };
    const { error: err } = await sb.from("voters").update(patch).eq("serial", v.serial);
    if (err) return fail(err);
    reload();
    toast(patch.leaning === "unknown" ? t("sup_cleared") : t("saved"), false, { label: t("undo"), run: async () => {
      const { error: e2 } = await sb.from("voters").update(before).eq("serial", v.serial);
      if (e2) return fail(e2);
      toast(t("undone"));
      if (location.hash.startsWith(`#/v/${v.serial}`)) reload();
    } });
  });
  const houseUpdate = async (patch) => {
    const { error: err } = await sb.from("voters").update(patch).eq("hamlet_id", v.hamlet_id).eq("house_no", v.house_no);
    if (err) return fail(err);
    toast(t("saved"));
    reload();
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
  const cf = $("#campForm");
  $("#fuClear").addEventListener("click", () => { cf.follow_up_on.value = ""; });
  cf.needs_transport.addEventListener("change", () => { if ($("#vehBox")) $("#vehBox").hidden = !cf.needs_transport.checked && !cf.vehicle_id.value; });
  cf.away.addEventListener("change", () => { if ($("#awayBox")) $("#awayBox").hidden = !cf.away.checked; });
  cf.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const patch = {
      contacted: f.contacted.checked, phone: f.phone.value.trim() || null,
      needs_transport: f.needs_transport.checked, away: f.away.checked, notes: f.notes.value.trim() || null,
      slip_delivered: f.slip_delivered.checked, follow_up_on: f.follow_up_on.value || null,
    };
    if (f.assigned_to) patch.assigned_to = f.assigned_to.value || null;
    if (hasTransport) {
      patch.vehicle_id = f.vehicle_id.value ? Number(f.vehicle_id.value) : null;
      patch.away_place = f.away_place.value.trim() || null;
      patch.travel_plan = f.travel_plan.value;
    }
    if (await update(patch)) reload();
  });
  $("#voteBtn")?.addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    const { error: err } = await sb.from("voters").update({ voted: true }).eq("serial", v.serial);
    if (err) { $("#voteBtn").disabled = false; return fail(err); }
    rememberMark(v);
    toast(`${v.serial} ✓ ${t("st_voted")}`);
    reload();
  });
  $("#unvoteBtn")?.addEventListener("click", async () => {
    if (!confirm(t("confirm_undo"))) return;
    if (await update({ voted: false })) reload();
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
    if (await update(patch)) reload();
  });
}

// One sheet for a door-to-door visit: who was met, support, when to come back.
function openVisitSheet(v) {
  $(".sheet-bg")?.remove();
  const st = { met: "voter", lean: v.leaning || "unknown", fu: null, date: "", slip: !!v.slip_delivered };
  const sc = scale();
  const fuOpts = [["1", "fu_tomorrow"], ["3", "fu_3"], ["7", "fu_week"], ["pick", "fu_pick"], ["none", "fu_none"]];
  document.body.insertAdjacentHTML("beforeend", `
  <div class="sheet-bg" id="sheetBg">
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(t("record_visit"))}">
      <div class="grab"></div>
      <div class="row between" style="flex-wrap:nowrap">
        <div style="font-size:20px;font-weight:700">${esc(t("record_visit"))}<span class="en">${esc(v.name_en || v.name)} · #${v.serial}${v.house_no ? " · " + esc(STRINGS.en.house) + " " + esc(v.house_no) : ""}</span></div>
        <button class="iconbtn" id="sheetX" aria-label="Close" style="border-radius:24px;background:var(--s0-bg);border:0">${icon("x")}</button>
      </div>
      <div class="step"><b>1</b>${esc(t("who_met"))}${subIn("who_met")}</div>
      <div class="grid3" id="metOpts">${["voter", "family", "nobody"].map((m) => `<button type="button" class="opt ${m === "voter" ? "on" : ""}" data-met="${m}">${esc(t("met_" + m))}</button>`).join("")}</div>
      ${lang === "te" ? `<div class="grid3 en center" style="margin-top:4px">${["voter", "family", "nobody"].map((m) => `<span>${esc(STRINGS.en["met_" + m])}</span>`).join("")}</div>` : ""}
      <div class="step"><b>2</b>${esc(t("support_q"))}${subIn("support_q")}</div>
      <div class="supgrid ${sc.length === 4 ? "four" : ""}" id="visLean">${sc.map((l) => `<button type="button" class="sup c-${l} ${st.lean === l ? "on" : ""}" data-l="${l}">${bars(LEVEL[l])}<span class="lbl">${esc(t("lean_" + l))}</span></button>`).join("")}</div>
      ${lang === "te" ? `<div class="suplabels en ${sc.length === 4 ? "four" : ""}">${sc.map((l) => `<span>${esc(STRINGS.en["lean_" + l])}</span>`).join("")}</div>` : ""}
      <div class="step"><b>3</b>${esc(t("fu_q"))}${subIn("fu_q")}</div>
      <div class="row" id="fuOpts" style="gap:8px">${fuOpts.map(([k, lbl]) => `<button type="button" class="opt" data-fu="${k}">${k === "pick" ? icon("cal", "width:18px;height:18px") : ""}${esc(t(lbl))}${["1", "3", "7"].includes(k) ? `<span class="num" style="font-size:12px;opacity:.8"> · ${esc(fmtDay(dayIST(Number(k))))}</span>` : ""}</button>`).join("")}</div>
      <input type="date" id="fuDate" hidden style="margin-top:8px" min="${todayIST()}">
      ${v.follow_up_on ? `<div class="en" style="margin-top:6px">Now: ${esc(fmtDay(v.follow_up_on))}</div>` : ""}
      <label class="toggle"><span>${esc(t("slip"))}${sub("slip")}</span><input type="checkbox" id="slipT" ${st.slip ? "checked" : ""}></label>
      <label class="f" style="margin-top:16px">${esc(t("note_opt"))}<textarea id="visNote" style="min-height:64px"></textarea></label>
      <button class="primary big" id="visSave" style="margin-top:16px">${icon("check")}<span>${esc(t("save_visit"))}${sub("save_visit")}</span></button>
    </div>
  </div>`);
  const bg = $("#sheetBg");
  const close = () => { bg.remove(); if (location.hash.endsWith("/visit")) history.replaceState(null, "", `#/v/${v.serial}`); };
  $("#sheetX").addEventListener("click", close);
  bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
  $("#metOpts").addEventListener("click", (e) => {
    const b = e.target.closest("[data-met]"); if (!b) return;
    st.met = b.dataset.met;
    $$("#metOpts [data-met]").forEach((x) => x.classList.toggle("on", x === b));
  });
  $("#visLean").addEventListener("click", (e) => {
    const b = e.target.closest("[data-l]"); if (!b) return;
    st.lean = st.lean === b.dataset.l ? "unknown" : b.dataset.l;
    $$("#visLean [data-l]").forEach((x) => x.classList.toggle("on", x.dataset.l === st.lean));
  });
  $("#fuOpts").addEventListener("click", (e) => {
    const b = e.target.closest("[data-fu]"); if (!b) return;
    st.fu = st.fu === b.dataset.fu ? null : b.dataset.fu;
    $$("#fuOpts [data-fu]").forEach((x) => x.classList.toggle("on", x.dataset.fu === st.fu));
    $("#fuDate").hidden = st.fu !== "pick";
    if (st.fu === "pick") $("#fuDate").focus();
  });
  $("#visSave").addEventListener("click", async (e) => {
    const patch = { slip_delivered: $("#slipT").checked };
    if (st.met !== "nobody") patch.contacted = true;
    if (st.lean !== (v.leaning || "unknown")) patch.leaning = st.lean;
    if (st.fu === "none") patch.follow_up_on = null;
    else if (st.fu === "pick") { if ($("#fuDate").value) patch.follow_up_on = $("#fuDate").value; }
    else if (st.fu) patch.follow_up_on = dayIST(Number(st.fu));
    let note = $("#visNote").value.trim();
    if (!note && st.met === "nobody") note = t("met_nobody");
    if (note) patch.notes = `${fmtShort(new Date().toISOString())}: ${note}${v.notes ? "\n" + v.notes : ""}`;
    e.currentTarget.disabled = true;
    const { error } = await sb.from("voters").update(patch).eq("serial", v.serial);
    if (error) { $("#visSave").disabled = false; return fail(error); }
    toast(t("saved"));
    history.replaceState(null, "", `#/v/${v.serial}`);
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
    if (typeof val === "boolean") return `${t(k === "needs_transport" ? "st_transport" : k === "away" ? "st_away" : k === "slip_delivered" ? "slip" : k === "contacted" ? "st_contacted" : k)}: ${val ? "✓" : "✗"}`;
    if (k === "follow_up_on") return `${t("follow_up")}: ${val ? fmtDay(val) : "—"}`;
    if (k === "vehicle_id") return `${t("vehicle")}: ${vehicleName(val) || t("not_booked")}`;
    if (k === "travel_plan") return `${t("travel_plan")}: ${t("tp_" + val)}`;
    if (k === "notes") return `${t("notes")}: ${firstLine(val)}`;
    return `${t(k === "house_no" ? "house" : k)}: ${val ?? "—"}`;
  }).join(", ");
}

// ───────── Follow-ups ─────────
async function viewFollow() {
  setTab("follow");
  main.innerHTML = loading;
  const today = todayIST(), week = dayIST(7);
  const seg = store.get("fuSeg", "today");
  const range = { late: (q) => q.lt("follow_up_on", today), today: (q) => q.eq("follow_up_on", today), week: (q) => q.gt("follow_up_on", today).lte("follow_up_on", week) };
  const count = (k) => range[k](scoped(sb.from("voters").select("serial", { count: "exact", head: true }))).then((r) => r.count ?? 0);
  const [nLate, nToday, nWeek, res] = await Promise.all([count("late"), count("today"), count("week"),
    range[seg](scoped(sb.from("voters").select(VOTER_COLS))).order("follow_up_on").order("serial").limit(200)]);
  if (res.error) return fail(res.error);
  const rows = res.data || [];
  const card = (v) => {
    const tel = (v.phone || "").replace(/[^\d+]/g, "");
    const late = v.follow_up_on < today;
    const when = late ? `<span class="pill sm p-late">${daysBetween(v.follow_up_on, today)} ${esc(t("days_late"))}</span>`
      : v.follow_up_on === today ? `<span class="pill sm p-due">${esc(t("today"))}</span>` : `<span class="pill sm">${esc(fmtDay(v.follow_up_on))}</span>`;
    return `<div class="card fu ${late ? "late" : ""}">
      <div class="head"><a href="#/v/${v.serial}"><b style="font-size:17px">${esc(v.name)}</b><span class="en">#${v.serial}${v.house_no ? " · " + esc(STRINGS.en.house) + " " + esc(v.house_no) : ""}${v.age ? ` · ${v.age} ${esc(v.gender || "")}` : ""} · ${esc(hamletName(v.hamlet_id))}</span></a>${when}</div>
      ${v.notes ? `<div class="fu note">${esc(firstLine(v.notes))}</div>` : ""}
      <div class="row" style="flex-wrap:nowrap">
        ${leanChip(v.leaning) || supPill("unknown", "sm")}
        <span class="grow"></span>
        ${tel ? `<a class="btn iconbtn callbtn" href="tel:${esc(tel)}" aria-label="${esc(t("call"))} ${esc(v.name_en || v.name)}">${icon("phone")}</a>` : ""}
        <a class="btn primary small" href="#/v/${v.serial}/visit" style="min-height:48px">${icon("check", "width:18px;height:18px")}${esc(t("met"))}</a>
      </div>
    </div>`;
  };
  main.innerHTML = `
    <h1>${esc(t("tab_follow"))}${sub(scopeMine ? "my_voters" : "tab_follow")}</h1>
    <div class="segs" id="segs">
      <button class="${seg === "late" ? "on" : ""} late" data-seg="late"><span class="n">${nLate}</span>${esc(t("overdue"))}${sub("overdue")}</button>
      <button class="${seg === "today" ? "on" : ""}" data-seg="today"><span class="n">${nToday}</span>${esc(t("today"))}${sub("today")}</button>
      <button class="${seg === "week" ? "on" : ""}" data-seg="week"><span class="n">${nWeek}</span>${esc(t("this_week"))}${sub("this_week")}</button>
    </div>
    <div class="cardgrid" style="margin-top:14px">${rows.length ? rows.map(card).join("") : `<p class="empty">${esc(t("no_followups"))}</p>`}</div>`;
  $("#segs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-seg]"); if (!b) return;
    store.set("fuSeg", b.dataset.seg);
    viewFollow();
  });
}

// ───────── Team ─────────
async function loadTeam() {
  const { data, error } = await sb.from("profiles").select("*").order("role").order("full_name");
  if (!error) team = data;
}
const ROLE_ORDER = { superadmin: 0, admin: 1, incharge: 2, worker: 3 };
const canManage = (p) => isAdmin() && p.id !== me.id && (isSuper() || ["incharge", "worker"].includes(p.role));
const callFn = async (body) => {
  const { data, error } = await sb.functions.invoke(CFG.ADMIN_FUNCTION || "admin-users", { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch { /* keep */ }
    throw new Error(msg);
  }
  return data;
};

async function viewTeam() {
  setTab("team");
  if (!canAssign()) { location.hash = "#/"; return; }
  main.innerHTML = loading;
  const since = new Date(Date.now() - 14 * 86400e3).toISOString();
  const [, { data: stats }, { data: acts }] = await Promise.all([loadTeam(), sb.rpc("assignment_stats"),
    sb.from("activity").select("user_id,at").gte("at", since).order("at", { ascending: false }).limit(5000)]);
  const lastAt = {};
  (acts || []).forEach((a) => { if (a.user_id && !lastAt[a.user_id]) lastAt[a.user_id] = a.at; });
  const statBy = Object.fromEntries((stats || []).map((s) => [s.user_id, s]));
  const roleF = store.get("teamRole", "");
  const people = [...team].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || String(a.full_name).localeCompare(String(b.full_name)));
  const shown = people.filter((p) => !roleF || p.role === roleF || (roleF === "admin" && p.role === "superadmin"));
  const isIdle = (p) => p.active && ["worker", "incharge"].includes(p.role) && (!lastAt[p.id] || Date.now() - new Date(lastAt[p.id]) > 48 * 3600e3);
  const idle = people.filter(isIdle);
  const n = (r) => people.filter((p) => p.role === r || (r === "admin" && p.role === "superadmin")).length;
  if (isDesk()) return viewTeamDesk({ people, statBy, lastAt, isIdle, idle, roleF, n });
  main.innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <h1 style="margin:0">${esc(t("tab_team"))}<span class="en">${people.length} ${esc(STRINGS.en.team_people)}</span></h1>
      ${isAdmin() ? `<a class="btn primary" href="#/team/new">${icon("plus")}${esc(t("add_person"))}</a>` : ""}
    </div>
    <div class="chips" id="roleTabs">
      ${[["", t("all_people"), people.length], ["admin", t("role_admin"), n("admin")], ["incharge", t("role_incharge"), n("incharge")], ["worker", t("role_worker"), n("worker")]]
        .map(([r, lbl, c]) => `<button class="chip-btn ${roleF === r ? "on" : ""}" data-role="${r}">${esc(lbl)} <span class="num">${c}</span></button>`).join("")}
    </div>
    ${idle.length ? `<div class="card due row" style="margin-top:10px;flex-wrap:nowrap">${icon("clock")}<div><b>${idle.length} ${esc(t("idle_warn"))}</b><span class="en">${esc(idle.map((p) => p.full_name || p.username).join(", "))}</span></div></div>` : ""}
    <div class="cardgrid" style="margin-top:12px">
      ${shown.map((p) => {
        const s = statBy[p.id];
        return `<div class="card person ${isIdle(p) ? "idle" : ""} ${p.active ? "" : "off"}">
          <div class="row" style="flex-wrap:nowrap;gap:12px">
            <span class="av r-${p.role}">${esc(initial(p.full_name || p.username))}</span>
            <div class="grow"><b style="font-size:17px">${esc(p.full_name || p.username)}</b><span class="en">@${esc(p.username)}${p.phone ? " · " + esc(p.phone) : ""}</span></div>
            <span class="pill sm r-${p.role}">${esc(t("role_" + p.role))}</span>
          </div>
          ${["worker", "incharge"].includes(p.role) && p.hamlet_ids?.length ? `<div class="row" style="gap:6px">${p.hamlet_ids.map((h) => `<span class="pill sm hchip">${esc(hamletName(h))}</span>`).join("")}</div>` : ""}
          ${s ? `<div class="track thin"><span style="width:${pct(s.contacted, s.assigned)}%;${isIdle(p) ? "background:#B7791F" : ""}"></span></div>
            <div class="en row between"><span>${esc(STRINGS.en.visited_n)} ${nf(s.contacted)} of ${nf(s.assigned)}${s.follow_ups_due ? ` · ${s.follow_ups_due} ${STRINGS.en.due_word}` : ""}</span></div>` : ""}
          <div class="row between">
            <span class="en" style="color:${lastAt[p.id] && !isIdle(p) ? "var(--brand)" : "var(--s2)"}">${lastAt[p.id] ? "● " + esc(relTime(lastAt[p.id])) : "○ " + esc(t("never"))}${p.active ? "" : " · " + esc(t("inactive"))}</span>
            <span class="row" style="gap:6px">
              <a class="btn small" href="#/activity?u=${p.id}">${esc(t("updates"))}</a>
              ${canManage(p) || p.id === me.id ? `<a class="btn small" href="#/team/p/${p.id}">${esc(t("edit"))}</a>` : ""}
            </span>
          </div>
        </div>`;
      }).join("")}
    </div>
    <a class="btn" style="width:100%" href="#/activity">${icon("clock")} ${esc(t("updates_title"))}</a>`;
  $("#roleTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-role]"); if (!b) return;
    store.set("teamRole", b.dataset.role);
    viewTeam();
  });
}

// Add a person (id "new") or edit one.
async function viewPerson(id) {
  setTab("team");
  const isNew = id === "new";
  if (isNew ? !isAdmin() : !canAssign()) { location.hash = "#/team"; return; }
  main.innerHTML = loading;
  await loadTeam();
  const p = isNew ? { role: "worker", hamlet_ids: [], active: true } : team.find((x) => x.id === id);
  if (!p) { location.hash = "#/team"; return; }
  const editable = isNew || canManage(p);
  const self = !isNew && p.id === me.id;
  if (!editable && !self) { location.hash = "#/team"; return; }
  const roles = isSuper() ? ["admin", "incharge", "worker"] : ["incharge", "worker"];
  const free = {};
  if (isNew) {
    try {
      const rows = await fetchAll(() => sb.from("voters").select("serial,hamlet_id").is("assigned_to", null));
      rows.forEach((r) => (free[r.hamlet_id] = (free[r.hamlet_id] || 0) + 1));
    } catch { /* counts are a hint only */ }
  }
  main.innerHTML = `
    <div class="topbar" style="justify-content:flex-start;gap:12px">
      <a class="btn iconbtn" href="#/team" aria-label="${esc(t("back"))}">${icon("back")}</a>
      <h1 style="margin:0">${esc(isNew ? t("add_person") : p.full_name || p.username)}${isNew ? sub("add_person") : `<span class="en">@${esc(p.username)} · ${esc(STRINGS.en["role_" + p.role])}</span>`}</h1>
    </div>
    <form id="personForm" class="stack">
      <div class="cols"><div class="col-a stack">
      <div class="grid2">
        <label class="f">${esc(t("full_name"))}<input name="full_name" required value="${esc(p.full_name || "")}"></label>
        <label class="f">${esc(t("phone"))}<input name="phone" type="tel" inputmode="tel" value="${esc(p.phone || "")}"></label>
      </div>
      ${isNew ? `<div class="grid2">
        <label class="f">${esc(t("username"))}<input name="username" required pattern="[a-zA-Z0-9_.\\-]{3,30}" autocapitalize="none"></label>
        <label class="f">${esc(t("password"))}<input name="password" required minlength="6"></label>
      </div>` : ""}
      ${p.role === "superadmin" ? "" : `<div>
        <div class="step"><b>1</b>${esc(t("role"))}${subIn("role")}</div>
        <div class="stack" style="--gap:8px">
          ${roles.concat(roles.includes(p.role) ? [] : [p.role]).map((r) => `<label class="rolecard"><input type="radio" name="role" value="${r}" ${p.role === r ? "checked" : ""} ${editable && roles.includes(r) ? "" : "disabled"}>
            <span><b>${esc(t("role_" + r))}</b><span class="en">${esc(STRINGS.en["role_desc_" + (r === "superadmin" ? "admin" : r)] || "")}</span></span></label>`).join("")}
        </div>
      </div>
      </div><div class="col-b">
      <div id="hamletStep">
        <div class="step"><b>2</b>${esc(t("which_hamlets"))}${subIn("which_hamlets")}</div>
        <div class="card flat">
          ${hamlets.map((h) => `<label class="hm"><input type="checkbox" name="h" value="${h.id}" ${p.hamlet_ids?.includes(h.id) ? "checked" : ""} ${editable ? "" : "disabled"}>
            <span class="grow">${esc(hamletName(h.id))}</span><span class="en num">${hamletSize(h) || ""}${isNew ? ` · ${free[h.id] || 0} ${esc(STRINGS.en.free)}` : ""}</span></label>`).join("")}
        </div>
        ${isNew ? `<label class="check" style="margin-top:8px"><input type="checkbox" name="assignFree" checked> <span>${esc(t("assign_free"))}</span></label>` : ""}
      </div>`}
      </div></div>
      <button class="primary big" type="submit">${esc(isNew ? t("create") : t("save"))}</button>
    </form>
    ${isNew ? "" : `
    <div class="card stack" style="margin-top:16px">
      <label class="f">${esc(t("new_pw"))}<input id="newpw" minlength="6"></label>
      <button type="button" id="resetBtn">${esc(t("reset_pw"))}</button>
      ${editable ? `<button type="button" class="${p.active ? "danger" : ""}" id="activeBtn">${esc(p.active ? t("deactivate") : t("activate"))}</button>` : ""}
    </div>`}`;
  const f = $("#personForm");
  const syncRole = () => { const r = f.role?.value || p.role; if ($("#hamletStep")) $("#hamletStep").hidden = ["admin", "superadmin"].includes(r); if (f.assignFree) f.assignFree.checked = r === "worker"; };
  $$("input[name=role]", f).forEach((x) => x.addEventListener("change", syncRole));
  syncRole();
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const role = f.role?.value || p.role;
    const hs = ["admin", "superadmin"].includes(role) ? [] : $$("input[name=h]:checked", f).map((x) => Number(x.value));
    const btn = $("button[type=submit]", f);
    btn.disabled = true;
    try {
      if (isNew) {
        const res = await callFn({ action: "create", username: f.username.value, password: f.password.value, full_name: f.full_name.value.trim(),
          phone: f.phone.value.trim() || null, role, hamlet_ids: hs });
        if (res?.id && role === "worker" && f.assignFree?.checked && hs.length) {
          const { error } = await sb.from("voters").update({ assigned_to: res.id }).in("hamlet_id", hs).is("assigned_to", null);
          if (error) throw error;
        }
      } else {
        const patch = { full_name: f.full_name.value.trim(), phone: f.phone.value.trim() || null };
        if (editable) { patch.hamlet_ids = hs; if (p.role !== "superadmin") patch.role = role; }
        const { error } = await sb.from("profiles").update(patch).eq("id", p.id);
        if (error) throw error;
      }
      toast(t("saved"));
      location.hash = "#/team";
    } catch (err) { btn.disabled = false; fail(err); }
  });
  $("#resetBtn")?.addEventListener("click", async () => {
    try { await callFn({ action: "reset_password", id: p.id, password: $("#newpw").value }); toast(t("saved")); } catch (err) { fail(err); }
  });
  $("#activeBtn")?.addEventListener("click", async () => {
    try { await callFn({ action: "set_active", id: p.id, active: !p.active }); toast(t("saved")); viewPerson(p.id); } catch (err) { fail(err); }
  });
}

// ───────── Who updated what ─────────
function eventHtml(h, voter) {
  const d = h.detail || {};
  const kind = h.action === "voted" ? "vote" : d.contacted === true ? "visit" : "assigned_to" in d ? "assign" : "leaning" in d ? "support" : "other";
  const dot = { vote: ["ballot", "var(--voted-bg)", "#1D3F6E"], visit: ["check", "var(--brand-soft)", "var(--brand)"], assign: ["userplus", "var(--voted-bg)", "#1D3F6E"],
    support: ["chart", "var(--s3-bg)", "var(--s3)"], other: ["note", "var(--soft)", "#454D49"] }[kind];
  const pills = [];
  if ("leaning" in d) pills.push(supPill(d.leaning, "sm"));
  if (d.follow_up_on) pills.push(`<span class="pill sm p-due">${esc(t("tab_follow"))} ${esc(fmtDay(d.follow_up_on))}</span>`);
  const rest = { ...d }; delete rest.leaning; delete rest.follow_up_on; delete rest.contacted;
  const text = h.action === "voted" || h.action === "unvoted" ? describe(h) : describe({ ...h, detail: rest });
  return `<div class="ev">
    <span class="dot" style="background:${dot[1]};color:${dot[2]}">${icon(dot[0])}</span>
    <div class="grow"><b>${esc(personName(h.user_id) || "—")}</b> · <a href="#/v/${h.voter_serial}">${esc(voter?.name || "")} #${h.voter_serial}</a>
      ${kind === "visit" ? `<span class="pill sm p-done" style="margin-left:4px">${esc(t("met"))}</span>` : ""}
      ${pills.length ? `<div class="row" style="gap:6px;margin-top:6px">${pills.join("")}</div>` : ""}
      ${text ? `<div class="en" style="margin-top:4px">${esc(text)}</div>` : ""}
    </div>
    <span class="time">${esc(fmtClock(h.at))}</span>
  </div>`;
}

async function viewActivity(params = "") {
  setTab("team");
  if (!canAssign()) { location.hash = "#/"; return; }
  main.innerHTML = loading;
  const u = new URLSearchParams(params).get("u") || "";
  const range = store.get("actRange", "today");
  const since = range === "today" ? new Date(todayIST() + "T00:00:00+05:30").toISOString() : new Date(Date.now() - 7 * 86400e3).toISOString();
  let q = sb.from("activity").select("voter_serial,user_id,at,action,detail").gte("at", since).order("at", { ascending: false }).limit(400);
  if (u) q = q.eq("user_id", u);
  const { data: rows, error } = await q;
  if (error) return fail(error);
  const serials = [...new Set(rows.map((r) => r.voter_serial))];
  const names = {};
  for (let i = 0; i < serials.length; i += 200) {
    const { data } = await sb.from("voters").select("serial,name").in("serial", serials.slice(i, i + 200));
    (data || []).forEach((v) => (names[v.serial] = v));
  }
  const visits = rows.filter((r) => r.detail?.contacted === true).length;
  const active = new Set(rows.map((r) => r.user_id)).size;
  const activeTeam = team.filter((p) => p.active).length;
  main.innerHTML = `
    <div class="topbar" style="justify-content:flex-start;gap:12px">
      <a class="btn iconbtn" href="#/team" aria-label="${esc(t("back"))}">${icon("back")}</a>
      <h1 style="margin:0">${esc(t("updates_title"))}${sub("updates_title")}</h1>
    </div>
    <div class="grid2">
      <select id="actUser" aria-label="${esc(t("everyone"))}"><option value="">${esc(t("everyone"))}</option>${team.map((p) => `<option value="${p.id}" ${p.id === u ? "selected" : ""}>${esc(p.full_name || p.username)}</option>`).join("")}</select>
      <select id="actRange"><option value="today" ${range === "today" ? "selected" : ""}>${esc(t("today"))}</option><option value="7d" ${range === "7d" ? "selected" : ""}>${esc(t("last7"))}</option></select>
    </div>
    <div class="grid3" style="margin-top:10px">
      <div class="card" style="padding:10px 12px"><div class="num" style="font-size:22px;font-weight:700">${rows.length >= 400 ? "400+" : rows.length}</div><span class="en">${esc(STRINGS.en.updates)}</span></div>
      <div class="card" style="padding:10px 12px"><div class="num" style="font-size:22px;font-weight:700">${visits}</div><span class="en">${esc(STRINGS.en.visits)}</span></div>
      <div class="card" style="padding:10px 12px"><div class="num" style="font-size:22px;font-weight:700">${u ? "—" : `${active}<span style="font-size:14px;color:var(--muted)">/${activeTeam}</span>`}</div><span class="en">${esc(STRINGS.en.active_people)}</span></div>
    </div>
    <div class="card flat" style="margin-top:12px">${rows.length ? rows.map((r) => eventHtml(r, names[r.voter_serial])).join("") : `<p class="empty">${esc(t("no_results"))}</p>`}</div>`;
  $("#actUser").addEventListener("change", (e) => { location.hash = e.target.value ? `#/activity?u=${e.target.value}` : "#/activity"; });
  $("#actRange").addEventListener("change", (e) => { store.set("actRange", e.target.value); viewActivity(params); });
}

// ───────── Reports ─────────
let dashChannel = null;
async function viewReports() {
  setTab("reports");
  if (!canAssign()) { location.hash = "#/"; return; }
  const opt = (val, label, cur) => `<option value="${esc(val)}" ${String(cur) === String(val) ? "selected" : ""}>${esc(label)}</option>`;
  main.innerHTML = loading;
  const draw = async () => {
    if (!location.hash.startsWith("#/reports") && location.hash !== "#/dash") return;
    const hf = store.get("repHamlet", "");
    const [{ data: all, error }, { data: a }] = await Promise.all([sb.rpc("hamlet_stats"), sb.rpc("assignment_stats")]);
    if (error) return fail(error);
    const rows = hf ? all.filter((r) => String(r.hamlet_id) === String(hf)) : all;
    const sum = (k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
    const T = Object.fromEntries(["total", "contacted", "strong", "leaning", "undecided", "unlikely", "opposed", "unknown", "voted", "ours_voted", "ours_total", "transport", "away", "slips", "follow_ups_due"].map((k) => [k, sum(k)]));
    const expOf = (r) => LEANINGS.reduce((s, l) => s + Number(r[l] || 0) * WEIGHT[l], 0);
    const expected = Math.round(expOf(T));
    const targetOf = (id) => hamlets.find((h) => h.id === id)?.target_votes || 0;
    const target = rows.reduce((s, r) => s + targetOf(r.hamlet_id), 0);
    const order = ["strong", "leaning", "undecided", ...(hasUnlikely ? ["unlikely"] : []), "opposed", "unknown"];
    const el = $("#rep") || main;
    main.innerHTML = `
      <div class="row between" style="margin-bottom:12px;flex-wrap:nowrap">
        <h1 style="margin:0">${esc(t("reports_title"))}<span class="en">${esc(hf ? hamletName(Number(hf)) : STRINGS.en.all_hamlets)}</span></h1>
        <select id="repHamlet" style="width:auto;max-width:55%">${opt("", t("all_hamlets"), hf)}${hamlets.map((h) => opt(h.id, hamletName(h.id), hf)).join("")}</select>
      </div>
      <div class="cols"><div class="col-a">
      <div class="card hero">
        <div class="lbl" style="font-weight:600">${esc(t("expected"))}${lang === "te" ? ` <span style="font-family:'Noto Sans',sans-serif;font-weight:500">· ${esc(STRINGS.en.expected)}</span>` : ""}</div>
        <div class="row" style="align-items:baseline;gap:8px"><span class="big">${nf(expected)}</span>${target ? `<span class="num lbl">/ ${esc(STRINGS.en.target.toLowerCase())} ${nf(target)}</span>` : ""}</div>
        ${target ? `<div class="track" style="margin-top:12px"><span style="width:${Math.min(100, pct(expected, target))}%"></span></div>` : ""}
        <div class="en" style="margin-top:10px">${esc(STRINGS.en.expected_help)}${target && target > expected ? ` ${nf(target - expected)} ${esc(STRINGS.en.need_more)}.` : ""}${target ? "" : " " + esc(STRINGS.en.no_target)}</div>
      </div>
      <div class="card" style="margin-top:12px">
        <div style="font-weight:700;margin-bottom:10px">${esc(t("support_across"))}${lang === "te" ? "" : " " + nf(T.total)}<span class="en">${lang === "te" ? esc(STRINGS.en.support_across) + " " + nf(T.total) : ""}</span></div>
        <div class="stackbar">${order.map((l) => T[l] ? `<span style="width:${(T[l] / T.total) * 100}%;background:${SUP_COLOR[l]}" title="${esc(t("lean_" + l))}"></span>` : "").join("")}</div>
        <div class="legend">${order.map((l) => `<div><i style="background:${SUP_COLOR[l]}"></i>${esc(t("lean_" + l))}<b>${nf(T[l])}</b></div>`).join("")}</div>
      </div>
      <div class="grid2" style="margin-top:12px">
        <div class="card" style="padding:12px 14px"><div class="num" style="font-size:24px;font-weight:700">${pct(T.contacted, T.total)}%</div><b class="small">${esc(t("st_contacted"))}</b><span class="en">${nf(T.contacted)} ${esc(STRINGS.en.visited_word)}</span></div>
        <a class="card due" href="#/follow" style="padding:12px 14px;text-decoration:none"><div class="num" style="font-size:24px;font-weight:700">${nf(T.follow_ups_due)}</div><b class="small">${esc(t("fu_due"))}</b>${sub("fu_due")}</a>
        <div class="card" style="padding:12px 14px"><div class="num" style="font-size:24px;font-weight:700">${pct(T.slips, T.total)}%</div><b class="small">${esc(t("slips_delivered"))}</b><span class="en">${nf(T.slips)}</span></div>
        <div class="card" style="padding:12px 14px"><div class="num" style="font-size:24px;font-weight:700;color:var(--voted)">${pct(T.voted, T.total)}%</div><b class="small">${esc(t("turnout"))}</b><span class="en">${esc(STRINGS.en.ours_voted)}: ${nf(T.ours_voted)}/${nf(T.ours_total)}</span></div>
      </div>
      </div><div class="col-b">
      <h2>${esc(t("by_hamlet"))}${subIn("by_hamlet")}</h2>
      <div class="card flat">
        <div class="hr en" style="padding-bottom:4px"><span>${esc(STRINGS.en.hamlet)}</span><span>${esc(STRINGS.en.st_contacted)}</span><span style="text-align:right">${esc(STRINGS.en.expected.split(" ")[0])}</span></div>
        ${all.map((r) => `<div class="hr"><div>${esc(hamletName(r.hamlet_id))}<div class="track"><span style="width:${pct(r.contacted, r.total)}%"></span></div></div>
          <span class="num">${pct(r.contacted, r.total)}%</span><span class="num" style="text-align:right">${nf(Math.round(expOf(r)))}${targetOf(r.hamlet_id) ? "/" + nf(targetOf(r.hamlet_id)) : ""}</span></div>`).join("")}
      </div>
      ${a?.length ? `<h2>${esc(t("worker_progress"))}${subIn("worker_progress")}</h2><div class="tablewrap"><table><thead><tr><th></th><th>${esc(t("assigned_n"))}</th><th>${esc(t("contacted_pct"))}</th><th>${esc(t("with_us"))}</th><th>${esc(t("slip"))}</th><th>${esc(t("tab_follow"))}</th><th>${esc(t("st_voted"))}</th></tr></thead><tbody>
        ${a.map((r) => `<tr><td><a href="#/activity?u=${r.user_id}">${esc(r.full_name)}</a></td><td>${r.assigned}</td><td>${pct(r.contacted, r.assigned)}%</td><td>${r.ours}</td><td>${pct(r.slips, r.assigned)}%</td><td>${r.follow_ups_due}</td><td>${r.voted}</td></tr>`).join("")}</tbody></table></div>` : ""}
      <h2>${esc(t("tools"))}${subIn("tools")}</h2>
      <div class="card flat">
        ${hasTransport ? `<a class="task" href="#/transport"><span class="tile">${icon("car")}</span><span class="grow"><b>${esc(t("transport_plan"))}</b>${sub("transport_plan")}</span>${icon("chev")}</a>` : ""}
        ${isAdmin() ? `<a class="task" href="#/dashboard"><span class="tile">${icon("chart")}</span><span class="grow"><b>${esc(t("analysis"))}</b><span class="en">${esc(STRINGS.en.analysis_sub)}</span></span>${icon("chev")}</a>` : ""}
        <a class="task" href="#/activity"><span class="tile">${icon("clock")}</span><span class="grow"><b>${esc(t("updates_title"))}</b>${sub("updates_title")}</span>${icon("chev")}</a>
        <a class="task" href="#/print"><span class="tile">${icon("print")}</span><span class="grow"><b>${esc(t("walk_list"))}</b>${sub("walk_list")}</span>${icon("chev")}</a>
      </div>
      ${isSuper() ? `<details class="card" style="margin-top:12px"><summary>${esc(t("targets"))}</summary>
        <form id="targetForm" class="stack" style="margin-top:10px">
          <p class="small muted">${esc(t("targets_help"))}</p>
          ${hamlets.map((h) => `<label class="row small" style="flex-wrap:nowrap"><span class="grow">${esc(hamletName(h.id))} <span class="en in">(${hamletSize(h)})</span></span><input type="number" min="0" name="t${h.id}" value="${esc(h.target_votes ?? "")}" style="width:110px"></label>`).join("")}
          <button type="submit">${esc(t("save"))}</button>
        </form>
      </details>` : ""}
      </div></div>
      <p class="small muted center">${esc(t("refreshed"))}: ${esc(fmtTime(new Date().toISOString()))}</p>`;
    void el;
    $("#repHamlet").addEventListener("change", (e) => { store.set("repHamlet", e.target.value); draw(); });
    $("#targetForm")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      for (const h of hamlets) {
        const val = e.target["t" + h.id].value;
        const tv = val === "" ? null : Number(val);
        if (tv === (h.target_votes ?? null)) continue;
        const { error: err } = await sb.from("hamlets").update({ target_votes: tv }).eq("id", h.id);
        if (err) return fail(err);
        h.target_votes = tv;
      }
      toast(t("saved"));
      draw();
    });
  };
  await draw();
  // Live refresh while Reports is open (poll day), at most every 5 seconds, unless a form is being edited.
  if (dashChannel) sb.removeChannel(dashChannel);
  let pending = null;
  dashChannel = sb.channel("dash").on("postgres_changes", { event: "UPDATE", schema: "public", table: "voters" }, () => {
    if (pending) return;
    pending = setTimeout(() => {
      pending = null;
      if (document.activeElement?.closest?.("form")) return;
      if ($("details[open]")) return;
      draw();
    }, 5000);
  }).subscribe();
}

// ───────── printable walk list (uses the current Voters filters) ─────────
async function viewPrint() {
  setTab("voters");
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
      <a class="btn small" href="#/voters">← ${esc(t("back"))}</a>
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

// ───────── poll day ─────────
function rememberMark(v) {
  const marks = store.get("marks", []);
  marks.unshift({ serial: v.serial, name: v.name, at: Date.now() });
  store.set("marks", marks.slice(0, 15));
}

function viewPoll() {
  setTab("today");
  let digits = "";
  const marks = store.get("marks", []);
  main.innerHTML = `
    <h1>${esc(t("poll_title"))}</h1>
    <p class="small muted">${esc(t("poll_help"))}</p>
    <div class="cols"><div class="col-a">
    <div class="serial-display" id="sd">&nbsp;</div>
    <div class="numpad" style="margin-top:8px">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-d="${n}">${n}</button>`).join("")}
      <button data-d="C">${esc(t("clear"))}</button><button data-d="0">0</button><button data-d="B">⌫</button>
    </div>
    <button class="primary big" id="findBtn" style="margin-top:8px">${esc(t("find"))}</button>
    </div><div class="col-b">
    <div id="found" style="margin-top:12px"></div>
    <a class="btn" style="width:100%;margin-top:12px" href="#/voters" id="pendingLink">🙋 ${esc(t("ours_pending"))}</a>
    <label class="card check" style="margin-top:12px"><input type="checkbox" id="pm" ${pollMode() ? "checked" : ""}> ${esc(t("poll_mode"))}</label>
    ${marks.length ? `<h2>${esc(t("recent_marks"))}</h2><ul class="hist">${marks.map((m) => `<li><a href="#/v/${m.serial}">${m.serial}</a> · ${esc(m.name)} · ${esc(fmtTime(new Date(m.at).toISOString()))}</li>`).join("")}</ul>` : ""}
    </div></div>
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
  setTab("reports");
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
    <div class="row" style="margin-bottom:8px"><a class="btn small" href="#/reports">← ${esc(t("back"))}</a></div>
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
  setTab("reports");
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


// ───────── analytics (super admin / admin, built for a laptop screen) ─────────
const AGE_BANDS = [
  { k: "first", en: "18–22", te: "18–22", min: 18, max: 22 },
  { k: "young", en: "23–29", te: "23–29", min: 23, max: 29 },
  { k: "a30", en: "30–44", te: "30–44", min: 30, max: 44 },
  { k: "a45", en: "45–59", te: "45–59", min: 45, max: 59 },
  { k: "a60", en: "60–74", te: "60–74", min: 60, max: 74 },
  { k: "a75", en: "75+", te: "75+", min: 75, max: 200 },
];
const AGE_FILTER = { first: [18, 22], young: [23, 29], youth: [18, 29], a30: [30, 44], a45: [45, 59], a60: [60, 74], a75: [75, 200], senior: [60, 200] };
const L = (en, te) => (lang === "te" ? `${esc(te)}<span class="en">${esc(en)}</span>` : esc(en));
const Lin = (en, te) => (lang === "te" ? `${esc(te)} <span class="en in">· ${esc(en)}</span>` : esc(en));

function summarize(list) {
  const s = { n: list.length, visited: 0, exp: 0, persu: 0, unvisited: 0, due: 0, away: 0, voted: 0 };
  LEANINGS.forEach((l) => (s[l] = 0));
  const today = todayIST();
  for (const v of list) {
    const l = v.leaning || "unknown";
    s[l] = (s[l] || 0) + 1;
    s.exp += WEIGHT[l] || 0;
    if (v.contacted) s.visited++; else s.unvisited++;
    if (["undecided", "unlikely"].includes(l) || (l === "unknown")) s.persu++;
    if (v.follow_up_on && v.follow_up_on <= today) s.due++;
    if (v.away) s.away++;
    if (v.voted) s.voted++;
  }
  s.ours = s.strong + s.leaning;
  return s;
}
const supOrder = () => ["strong", "leaning", "undecided", ...(hasUnlikely ? ["unlikely"] : []), "opposed", "unknown"];
const miniStack = (s, h = 14) => `<div class="stackbar" style="height:${h}px">${supOrder().map((l) => s[l] ? `<span style="width:${(s[l] / s.n) * 100}%;background:${SUP_COLOR[l]}" title="${esc(t("lean_" + l))}: ${s[l]}"></span>` : "").join("")}</div>`;
const goAttr = (patch) => `data-go="${esc(JSON.stringify(patch))}"`;

const DASH_TABS = [
  ["overview", "Overview", "సారాంశం"], ["people", "Women, men & age", "మహిళలు, పురుషులు, వయసు"], ["hamlets", "Hamlets", "గ్రామాలు"],
  ["houses", "Households", "ఇళ్ళు"], ["reach", "Who to reach", "ఎవరిని చేరుకోవాలి"], ["team", "Team progress", "టీమ్ పురోగతి"],
];
let dashCache = null; // { at, all, team }
async function viewAnalytics(tab = "overview", fresh = false, arg = "") {
  if (tab === "hamlet" && !hamlets.some((h) => String(h.id) === String(arg))) tab = "hamlets";
  if (tab !== "hamlet" && !DASH_TABS.some(([k]) => k === tab)) tab = "overview";
  setTab("dashboard");
  main.classList.add("wide");
  if (!isAdmin()) { main.innerHTML = `<p class="card">${esc(t("no_access"))}</p>`; return; }
  if (fresh || !dashCache || Date.now() - dashCache.at > 60000) {
    if (!dashCache) main.innerHTML = loading;
    try {
      const since = new Date(Date.now() - 14 * 86400e3).toISOString();
      const [all, { data: team }, { data: acts }] = await Promise.all([
        fetchAll(() => sb.from("voters").select("serial,name,hamlet_id,gender,age,house_no,leaning,contacted,follow_up_on,away,voted,assigned_to,slip_delivered")),
        sb.rpc("assignment_stats"),
        sb.from("activity").select("voter_serial,user_id,at,action,detail").gte("at", since).order("at", { ascending: false }).limit(5000),
        loadTeam(),
      ]);
      dashCache = { at: Date.now(), all, team: team || [], acts: acts || [] };
    } catch (err) { main.innerHTML = ""; return fail(err); }
  }
  if (location.hash && !/^#\/(dashboard|analysis)/.test(location.hash)) return;
  const { all, team, acts } = dashCache;
  const hf = tab === "hamlet" ? String(arg) : tab === "overview" ? "" : store.get("anHamlet", "");
  const rows = hf ? all.filter((v) => String(v.hamlet_id) === String(hf)) : all;
  const S = summarize(rows);
  const women = rows.filter((v) => v.gender === "F"), men = rows.filter((v) => v.gender === "M");
  const W = summarize(women), M = summarize(men);
  const ages = rows.map((v) => v.age).filter(Boolean);
  const avgAge = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;
  const inBand = (v, b) => v.age >= b.min && v.age <= b.max;
  const bands = AGE_BANDS.map((b) => ({ ...b, F: summarize(women.filter((v) => inBand(v, b))), M: summarize(men.filter((v) => inBand(v, b))), all: summarize(rows.filter((v) => inBand(v, b))) }));
  const maxBand = Math.max(1, ...bands.flatMap((b) => [b.F.n, b.M.n]));

  // households: same hamlet + same house number
  const houses = new Map();
  for (const v of rows) {
    if (!v.house_no) continue;
    const k = v.hamlet_id + "|" + v.house_no;
    if (!houses.has(k)) houses.set(k, []);
    houses.get(k).push(v);
  }
  const sizeBuckets = [["1", 1, 1], ["2", 2, 2], ["3", 3, 3], ["4", 4, 4], ["5", 5, 5], ["6–9", 6, 9], ["10+", 10, 999]];
  const hs = [...houses.values()];
  const sizeDist = sizeBuckets.map(([lbl, a, b]) => { const g = hs.filter((h) => h.length >= a && h.length <= b); return { lbl, houses: g.length, voters: g.reduce((s, h) => s + h.length, 0) }; });
  const maxSize = Math.max(1, ...sizeDist.map((d) => d.voters));
  const bigOpen = hs.filter((h) => h.length >= 5).map((h) => ({ h, s: summarize(h) }))
    .filter((x) => x.s.persu >= Math.ceil(x.s.n / 2))
    .sort((a, b) => b.s.persu - a.s.persu || b.s.n - a.s.n).slice(0, 12);

  // hamlets
  const hamRows = hamlets.map((h) => {
    const list = all.filter((v) => v.hamlet_id === h.id);
    const s = summarize(list);
    const fem = list.filter((v) => v.gender === "F").length;
    const yth = list.filter((v) => v.age && v.age <= 29).length;
    const old = list.filter((v) => v.age >= 60).length;
    const unassigned = list.filter((v) => !v.assigned_to).length;
    return { h, s, fem, yth, old, unassigned, target: h.target_votes || 0 };
  });
  const maxPersu = Math.max(1, ...hamRows.map((r) => r.s.persu));

  // segments with outreach playbook
  const seg = (key, en, te, list, go, why, ideas) => ({ key, en, te, s: summarize(list), go, why, ideas });
  const segments = [
    seg("first", "First-time & new voters (18–22)", "కొత్త ఓటర్లు (18–22)", rows.filter((v) => v.age >= 18 && v.age <= 22), { age: "first" },
      "Many are voting for the first time and have no fixed loyalty yet.",
      ["Meet them in small groups at the playground, college bus stop or evening hangouts, not only at home.", "Talk about jobs, skill training, sports facilities and internet/phone signal in the village.", "Ask 2–3 respected young people from each hamlet to join as volunteers and bring friends.", "Help them check their name and booth on the roll and remind them of the poll date."]),
    seg("young", "Young voters (23–29)", "యువత (23–29)", rows.filter((v) => v.age >= 23 && v.age <= 29), { age: "young" },
      "Working-age, often away during the day; reachable on WhatsApp and in the evenings.",
      ["Visit after 6 pm or on Sundays.", "Share a short manifesto on WhatsApp: roads, street lights, drainage, work under MGNREGS.", "Hold one youth meeting per hamlet with clear, local promises you can keep."]),
    seg("women", "Women", "మహిళలు", women, { gender: "F" },
      "Half the electorate; often decide together with the family, and best reached by women volunteers.",
      ["Send women volunteers for door-to-door visits during the day.", "Meet self-help groups (DWCRA/SHG) and talk about drinking water, ration shop timings, safety and street lights.", "Speak to the mother or eldest woman in big households; she often sways the house.", "Explain how the panchayat will help with pensions, housing and anganwadi services."]),
    seg("elderly", "Elders (60+)", "పెద్దలు (60+)", rows.filter((v) => v.age >= 60), { age: "senior" },
      "High turnout and respected in the family; they influence younger voters.",
      ["Visit personally and take blessings; a respectful visit counts a lot.", "Talk about pensions, health sub-centre and road to the bus stop.", "Tell them their booth and the poll timings; ask family members to go with them."]),
    seg("persuadable", "50-50 and Unlikely", "50-50, కష్టం", rows.filter((v) => ["undecided", "unlikely"].includes(v.leaning)), { lean: "undecided" },
      "These voters can still move. Every one who shifts to Likely adds about 20–45 expected votes per 100.",
      ["Second visit by the candidate or a respected elder, not the same worker.", "Find their one main issue and come back with a clear answer.", "Set a follow-up date in the app and keep it."]),
    seg("unvisited", "Not visited yet", "ఇంకా కలవలేదు", rows.filter((v) => !v.contacted), { status: "not_contacted" },
      "Support is unknown until someone meets them.",
      ["Assign every unvisited voter to a worker and give a daily target.", "Start with big households: one visit covers many voters.", "Print walk lists for hamlets with the most unvisited voters."]),
    seg("away", "Outstation voters", "ఊరిలో లేని వారు", rows.filter((v) => v.away), { status: "away" },
      "Living outside for work or study; need early contact to plan travel on poll day.",
      ["Call them now, not the week before the poll.", "Ask family members to remind them and confirm their travel plan in the app.", "Do not pay for their travel or tickets; that is illegal."]),
  ];

  // automatic insights
  const ins = [];
  if (W.n && M.n && Math.abs(pct(W.visited, W.n) - pct(M.visited, M.n)) >= 5) {
    const low = pct(W.visited, W.n) < pct(M.visited, M.n) ? ["Women", "మహిళలు", W] : ["Men", "పురుషులు", M];
    ins.push(`${low[0]} are visited less (${pct(low[2].visited, low[2].n)}% vs ${pct((low[2] === W ? M : W).visited, (low[2] === W ? M : W).n)}%). ${low[2] === W ? "Send women volunteers." : "Plan evening visits."}`);
  }
  const bandLow = [...bands].filter((b) => b.all.n >= 20).sort((a, b) => pct(a.all.visited, a.all.n) - pct(b.all.visited, b.all.n))[0];
  if (bandLow) ins.push(`Age ${bandLow.en} has the lowest coverage: ${pct(bandLow.all.visited, bandLow.all.n)}% visited of ${nf(bandLow.all.n)}.`);
  const topPersu = [...hamRows].sort((a, b) => b.s.persu - a.s.persu)[0];
  if (topPersu && !hf) ins.push(`${hamletName(topPersu.h.id)} has the most voters still open (${nf(topPersu.s.persu)} not yet Sure, Likely or Against).`);
  const gapRows = hamRows.filter((r) => r.target && r.s.exp < r.target).sort((a, b) => (b.target - b.s.exp) - (a.target - a.s.exp));
  if (gapRows.length && !hf) ins.push(`${gapRows.length} hamlet${gapRows.length > 1 ? "s are" : " is"} below target. Biggest gap: ${hamletName(gapRows[0].h.id)} needs ${nf(Math.round(gapRows[0].target - gapRows[0].s.exp))} more expected votes.`);
  const big = hs.filter((h) => h.length >= 5);
  if (big.length) ins.push(`${nf(big.length)} households have 5 or more voters (${nf(big.reduce((s, h) => s + h.length, 0))} voters, ${pct(big.reduce((s, h) => s + h.length, 0), S.n)}% of the roll). Win the house, win the votes.`);
  if (S.due) ins.push(`${nf(S.due)} follow-ups are due or overdue.`);

  const target = hf ? (hamlets.find((h) => String(h.id) === String(hf))?.target_votes || 0) : hamlets.reduce((s, h) => s + (h.target_votes || 0), 0);
  const tile = (val, en, te, note = "", cls = "") => `<div class="card kpi ${cls}"><div class="num">${val}</div><b>${L(en, te)}</b>${note ? `<span class="en">${note}</span>` : ""}</div>`;
  const opt = (val, label, cur) => `<option value="${esc(val)}" ${String(cur) === String(val) ? "selected" : ""}>${esc(label)}</option>`;
  const genderCol = (en, te, s, cls, go) => `
    <div class="gcol">
      <div class="row between"><b class="${cls}">${L(en, te)}</b><span class="num big2">${nf(s.n)}</span></div>
      <div class="small muted">${pct(s.n, S.n)}% · ${esc(STRINGS.en.visited_word)} ${pct(s.visited, s.n)}% · ${esc(STRINGS.en.expected.split(" ")[0])} ${nf(Math.round(s.exp))}</div>
      ${miniStack(s, 16)}
      <div class="small" style="margin-top:6px">${esc(t("lean_strong"))}+${esc(t("lean_leaning"))} <b class="num">${pct(s.ours, s.n)}%</b> · 50-50 <b class="num">${nf(s.undecided)}</b> · ${esc(t("lean_unknown"))} <b class="num">${nf(s.unknown)}</b></div>
      <a href="#/voters" ${goAttr(go)} class="small">${esc(t("view_list"))} →</a>
    </div>`;

  const sec = {
    kpis: `    <div class="kpis">
      ${tile(nf(S.n), "Voters", "ఓటర్లు", `${nf(houses.size)} households`)}
      ${tile(pct(W.n, S.n) + "%", "Women", "మహిళలు", `${nf(W.n)} women · ${nf(M.n)} men`)}
      ${tile(avgAge, "Average age", "సగటు వయసు", `${nf(rows.filter((v) => v.age <= 29).length)} under 30`)}
      ${tile(pct(S.visited, S.n) + "%", "Visited", "కలిశాం", `${nf(S.unvisited)} still to visit`)}
      ${tile(nf(Math.round(S.exp)), "Expected votes", "అంచనా ఓట్లు", target ? `target ${nf(target)} · ${S.exp >= target ? "on track" : "need " + nf(Math.round(target - S.exp))}` : "no target set", S.exp >= target && target ? "good" : "")}
      ${tile(nf(S.persu), "Still open", "ఇంకా తేలని వారు", "50-50, Unlikely or not known")}
    </div>

`,
    insights: `    ${ins.length ? `<div class="card insights"><b>${L("What the numbers say", "సంఖ్యలు ఏం చెబుతున్నాయి")}</b><ul>${ins.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}

`,
    gender: `      <section class="card">
        <h2>${L("Women and men", "మహిళలు, పురుషులు")}</h2>
        <div class="g2">${genderCol("Women", "మహిళలు", W, "c-f", { gender: "F" })}${genderCol("Men", "పురుషులు", M, "c-m", { gender: "M" })}</div>
      </section>

`,
    pyramid: `      <section class="card">
        <h2>${L("Age groups", "వయసు వారీగా")} <span class="en in">women left, men right</span></h2>
        <div class="pyr">
          ${bands.map((b) => `<a class="pyr-row" href="#/voters" ${goAttr({ age: b.k })}>
            <span class="num r">${nf(b.F.n)}</span><span class="bar l"><i class="f" style="width:${(b.F.n / maxBand) * 100}%"></i></span>
            <b>${b.en}</b>
            <span class="bar"><i class="m" style="width:${(b.M.n / maxBand) * 100}%"></i></span><span class="num">${nf(b.M.n)}</span></a>`).join("")}
        </div>
      </section>
`,
    agetable: `    <section class="card" style="margin-top:12px">
      <h2>${L("Support by age group", "వయసు వారీగా మద్దతు")}</h2>
      <div class="tablewrap flat"><table class="an">
        <thead><tr><th>Age</th><th class="n">Voters</th><th class="n">% of roll</th><th class="n">Visited</th><th style="min-width:180px">Support</th><th class="n">Sure+Likely</th><th class="n">50-50</th><th class="n">Expected</th></tr></thead>
        <tbody>${bands.map((b) => `<tr><td><a href="#/voters" ${goAttr({ age: b.k })}>${b.en}</a></td><td class="n">${nf(b.all.n)}</td><td class="n">${pct(b.all.n, S.n)}%</td><td class="n">${pct(b.all.visited, b.all.n)}%</td><td>${miniStack(b.all)}</td><td class="n">${pct(b.all.ours, b.all.n)}%</td><td class="n">${nf(b.all.undecided)}</td><td class="n">${nf(Math.round(b.all.exp))}</td></tr>`).join("")}</tbody>
      </table></div>
    </section>

`,
    hamtable: `<section class="card" style="margin-top:12px">
      <h2>${L("Hamlets", "గ్రామాలు")} <span class="en in">sorted by voters still open</span></h2>
      <div class="tablewrap flat"><table class="an">
        <thead><tr><th>Hamlet</th><th class="n">Voters</th><th class="n">Women</th><th class="n">18–29</th><th class="n">60+</th><th class="n">Visited</th><th style="min-width:160px">Support</th><th class="n">Expected</th><th class="n">Target</th><th class="n">Still open</th><th class="n">Not assigned</th><th class="n">Away</th></tr></thead>
        <tbody>${[...hamRows].sort((a, b) => b.s.persu - a.s.persu).map((r) => `<tr>
          <td><a href="#/dashboard/hamlet/${r.h.id}">${esc(hamletName(r.h.id))}</a></td>
          <td class="n">${nf(r.s.n)}</td><td class="n">${pct(r.fem, r.s.n)}%</td><td class="n">${pct(r.yth, r.s.n)}%</td><td class="n">${pct(r.old, r.s.n)}%</td>
          <td class="n"><span class="heat" style="--p:${pct(r.s.visited, r.s.n)}">${pct(r.s.visited, r.s.n)}%</span></td>
          <td>${miniStack(r.s)}</td>
          <td class="n">${nf(Math.round(r.s.exp))}</td>
          <td class="n ${r.target && r.s.exp < r.target ? "bad" : r.target ? "ok" : ""}">${r.target ? nf(r.target) : "—"}</td>
          <td class="n"><span class="pbar"><i style="width:${(r.s.persu / maxPersu) * 100}%"></i></span>${nf(r.s.persu)}</td>
          <td class="n ${r.unassigned ? "bad" : ""}">${nf(r.unassigned)}</td><td class="n">${nf(r.s.away)}</td></tr>`).join("")}</tbody>
      </table></div>
    </section>`,
    houses: `    <div class="an-grid" style="margin-top:12px">
      <section class="card">
        <h2>${L("Household size", "ఇంటికి ఎంత మంది ఓటర్లు")}</h2>
        <p class="small muted" style="margin-top:0">Voters living in houses of each size. Bigger houses give more votes per visit.</p>
        ${sizeDist.map((d) => `<div class="hbar"><span>${d.lbl}</span><span class="bar"><i style="width:${(d.voters / maxSize) * 100}%"></i></span><span class="num">${nf(d.voters)} <small class="muted">in ${nf(d.houses)} houses</small></span></div>`).join("")}
      </section>
      <section class="card">
        <h2>${L("Big houses still open", "ఇంకా తేలని పెద్ద ఇళ్ళు")}</h2>
        <p class="small muted" style="margin-top:0">5+ voters, at least half not yet Sure, Likely or Against. Send a senior person.</p>
        ${bigOpen.length ? `<div class="tablewrap flat"><table class="an"><thead><tr><th>House</th><th>Hamlet</th><th class="n">Voters</th><th class="n">Open</th><th style="min-width:110px">Support</th></tr></thead><tbody>
          ${bigOpen.map(({ h, s }) => `<tr><td><a href="#/voters" ${goAttr({ q: h[0].house_no, hamlet: String(h[0].hamlet_id) })}>${esc(h[0].house_no)}</a></td><td>${esc(hamletName(h[0].hamlet_id))}</td><td class="n">${s.n}</td><td class="n">${s.persu}</td><td>${miniStack(s)}</td></tr>`).join("")}
        </tbody></table></div>` : `<p class="muted">None right now.</p>`}
      </section>
    </div>

`,
    reach: `    <h2 style="margin-top:4px">${L("Who to reach, and how", "ఎవరిని, ఎలా చేరుకోవాలి")}</h2>
    <div class="segs-grid">
      ${segments.map((g) => `<section class="card seg">
        <div class="row between" style="align-items:flex-start"><b>${L(g.en, g.te)}</b><span class="num big2">${nf(g.s.n)}</span></div>
        <div class="small muted">${pct(g.s.n, S.n)}% of voters · ${pct(g.s.visited, g.s.n)}% visited · ${nf(g.s.persu)} still open</div>
        ${g.s.n ? miniStack(g.s, 12) : ""}
        <p class="small" style="margin:10px 0 6px">${esc(g.why)}</p>
        <ul class="small ideas">${g.ideas.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
        <a href="#/voters" ${goAttr(g.go)} class="small">${esc(t("view_list"))} →</a>
      </section>`).join("")}
    </div>

`,
    rules: `    <div class="card rules">
      <b>${L("Stay within the election rules", "ఎన్నికల నియమాలు పాటించండి")}</b>
      <p class="small" style="margin:6px 0 0">Win votes with issues, respect and repeated contact. Offering cash, gifts, liquor, free travel or any other inducement, or threatening anyone, is a crime under the election law and can cancel the election. Follow the State Election Commission's code of conduct for meetings, campaign times and the silence period before polling.</p>
    </div>
`,
    support: `<section class="card"><h2>${L("Support", "మద్దతు")} <span class="en in">${nf(S.n)} voters</span></h2>
      ${miniStack(S, 22)}
      <div class="legend">${supOrder().map((l) => `<a href="#/voters" ${goAttr({ lean: l === "unknown" ? "unknown" : l })} style="color:inherit;text-decoration:none;display:flex;align-items:center;gap:6px"><i style="background:${SUP_COLOR[l]}"></i>${esc(t("lean_" + l))}<b>${nf(S[l])}</b></a>`).join("")}</div>
      <div class="small muted" style="margin-top:10px">Follow-ups due: <b>${nf(S.due)}</b> · Slips: <b>${pct(rows.filter((v) => v.slip_delivered).length, S.n)}%</b> · Voted: <b>${nf(S.voted)}</b></div></section>`,
    topHamlets: `<section class="card"><h2>${L("Hamlets to focus on", "దృష్టి పెట్టాల్సిన గ్రామాలు")}</h2>
      <div class="tablewrap flat"><table class="an"><thead><tr><th>Hamlet</th><th class="n">Visited</th><th class="n">Expected</th><th class="n">Target</th><th class="n">Still open</th></tr></thead><tbody>
      ${[...hamRows].filter((r) => r.s.n).sort((a, b) => ((b.target - b.s.exp) || 0) - ((a.target - a.s.exp) || 0) || b.s.persu - a.s.persu).slice(0, 5).map((r) => `<tr><td><a href="#/voters" ${goAttr({ hamlet: String(r.h.id) })}>${esc(hamletName(r.h.id))}</a></td><td class="n"><span class="heat" style="--p:${pct(r.s.visited, r.s.n)}">${pct(r.s.visited, r.s.n)}%</span></td><td class="n">${nf(Math.round(r.s.exp))}</td><td class="n ${r.target && r.s.exp < r.target ? "bad" : r.target ? "ok" : ""}">${r.target ? nf(r.target) : "—"}</td><td class="n">${nf(r.s.persu)}</td></tr>`).join("")}
      </tbody></table></div><a class="small" href="#/dashboard/hamlets">All hamlets →</a></section>`,
    team: `<section class="card"><h2>${L("Team progress", "టీమ్ పురోగతి")}</h2>
      ${team.length ? `<div class="tablewrap flat"><table class="an"><thead><tr><th>Person</th><th class="n">Assigned</th><th class="n">Visited</th><th style="min-width:140px"></th><th class="n">With us</th><th class="n">Slips</th><th class="n">Follow-ups due</th><th class="n">Voted</th><th></th></tr></thead><tbody>
      ${[...team].sort((a, b) => pct(a.contacted, a.assigned) - pct(b.contacted, b.assigned)).map((r) => `<tr><td>${esc(r.full_name)}</td><td class="n">${nf(r.assigned)}</td><td class="n">${pct(r.contacted, r.assigned)}%</td><td><span class="pbar wide"><i style="width:${pct(r.contacted, r.assigned)}%;background:var(--brand)"></i></span></td><td class="n">${nf(r.ours)}</td><td class="n">${pct(r.slips, r.assigned)}%</td><td class="n ${r.follow_ups_due ? "bad" : ""}">${nf(r.follow_ups_due)}</td><td class="n">${nf(r.voted)}</td><td><a class="small" href="#/activity?u=${esc(r.user_id)}">Updates →</a></td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted">No voters assigned yet. Assign voters from the Team page.</p>`}
      <div class="row" style="gap:12px;margin-top:10px"><a class="small" href="#/team">Manage team →</a><a class="small" href="#/activity">All updates →</a></div></section>`,
  };
  // ── laptop overview: are we winning? ──
  const today = todayIST();
  const dayStart = new Date(today + "T00:00:00+05:30").getTime();
  const lastAt = {};
  acts.forEach((a) => { if (a.user_id && !lastAt[a.user_id]) lastAt[a.user_id] = a.at; });
  const field = teamPeople().filter((p) => p.active && ["worker", "incharge"].includes(p.role));
  const activeToday = field.filter((p) => lastAt[p.id] && new Date(lastAt[p.id]).getTime() >= dayStart).length;
  const quiet = field.filter((p) => !lastAt[p.id] || Date.now() - new Date(lastAt[p.id]) > 72 * 3600e3);
  const overdue = rows.filter((v) => v.follow_up_on && v.follow_up_on < today).length;
  const dueToday = rows.filter((v) => v.follow_up_on === today).length;
  const noWorker = rows.filter((v) => !v.assigned_to).length;
  const gap = Math.max(0, Math.round(target - S.exp));
  const sbar = (s, h = 10) => `<div class="dk-bar" style="height:${h}px">${supOrder().map((l) => s[l] ? `<span style="width:${(s[l] / s.n) * 100}%;background:${SUP_COLOR[l]}" title="${esc(t("lean_" + l))}: ${s[l]}"></span>` : "").join("")}</div>`;
  const legend = (s) => `<div class="dk-legend">${supOrder().map((l) => `<a href="#/voters" ${goAttr({ lean: l, ...(hf ? { hamlet: hf } : {}) })}><i style="background:${SUP_COLOR[l]}"></i>${esc(t("lean_" + l))} <b class="num">${nf(s[l])}</b> <span class="muted num">${pct(s[l], s.n)}%</span></a>`).join("")}</div>`;
  const hamGo = (id) => `#/dashboard/hamlet/${id}`;
  const card = (val, en, te, note, href, cls = "", go = null) => `<a class="card dk-kpi ${cls}" href="${href}" ${go ? goAttr(go) : ""}><div class="num">${val}</div><b>${L(en, te)}</b><span class="en">${note}</span></a>`;
  const hero = `<div class="card dk-hero">
      <div class="lbl">${L("Expected votes", "అంచనా ఓట్లు")}</div>
      <div class="row" style="align-items:baseline;gap:10px"><span class="num big">${nf(Math.round(S.exp))}</span>
        <span class="num">${target ? `of ${nf(target)} target · ${gap ? `need ${nf(gap)} more` : "on track"}` : "no target set yet"}</span></div>
      <div class="track"><span style="width:${target ? Math.min(100, (S.exp / target) * 100) : 0}%"></span></div>
      <div class="small">Sure counts 90% · Likely 70% · 50-50 50%${hasUnlikely ? " · Unlikely 25%" : ""} · Against 5%</div>
    </div>`;
  const kpiRow = (scope) => `<div class="dk-kpis">${hero}
      ${card(pct(S.visited, S.n) + "%", "Visited", "కలిశాం", `${nf(S.visited)} of ${nf(S.n)} · ${nf(S.unvisited)} to go`, "#/voters", "", { ...scope, status: "not_contacted" })}
      ${card(nf(S.persu), "Still open", "ఇంకా తేలని వారు", `50-50 ${nf(S.undecided)}${hasUnlikely ? ` · Unlikely ${nf(S.unlikely)}` : ""} · not known ${nf(S.unknown)}`, "#/voters", "", { ...scope, lean: "open" })}
      ${card(nf(overdue), "Follow-ups overdue", "గడువు దాటిన ఫాలో-అప్‌లు", `${nf(dueToday)} due today`, "#/voters", overdue ? "warn" : "", { ...scope, status: "follow_up_due" })}
      ${scope.hamlet ? card(nf(noWorker), "No worker yet", "వర్కర్ లేని వారు", "assign them to someone", "#/voters", noWorker ? "warn" : "", { ...scope, status: "unassigned" })
        : card(`${activeToday}<small>/${field.length}</small>`, "Team active today", "ఈరోజు పని చేసిన వారు", `${quiet.length} quiet for 3+ days`, "#/team")}
    </div>`;
  const winRows = [...hamRows].filter((r) => r.s.n).sort((a, b) => (Math.max(0, b.target - b.s.exp) - Math.max(0, a.target - a.s.exp)) || b.s.persu - a.s.persu);
  sec.win = `<section class="card dk-sec">
      <div class="dk-sec-h"><h2>${L("Where to win", "ఎక్కడ గెలవాలి")}</h2><span class="en in">sorted by gap to target · click a hamlet to open it</span></div>
      <div class="tablewrap flat"><table class="an dk-t">
        <thead><tr><th>Hamlet</th><th class="n">Voters</th><th class="n">Visited</th><th style="min-width:150px">Support</th><th class="n">Expected</th><th class="n">Target</th><th class="n">Gap</th><th class="n">Still open</th></tr></thead>
        <tbody>${winRows.map((r) => { const g = r.target ? Math.round(r.target - r.s.exp) : null; return `<tr class="go" data-href="${hamGo(r.h.id)}">
          <td><a href="${hamGo(r.h.id)}">${esc(hamletName(r.h.id))}</a></td><td class="n">${nf(r.s.n)}</td>
          <td class="n"><span class="heat" style="--p:${pct(r.s.visited, r.s.n)}">${pct(r.s.visited, r.s.n)}%</span></td><td>${sbar(r.s)}</td>
          <td class="n">${nf(Math.round(r.s.exp))}</td><td class="n">${r.target ? nf(r.target) : "—"}</td>
          <td class="n ${g > 0 ? "bad" : g !== null ? "ok" : ""}">${g === null ? "—" : g > 0 ? "−" + nf(g) : "+" + nf(-g)}</td><td class="n">${nf(r.s.persu)}</td></tr>`; }).join("")}</tbody>
      </table></div>
    </section>`;
  const todoItem = (n, en, te, note, href, tone, ic, go = null) => n ? `<a class="dk-todo" href="${href}" ${go ? goAttr(go) : ""}><span class="dot ${tone}">${icon(ic)}</span><span class="grow"><b>${nf(n)} ${L(en, te)}</b><span class="en">${note}</span></span>${icon("chev", "width:18px;height:18px;color:var(--muted)")}</a>` : "";
  const bigOpenAll = hs.filter((h) => h.length >= 5 && summarize(h).persu >= Math.ceil(h.length / 2)).length;
  const todos = [
    todoItem(overdue, "follow-ups overdue", "ఫాలో-అప్‌లు గడువు దాటాయి", "promised visits not done yet", "#/voters", "late", "cal", { status: "follow_up_due" }),
    todoItem(noWorker, "voters have no worker", "ఓటర్లకు వర్కర్ లేరు", "assign them so someone visits", "#/voters", "warn", "userplus", { status: "unassigned" }),
    todoItem(quiet.length, "people quiet for 3+ days", "మంది 3+ రోజులుగా పని చేయలేదు", esc(quiet.slice(0, 4).map((p) => p.full_name || p.username).join(", ")), "#/team", "warn", "clock"),
    todoItem(bigOpenAll, "big houses still open", "పెద్ద ఇళ్ళు ఇంకా తేలలేదు", "5+ voters each · send a senior person", "#/dashboard/houses", "info", "home"),
    todoItem(S.away, "voters live outside", "మంది ఊరిలో లేరు", "call early to plan for poll day", "#/voters", "info", "phone", { status: "away" }),
  ].join("");
  sec.todo = `<section class="card dk-sec"><div class="dk-sec-h"><h2>${L("To do now", "ఇప్పుడు చేయాల్సినవి")}</h2></div>${todos || `<p class="muted" style="padding:0 16px 16px">Nothing urgent.</p>`}</section>`;
  const grpRow = (en, te, list, go) => { const s = summarize(list); return `<a class="dk-grp" href="#/voters" ${goAttr({ ...go, ...(hf ? { hamlet: hf } : {}) })}><span><b>${L(en, te)}</b><span class="en">${nf(s.n)} voters · ${pct(s.visited, s.n)}% visited</span></span>${sbar(s, 12)}<span class="num r"><b>${pct(s.ours, s.n)}%</b><span class="en">with us</span></span></a>`; };
  sec.groups = `<section class="card dk-sec"><div class="dk-sec-h"><h2>${L("Support by group", "వర్గాల వారీగా మద్దతు")}</h2><a class="small" href="#/dashboard/people">More →</a></div>
      ${grpRow("Women", "మహిళలు", women, { gender: "F" })}${grpRow("Men", "పురుషులు", men, { gender: "M" })}
      ${grpRow("Age 18–29", "వయసు 18–29", rows.filter((v) => v.age >= 18 && v.age <= 29), { age: "youth" })}${grpRow("Age 60+", "వయసు 60+", rows.filter((v) => v.age >= 60), { age: "senior" })}</section>`;
  const nameBy = Object.fromEntries(all.map((v) => [v.serial, v]));
  const recent = acts.filter((a) => !hf || String(nameBy[a.voter_serial]?.hamlet_id) === hf).slice(0, 8);
  sec.latest = `<section class="card dk-sec"><div class="dk-sec-h"><h2>${L("Latest updates", "తాజా మార్పులు")}</h2><a class="small" href="#/activity">All →</a></div>
      ${recent.length ? `<ul class="dk-feed">${recent.map((a) => `<li><span class="time">${esc(relTime(a.at))}</span><span><b>${esc(personName(a.user_id) || "—")}</b> · ${esc(describe(a))} · <a href="#/v/${a.voter_serial}">${esc(nameBy[a.voter_serial]?.name || "")} #${a.voter_serial}</a></span></li>`).join("")}</ul>` : `<p class="muted" style="padding:0 16px 16px">No updates in the last 14 days.</p>`}</section>`;

  // ── one hamlet ──
  let hamletBody = "";
  if (tab === "hamlet") {
    const hid = Number(hf);
    const rank = winRows.findIndex((r) => r.h.id === hid);
    const incharges = teamPeople().filter((p) => p.role === "incharge" && (p.hamlet_ids || []).includes(hid));
    const groups = [["Women", "మహిళలు", women, { gender: "F" }], ["Men", "పురుషులు", men, { gender: "M" }],
      ...AGE_BANDS.map((b) => [`Age ${b.en}`, `వయసు ${b.te}`, rows.filter((v) => inBand(v, b)), { age: b.k }])];
    const byWorker = new Map();
    for (const v of rows) { const k = v.assigned_to || ""; if (!byWorker.has(k)) byWorker.set(k, []); byWorker.get(k).push(v); }
    const wk = [...byWorker.entries()].filter(([k]) => k).map(([k, list]) => ({ id: k, s: summarize(list), fu: list.filter((v) => v.follow_up_on && v.follow_up_on < today).length }))
      .sort((a, b) => pct(a.s.visited, a.s.n) - pct(b.s.visited, b.s.n));
    const bigHere = hs.filter((h) => h.length >= 4).map((h) => ({ h, s: summarize(h) })).filter((x) => x.s.persu >= Math.ceil(x.s.n / 2))
      .sort((a, b) => b.s.persu - a.s.persu || b.s.n - a.s.n).slice(0, 8);
    hamletBody = `${kpiRow({ hamlet: hf })}
      <section class="card dk-sec" style="padding-bottom:16px"><div class="dk-sec-h"><h2>${L("Support in this hamlet", "ఈ గ్రామంలో మద్దతు")}</h2><span class="en in">${nf(S.n)} voters</span></div>
        <div style="padding:0 16px">${sbar(S, 20)}${legend(S)}</div></section>
      <div class="dk-3">
        <section class="card dk-sec"><div class="dk-sec-h"><h2>${L("Who is not decided yet", "ఇంకా తేల్చుకోని వారు")}</h2><span class="en in">many "not known" means visit them first</span></div>
          <div class="tablewrap flat"><table class="an dk-t"><thead><tr><th>Group</th><th class="n">Voters</th><th class="n">Visited</th><th style="min-width:120px">Support</th><th class="n">Not known</th></tr></thead><tbody>
          ${groups.map(([en, te, list, go]) => { const s = summarize(list); return s.n ? `<tr class="go" ${goAttr({ ...go, hamlet: hf })}><td><a href="#/voters" ${goAttr({ ...go, hamlet: hf })}>${L(en, te)}</a></td><td class="n">${nf(s.n)}</td><td class="n">${pct(s.visited, s.n)}%</td><td>${sbar(s)}</td><td class="n">${pct(s.unknown, s.n)}%</td></tr>` : ""; }).join("")}
          </tbody></table></div></section>
        <div class="dk-side"><section class="card dk-sec"><div class="dk-sec-h"><h2>${L("Team in this hamlet", "ఈ గ్రామంలో బృందం")}</h2></div>
          <div class="tablewrap flat"><table class="an dk-t"><thead><tr><th>Person</th><th class="n">Voters</th><th class="n">Visited</th><th class="n">Overdue</th><th>Last active</th></tr></thead><tbody>
          ${wk.map((w) => `<tr><td><a href="#/activity?u=${esc(w.id)}">${esc(personName(w.id) || "—")}</a></td><td class="n">${nf(w.s.n)}</td><td class="n">${pct(w.s.visited, w.s.n)}%</td><td class="n ${w.fu ? "bad" : ""}">${nf(w.fu)}</td><td class="${lastAt[w.id] && Date.now() - new Date(lastAt[w.id]) < 72 * 3600e3 ? "" : "bad"}">${lastAt[w.id] ? esc(relTime(lastAt[w.id])) : esc(t("never"))}</td></tr>`).join("")}
          ${noWorker ? `<tr class="dk-warnrow"><td><b>${L("No worker yet", "వర్కర్ లేరు")}</b></td><td class="n">${nf(noWorker)}</td><td colspan="3"><a href="#/voters" ${goAttr({ hamlet: hf, status: "unassigned" })}>Assign these →</a></td></tr>` : ""}
          ${!wk.length && !noWorker ? `<tr><td colspan="5" class="muted">Nobody assigned yet.</td></tr>` : ""}
          </tbody></table></div></section>
        <section class="card dk-sec"><div class="dk-sec-h"><h2>${L("Big houses still open", "ఇంకా తేలని పెద్ద ఇళ్ళు")}</h2><span class="en in">one visit reaches many votes</span></div>
          ${bigHere.length ? bigHere.map(({ h, s }) => `<a class="dk-todo" href="#/voters" ${goAttr({ q: h[0].house_no, hamlet: hf })}><span class="dot info num">${s.n}</span><span class="grow"><b>${esc(STRINGS.en.house)} ${esc(h[0].house_no)}</b><span class="en">${s.visited} of ${s.n} visited · ${s.persu} still open</span></span>${sbar(s, 8)}</a>`).join("") : `<p class="muted" style="padding:0 16px 16px">None right now.</p>`}
        </section></div>
      </div>
      ${sec.latest}`;
    hamletBody = `<div class="dk-crumb"><a href="#/dashboard">${L("Overview", "సారాంశం")}</a> › <a href="#/dashboard/hamlets">${L("Hamlets", "గ్రామాలు")}</a></div>` + hamletBody;
    sec.hamletHead = `<span class="en">${nf(S.n)} voters · ${nf(houses.size)} houses${incharges.length ? " · in-charge " + esc(incharges.map((x) => x.full_name || x.username).join(", ")) : ""}${rank >= 0 && target ? ` · gap rank ${rank + 1} of ${winRows.length}` : ""}</span>`;
  }

  const body = {
    overview: `${kpiRow({})}<div class="dk-split">${sec.win}<div class="dk-side">${sec.todo}${sec.groups}</div></div>${sec.latest}${ins.length ? sec.insights : ""}`,
    hamlet: hamletBody,
    people: `<div class="an-grid" style="margin-top:0">${sec.gender}${sec.pyramid}</div>${sec.agetable}`,
    hamlets: hf ? `<p class="card">Choose "All hamlets" above to compare hamlets.</p>` : sec.hamtable.replace('style="margin-top:12px"', ""),
    houses: sec.houses.replace('style="margin-top:12px"', 'style="margin-top:0"'),
    reach: sec.reach + sec.rules,
    team: sec.team,
  }[tab];

  const heading = tab === "hamlet" ? `${esc(hamletName(Number(hf)))}${sec.hamletHead}`
    : tab === "overview" ? `${L("Are we winning?", "మనం గెలుస్తున్నామా?")}<span class="en">${esc(t("all_hamlets"))} · ${nf(all.length)} voters</span>` : L("Dashboard", "డాష్‌బోర్డ్");
  main.innerHTML = `
    <div class="row between an-head">
      <h1 style="margin:0">${heading}</h1>
      <div class="row" style="gap:8px">
        ${tab === "hamlet" ? `<a class="btn primary small" href="#/voters" ${goAttr({ hamlet: hf, lean: "open" })}>${L(`Open ${nf(S.persu)} still-open voters`, `${nf(S.persu)} తేలని ఓటర్లు`)}</a>
        <a class="btn small" href="#/print" ${goAttr({ hamlet: hf, status: "not_contacted" })} data-then="#/print">${icon("print", "width:18px;height:18px")} ${esc(t("walk_list"))}</a>` : ""}
        <select id="anHamlet" style="width:auto">${opt("", t("all_hamlets"), hf)}${hamlets.map((h) => opt(h.id, hamletName(h.id), hf)).join("")}</select>
        <button type="button" id="anRefresh" class="noprint" title="Refresh">${icon("refresh", "width:18px;height:18px")}</button>
        <button type="button" id="anPrint" class="noprint">${icon("print", "width:18px;height:18px")} ${esc(t("print"))}</button>
      </div>
    </div>
    <nav class="dtabs noprint" aria-label="Dashboard sections">${DASH_TABS.map(([k, en, te]) => `<a href="#/dashboard/${k}" class="${k === tab || (tab === "hamlet" && k === "hamlets") ? "on" : ""}">${lang === "te" ? esc(te) : esc(en)}</a>`).join("")}</nav>
    <div class="dbody">${body}</div>
    <p class="small muted center">${esc(t("refreshed"))}: ${esc(fmtTime(new Date(dashCache.at).toISOString()))}</p>`;

  $("#anHamlet").addEventListener("change", (e) => {
    const v = e.target.value;
    if (tab === "overview" || tab === "hamlet") { location.hash = v ? `#/dashboard/hamlet/${v}` : "#/dashboard"; return; }
    store.set("anHamlet", v); viewAnalytics(tab);
  });
  $$("tr.go[data-href]").forEach((tr) => tr.addEventListener("click", (e) => { if (!e.target.closest("a")) location.hash = tr.dataset.href; }));
  $("#anRefresh").addEventListener("click", () => viewAnalytics(tab, true));
  $("#anPrint").addEventListener("click", () => window.print());
}

// ───────── laptop: voters workspace (filter, select, assign) ─────────
const DESK_PAGE = 50;
const deskSel = new Set();
async function viewVotersDesk(params = "") {
  main.classList.add("wide");
  const opt = (val, label, cur) => `<option value="${esc(val)}" ${String(cur) === String(val) ? "selected" : ""}>${esc(label)}</option>`;
  const chip = (key, val, label) => `<button type="button" class="dk-chip ${String(filters[key]) === String(val) ? "on" : ""}" data-k="${key}" data-v="${esc(val)}">${label}</button>`;
  const grp = (title, html) => `<div class="dk-fg"><div class="dk-fl">${title}</div><div class="dk-chips">${html}</div></div>`;
  const people = team.filter((p) => p.active && p.role !== "superadmin");
  const workerOpts = `<option value="">${esc(t("assign"))}…</option><option value="__none">${esc(t("nobody"))}</option>${people.map((p) => `<option value="${p.id}">${esc(p.full_name || p.username)}</option>`).join("")}`;
  main.innerHTML = `
    <div class="row between an-head">
      <h1 style="margin:0">${esc(t("tab_voters"))}<span class="en" id="dkSub"></span></h1>
      <label class="searchbox dk-search">
        <span style="color:var(--brand)">${icon("search")}</span>
        <input type="search" id="q" aria-label="${esc(t("search_ph"))}" placeholder="${esc(t("search_ph"))}" value="${esc(filters.q)}" autocomplete="off">
      </label>
    </div>
    <div class="dk-work">
      <aside class="card dk-rail" aria-label="Filters">
        <div class="row between"><b>${L("Filters", "ఫిల్టర్లు")}</b><button type="button" class="ghost small" id="clearBtn" style="color:var(--brand)">${esc(t("clear_all"))}</button></div>
        <div class="dk-fg"><div class="dk-fl">${esc(t("hamlet"))}</div><select id="fHamlet">${opt("", t("all_hamlets"), filters.hamlet)}${hamlets.map((h) => opt(h.id, hamletName(h.id), filters.hamlet)).join("")}</select></div>
        ${grp(esc(t("support")), [chip("lean", "open", esc(t("lean_open"))), ...[...scale()].reverse().map((l) => chip("lean", l, `<i style="background:${SUP_COLOR[l]}"></i>${esc(t("lean_" + l))}`)), chip("lean", "unknown", `<i style="background:${SUP_COLOR.unknown}"></i>${esc(t("lean_unknown"))}`)].join(""))}
        ${grp(L("Show only", "చూపించు"), ["not_contacted", "contacted", "follow_up_due", "unassigned", "away", "has_phone", "slip_pending", "transport", "review"].map((k) => chip("status", k, esc(t("st_" + k)))).join(""))}
        ${grp(esc(t("gender")), chip("gender", "F", esc(t("women"))) + chip("gender", "M", esc(t("male"))))}
        ${grp(L("Age", "వయసు"), [["first", "18–22"], ["young", "23–29"], ["a30", "30–44"], ["a45", "45–59"], ["senior", "60+"]].map(([k, l]) => chip("age", k, l)).join(""))}
        <div class="dk-fg"><div class="dk-fl">${L("Everyone in this list", "ఈ జాబితాలో అందరూ")}</div>
          <div class="row" style="gap:6px;flex-wrap:nowrap"><select id="bulkWorker" style="flex:1;min-width:0">${workerOpts}</select><button type="button" class="small" id="bulkAssign">${esc(t("assign"))}</button></div>
          <div class="row" style="gap:6px;margin-top:8px"><a class="btn small" href="#/print">${icon("print", "width:18px;height:18px")} ${esc(t("walk_list"))}</a>${isSuper() ? `<button type="button" class="small" id="csvBtn">⬇ CSV</button>` : ""}</div>
        </div>
      </aside>
      <section class="card dk-table">
        <div class="dk-bulk" id="bulk" hidden>
          <b id="selN"></b>
          <span class="grow"></span>
          <select id="selWorker" aria-label="${esc(t("assign"))}">${workerOpts}</select>
          <label class="row" style="gap:6px;flex-wrap:nowrap">${esc(t("tab_follow"))} <input type="date" id="selDate" style="width:auto"></label>
          <button type="button" class="small" id="selClear">${esc(t("close"))}</button>
        </div>
        <div class="tablewrap flat"><table class="an dk-t dk-vt">
          <thead><tr><th style="width:36px"><input type="checkbox" id="selAll" aria-label="Select all on this page"></th><th>#</th><th>${esc(t("name"))}</th><th>${L("Age", "వయసు")}</th><th>${esc(STRINGS[lang].house || "House")}</th><th>${esc(t("hamlet"))}</th><th>${L("Worker", "వర్కర్")}</th><th>${esc(t("support"))}</th><th>${L("Visited", "కలిశాం")}</th><th>${esc(t("tab_follow"))}</th></tr></thead>
          <tbody id="rows"><tr><td colspan="10" class="muted center">…</td></tr></tbody>
        </table></div>
        <div class="row between small muted" style="padding:10px 14px"><span id="count" class="num"></span><span class="row" style="gap:8px"><button type="button" class="small" id="prev">←</button><span id="pageN" class="num"></span><button type="button" class="small" id="next">→</button></span></div>
      </section>
      <aside class="card dk-panel" id="panel" hidden></aside>
    </div>`;

  let offset = Number(store.get("dkOffset", 0)) || 0, total = 0, seq = 0, data = [], openSerial = null;
  const today = todayIST();
  const fuCell = (d) => !d ? "" : d < today ? `<span class="bad">${esc(fmtDay(d))}</span>` : d === today ? `<b>${esc(t("today"))}</b>` : esc(fmtDay(d));
  const supCell = (l) => `<span class="dk-sup"><i style="background:${SUP_COLOR[l || "unknown"]}"></i>${esc(t("lean_" + (l || "unknown")))}</span>`;
  const rowHtml = (v) => `<tr data-s="${v.serial}" class="${v.serial === openSerial ? "on" : ""}">
      <td><input type="checkbox" data-pick="${v.serial}" ${deskSel.has(v.serial) ? "checked" : ""} aria-label="Select ${esc(v.name || "")}"></td>
      <td class="num">${v.serial}</td><td><b>${esc(v.name || "—")}</b><span class="en">${esc(v.name_en || "")}</span></td>
      <td class="num">${v.gender || ""} ${v.age || ""}</td><td class="num">${esc(v.house_no || "")}</td><td>${esc(hamletName(v.hamlet_id))}</td>
      <td>${v.assigned_to ? esc(personName(v.assigned_to)) : `<span class="bad">${esc(t("nobody"))}</span>`}</td>
      <td>${supCell(v.leaning)}</td><td>${v.voted ? esc(t("st_voted")) : v.contacted ? `${icon("check", "width:16px;height:16px;color:var(--brand)")} ${esc(v.contacted_at ? fmtShort(v.contacted_at) : "")}` : ""}</td><td>${fuCell(v.follow_up_on)}</td></tr>`;
  const paintBulk = () => {
    $("#bulk").hidden = !deskSel.size;
    $("#selN").textContent = `${deskSel.size} ${lang === "te" ? "ఎంచుకున్నారు" : "selected"}`;
    $("#selAll").checked = data.length > 0 && data.every((v) => deskSel.has(v.serial));
  };
  async function load() {
    const my = ++seq;
    let qb = sb.from("voters").select(VOTER_COLS, { count: "exact" });
    qb = applyFilters(qb, filters).order("serial").range(offset, offset + DESK_PAGE - 1);
    const { data: d, error, count } = await qb;
    if (my !== seq) return;
    if (error) return fail(error);
    total = count ?? 0;
    if (offset && offset >= total) { offset = 0; store.set("dkOffset", 0); return load(); }
    data = d;
    $("#rows").innerHTML = data.length ? data.map(rowHtml).join("") : `<tr><td colspan="10" class="empty">${esc(t("no_results"))}</td></tr>`;
    $("#count").textContent = `${nf(total)} ${t("found")}`;
    $("#dkSub").textContent = `${nf(total)} ${STRINGS.en.found}`;
    $("#pageN").textContent = total ? `${offset + 1}–${Math.min(offset + DESK_PAGE, total)}` : "";
    $("#prev").disabled = offset === 0; $("#next").disabled = offset + DESK_PAGE >= total;
    paintBulk();
  }
  const reload = (keepPage = false) => { if (!keepPage) { offset = 0; store.set("dkOffset", 0); } load(); };

  async function openPanel(serial) {
    openSerial = serial;
    $$("#rows tr").forEach((tr) => tr.classList.toggle("on", Number(tr.dataset.s) === serial));
    const v = data.find((x) => x.serial === serial);
    if (!v) return;
    const panel = $("#panel");
    panel.hidden = false;
    const [{ data: house }, { data: last }] = await Promise.all([
      v.house_no ? sb.from("voters").select("serial,name,leaning,age,gender").eq("hamlet_id", v.hamlet_id).eq("house_no", v.house_no).neq("serial", v.serial).order("serial").limit(20) : { data: [] },
      sb.from("activity").select("user_id,at,action,detail").eq("voter_serial", v.serial).order("at", { ascending: false }).limit(3),
    ]);
    if (openSerial !== serial) return;
    const tel = (v.phone || "").replace(/[^\d+]/g, "");
    const rel = v.relation_name ? `${t("rel_" + (v.relation_type || "other"))}: ${v.relation_name}` : "";
    panel.innerHTML = `
      <div class="row between" style="flex-wrap:nowrap;align-items:flex-start;gap:8px">
        <div><span class="en">#${v.serial}${v.house_no ? ` · ${esc(STRINGS.en.house)} ${esc(v.house_no)}` : ""} · ${esc(hamletName(v.hamlet_id))}</span>
          <div style="font-size:20px;font-weight:700;line-height:1.3">${esc(v.name || "—")}</div>
          <span class="en">${esc([v.name_en, v.age && `${v.age} ${v.gender || ""}`, rel].filter(Boolean).join(" · "))}</span></div>
        <button type="button" class="iconbtn" id="pClose" aria-label="${esc(t("close"))}">${icon("x")}</button>
      </div>
      <div class="row" style="gap:8px;flex-wrap:nowrap">
        ${tel ? `<a class="btn small grow" href="tel:${esc(tel)}">${icon("phone", "width:18px;height:18px")} ${esc(v.phone)}</a>` : ""}
        <a class="btn small grow" href="#/v/${v.serial}">${L("Open full card", "పూర్తి వివరాలు")}</a>
      </div>
      <div><div class="dk-fl">${esc(t("support"))}</div>
        <div class="dk-supbtns" id="pSup">${[...scale()].reverse().map((l) => `<button type="button" data-l="${l}" class="${v.leaning === l ? "on" : ""}" style="--c:${SUP_COLOR[l]}">${esc(t("lean_" + l))}</button>`).join("")}</div>
        <span class="en" style="margin-top:4px">${esc(STRINGS.en.tap_clear)}</span></div>
      <div class="dk-facts">
        <div><span class="en">${L("Worker", "వర్కర్")}</span><select id="pWorker">${`<option value="__none">${esc(t("nobody"))}</option>` + people.map((p) => `<option value="${p.id}" ${v.assigned_to === p.id ? "selected" : ""}>${esc(p.full_name || p.username)}</option>`).join("")}</select></div>
        <div><span class="en">${esc(t("tab_follow"))}</span><input type="date" id="pDate" value="${esc(v.follow_up_on || "")}"></div>
        <div><span class="en">${L("Visited", "కలిశాం")}</span><b>${v.contacted ? (v.contacted_at ? esc(fmtShort(v.contacted_at)) : esc(t("st_contacted"))) : "—"}</b></div>
        <div><span class="en">${L("Lives", "ఉంటున్నది")}</span><b>${v.away ? esc(v.away_place || t("st_away")) : L("In village", "ఊరిలోనే")}</b></div>
      </div>
      ${house?.length ? `<div><div class="dk-fl">${L("Same house", "అదే ఇల్లు")} (${house.length + 1})</div><ul class="dk-house">${house.map((h) => `<li><a href="#/voters" data-open="${h.serial}">${esc(h.name || "—")}</a><span class="en in">${h.gender || ""} ${h.age || ""}</span>${supCell(h.leaning)}</li>`).join("")}</ul></div>` : ""}
      ${v.notes ? `<div><div class="dk-fl">${esc(t("notes"))}</div><div class="dk-note">${esc(v.notes)}</div></div>` : ""}
      <a class="btn primary big" href="#/v/${v.serial}/visit">${icon("check")} ${esc(t("record_visit"))}</a>
      ${last?.length ? `<div class="en">${last.map((h) => `${esc(relTime(h.at))} · ${esc(personName(h.user_id) || "—")} · ${esc(describe(h))}`).join("<br>")}</div>` : ""}`;
    const save = async (patch, msg = t("saved"), undo = null) => {
      const { error } = await sb.from("voters").update(patch).eq("serial", v.serial);
      if (error) { fail(error); return false; }
      Object.assign(v, patch);
      const tr = $(`#rows tr[data-s="${v.serial}"]`);
      if (tr) tr.outerHTML = rowHtml(v);
      toast(msg, false, undo);
      return true;
    };
    $("#pClose").addEventListener("click", () => { openSerial = null; panel.hidden = true; $$("#rows tr.on").forEach((tr) => tr.classList.remove("on")); });
    $("#pSup").addEventListener("click", async (e) => {
      const b = e.target.closest("button[data-l]"); if (!b) return;
      const before = { leaning: v.leaning || "unknown", contacted: !!v.contacted };
      const patch = b.dataset.l === v.leaning ? { leaning: "unknown" } : { leaning: b.dataset.l, contacted: true };
      const ok = await save(patch, patch.leaning === "unknown" ? t("sup_cleared") : t("saved"), { label: t("undo"), run: async () => {
        if (await save(before, t("undone")) && openSerial === v.serial) openPanel(v.serial);
      } });
      if (ok) openPanel(v.serial);
    });
    $("#pWorker").addEventListener("change", (e) => save({ assigned_to: e.target.value === "__none" ? null : e.target.value }));
    $("#pDate").addEventListener("change", (e) => save({ follow_up_on: e.target.value || null }));
    panel.addEventListener("click", (e) => {
      const a = e.target.closest("[data-open]"); if (!a) return;
      e.preventDefault();
      const s = Number(a.dataset.open);
      if (data.some((x) => x.serial === s)) openPanel(s); else location.hash = `#/v/${s}`;
    });
  }

  let deb;
  $("#q").addEventListener("input", (e) => { filters.q = e.target.value; store.set("filters", filters); clearTimeout(deb); deb = setTimeout(() => reload(), 300); });
  $("#fHamlet").addEventListener("change", (e) => { filters.hamlet = e.target.value; store.set("filters", filters); reload(); });
  $$(".dk-rail [data-k]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.k, val = b.dataset.v;
    filters[k] = String(filters[k]) === val ? EMPTY_FILTERS[k] : val;
    store.set("filters", filters);
    $$(`.dk-rail [data-k="${k}"]`).forEach((x) => x.classList.toggle("on", String(filters[k]) === x.dataset.v));
    reload();
  }));
  $("#clearBtn").addEventListener("click", () => { setFilters({}); deskSel.clear(); store.set("dkOffset", 0); viewVotersDesk(); });
  $("#prev").addEventListener("click", () => { offset = Math.max(0, offset - DESK_PAGE); store.set("dkOffset", offset); load(); });
  $("#next").addEventListener("click", () => { offset += DESK_PAGE; store.set("dkOffset", offset); load(); });
  $("#rows").addEventListener("click", (e) => {
    const pick = e.target.closest("[data-pick]");
    if (pick) { const s = Number(pick.dataset.pick); if (pick.checked) deskSel.add(s); else deskSel.delete(s); return paintBulk(); }
    const tr = e.target.closest("tr[data-s]");
    if (tr && !e.target.closest("a")) openPanel(Number(tr.dataset.s));
  });
  $("#selAll").addEventListener("change", (e) => { data.forEach((v) => (e.target.checked ? deskSel.add(v.serial) : deskSel.delete(v.serial))); $$("#rows [data-pick]").forEach((c) => (c.checked = e.target.checked)); paintBulk(); });
  $("#selClear").addEventListener("click", () => { deskSel.clear(); $$("#rows [data-pick]").forEach((c) => (c.checked = false)); paintBulk(); });
  const bulkPatch = async (patch, label) => {
    const list = [...deskSel];
    for (let i = 0; i < list.length; i += 200) {
      const { error } = await sb.from("voters").update(patch).in("serial", list.slice(i, i + 200));
      if (error) return fail(error);
    }
    toast(`${list.length} → ${label}`);
    deskSel.clear();
    reload(true);
  };
  $("#selWorker").addEventListener("change", (e) => {
    const who = e.target.value; if (!who) return;
    const name = who === "__none" ? t("nobody") : personName(who);
    if (!confirm(`${t("assign_confirm")} ${deskSel.size} → ${name}?`)) { e.target.value = ""; return; }
    bulkPatch({ assigned_to: who === "__none" ? null : who }, name);
  });
  $("#selDate").addEventListener("change", (e) => { if (e.target.value) bulkPatch({ follow_up_on: e.target.value }, fmtDay(e.target.value)); });
  $("#csvBtn")?.addEventListener("click", () => exportCsv());
  $("#bulkAssign").addEventListener("click", async () => {
    const who = $("#bulkWorker").value;
    if (!who || !total) return;
    const name = who === "__none" ? t("nobody") : personName(who);
    if (!confirm(`${t("assign_confirm")} ${total} → ${name}?`)) return;
    const { error } = await applyFilters(sb.from("voters").update({ assigned_to: who === "__none" ? null : who }), filters);
    if (error) return fail(error);
    toast(`${total} → ${name}`);
    reload(true);
  });
  await load();
  const want = Number(new URLSearchParams(params).get("open"));
  if (want && data.some((v) => v.serial === want)) openPanel(want);
}

// ───────── laptop: is the team working? ─────────
async function viewTeamDesk({ people, statBy, lastAt, isIdle, idle, roleF, n }) {
  main.classList.add("wide");
  const quietF = roleF === "quiet";
  const shown = people.filter((p) => quietF ? isIdle(p) : (!roleF || p.role === roleF || (roleF === "admin" && p.role === "superadmin")));
  let selId = store.get("teamSel", "");
  if (!shown.some((p) => p.id === selId)) selId = (shown.find((p) => ["worker", "incharge"].includes(p.role)) || shown[0])?.id || "";
  const field = people.filter((p) => p.active && ["worker", "incharge"].includes(p.role));
  const dayStart = new Date(todayIST() + "T00:00:00+05:30").getTime();
  const activeToday = field.filter((p) => lastAt[p.id] && new Date(lastAt[p.id]).getTime() >= dayStart).length;
  const totalUn = await sb.from("voters").select("serial", { count: "exact", head: true }).is("assigned_to", null).then((r) => r.count ?? 0);
  const vbar = (s) => `<span class="row" style="gap:8px;flex-wrap:nowrap"><span class="pbar wide"><i style="width:${pct(s.contacted, s.assigned)}%;background:var(--brand)"></i></span><span class="num">${pct(s.contacted, s.assigned)}%</span></span>`;
  main.innerHTML = `
    <div class="row between an-head">
      <h1 style="margin:0">${L("Is the team working?", "బృందం పని చేస్తోందా?")}<span class="en">${people.length} people · ${activeToday} of ${field.length} active today · ${idle.length} quiet for 2+ days · ${nf(totalUn)} voters have no worker</span></h1>
      <div class="row" style="gap:8px"><a class="btn small" href="#/activity">${icon("clock", "width:18px;height:18px")} ${esc(t("updates_title"))}</a>${isAdmin() ? `<a class="btn primary small" href="#/team/new">${icon("plus", "width:18px;height:18px")} ${esc(t("add_person"))}</a>` : ""}</div>
    </div>
    <div class="dk-work dk-work2">
      <section class="card dk-table">
        <div class="dk-chips" id="roleTabs" style="padding:12px 14px;border-bottom:1px solid var(--line)">
          ${[["", t("all_people"), people.length], ["quiet", lang === "te" ? "పని చేయని వారు" : "Quiet 2+ days", idle.length], ["incharge", t("role_incharge"), n("incharge")], ["worker", t("role_worker"), n("worker")], ["admin", t("role_admin"), n("admin")]]
            .map(([r, lbl, c]) => `<button type="button" class="dk-chip ${roleF === r ? "on" : ""}" data-role="${r}">${esc(lbl)} <span class="num">${c}</span></button>`).join("")}
        </div>
        <div class="tablewrap flat"><table class="an dk-t">
          <thead><tr><th>${esc(t("name"))}</th><th>${L("Role", "పాత్ర")}</th><th>${L("Area", "ప్రాంతం")}</th><th class="n">${L("Voters", "ఓటర్లు")}</th><th style="min-width:150px">${L("Visited", "కలిశాం")}</th><th class="n">${L("With us", "మనవైపు")}</th><th class="n">${L("Overdue", "గడువు దాటినవి")}</th><th>${L("Last active", "చివరిగా")}</th></tr></thead>
          <tbody>${shown.map((p) => { const s = statBy[p.id]; return `<tr data-p="${p.id}" class="${p.id === selId ? "on" : ""} ${p.active ? "" : "muted"}">
            <td><b>${esc(p.full_name || p.username)}</b><span class="en">@${esc(p.username)}</span></td>
            <td><span class="pill sm r-${p.role}">${esc(t("role_" + p.role))}</span></td>
            <td>${esc((p.hamlet_ids || []).map((h) => hamletName(h)).join(", ") || (["admin", "superadmin"].includes(p.role) ? t("all_hamlets") : "—"))}</td>
            <td class="n">${s ? nf(s.assigned) : "—"}</td><td>${s ? vbar(s) : ""}</td>
            <td class="n">${s && s.contacted ? pct(s.ours, s.contacted) + "%" : "—"}</td>
            <td class="n ${s?.follow_ups_due ? "bad" : ""}">${s ? nf(s.follow_ups_due) : "—"}</td>
            <td class="${isIdle(p) ? "bad" : ""}">${lastAt[p.id] ? esc(relTime(lastAt[p.id])) : esc(t("never"))}${p.active ? "" : " · " + esc(t("inactive"))}</td></tr>`; }).join("")}</tbody>
        </table></div>
        <p class="en" style="padding:10px 14px;margin:0">"With us" is Sure + Likely among the voters they visited. "Overdue" counts follow-ups due today or earlier. Click a row to see what they did.</p>
      </section>
      <div class="dk-side">
        <aside class="card dk-panel" id="pPanel"></aside>
        <aside class="card dk-sec" id="unBox"><div class="dk-sec-h"><h2>${L("Voters with no worker", "వర్కర్ లేని ఓటర్లు")}</h2><span class="en in">${nf(totalUn)} in all</span></div><p class="muted" style="padding:0 16px 16px">…</p></aside>
      </div>
    </div>`;

  $("#roleTabs").addEventListener("click", (e) => { const b = e.target.closest("[data-role]"); if (!b) return; store.set("teamRole", b.dataset.role); viewTeam(); });
  async function showPerson(id) {
    selId = id; store.set("teamSel", id);
    $$("tr[data-p]").forEach((tr) => tr.classList.toggle("on", tr.dataset.p === id));
    const p = people.find((x) => x.id === id), panel = $("#pPanel");
    if (!p) { panel.hidden = true; return; }
    panel.hidden = false;
    const s = statBy[p.id];
    panel.innerHTML = `<div class="row between" style="flex-wrap:nowrap;align-items:flex-start"><div><div style="font-size:20px;font-weight:700">${esc(p.full_name || p.username)}</div><span class="en">${esc(t("role_" + p.role))}${p.phone ? " · " + esc(p.phone) : ""}</span></div>${canManage(p) || p.id === me.id ? `<a class="small" href="#/team/p/${p.id}">${esc(t("edit"))}</a>` : ""}</div>
      ${s ? `<div class="dk-tiles"><div><b class="num">${nf(s.contacted)}</b><span class="en">visited</span></div><div><b class="num">${nf(s.assigned - s.contacted)}</b><span class="en">to go</span></div><div class="${s.follow_ups_due ? "warn" : ""}"><b class="num">${nf(s.follow_ups_due)}</b><span class="en">follow-ups due</span></div></div>` : `<p class="en">No voters assigned.</p>`}
      <div class="row" style="gap:8px;flex-wrap:nowrap">${p.phone ? `<a class="btn small grow" href="tel:${esc(p.phone.replace(/[^\d+]/g, ""))}">${icon("phone", "width:18px;height:18px")} ${esc(t("call"))}</a>` : ""}<a class="btn small grow" href="#/activity?u=${p.id}">${esc(t("updates"))}</a></div>
      <div class="dk-fl">${L("Recent activity", "ఇటీవలి పని")}</div><div id="pActs" class="en">…</div>`;
    const { data: acts } = await sb.from("activity").select("voter_serial,user_id,at,action,detail").eq("user_id", p.id).order("at", { ascending: false }).limit(8);
    if (selId !== id) return;
    $("#pActs").outerHTML = acts?.length ? `<ul class="dk-feed">${acts.map((a) => `<li><span class="time">${esc(relTime(a.at))}</span><span>${esc(describe(a))} · <a href="#/v/${a.voter_serial}">#${a.voter_serial}</a></span></li>`).join("")}</ul>` : `<p class="en">${esc(t("never"))}</p>`;
  }
  $("tbody").addEventListener("click", (e) => { const tr = e.target.closest("tr[data-p]"); if (tr && !e.target.closest("a")) showPerson(tr.dataset.p); });
  if (selId) showPerson(selId); else $("#pPanel").hidden = true;
  const counts = await Promise.all(hamlets.map((h) => sb.from("voters").select("serial", { count: "exact", head: true }).is("assigned_to", null).eq("hamlet_id", h.id).then((r) => [h, r.count ?? 0])));
  const un = counts.filter(([, c]) => c).sort((a, b) => b[1] - a[1]);
  const box = $("#unBox");
  if (box) box.innerHTML = `<div class="dk-sec-h"><h2>${L("Voters with no worker", "వర్కర్ లేని ఓటర్లు")}</h2><span class="en in">${nf(totalUn)} in all</span></div>` +
    (un.length ? un.map(([h, c]) => `<a class="dk-todo" href="#/voters" ${goAttr({ hamlet: String(h.id), status: "unassigned" })}><span class="grow"><b>${esc(hamletName(h.id))}</b></span><b class="num">${nf(c)}</b><span class="en in">${esc(t("assign"))} →</span></a>`).join("") : `<p class="muted" style="padding:0 16px 16px">Everyone has a worker.</p>`);
}

// ───────── router & boot ─────────
function route() {
  if (!me) return;
  if (dashChannel && !/^#\/(reports|dash$)/.test(location.hash)) { sb.removeChannel(dashChannel); dashChannel = null; }
  const full = location.hash.replace(/^#/, "") || "/";
  const [h, params = ""] = full.split("?");
  window.scrollTo(0, 0);
  main.dataset.view = /^\/v\/\d+/.test(h) ? "voter" : (/^\/team\/(new|p\/)/.test(h) ? "person" : (h.split("/")[1] || (isAdmin() && !location.hash && matchMedia("(min-width: 1000px)").matches ? "dashboard" : "today")));
  let m = h.match(/^\/v\/(\d+)(\/visit)?/);
  if (m) return viewVoter(Number(m[1]), !!m[2]);
  if (h.startsWith("/voters")) return viewSearch(params);
  if (h.startsWith("/follow")) return viewFollow();
  if (h.startsWith("/poll")) return viewPoll();
  if (h.startsWith("/reports") || h === "/dash") return viewReports();
  m = h.match(/^\/(?:dashboard|analysis)(?:\/(\w+))?(?:\/(\d+))?/);
  if (m) return viewAnalytics(m[1], false, m[2] || "");
  if (!location.hash && isAdmin() && matchMedia("(min-width: 1000px)").matches) return viewAnalytics();
  m = h.match(/^\/team\/(new|p\/([\w-]+))/);
  if (m) return viewPerson(m[2] || "new");
  if (h.startsWith("/team")) return viewTeam();
  if (h.startsWith("/activity")) return viewActivity(params);
  if (h.startsWith("/print")) return viewPrint();
  const rm = h.match(/^\/transport\/(\d+)/);
  if (rm && hasTransport) return viewRoster(Number(rm[1]));
  if (h.startsWith("/transport") && hasTransport) return viewTransport();
  return viewToday();
}
window.addEventListener("hashchange", route);
matchMedia("(min-width: 1000px)").addEventListener("change", () => { if (me) route(); });

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
  const [{ data: hs }, , { error: vErr }, { data: st }, mineCount] = await Promise.all([
    sb.from("hamlets").select("*").order("id"), loadTeam(), sb.from("vehicles").select("id").limit(1), sb.rpc("hamlet_stats"),
    me.role === "worker" ? sb.from("voters").select("serial", { count: "exact", head: true }).eq("assigned_to", me.id).then((r) => r.count ?? 0) : 0,
  ]);
  hasTransport = !vErr;
  hasUnlikely = !!(st && st[0] && "unlikely" in st[0]);
  scopeMine = mineCount > 0;
  VOTER_COLS = hasTransport ? BASE_COLS + ",away_place,travel_plan,vehicle_id" : BASE_COLS;
  await loadVehicles();
  hamlets = hs || [];
  $("#who").textContent = me.full_name || me.username;
  $("#logoutBtn").hidden = false;
  $("#tabs").hidden = false;
  $$("#tabs [data-mgr]").forEach((a) => (a.hidden = !canAssign()));
  $$("#tabs [data-admin]").forEach((a) => (a.hidden = !isAdmin()));
  route();
}
boot();
