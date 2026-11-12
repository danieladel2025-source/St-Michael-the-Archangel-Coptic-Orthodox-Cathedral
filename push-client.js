// =====================================================================
//  🔔 push-client.js — تسجيل الجهاز في Web Push ليصله الإشعار والتطبيق مغلق
//
//  يعمل تلقائياً: بمجرد أن يكون إذن الإشعارات "مسموح" (من أي زر/نافذة موجودة
//  في التطبيق) يشترك الجهاز ويرسل اشتراكه + إعداداته (تنبيه التحضير) للسحابة.
//
//  PushClient.init({
//    role: 'servant' | 'admin',
//    getClient: () => supabaseClient | null,   // null = لم يُسجَّل الدخول بعد
//    getChapterId: () => 'chapter-id',         // للخدام فقط
//    getName: () => 'اسم صاحب الجهاز'          // لعدم إرسال رسائله له (اختياري)
//  });
//  PushClient.test(15)   // إشعار تجريبي من السيرفر بعد 15 ثانية (أغلق التطبيق وانتظر)
//  PushClient.status()   // حالة نصية للتشخيص
// =====================================================================
(function (root) {
  'use strict';

  var FN = 'push-notify';
  var KEY_CACHE = 'push_vapid_pub_v1';
  var cfg = null;
  var st = { status: 'idle', busy: false, sig: '', fails: 0, nextTry: 0, endpoint: '' };

  // ---------- أدوات ----------
  function supported() {
    return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window);
  }
  function b64ToBytes(b64) {
    var pad = '='.repeat((4 - b64.length % 4) % 4);
    var raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  function sameKey(buf, bytes) {
    if (!buf) return false;
    var a = new Uint8Array(buf);
    if (a.length !== bytes.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== bytes[i]) return false;
    return true;
  }
  function tz() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Cairo'; } catch (e) { return 'Africa/Cairo'; }
  }
  function client() { try { return cfg.getClient && cfg.getClient(); } catch (e) { return null; } }
  function hasProfile() { try { return !!(root.WelcomeGate && root.WelcomeGate.profile && root.WelcomeGate.profile()); } catch (e) { return false; } }
  function chapter() { try { return (cfg.getChapterId && cfg.getChapterId()) || ''; } catch (e) { return ''; } }

  // تسجيل/جلب الـ Service Worker (صفحة المشرفين قد تُفتح قبل صفحة الخدام)
  function getRegistration() {
    return navigator.serviceWorker.getRegistration('./').then(function (r) {
      return r || navigator.serviceWorker.register('./sw.js', { scope: './' });
    }).then(function () { return navigator.serviceWorker.ready; });
  }

  // ---------- المفتاح العام (يُجلب من الدالة مرة واحدة ويُحفظ) ----------
  function getVapidKey(c) {
    var cached = '';
    try { cached = localStorage.getItem(KEY_CACHE) || ''; } catch (e) {}
    if (cached) return Promise.resolve(cached);
    return c.functions.invoke(FN, { body: { mode: 'key' } }).then(function (r) {
      var k = r && r.data && r.data.key;
      if (r && r.error) throw r.error;
      if (!k) throw new Error('لم تُضبط مفاتيح VAPID في الدالة');
      try { localStorage.setItem(KEY_CACHE, k); } catch (e) {}
      return k;
    });
  }

  // ---------- إعدادات الجهاز التي يحتاجها السيرفر ----------
  function buildPrefs() {
    var p = { birthdays: true, chat: true };
    var name = '';
    try { name = String((cfg.getName && cfg.getName()) || localStorage.getItem('lc_name') || '').trim(); } catch (e) {}
    if (name) p.chatName = name;

    if (cfg.role === 'servant') {
      var cid = chapter() || 'default';
      var raw = {};
      try { raw = JSON.parse(localStorage.getItem('lessonReminder_v1_' + cid) || '{}') || {}; } catch (e) {}
      p.lesson = {
        enabled: raw.enabled !== false,
        daysBefore: Math.min(6, Math.max(1, parseInt(raw.daysBefore, 10) || 3)),
        hour: Math.min(22, Math.max(5, isNaN(parseInt(raw.hour, 10)) ? 9 : parseInt(raw.hour, 10))),
        done: raw.done || {}, notified: raw.notified || {}, topics: raw.topics || {}
      };
      var dow = 5;
      try { if (typeof getAbsenceDayOfWeek === 'function') dow = getAbsenceDayOfWeek(); } catch (e) {}
      p.absenceDay = (isNaN(dow) || dow < 0 || dow > 6) ? 5 : dow;
      // إعلانات المشرف العام: نرسل مرحلة الخادم واسم فصله ليختار السيرفر المستلمين
      p.announce = true;
      try { if (root.WelcomeGate && root.WelcomeGate.pushTargets) p.ann = root.WelcomeGate.pushTargets() || undefined; } catch (e) {}
    }
    return p;
  }

  function saveToCloud(c, sub, prefs) {
    var j = sub.toJSON();
    var keys = j.keys || {};
    var ua = (navigator.userAgent || '').slice(0, 300);
    if (cfg.role === 'admin') {
      return c.rpc('push_save_admin_subscription', {
        p_endpoint: j.endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth,
        p_tz: tz(), p_prefs: prefs, p_user_agent: ua
      });
    }
    return c.rpc('push_save_subscription', {
      p_endpoint: j.endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth,
      p_chapter_id: chapter(), p_tz: tz(), p_prefs: prefs, p_user_agent: ua
    });
  }

  // ---------- الدورة الرئيسية ----------
  function tick(force) {
    if (!cfg || st.busy) return Promise.resolve();
    if (!supported()) { st.status = 'unsupported'; return Promise.resolve(); }
    if (Notification.permission !== 'granted') {
      st.status = Notification.permission === 'denied' ? 'denied' : 'need-permission';
      return Promise.resolve();
    }
    var c = client();
    if (!c) { st.status = 'waiting-login'; return Promise.resolve(); }
    // الخادم المسجّل يشترك حتى لو لم يفتح فصله (ليصله إعلان المشرف)؛ أما إشعارات الدرس/الميلاد/الشات فتحتاج فتح الفصل مرة
    if (cfg.role !== 'admin' && !chapter() && !hasProfile()) { st.status = 'waiting-chapter'; return Promise.resolve(); }
    if (!force && Date.now() < st.nextTry) return Promise.resolve();

    st.busy = true;
    return getRegistration().then(function (reg) {
      return getVapidKey(c).then(function (pub) {
        var bytes = b64ToBytes(pub);
        return reg.pushManager.getSubscription().then(function (sub) {
          // مفتاح السيرفر تغيّر → اشتراك قديم لن يعمل
          if (sub && sub.options && sub.options.applicationServerKey && !sameKey(sub.options.applicationServerKey, bytes)) {
            return sub.unsubscribe().then(function () { return null; });
          }
          return sub;
        }).then(function (sub) {
          if (sub) return sub;
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
        });
      });
    }).then(function (sub) {
      st.endpoint = sub.endpoint;
      var prefs = buildPrefs();
      var sig = sub.endpoint + '|' + cfg.role + '|' + chapter() + '|' + JSON.stringify(prefs);
      if (!force && sig === st.sig) { st.status = 'active'; return; }
      return saveToCloud(c, sub, prefs).then(function (r) {
        if (r && r.error) throw r.error;
        st.sig = sig; st.fails = 0; st.status = 'active';
      });
    }).catch(function (e) {
      st.fails++;
      st.status = 'error: ' + String((e && (e.message || e.details)) || e);
      st.nextTry = Date.now() + Math.min(300000, 15000 * st.fails);   // إعادة المحاولة بتباعد
      try { console.warn('[PushClient]', st.status); } catch (e2) {}
    }).then(function () { st.busy = false; });
  }

  // ---------- اختبار حقيقي من السيرفر ----------
  function test(delaySec) {
    if (!supported()) {
      return Promise.resolve({ ok: false, msg: 'هذا المتصفح لا يدعم الإشعارات الحقيقية. على الآيفون: أضف التطبيق للشاشة الرئيسية (Add to Home Screen) ثم افتحه من هناك.' });
    }
    if (Notification.permission !== 'granted') {
      return Promise.resolve({ ok: false, msg: 'فعّل الإشعارات أولاً ثم أعد المحاولة.' });
    }
    var c = client();
    if (!c) return Promise.resolve({ ok: false, msg: 'سجّل الدخول / افتح الفصل أولاً.' });
    return tick(true).then(function () {
      if (st.status !== 'active') return { ok: false, msg: 'تعذّر تسجيل الجهاز: ' + st.status };
      return c.functions.invoke(FN, { body: { mode: 'test', endpoint: st.endpoint, delay: delaySec || 15 } }).then(function (r) {
        if (r && r.error) return { ok: false, msg: 'تعذّر الاتصال بدالة الإشعارات: ' + (r.error.message || r.error) };
        if (r && r.data && r.data.ok === false) return { ok: false, msg: r.data.error || 'فشل الاختبار' };
        return { ok: true, msg: 'تم. أغلق التطبيق تماماً الآن (اسحبه من التطبيقات الأخيرة) وانتظر ' + (delaySec || 15) + ' ثانية ⏳' };
      });
    }).catch(function (e) { return { ok: false, msg: String((e && e.message) || e) }; });
  }

  function testFromPanel() {
    var el = document.getElementById('notifTestResult');
    if (el) el.innerHTML = '⏳ جاري الفحص...';
    return diag().then(function (list) {
      var ok = list.every(function (r) { return r.ok; });
      if (el) el.innerHTML = diagHtml(list) + (ok ? '<div style="padding:8px 0;font-weight:800;color:#0f766e">🎉 وصل إشعار تجريبي الآن. للتأكد من عمله والتطبيق مغلق: أغلقه تماماً ثم اطلب إعلاناً من المشرف.</div>' : '');
      return { ok: ok, list: list };
    });
  }

  // ---------- بيئة الجهاز ----------
  function isIOS() { return /iPhone|iPad|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function standalone() {
    try { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; } catch (e) { return false; }
  }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // ---------- تشخيص كامل خطوة بخطوة ----------
  function diag() {
    var out = [];
    function add(ok, label, detail) { out.push({ ok: ok, label: label, detail: detail || '' }); }
    return (async function () {
      add(!!window.isSecureContext, 'اتصال آمن (HTTPS)', window.isSecureContext ? '' : 'يجب فتح الموقع برابط يبدأ بـ https');
      if (!supported()) {
        add(false, 'دعم المتصفح للإشعارات الخارجية',
          isIOS() && !standalone() ? 'آيفون: اضغط زر المشاركة ← «إضافة إلى الشاشة الرئيسية» ثم افتح التطبيق من الأيقونة (يلزم iOS 16.4 أو أحدث)'
                                    : 'هذا المتصفح لا يدعم Web Push — جرّب Chrome');
        return out;
      }
      add(true, 'دعم المتصفح');
      if (isIOS()) add(standalone(), 'التطبيق مفتوح من الشاشة الرئيسية', standalone() ? '' : 'افتحه من أيقونة الشاشة الرئيسية وليس من Safari');
      var perm = Notification.permission;
      add(perm === 'granted', 'إذن الإشعارات: ' + (perm === 'granted' ? 'مسموح' : perm === 'denied' ? 'محظور' : 'لم يُطلب بعد'),
        perm === 'granted' ? '' : perm === 'denied' ? 'غيّر إذن «الإشعارات» للموقع إلى «سماح» من إعدادات المتصفح (🔒 بجوار العنوان) ثم أعد فتح الصفحة'
                                                     : 'اضغط زر «🔔 تفعيل الإشعارات» ووافق');
      if (perm !== 'granted') return out;

      var reg;
      try { reg = await getRegistration(); } catch (e) { add(false, 'Service Worker', String((e && e.message) || e)); return out; }
      add(!!(reg && reg.active), 'Service Worker', reg && reg.active ? 'نشط' : 'غير نشط — أعد تحميل الصفحة');

      var c = client();
      add(!!c, 'الاتصال بقاعدة البيانات', c ? '' : (cfg.role === 'admin' ? 'سجّل دخول المشرف أولاً' : 'افتح فصلك (أدخل كلمة سر الفصل) ثم أعد التشخيص'));
      if (!c) return out;
      if (cfg.role !== 'admin' && !chapter() && !hasProfile()) { add(false, 'تسجيل بيانات الخادم', 'سجّل بياناتك في صفحة الترحيب أو افتح فصلك أولاً'); return out; }

      // المفتاح العام — نتجاهل المخزَّن لنكشف أي تغيير في الأسرار
      try { localStorage.removeItem(KEY_CACHE); } catch (e) {}
      var kr;
      try { kr = await c.functions.invoke(FN, { body: { mode: 'key' } }); } catch (e) { kr = { error: e }; }
      if (kr && kr.error) {
        add(false, 'دالة push-notify على Supabase', 'غير منشورة أو ترفض الطلب: ' + String(kr.error.message || kr.error) + ' — انشرها من Edge Functions، ولو الخطأ 401 انشرها مع إيقاف «Verify JWT»');
        return out;
      }
      var pub = kr && kr.data && kr.data.key;
      if (!pub) { add(false, 'مفاتيح VAPID', (kr && kr.data && kr.data.error) || 'غير مضبوطة في Secrets الخاصة بالدالة'); return out; }
      try { localStorage.setItem(KEY_CACHE, pub); } catch (e) {}
      add(true, 'دالة push-notify ومفتاح VAPID');

      var bytes = b64ToBytes(pub), sub = null;
      try {
        sub = await reg.pushManager.getSubscription();
        if (sub && sub.options && sub.options.applicationServerKey && !sameKey(sub.options.applicationServerKey, bytes)) {
          await sub.unsubscribe(); sub = null;
          add(true, 'اشتراك قديم بمفتاح مختلف', 'تم حذفه وسيُنشأ اشتراك جديد');
        }
        if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
        add(true, 'اشتراك الجهاز في خدمة الدفع');
      } catch (e) {
        add(false, 'اشتراك الجهاز في خدمة الدفع', String((e && e.message) || e) + ' — تأكد أن المتصفح غير مقيَّد (وضع التخفي/موفّر البيانات/حظر Google Play Services)');
        return out;
      }
      st.endpoint = sub.endpoint;

      try {
        var sr = await saveToCloud(c, sub, buildPrefs());
        if (sr && sr.error) throw sr.error;
        st.sig = ''; st.status = 'active';
        add(true, 'تسجيل الجهاز في قاعدة البيانات');
      } catch (e) {
        var m = String((e && (e.message || e.details)) || e);
        add(false, 'تسجيل الجهاز في قاعدة البيانات', m + (/could not find|schema cache|does not exist|PGRST202|42883/i.test(m) ? ' — شغّل ملف push-setup.sql في SQL Editor' : ''));
        return out;
      }

      var j = sub.toJSON(), k = j.keys || {};
      var dr;
      try { dr = await c.functions.invoke(FN, { body: { mode: 'diag', endpoint: j.endpoint, p256dh: k.p256dh, auth: k.auth } }); } catch (e) { dr = { error: e }; }
      if (dr && dr.error) { add(false, 'التشخيص من السيرفر', String(dr.error.message || dr.error) + ' — أعد نشر index.ts الجديد على Supabase'); return out; }
      var d = (dr && dr.data) || {};
      if (d.error) { add(false, 'التشخيص من السيرفر', d.error); return out; }
      var v = d.vapid || {};
      add(!!(v.pub && v.priv), 'أسرار VAPID في السيرفر', v.pub && v.priv ? '' : 'VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY ناقصة');
      add(!v.subjectFake, 'VAPID_SUBJECT', v.subjectFake ? 'القيمة «' + v.subject + '» غير صالحة — اجعلها mailto:بريدك-الحقيقي@gmail.com (آبل وبعض الخدمات ترفض غير ذلك)' : v.subject);
      add(!!v.secret, 'PUSH_SECRET', v.secret ? '' : 'غير مضبوط — بدونه لا تعمل إشعارات الدرس/أعياد الميلاد/الشات');
      add(!!d.registered, 'الجهاز مسجّل في جدول الاشتراكات', d.registered ? ('إجمالي الأجهزة المسجّلة: ' + (d.totalSubs == null ? '؟' : d.totalSubs)) : (d.registeredError || 'غير موجود — راجع push-setup.sql'));
      var sd = d.send || {};
      add(!!sd.ok, 'إرسال فعلي من السيرفر إلى هذا الجهاز',
        sd.ok ? 'قبلت خدمة الدفع الرسالة (كود ' + sd.code + ') — يجب أن يظهر إشعار الآن' :
        'رفضتها خدمة الدفع (كود ' + sd.code + '): ' + (sd.msg || '') +
        (sd.code === 403 || sd.code === 401 ? ' ← غالباً VAPID_PUBLIC_KEY لا يطابق VAPID_PRIVATE_KEY أو VAPID_SUBJECT غير صالح' :
         sd.code === 410 || sd.code === 404 ? ' ← الاشتراك منتهي، أعد التشخيص' : ''));
      return out;
    })().catch(function (e) { add(false, 'خطأ غير متوقع', String((e && e.message) || e)); return out; });
  }

  function diagText(list) {
    return list.map(function (r) { return (r.ok ? '✅ ' : '❌ ') + r.label + (r.detail ? ' — ' + r.detail : ''); }).join('\n');
  }
  function diagHtml(list) {
    return list.map(function (r) {
      return '<div style="padding:7px 0;border-bottom:1px solid #eee;line-height:1.7"><b style="color:' + (r.ok ? '#0f766e' : '#b3261e') + '">' + (r.ok ? '✅ ' : '❌ ') + esc(r.label) + '</b>' +
        (r.detail ? '<div style="font-size:12.5px;color:#555">' + esc(r.detail) + '</div>' : '') + '</div>';
    }).join('');
  }

  function showDiag() {
    var old = document.getElementById('pcDiag'); if (old) old.remove();
    var ov = document.createElement('div');
    ov.id = 'pcDiag';
    ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:16px;font-family:Cairo,Tahoma,sans-serif;direction:rtl';
    ov.innerHTML = '<div style="background:#fff;color:#111;border-radius:16px;max-width:520px;width:100%;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.4)">' +
      '<div style="padding:14px 16px;font-weight:900;font-size:16px;border-bottom:1px solid #eee">🔧 تشخيص الإشعارات الخارجية</div>' +
      '<div id="pcDiagBody" style="padding:6px 16px;overflow:auto;font-size:14px">⏳ جاري الفحص...</div>' +
      '<div style="display:flex;gap:8px;padding:12px 16px;border-top:1px solid #eee">' +
        '<button id="pcDiagCopy" style="flex:1;padding:10px;border:none;border-radius:10px;background:#0f766e;color:#fff;font-weight:800;font-family:inherit;cursor:pointer">📋 نسخ النتيجة</button>' +
        '<button id="pcDiagClose" style="flex:1;padding:10px;border:none;border-radius:10px;background:#222;color:#fff;font-weight:800;font-family:inherit;cursor:pointer">إغلاق</button>' +
      '</div></div>';
    document.body.appendChild(ov);
    var last = [];
    document.getElementById('pcDiagClose').onclick = function () { ov.remove(); updateBar(); };
    document.getElementById('pcDiagCopy').onclick = function () {
      var t = diagText(last);
      try { navigator.clipboard.writeText(t); } catch (e) {}
      this.textContent = '✓ تم النسخ';
    };
    return diag().then(function (list) {
      last = list;
      var b = document.getElementById('pcDiagBody');
      if (b) b.innerHTML = diagHtml(list) + (list.every(function (r) { return r.ok; })
        ? '<div style="padding:10px 0;font-weight:800;color:#0f766e">🎉 كل شيء سليم. أغلق التطبيق تماماً ثم اطلب إعلاناً تجريبياً من المشرف للتأكد.</div>' : '');
      return list;
    });
  }

  // تثبيت التطبيق (أندرويد/كمبيوتر): التطبيق المثبّت أوثق في وصول الإشعارات كالواتساب
  var installEvt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; setTimeout(updateBar, 300); });
  window.addEventListener('appinstalled', function () { installEvt = null; updateBar(); });

  // ---------- شريط تفعيل الإشعارات (يتطلب ضغطة من المستخدم — المتصفحات تمنع الطلب التلقائي) ----------
  function ensureBar() {
    var b = document.getElementById('pcBar');
    if (b) return b;
    b = document.createElement('div');
    b.id = 'pcBar';
    b.style.cssText = 'position:fixed;left:10px;right:10px;bottom:12px;z-index:99990;display:none;align-items:center;gap:8px;flex-wrap:wrap;' +
      'background:#111;color:#fff;border:2px solid #d4a017;border-radius:14px;padding:10px 12px;box-shadow:0 6px 22px rgba(0,0,0,.45);font-family:Cairo,Tahoma,sans-serif;direction:rtl;font-size:13.5px;font-weight:700;max-width:560px;margin:0 auto';
    b.innerHTML = '<span id="pcBarMsg" style="flex:1 1 220px;line-height:1.6"></span>' +
      '<button id="pcBarEnable" type="button" style="display:none;padding:9px 14px;border:none;border-radius:10px;background:#d4a017;color:#000;font-weight:900;font-family:inherit;cursor:pointer">🔔 تفعيل الإشعارات</button>' +
      '<button id="pcBarInstall" type="button" style="display:none;padding:9px 14px;border:none;border-radius:10px;background:#d4a017;color:#000;font-weight:900;font-family:inherit;cursor:pointer">📲 تثبيت التطبيق</button>' +
      '<button id="pcBarDiag" type="button" style="padding:9px 12px;border:1px solid #666;border-radius:10px;background:transparent;color:#fff;font-weight:800;font-family:inherit;cursor:pointer">🔧 تشخيص</button>' +
      '<button id="pcBarX" type="button" aria-label="إخفاء" style="padding:6px 10px;border:none;background:transparent;color:#aaa;font-size:18px;cursor:pointer">✕</button>';
    document.body.appendChild(b);
    document.getElementById('pcBarEnable').onclick = function () {
      try {
        Promise.resolve(Notification.requestPermission()).then(function () { updateBar(); tick(true).then(updateBar); });
      } catch (e) { updateBar(); }
    };
    document.getElementById('pcBarInstall').onclick = function () {
      if (!installEvt) return;
      installEvt.prompt();
      Promise.resolve(installEvt.userChoice).then(function () { installEvt = null; updateBar(); });
    };
    document.getElementById('pcBarDiag').onclick = function () { showDiag(); };
    document.getElementById('pcBarX').onclick = function () {
      try { sessionStorage.setItem('pc_bar_x', '1'); } catch (e) {}
      b.style.display = 'none';
    };
    return b;
  }
  // زر عائم صغير ثابت لفتح التشخيص في أي وقت (حتى لو كل شيء يعمل)
  function ensureFab() {
    if (document.getElementById('pcFab') || !document.body) return;
    var f = document.createElement('button');
    f.id = 'pcFab'; f.type = 'button'; f.title = 'تشخيص الإشعارات'; f.setAttribute('aria-label', 'تشخيص الإشعارات');
    f.textContent = '🔔';
    f.style.cssText = 'position:fixed;left:10px;bottom:76px;z-index:99980;width:42px;height:42px;border-radius:50%;border:2px solid #d4a017;' +
      'background:#111;color:#fff;font-size:19px;line-height:1;cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,.4);opacity:.88;padding:0';
    f.onclick = function () { showDiag(); };
    document.body.appendChild(f);
  }
  function updateBar() {
    if (!cfg || !document.body) return;
    ensureFab();
    var msg = '', enable = false, install = false;
    if (!supported()) {
      if (isIOS() && !standalone()) msg = '📲 لتصلك الإشعارات على الآيفون: اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية» وافتح التطبيق من الأيقونة.';
    } else if (Notification.permission === 'default') {
      msg = '🔔 فعّل الإشعارات لتصلك الإعلانات والرسائل وتنبيه تحضير الدرس حتى والتطبيق مغلق.'; enable = true;
    } else if (Notification.permission === 'denied') {
      msg = '🔕 الإشعارات محظورة لهذا الموقع. اضغط 🔒 بجوار عنوان الموقع ← الإشعارات ← سماح، ثم أعد فتح الصفحة.';
    } else if (/^error/.test(st.status)) {
      msg = '⚠️ تعذّر تفعيل الإشعارات الخارجية على هذا الجهاز. اضغط «تشخيص» لمعرفة السبب.';
    } else if (installEvt && !standalone()) {
      msg = '📲 ثبّت التطبيق على هاتفك لتصلك الإشعارات مثل الواتساب والفيس، حتى وهو مغلق.'; install = true;
    }
    var dismissed = false;
    try { dismissed = sessionStorage.getItem('pc_bar_x') === '1'; } catch (e) {}
    var b = document.getElementById('pcBar');
    if (!msg || (dismissed && !enable)) { if (b) b.style.display = 'none'; return; }
    if (dismissed) { if (b) b.style.display = 'none'; return; }
    b = ensureBar();
    document.getElementById('pcBarMsg').textContent = msg;
    document.getElementById('pcBarEnable').style.display = enable ? '' : 'none';
    document.getElementById('pcBarInstall').style.display = install ? '' : 'none';
    b.style.display = 'flex';
  }

  // ---------- إلغاء الاشتراك ----------
  function disable() {
    var c = client();
    return getRegistration().then(function (reg) { return reg.pushManager.getSubscription(); })
      .then(function (sub) {
        if (!sub) return;
        var ep = sub.endpoint;
        return sub.unsubscribe().then(function () {
          if (c) return c.rpc('push_remove_subscription', { p_endpoint: ep });
        });
      }).then(function () { st.sig = ''; st.status = 'disabled'; });
  }

  function init(options) {
    cfg = options || {};
    cfg.role = cfg.role === 'admin' ? 'admin' : 'servant';
    setTimeout(function () { tick(false).then(updateBar); }, 1500);
    setTimeout(updateBar, 2500);
    setInterval(function () { tick(false).then(updateBar); }, 10000);   // يلتقط منح الإذن/فتح الفصل/تغيير الإعدادات
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') tick(false);
    });
  }

  // ---------- إشعار إعلان جديد (من صفحة المشرف) ----------
  function announce(a) {
    var c = client();
    if (!c) return Promise.resolve({ ok: false });
    return c.functions.invoke(FN, { body: { mode: 'announce', by_kind: a.by_kind === 'priest' ? 'priest' : 'general', by_name: a.by_name || '', title: a.title || '', body: a.body || '', target_type: a.target_type || 'all', target_value: a.target_value || '' } })
      .then(function (r) { return (r && r.data) || { ok: false }; })
      .catch(function () { return { ok: false }; });
  }

  root.PushClient = {
    announce: announce,
    diag: diag, showDiag: showDiag,
    init: init, test: test, testFromPanel: testFromPanel, disable: disable,
    sync: function () { return tick(true); },
    status: function () { return st.status; }
  };
})(window);
