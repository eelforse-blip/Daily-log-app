import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { App } from "@capacitor/app";

const $ = (s) => document.querySelector(s);
const NATIVE = Capacitor.isNativePlatform();
const AR_DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const AR_SHORT = ["ح", "ن", "ث", "ر", "خ", "ج", "س"]; // Sun..Sat
const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const pad = (n) => String(n).padStart(2, "0");
const keyOf = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const fromKey = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const todayKey = () => keyOf(new Date());
const uid = () => Math.random().toString(36).slice(2, 9);
const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fmtTime = (t) => { if (!t) return ""; let [h, m] = t.split(":").map(Number); const pm = h >= 12; h = h % 12 || 12; return h + ":" + pad(m) + (pm ? " م" : " ص"); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const DEFAULTS = [
  { id: "coffee", type: "avoid", title: "شرب القهوة", time: "14:00", limit: 0, days: ALL_DAYS },
  { id: "overeat", type: "avoid", title: "الإفراط في الأكل", time: "20:30", limit: 0, days: ALL_DAYS },
  { id: "walk", type: "do", title: "مشي 30 دقيقة", time: "18:00", days: ALL_DAYS },
  { id: "water", type: "do", title: "شرب مية كفاية", time: "12:00", days: ALL_DAYS },
  { id: "journal", type: "do", title: "كتابة ملاحظات اليوم", time: "22:00", days: ALL_DAYS },
];

/* ---------------- storage (on this phone) ---------------- */
const KEY = "daily-log-v1";
function load() {
  try { const r = localStorage.getItem(KEY); if (r) return JSON.parse(r); } catch (e) {}
  return { items: null, days: {} };
}
let data = load();
function persist() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) { toast("ماتحفظش، المساحة ممتلئة"); } }

let state = { cur: todayKey(), tab: "day" };
const items = () => data.items || [];
const dayBody = (k) => { const d = data.days[k]; return { date: k, done: { ...(d && d.done) }, counts: { ...(d && d.counts) }, note: (d && d.note) || "" }; };
function writeDay(k, body) { data.days[k] = body; persist(); render(); }
function saveItems(list) { data.items = list; persist(); reschedule(); render(); }

