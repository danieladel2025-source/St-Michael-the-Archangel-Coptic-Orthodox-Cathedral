// =====================================================================
//  🔔 push-notify — Supabase Edge Function
//  يرسل إشعارات Web Push حقيقية للأجهزة حتى والتطبيق مغلق:
//   • mode "cron"  : أعياد الميلاد + تنبيه تحضير الدرس (يُستدعى كل 15 دقيقة من pg_cron)
//   • mode "chat"  : رسالة جديدة في الشات (يُستدعى من Trigger على chat_messages)
//   • mode "test"  : إشعار تجريبي لجهاز واحد بعد تأخير (من زر الاختبار في التطبيق)
//   • mode "key"   : يرجّع المفتاح العام VAPID للمتصفح
//
//  الأسرار المطلوبة (Edge Functions → Secrets):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...), PUSH_SECRET
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com";
const PUSH_SECRET = Deno.env.get("PUSH_SECRET") ?? "";

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
if (VAPID_PUBLIC && VAPID_PRIVATE) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

// ---- BEGIN PURE ----
const DAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const DEFAULT_TZ = "Africa/Cairo";
const SEP = " ‖ ";

interface YMD { y: number; m: number; d: number }
interface Local extends YMD { h: number; min: number }

function pad2(n: number) { return String(n).padStart(2, "0"); }
function ymd(t: YMD) { return `${t.y}-${pad2(t.m)}-${pad2(t.d)}`; }

/** الوقت المحلي (حسب المنطقة الزمنية للجهاز) كأجزاء رقمية */
function localNow(tz: string, now = new Date()): Local {
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz || DEFAULT_TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
  } catch {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: DEFAULT_TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    });
  }
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(now)) p[part.type] = part.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, min: +p.minute };
}

function addDays(t: YMD, n: number): YMD {
  const x = new Date(Date.UTC(t.y, t.m - 1, t.d + n));
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() };
}
function dowOf(t: YMD) { return new Date(Date.UTC(t.y, t.m - 1, t.d)).getUTCDay(); }
function isLeap(y: number) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

/** هل تاريخ الميلاد (YYYY-MM-DD) يوافق هذا اليوم؟ (مع معالجة 29 فبراير) */
function bdayMatches(dob: string, t: YMD): boolean {
  const p = String(dob || "").split("-");
  const m0 = parseInt(p[1], 10), d0 = parseInt(p[2], 10);
  if (!m0 || !d0) return false;
  if (m0 === t.m && d0 === t.d) return true;
  return m0 === 2 && d0 === 29 && t.m === 2 && t.d === 28 && !isLeap(t.y);
}

function daysText(n: number) {
  if (n <= 0) return "اليوم";
  if (n === 1) return "يوم واحد";
  if (n === 2) return "يومان";
  return n + " أيام";
}

function clamp(v: unknown, lo: number, hi: number, dflt: number) {
  const n = parseInt(String(v), 10);
  return isNaN(n) ? dflt : Math.min(hi, Math.max(lo, n));
}

interface LessonPrefs {
  enabled?: boolean; daysBefore?: number; hour?: number;
  done?: Record<string, boolean>; notified?: Record<string, boolean>; topics?: Record<string, string>;
}
interface Outgoing {
  key: string;   // مفتاح منع التكرار
  payload: Record<string, unknown>;
}

/** تنبيه تحضير الدرس — نفس منطق lesson-reminder.js في المتصفح */
function lessonDue(prefs: { lesson?: LessonPrefs; absenceDay?: number }, t: Local): Outgoing | null {
  const L = prefs.lesson;
  if (!L || L.enabled === false) return null;
  const dow = Number.isInteger(prefs.absenceDay) && prefs.absenceDay! >= 0 && prefs.absenceDay! <= 6 ? prefs.absenceDay! : 5;
  const daysBefore = clamp(L.daysBefore, 1, 6, 3);
  const hour = clamp(L.hour, 5, 22, 9);

  const delta = (dow - dowOf(t) + 7) % 7;       // 0 = الدرس اليوم
  const meeting = addDays(t, delta);
  const key = ymd(meeting);
  if (L.done?.[key] || L.notified?.[key]) return null;

  const rs = Date.UTC(meeting.y, meeting.m - 1, meeting.d - daysBefore, hour, 0);
  const nowL = Date.UTC(t.y, t.m - 1, t.d, t.h, t.min);
  if (nowL < rs) return null;

  const topic = String(L.topics?.[key] ?? "").trim();
  const when = delta <= 0 ? "درس اليوم" : "باقي " + daysText(delta) + " على الدرس";
  return {
    key: "lesson-" + key,
    payload: {
      kind: "lesson",
      title: "📖 وقت تحضير الدرس",
      body: when + " (" + DAYS[dow] + " " + key + ")" + (topic ? " — الموضوع: " + topic : "") + " — ابدأ التحضير الآن 🙏",
      tag: "lesson-prep-" + key,
      requireInteraction: true,
      ttl: 12 * 3600,
    },
  };
}

