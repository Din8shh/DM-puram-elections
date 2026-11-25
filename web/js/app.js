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
let hamlets = [];           // [{id,name_te,name_en,serial_from,serial_to,target_votes}]
let team = [];              // profiles
let scopeMine = false;      // a worker with voters assigned sees "my voters" on Today and Follow-ups
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
  main.classList.remove("has-bar");
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
  else if (f.lean) qb = qb.eq("leaning", f.lean);
  if (f.gender) qb = qb.eq("gender", f.gender);
  if (f.age === "youth") qb = qb.lte("age", 29);
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
  location.hash = "#/voters";
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

    <div class="card flat" style="margin-top:12px">
      <a class="task" href="#/poll"><span class="tile" style="background:var(--voted-bg);color:#1D3F6E">${icon("ballot")}</span>
        <span class="grow"><b>${esc(t("poll_card"))}</b>${sub("poll_card")}</span><span style="color:var(--muted)">${icon("chev")}</span></a>
    </div>

    ${recent.length ? `<h2>${esc(t("recent"))}${subIn("recent")}</h2>
      <div class="grid2">${recent.slice(0, 4).map((r) => `<a class="card row" href="#/v/${r.serial}" style="padding:12px;text-decoration:none;color:var(--ink);flex-wrap:nowrap">
        <span class="tile" style="width:40px;height:40px">${esc(initial(r.name))}</span>
        <span style="min-width:0"><b style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.name)}</b><span class="en">#${r.serial}${r.house ? " · " + esc(r.house) : ""}</span></span></a>`).join("")}</div>` : ""}`;
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
    </div>

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
  if (openVisit) openVisitSheet(v);
  $("#backBtn").addEventListener("click", () => (history.length > 1 ? history.back() : (location.hash = "#/voters")));
  $("#supGrid").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-l]");
    if (!b || b.dataset.l === v.leaning) return;
    // Choosing a support level means someone spoke to them.
    if (await update({ leaning: b.dataset.l, contacted: true })) reload();
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
    st.lean = b.dataset.l;
    $$("#visLean [data-l]").forEach((x) => x.classList.toggle("on", x === b));
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
    <div style="margin-top:14px">${rows.length ? rows.map(card).join("") : `<p class="empty">${esc(t("no_followups"))}</p>`}</div>`;
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
    <div style="margin-top:12px">
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
      <div id="hamletStep">
        <div class="step"><b>2</b>${esc(t("which_hamlets"))}${subIn("which_hamlets")}</div>
        <div class="card flat">
          ${hamlets.map((h) => `<label class="hm"><input type="checkbox" name="h" value="${h.id}" ${p.hamlet_ids?.includes(h.id) ? "checked" : ""} ${editable ? "" : "disabled"}>
            <span class="grow">${esc(hamletName(h.id))}</span><span class="en num">${hamletSize(h) || ""}${isNew ? ` · ${free[h.id] || 0} ${esc(STRINGS.en.free)}` : ""}</span></label>`).join("")}
        </div>
        ${isNew ? `<label class="check" style="margin-top:8px"><input type="checkbox" name="assignFree" checked> <span>${esc(t("assign_free"))}</span></label>` : ""}
      </div>`}
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
    if (!location.hash.startsWith("#/reports") && !location.hash.startsWith("#/dash")) return;
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
    <div class="serial-display" id="sd">&nbsp;</div>
    <div class="numpad" style="margin-top:8px">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-d="${n}">${n}</button>`).join("")}
      <button data-d="C">${esc(t("clear"))}</button><button data-d="0">0</button><button data-d="B">⌫</button>
    </div>
    <button class="primary big" id="findBtn" style="margin-top:8px">${esc(t("find"))}</button>
    <div id="found" style="margin-top:12px"></div>
    <a class="btn" style="width:100%;margin-top:12px" href="#/voters" id="pendingLink">🙋 ${esc(t("ours_pending"))}</a>
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


// ───────── router & boot ─────────
function route() {
  if (!me) return;
  if (dashChannel && !/^#\/(reports|dash)/.test(location.hash)) { sb.removeChannel(dashChannel); dashChannel = null; }
  const full = location.hash.replace(/^#/, "") || "/";
  const [h, params = ""] = full.split("?");
  window.scrollTo(0, 0);
  let m = h.match(/^\/v\/(\d+)(\/visit)?/);
  if (m) return viewVoter(Number(m[1]), !!m[2]);
  if (h.startsWith("/voters")) return viewSearch(params);
  if (h.startsWith("/follow")) return viewFollow();
  if (h.startsWith("/poll")) return viewPoll();
  if (h.startsWith("/reports") || h.startsWith("/dash")) return viewReports();
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
  route();
}
boot();