/* ---------------- notifications ---------------- */
const CHANNEL = "reminders";
function hashId(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) % 100000; }
async function setupNotifications() {
  if (!NATIVE) return;
  try {
    await LocalNotifications.createChannel({ id: CHANNEL, name: "تذكيرات اليوم", description: "تنبيهات المهام والحاجات اللي تبتعد عنها", importance: 5, visibility: 1, vibration: true, lights: true });
    await LocalNotifications.registerActionTypes({ types: [
      { id: "DO", actions: [{ id: "done", title: "تمّ ✓" }, { id: "open", title: "افتح", foreground: true }] },
      { id: "AVOID", actions: [{ id: "kept", title: "ملتزم 👍" }, { id: "slip", title: "حصلت مرة" }] },
    ] });
    LocalNotifications.addListener("localNotificationActionPerformed", (a) => {
      const extra = (a.notification && a.notification.extra) || {};
      const id = extra.itemId; if (!id) return;
      const k = todayKey(); const body = dayBody(k);
      if (a.actionId === "done") body.done[id] = true;
      else if (a.actionId === "slip") body.counts[id] = (body.counts[id] || 0) + 1;
      else { state.cur = k; state.tab = "day"; render(); return; }
      writeDay(k, body);
    });
  } catch (e) { console.warn(e); }
}
async function reschedule() {
  if (!NATIVE) return;
  try {
    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) await LocalNotifications.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
    const list = [];
    for (const it of items()) {
      if (!it.time) continue;
      const [hour, minute] = it.time.split(":").map(Number);
      const days = it.days && it.days.length ? it.days : ALL_DAYS;
      const base = hashId(it.id) * 10;
      const title = it.type === "do" ? "حان وقت: " + it.title : "تذكير: ابتعد عن " + it.title;
      const body = it.type === "do" ? "اضغط «تمّ» لما تخلص." : (+it.limit ? "المسموح النهارده: " + it.limit : "النهارده من غيرها. تقدر.");
      const common = { title, body, channelId: CHANNEL, actionTypeId: it.type === "do" ? "DO" : "AVOID", extra: { itemId: it.id }, smallIcon: "ic_stat_notify", autoCancel: true };
      if (days.length === 7) {
        list.push({ ...common, id: base, schedule: { on: { hour, minute }, repeats: true, allowWhileIdle: true } });
      } else {
        for (const wd of days) list.push({ ...common, id: base + wd + 1, schedule: { on: { weekday: wd + 1, hour, minute }, repeats: true, allowWhileIdle: true } });
      }
    }
    if (list.length) await LocalNotifications.schedule({ notifications: list });
    const c = $("#sched-count"); if (c) c.textContent = list.length ? "متجدول " + list.length + " تنبيه" : "مفيش تنبيهات متجدولة";
  } catch (e) { console.warn(e); toast("مشكلة في جدولة التنبيهات"); }
}
async function refreshPermUI() {
  if (!NATIVE) { $("#perm-notif").textContent = "التنبيهات بتشتغل في نسخة الموبايل بس"; $("#perm-exact").textContent = ""; return; }
  try {
    const p = await LocalNotifications.checkPermissions();
    const ok = p.display === "granted";
    $("#perm-notif").textContent = ok ? "✅ الإشعارات مفعّلة" : "⚠️ الإشعارات مقفولة";
    $("#btn-perm").hidden = ok;
  } catch (e) {}
  try {
    const ex = await LocalNotifications.checkExactNotificationSetting();
    const ok = ex.exact_alarm === "granted";
    $("#perm-exact").textContent = ok ? "✅ التنبيه في الميعاد بالظبط مسموح" : "⚠️ اسمح بـ «المنبهات والتذكيرات» عشان التنبيه ييجي في ميعاده بالظبط";
    $("#btn-exact").hidden = ok;
  } catch (e) { $("#perm-exact").textContent = ""; }
}

/* ---------------- UI ---------------- */
let tt;
function toast(t) { const el = $("#toast"); el.textContent = t; el.classList.add("on"); clearTimeout(tt); tt = setTimeout(() => el.classList.remove("on"), 2200); }

function render() {
  if (state.cur > todayKey()) state.cur = todayKey();
  ["day", "hist", "set"].forEach((t) => { $("#view-" + t).hidden = state.tab !== t; $("#tab-" + t).setAttribute("aria-selected", String(state.tab === t)); });
  if (state.tab === "day") renderDay();
  if (state.tab === "hist") renderHist();
  if (state.tab === "set") renderSet();
}
function activeOn(it, k) { const wd = fromKey(k).getDay(); return !it.days || !it.days.length || it.days.includes(wd); }