interface Person { kind: string; name: string; dob: string }

/** أعياد الميلاد: اليوم (بعد 8 ص) وقبل أسبوع (بعد 9 ص) — مجمّعة لكل نوع */
function birthdaysDue(people: Person[], t: Local): Outgoing[] {
  const out: Outgoing[] = [];
  if (!people.length || t.h < 8 || t.h >= 21) return out;
  const target = addDays(t, 7);

  for (const kind of ["student", "servant"]) {
    const mine = people.filter((p) => p.kind === kind && p.name);
    const label = kind === "servant" ? "الخادم/ة" : "المخدوم";

    const today = mine.filter((p) => bdayMatches(p.dob, t)).map((p) => p.name);
    if (today.length) {
      out.push({
        key: `bday-now-${kind}-${ymd(t)}`,
        payload: {
          kind: "birthday",
          title: kind === "servant" ? "🎊 عيد ميلاد خادم اليوم!" : "🎂 عيد ميلاد مخدوم اليوم!",
          body: (kind === "servant" ? "عيد ميلاد سعيد للخادم/ة: " : "اليوم يوافق عيد ميلاد: ") + today.join(" ، "),
          tag: "birthday-now-" + kind,
          requireInteraction: true,
          ttl: 12 * 3600,
        },
      });
    }

    if (t.h >= 9) {
      const soon = mine.filter((p) => bdayMatches(p.dob, target)).map((p) => p.name);
      if (soon.length) {
        out.push({
          key: `bday-week-${kind}-${ymd(target)}`,
          payload: {
            kind: "birthday",
            title: "🎈 قريباً — عيد ميلاد بعد أسبوع",
            body: `عيد ميلاد ${label} ${soon.join(" ، ")} بعد 7 أيام (${target.d}/${target.m}) — ابدأ التحضير للتهنئة 🎊`,
            tag: `bday-week-${kind}-${ymd(target)}`,
            requireInteraction: true,
            ttl: 12 * 3600,
          },
        });
      }
    }
  }
  return out;
}

/** اسم غرفة الفصل — نفس LiveChat.roomFor */
function roomFor(id: string) { return "class_" + String(id).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 100); }
function parseSender(raw: string) {
  const p = String(raw ?? "").split(SEP);
  return { name: p[0] || "", cls: p[1] || "", role: p[2] || "" };
}
// ---- END PURE ----

// ---------------------------------------------------------------------
//  الإرسال
// ---------------------------------------------------------------------
interface Sub {
  endpoint: string; p256dh: string; auth: string; role: string;
  chapter_id: string | null; tz: string; prefs: Record<string, any> | null;
}

async function sendTo(sub: Sub, payload: Record<string, unknown>): Promise<boolean> {
  const { ttl, ...data } = payload as any;
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(data),
      { TTL: typeof ttl === "number" ? ttl : 3600, urgency: "high" },
    );
    return true;
  } catch (e: any) {
    const code = e?.statusCode;
    if (code === 404 || code === 410) {
      await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint); // اشتراك منتهي
    } else {
      console.warn("push failed", code, String(e?.body || e?.message || e).slice(0, 200));
    }
    return false;
  }
}

/** يحجز مفتاح الإرسال لهذا الجهاز؛ يرجّع false لو أُرسل سابقاً */
async function claim(endpoint: string, key: string): Promise<boolean> {
  const { data, error } = await sb.from("push_log")
    .upsert({ endpoint, tag: key }, { onConflict: "endpoint,tag", ignoreDuplicates: true })
    .select();
  if (error) { console.warn("claim error", error.message); return false; }
  return !!(data && data.length);
}
async function unclaim(endpoint: string, key: string) {
  await sb.from("push_log").delete().eq("endpoint", endpoint).eq("tag", key);
}

async function sendOnce(sub: Sub, o: Outgoing): Promise<boolean> {
  if (!(await claim(sub.endpoint, o.key))) return false;
  const ok = await sendTo(sub, o.payload);
  if (!ok) await unclaim(sub.endpoint, o.key);   // نعيد المحاولة في الدورة القادمة
  return ok;
}

