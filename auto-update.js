/**
 * 🔄 auto-update.js — تحديث الكاش والصفحة تلقائيًا بدون رفع رقم إصدار يدويًا
 *  1) يطلب من الـ Service Worker تجديد ملفاته المخزّنة عند كل فتح.
 *  2) يفحص دوريًا (وعند العودة للتطبيق) إن تغيّرت ملفات الموقع على الخادم.
 *  3) عند وجود تحديث يعيد تحميل الصفحة تلقائيًا في لحظة آمنة (لا نافذة مفتوحة ولا كتابة جارية).
 */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator) || !window.fetch) return;

  var CHECK_EVERY = 2 * 60 * 1000;   // فحص كل دقيقتين
  var MIN_RELOAD_GAP = 60 * 1000;    // لا إعادة تحميل أكثر من مرة كل دقيقة (يمنع التكرار)
  var hadController = !!navigator.serviceWorker.controller;
  var baseline = null, pending = false, reloading = false;

  function files() {
    var list = [location.pathname + location.search];
    document.querySelectorAll('script[src],link[rel="stylesheet"][href]').forEach(function (el) {
      var u = el.getAttribute('src') || el.getAttribute('href');
      try {
        var a = new URL(u, location.href);
        if (a.origin === location.origin) list.push(a.pathname + a.search);
      } catch (e) {}
    });
    list.push(new URL('./sw.js', location.href).pathname);
    return list.filter(function (v, i, a) { return a.indexOf(v) === i; });
  }

  // بصمة الملفات من ترويسات الخادم (ETag / Last-Modified / الحجم)
  function signature() {
    return Promise.all(files().map(function (p) {
      return fetch(p, { method: 'HEAD', cache: 'no-store' }).then(function (r) {
        if (!r.ok) return '';
        var h = r.headers;
        return p + '=' + (h.get('etag') || '') + '|' + (h.get('last-modified') || '') + '|' + (h.get('content-length') || '');
      }).catch(function () { return ''; });
    })).then(function (a) { return a.join(';'); });
  }

  function banner() {
    if (document.getElementById('autoUpdateBanner')) return;
    var d = document.createElement('div');
    d.id = 'autoUpdateBanner';
    d.textContent = '🔄 يوجد تحديث جديد — سيُطبَّق تلقائيًا بعد لحظات';
    d.style.cssText = 'position:fixed;bottom:14px;left:50%;transform:translateX(-50%);background:#0d1117;color:#fff;padding:8px 16px;border-radius:20px;font:700 12px Cairo,sans-serif;z-index:100000;box-shadow:0 6px 18px rgba(0,0,0,.3);max-width:92vw;text-align:center;';
    (document.body || document.documentElement).appendChild(d);
  }

  function idle() {
    var a = document.activeElement;
    // يُعتبر المستخدم "يكتب" فقط إذا كان في حقل مكتوب فيه شيء (الحقل الفارغ المحدّد تلقائيًا لا يمنع التحديث)
    var typing = a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'button' && String(a.value || '').length > 0;
    var modal = document.querySelector('.overlay.active, .modal.active, .sol-awards-ov');
    return !typing && !modal;
  }

  function reloadWhenSafe() {
    if (reloading) return;
    pending = true;
    var last = 0;
    try { last = +sessionStorage.getItem('autoUpdate:last') || 0; } catch (e) {}
    banner();
    var t = setInterval(function () {
      if (Date.now() - last < MIN_RELOAD_GAP || !idle()) return;
      clearInterval(t);
      reloading = true;
      try { sessionStorage.setItem('autoUpdate:last', String(Date.now())); } catch (e) {}
      location.reload();
    }, 3000);
  }

  function check() {
    if (pending || reloading || !navigator.onLine) return;
    navigator.serviceWorker.getRegistration('./').then(function (reg) {
      if (reg) reg.update().catch(function () {});
    }).catch(function () {});
    signature().then(function (sig) {
      if (!sig) return;
      if (baseline === null) { baseline = sig; return; }
      if (sig !== baseline) reloadWhenSafe();
    });
  }

  // تحديث نسخة الـ Service Worker نفسها → إعادة تحميل آمنة
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (hadController) reloadWhenSafe();
    hadController = true;
  });

  function askSwToRefresh() {
    navigator.serviceWorker.ready.then(function (reg) {
      if (reg.active) reg.active.postMessage({ type: 'REFRESH_CACHE' });
    }).catch(function () {});
  }

  window.addEventListener('load', function () {
    setTimeout(function () { check(); askSwToRefresh(); }, 2500);
    setInterval(check, CHECK_EVERY);
  });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
  window.addEventListener('online', check);
})();