function renderDay() {
  const k = state.cur, d = fromKey(k), isToday = k === todayKey();
  $("#d-title").textContent = isToday ? "النهارده" : AR_DAYS[d.getDay()];
  $("#d-sub").textContent = (isToday ? AR_DAYS[d.getDay()] + " · " : "") + d.getDate() + " " + AR_MONTHS[d.getMonth()] + " " + d.getFullYear();
  $("#go-today").hidden = isToday; $("#next").disabled = isToday;
  const body = dayBody(k), now = new Date(), nowMin = now.getHours() * 60 + now.getMinutes();
  const dos = items().filter((i) => i.type === "do" && activeOn(i, k)), avs = items().filter((i) => i.type === "avoid" && activeOn(i, k));
  const ldo = $("#list-do"), lav = $("#list-av");
  if (data.items === null) {
    ldo.innerHTML = '<div class="empty">أهلًا! ابدأ بقائمة جاهزة تعدّلها براحتك.<br><br><button class="btn" id="seed">ابدأ بالقائمة المقترحة</button> <button class="btn ghost" id="to-set">أضيف بنودي بنفسي</button></div>';
    lav.innerHTML = "";
    $("#seed").onclick = async () => { saveItems(DEFAULTS.map((x) => ({ ...x }))); await askPermissions(); };
    $("#to-set").onclick = () => { data.items = []; persist(); state.tab = "set"; render(); };
  } else {
    ldo.innerHTML = dos.length ? dos.map((i) => {
      const done = !!body.done[i.id];
      const late = isToday && !done && i.time && toMin(i.time) < nowMin;
      return `<div class="item ${done ? "done" : ""}" style="margin-bottom:8px"><button class="check" data-do="${i.id}" aria-pressed="${done}" aria-label="${esc(i.title)}"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg></button>
      <div class="t"><b>${esc(i.title)}</b><small>${i.time ? `<span>⏰ ${fmtTime(i.time)}</span>` : ""}${late ? '<span class="pill late">فات ميعاده</span>' : ""}${done ? '<span class="pill ok">تمّ</span>' : ""}</small></div></div>`;
    }).join("") : '<div class="empty">مفيش مهام النهارده.</div>';
    lav.innerHTML = avs.length ? avs.map((i) => {
      const c = body.counts[i.id] || 0, lim = +i.limit || 0, slip = c > lim;
      return `<div class="item ${slip ? "slip" : ""}" style="margin-bottom:8px"><div class="t"><b>${esc(i.title)}</b><small><span>${lim ? `المسموح: ${lim} في اليوم` : "المسموح: صفر"}</span><span class="pill ${slip ? "bad" : "ok"}">${slip ? "تجاوزت" : "ملتزم"}</span></small></div>
      <div class="counter"><button data-dec="${i.id}" aria-label="تقليل">−</button><output>${c}</output><button data-inc="${i.id}" aria-label="حصلت مرة">+</button></div></div>`;
    }).join("") : '<div class="empty">مفيش حاجات تبتعد عنها.</div>';
  }
  const dDone = dos.filter((i) => body.done[i.id]).length, aKept = avs.filter((i) => (body.counts[i.id] || 0) <= (+i.limit || 0)).length;
  $("#s-do").textContent = dDone + "/" + dos.length; $("#b-do").style.width = (dos.length ? (dDone / dos.length) * 100 : 0) + "%";
  $("#s-av").textContent = aKept + "/" + avs.length; $("#b-av").style.width = (avs.length ? (aKept / avs.length) * 100 : 0) + "%";
  const ta = $("#note"); if (document.activeElement !== ta) ta.value = body.note;
}

function renderHist() {
  const keys = []; const t = fromKey(todayKey());
  for (let i = 13; i >= 0; i--) { const d = new Date(t); d.setDate(t.getDate() - i); keys.push(keyOf(d)); }
  let h = "<thead><tr><th></th>" + keys.map((k) => `<th>${fromKey(k).getDate()}</th>`).join("") + "</tr></thead><tbody>";
  items().forEach((i) => {
    h += `<tr><td class="n">${esc(i.title)}</td>` + keys.map((k) => {
      const d = data.days[k]; if (!d || !activeOn(i, k)) return '<td><i class="dot"></i></td>';
      const ok = i.type === "do" ? !!(d.done || {})[i.id] : ((d.counts || {})[i.id] || 0) <= (+i.limit || 0);
      return `<td><i class="dot ${ok ? "g" : "r"}"></i></td>`;
    }).join("") + "</tr>";
  });
  $("#hgrid").innerHTML = h + "</tbody>";
  const ks = Object.keys(data.days).sort().reverse();
  $("#days").innerHTML = ks.length ? ks.map((k) => {
    const d = data.days[k], dt = fromKey(k);
    const dos = items().filter((i) => i.type === "do" && activeOn(i, k)), avs = items().filter((i) => i.type === "avoid" && activeOn(i, k));
    const dd = dos.filter((i) => (d.done || {})[i.id]).length, ak = avs.filter((i) => ((d.counts || {})[i.id] || 0) <= (+i.limit || 0)).length;
    return `<button class="day-row" data-open="${k}"><div class="dt"><b>${dt.getDate()} ${AR_MONTHS[dt.getMonth()]}</b><small>${AR_DAYS[dt.getDay()]}</small></div>
    <div class="tx">${d.note ? esc(d.note) : "بدون ملاحظات"}</div>
    <div class="sc"><span class="pill ok">${dd}/${dos.length} مهام</span><span class="pill ${ak < avs.length ? "bad" : "ok"}">${ak}/${avs.length} التزام</span></div></button>`;
  }).join("") : '<div class="empty">لسه مفيش أيام متسجلة.</div>';
}

