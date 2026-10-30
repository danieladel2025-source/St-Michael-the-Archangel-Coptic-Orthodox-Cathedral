// ===== Service Worker: نظام تسجيل غياب ومتابعة المخدومين — كاتدرائية رئيس الملائكة الجليل ميخائيل - طنطا =====
const CACHE_VERSION = 'church-attendance-v24'; // رفع الإصدار يجبر الأجهزة على جلب الملفات المُحدّثة
const CACHE_NAME = CACHE_VERSION;

// الملفات الأساسية التي يتم تخزينها مسبقًا (App Shell)
const PRECACHE_URLS = [
  './',
  './index.html',
  './admin.html',
  './library.html',
  './qr-map.js',
  './qr-map.css',
  './lesson-reminder.js',
  './live-chat.js',
  './welcome.js',
  './push-client.js',
  './manifest.json',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png'
];

// ----- التثبيت: تخزين الملفات الأساسية (فشل ملف واحد لا يُفشل التثبيت كله) -----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch((err) => console.warn('تعذر تخزين:', url, err))
          )
        )
      )
      .then(() => self.skipWaiting())
  );
});

// ----- التفعيل: حذف الكاشات القديمة -----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ----- الجلب -----
// - Supabase (API/بيانات/ملفات المكتبة): شبكة مباشرة دائمًا — لا تُخزَّن بيانات متغيّرة أو حساسة
// - باقي الملفات (App Shell وخطوط ومكتبات CDN): Cache أولًا مع تحديث في الخلفية
self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;
  // طلبات Range (تشغيل الصوت/الفيديو) لا يجوز تخزينها
  if (req.headers.has('range')) return;

  const url = new URL(req.url);

  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return;
  // خرائط جوجل المضمّنة تذهب للشبكة مباشرة
  if (url.hostname === 'google.com' || url.hostname.endsWith('.google.com')) return;

  // ملفات الموقع نفسه (html/js/css/json): الشبكة أولاً ثم الكاش، لتظهر التحديثات من أول فتح بدل إعادة التحميل عدة مرات
  const isAppFile = url.origin === self.location.origin &&
    (req.mode === 'navigate' || /\.(html|js|css|json)$/i.test(url.pathname));
  if (isAppFile) {
    event.respondWith(
      fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, responseClone));
          }
          return networkResponse;
        })
        .catch(() =>
          caches.match(req).then((c) => c || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cachedResponse) => {
      const fetchPromise = fetch(req)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, responseClone));
          }
          return networkResponse;
        })
        .catch(() => {
          if (cachedResponse) return cachedResponse;
          if (req.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });

      return cachedResponse || fetchPromise;
    })
  );
});