// ---------------------------------------------------------------------
//  mode: cron
// ---------------------------------------------------------------------
async function runCron() {
  const { data: subs, error } = await sb.from("push_subscriptions")
    .select("*").eq("role", "servant").not("chapter_id", "is", null);
  if (error) throw error;
  const list = (subs || []) as Sub[];
  if (!list.length) return { subs: 0, sent: 0 };

  const chapterIds = [...new Set(list.map((s) => s.chapter_id!))];
  const { data: ppl, error: perr } = await sb.rpc("push_people", { p_chapter_ids: chapterIds });
  if (perr) console.warn("push_people:", perr.message);
  const byChapter: Record<string, Person[]> = {};
  for (const r of (ppl || []) as any[]) (byChapter[r.chapter_id] ||= []).push({ kind: r.kind, name: r.name, dob: r.dob });

  let sent = 0;
  for (const sub of list) {
    const prefs = sub.prefs || {};
    const t = localNow(sub.tz);
    const jobs: Outgoing[] = [];
    if (prefs.birthdays !== false) jobs.push(...birthdaysDue(byChapter[sub.chapter_id!] || [], t));
    const lesson = lessonDue(prefs as any, t);
    if (lesson) jobs.push(lesson);
    for (const j of jobs) if (await sendOnce(sub, j)) sent++;
  }

  // تنظيف السجل القديم
  await sb.from("push_log").delete().lt("sent_at", new Date(Date.now() - 30 * 86400000).toISOString());
  return { subs: list.length, sent };
}

// ---------------------------------------------------------------------
//  mode: chat
// ---------------------------------------------------------------------
async function handleChat(m: any) {
  if (!m || !m.room || !m.body) return { sent: 0 };
  const { data: subs, error } = await sb.from("push_subscriptions").select("*");
  if (error) throw error;

  const sp = parseSender(m.sender);
  const title = (sub: Sub) => {
    const label = m.room === "general" ? "عام" : (sub.role === "servant" ? "فصلي" : "");
    return "💬 " + sp.name + (sp.cls ? " (" + (sp.role ? sp.role + " - " : "") + sp.cls + ")" : "") + (label ? " — " + label : "");
  };

  let sent = 0;
  await Promise.all(((subs || []) as Sub[]).map(async (sub) => {
    const prefs = sub.prefs || {};
    if (prefs.chat === false) return;
    // المستلمون: المشرفون (كل الغرف) + الخدام (الغرفة العامة وغرفة فصلهم فقط)
    const inRoom = sub.role === "admin" ||
      m.room === "general" ||
      (sub.role === "servant" && !!sub.chapter_id && roomFor(sub.chapter_id) === m.room);
    if (!inRoom) return;
    // لا نُرسل لصاحب الرسالة نفسه
    if (prefs.chatName && sub.role === m.role && String(prefs.chatName).trim() === sp.name) return;

    const ok = await sendTo(sub, {
      kind: "chat",
      title: title(sub),
      body: String(m.body).slice(0, 120),
      tag: "lc-" + m.room,
      renotify: true,
      url: sub.role === "admin" ? "./admin.html" : "./index.html",
      ttl: 6 * 3600,
    });
    if (ok) sent++;
  }));
  return { sent };
}

// ---------------------------------------------------------------------
//  mode: test  (يرد فوراً ثم يرسل بعد تأخير — لتتمكن من إغلاق التطبيق)
// ---------------------------------------------------------------------
async function handleTest(endpoint: string, delaySec: number) {
  const { data } = await sb.from("push_subscriptions").select("*").eq("endpoint", endpoint).maybeSingle();
  if (!data) return { ok: false, error: "الجهاز غير مسجّل في السحابة بعد" };
  const delay = Math.min(60, Math.max(0, delaySec | 0));
  const job = (async () => {
    if (delay) await new Promise((r) => setTimeout(r, delay * 1000));
    await sendTo(data as Sub, {
      kind: "test",
      title: "✅ الإشعارات الحقيقية تعمل",
      body: "وصلك هذا الإشعار من السيرفر والتطبيق مغلق 🎉",
      tag: "push-test",
      renotify: true,
      ttl: 300,
    });
  })();
  // @ts-ignore EdgeRuntime متاح داخل Supabase Edge Functions
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(job);
  else await job;
  return { ok: true, delay };
}

// ---------------------------------------------------------------------
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-push-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const mode = body?.mode;

    if (mode === "key") return json({ key: VAPID_PUBLIC });
    if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: "VAPID keys are not configured" }, 500);

    if (mode === "test") return json(await handleTest(String(body.endpoint || ""), Number(body.delay ?? 15)));

    if (mode === "cron" || mode === "chat") {
      if (!PUSH_SECRET || req.headers.get("x-push-secret") !== PUSH_SECRET) return json({ error: "unauthorized" }, 401);
      return json(mode === "cron" ? await runCron() : await handleChat(body.record));
    }
    return json({ error: "unknown mode" }, 400);
  } catch (e: any) {
    console.error(e);
    return json({ error: String(e?.message || e) }, 500);
  }
});