function renderSet() {
  $("#edit-list").innerHTML = items().length ? items().map((i) => {
    const days = i.days && i.days.length ? i.days : ALL_DAYS;
    return `<div class="le" data-id="${i.id}"><div class="head"><span class="kind ${i.type}"></span><input type="text" id="t-${i.id}" value="${esc(i.title)}" aria-label="اسم البند" style="flex:1"></div>
    <div class="row"><input type="time" id="tm-${i.id}" value="${i.time || ""}" aria-label="الميعاد">
    ${i.type === "avoid" ? `<label>الحد <input type="number" id="l-${i.id}" min="0" value="${+i.limit || 0}"></label>` : ""}
    <button class="btn danger" data-del="${i.id}">حذف</button></div>
    <div class="days">${ALL_DAYS.map((wd) => `<button data-wd="${wd}" data-item="${i.id}" aria-pressed="${days.includes(wd)}" aria-label="${AR_DAYS[wd]}">${AR_SHORT[wd]}</button>`).join("")}</div></div>`;
  }).join("") : '<div class="empty">مفيش بنود لسه.</div>';
  refreshPermUI();
}

async function askPermissions() {
  if (!NATIVE) return;
  try {
    const p = await LocalNotifications.requestPermissions();
    if (p.display !== "granted") toast("فعّل الإشعارات من «البنود والتنبيهات»");
    const ex = await LocalNotifications.checkExactNotificationSetting();
    if (ex.exact_alarm !== "granted") { state.tab = "set"; render(); toast("اسمح بالمنبهات عشان التنبيه ييجي في ميعاده"); }
  } catch (e) {}
  reschedule(); refreshPermUI();
}

/* ---------------- events ---------------- */
document.addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.tab) { state.tab = b.dataset.tab; render(); return; }
  if (b.dataset.do) { const body = dayBody(state.cur); if (body.done[b.dataset.do]) delete body.done[b.dataset.do]; else body.done[b.dataset.do] = true; writeDay(state.cur, body); return; }
  if (b.dataset.inc || b.dataset.dec) { const id = b.dataset.inc || b.dataset.dec; const body = dayBody(state.cur); body.counts[id] = Math.max(0, (body.counts[id] || 0) + (b.dataset.inc ? 1 : -1)); writeDay(state.cur, body); return; }
  if (b.dataset.open) { state.cur = b.dataset.open; state.tab = "day"; render(); window.scrollTo(0, 0); return; }
  if (b.dataset.wd) {
    const wd = +b.dataset.wd, id = b.dataset.item;
    saveItems(items().map((i) => { if (i.id !== id) return i; let ds = i.days && i.days.length ? [...i.days] : [...ALL_DAYS]; ds = ds.includes(wd) ? ds.filter((x) => x !== wd) : [...ds, wd].sort(); if (!ds.length) { toast("لازم يوم واحد على الأقل"); return i; } return { ...i, days: ds }; }));
    return;
  }
  if (b.dataset.del) {
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "متأكد؟"; setTimeout(() => { b.dataset.armed = ""; b.textContent = "حذف"; }, 3000); return; }
    saveItems(items().filter((i) => i.id !== b.dataset.del)); toast("اتحذف"); return;
  }
});
$("#prev").onclick = () => { const d = fromKey(state.cur); d.setDate(d.getDate() - 1); state.cur = keyOf(d); render(); };
$("#next").onclick = () => { const d = fromKey(state.cur); d.setDate(d.getDate() + 1); const k = keyOf(d); if (k <= todayKey()) { state.cur = k; render(); } };
$("#go-today").onclick = () => { state.cur = todayKey(); render(); };