// ----- أوامر من الصفحة -----
self.addEventListener('message', (event) => {
  const d = event.data;
  if (!d) return;

  if (d.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  // =====================================================================
  //  إشعارات أعياد الميلاد (كانت سابقاً داخل Blob في index.html وتزاحم هذا الملف على نفس النطاق)
  // =====================================================================
  if (d.type === 'SCHEDULE_BIRTHDAY_NOTIFS') {
    scheduleBirthdayNotifications(d.people);
  }

  // إشعار تحضير الدرس (قبل الميعاد بعدة أيام)
  if (d.type === 'SCHEDULE_LESSON_NOTIFS') {
    scheduleLessonNotifications(d.triggers);
  }

  if (d.type === 'SEND_NOW') {
    self.registration.showNotification(d.title, {
      body: d.body,
      icon: d.icon || './icons/icon-192.png',
      badge: d.badge || './icons/icon-192.png',
      tag: d.tag || 'birthday',
      dir: 'rtl',
      lang: 'ar',
      vibrate: [200, 100, 200],
      requireInteraction: false
    });
  }
});

// مؤقتات تنبيه التحضير: نلغي القديمة قبل الجدولة كي لا يتكرر الإشعار
const lessonTimers = {};
function scheduleLessonNotifications(triggers) {
  Object.keys(lessonTimers).forEach((k) => { clearTimeout(lessonTimers[k]); delete lessonTimers[k]; });
  const now = Date.now();
  (triggers || []).forEach((t) => {
    const delay = t.ts - now;
    if (delay > 0 && delay < 8 * 24 * 60 * 60 * 1000) {
      lessonTimers[t.tag] = setTimeout(async () => {
        delete lessonTimers[t.tag];
        if (await hasPushSubscription()) return; // السيرفر سيرسله (Web Push)
        self.registration.showNotification(t.title, {
          body: t.body,
          icon: './icons/icon-192.png',
          badge: './icons/icon-192.png',
          tag: t.tag,
          dir: 'rtl',
          lang: 'ar',
          vibrate: [200, 100, 200, 100, 200],
          requireInteraction: true
        });
      }, delay);
    }
  });
}

function scheduleBirthdayNotifications(people) {
  if (!people || !people.length) return;
  const now = Date.now();

  people.forEach((person) => {
    (person.triggers || []).forEach((trigger) => {
      const delay = trigger.ts - now;
      if (delay > 0 && delay < 8 * 24 * 60 * 60 * 1000) {
        // setTimeout تعمل طالما الـ SW نشط (المتصفح قد يوقفه، فالصفحة تعيد الجدولة عند كل فتح)
        setTimeout(async () => {
          if (await hasPushSubscription()) return; // السيرفر سيرسله (Web Push)
          self.registration.showNotification(trigger.title, {
            body: trigger.body,
            icon: trigger.icon || './icons/icon-192.png',
            tag: trigger.tag,
            dir: 'rtl',
            lang: 'ar',
            vibrate: [200, 100, 200, 100, 200],
            requireInteraction: true
          });
        }, delay);
      }
    });
  });
}

// =====================================================================
//  🔔 Web Push — يصل الإشعار من السيرفر حتى لو التطبيق/المتصفح مغلق
// =====================================================================
async function hasPushSubscription() {
  try { return !!(await self.registration.pushManager.getSubscription()); } catch (e) { return false; }
}

// سفاري/آيفون يُلزم بإظهار إشعار مع كل push، فلا نتخطّاه هناك أبداً
function isAppleWebKit() {
  const ua = (self.navigator && self.navigator.userAgent) || '';
  return /iPhone|iPad|iPod|Macintosh/.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua);
}

async function showPushNotification(d) {
  // رسالة شات والتطبيق مفتوح أمام المستخدم: يكفيه التنبيه داخل الصفحة
  if (d.kind === 'chat' && !isAppleWebKit()) {
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.some((w) => w.visibilityState === 'visible' && w.focused)) return;
  }
  const opts = {
    body: d.body || '',
    icon: d.icon || './icons/icon-192.png',     // صورة التطبيق تظهر في لوحة الإشعارات
    badge: d.badge || './icons/icon-192.png',
    dir: 'rtl',
    lang: 'ar',
    vibrate: d.kind === 'chat' ? [200, 100, 200] : [200, 100, 200, 100, 200],
    requireInteraction: !!d.requireInteraction,
    data: { url: d.url || './index.html', kind: d.kind || '' }
  };
  if (d.tag) { opts.tag = d.tag; if (d.renotify) opts.renotify = true; }
  return self.registration.showNotification(d.title || 'كشف غياب الكنيسة', opts);
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(showPushNotification(data));
});

// لو انتهى اشتراك الجهاز يجدّده المتصفح؛ والصفحة تُسجّله في السحابة عند فتح التطبيق
self.addEventListener('pushsubscriptionchange', (event) => {
  const old = event.oldSubscription;
  const key = old && old.options && old.options.applicationServerKey;
  if (!key) return;
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }).catch(() => {})
  );
});

// فتح التطبيق (أو الصفحة المطلوبة) عند الضغط على الإشعار
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const target = new URL(d.url || './index.html', self.registration.scope).href;
  const path = (u) => u.split('#')[0].split('?')[0];
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cls) => {
      const same = cls.find((c) => path(c.url) === path(target));
      if (same) return same.focus();
      return clients.openWindow(target);
    })
  );
});