let noteTimer;
$("#note").addEventListener("input", () => {
  $("#note-state").textContent = "بيتكتب…"; clearTimeout(noteTimer); const k = state.cur;
  noteTimer = setTimeout(() => { const body = dayBody(k); body.note = $("#note").value; data.days[k] = body; persist(); $("#note-state").textContent = "اتحفظ"; }, 600);
});
$("#n-type").onchange = () => { $("#n-limit-wrap").hidden = $("#n-type").value !== "avoid"; };
$("#n-add").onclick = () => {
  const title = $("#n-title").value.trim(); if (!title) { toast("اكتب اسم البند"); return; }
  const it = { id: uid(), type: $("#n-type").value, title, time: $("#n-time").value || "", days: ALL_DAYS };
  if (it.type === "avoid") it.limit = Math.max(0, +$("#n-limit").value || 0);
  saveItems([...items(), it]); $("#n-title").value = ""; $("#n-time").value = ""; toast("اتضاف");
  if (it.time) askPermissions();
};
document.addEventListener("change", (e) => {
  const le = e.target.closest(".le"); if (!le) return; const id = le.dataset.id;
  saveItems(items().map((i) => {
    if (i.id !== id) return i; const n = { ...i };
    const t = $("#t-" + id), tm = $("#tm-" + id), l = $("#l-" + id);
    n.title = (t && t.value.trim()) || i.title; n.time = tm ? tm.value : i.time; if (l) n.limit = Math.max(0, +l.value || 0);
    return n;
  }));
  toast("اتحفظ");
});
$("#btn-perm").onclick = askPermissions;
$("#btn-exact").onclick = async () => { try { await LocalNotifications.changeExactNotificationSetting(); } catch (e) {} refreshPermUI(); reschedule(); };
$("#btn-test").onclick = async () => {
  if (!NATIVE) { toast("جرّبها على الموبايل"); return; }
  const p = await LocalNotifications.checkPermissions(); if (p.display !== "granted") { await askPermissions(); }
  await LocalNotifications.schedule({ notifications: [{ id: 999999, title: "دفتر اليوم", body: "التنبيهات شغالة 👌", channelId: CHANNEL, smallIcon: "ic_stat_notify", schedule: { at: new Date(Date.now() + 10000), allowWhileIdle: true } }] });
  toast("هييجي تنبيه بعد 10 ثواني، ممكن تقفل التطبيق");
};
$("#bk-copy").onclick = async () => {
  const txt = JSON.stringify(data);
  try { await navigator.clipboard.writeText(txt); toast("اتنسخت. ابعتها لنفسك على واتساب أو الإيميل"); }
  catch (e) { $("#bk-restore").hidden = false; $("#bk-text").value = txt; $("#bk-text").select(); toast("اتحددت، انسخها يدوي"); }
};
$("#bk-show").onclick = () => { $("#bk-restore").hidden = !$("#bk-restore").hidden; };
$("#bk-apply").onclick = () => {
  try { const d = JSON.parse($("#bk-text").value); if (!d || typeof d !== "object" || !("days" in d)) throw 0; data = { items: d.items || [], days: d.days || {} }; persist(); reschedule(); $("#bk-text").value = ""; $("#bk-restore").hidden = true; render(); toast("اترجعت البيانات"); }
  catch (e) { toast("النص ده مش نسخة احتياطية صحيحة"); }
};

setInterval(() => { if (state.tab === "day") renderDay(); }, 60000);

/* ---------------- boot ---------------- */
(async () => {
  render();
  if (NATIVE) {
    await setupNotifications();
    App.addListener("resume", () => { render(); refreshPermUI(); });
    App.addListener("backButton", () => { if (state.tab !== "day") { state.tab = "day"; render(); } else App.minimizeApp(); });
    if (data.items) reschedule();
  }
})();
