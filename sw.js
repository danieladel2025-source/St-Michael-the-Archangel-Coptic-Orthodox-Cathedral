// Service Worker - نظام تسجيل غياب الكنيسة
// غيّر رقم الإصدار هنا عند كل تحديث للملفات ليتم مسح الكاش القديم عند المستخدمين
const CACHE_VERSION = 'v2';
const CACHE_PREFIX  = 'church-attendance-cache-';
const CACHE_NAME    = CACHE_PREFIX + CACHE_VERSION;

// ملفات التطبيق (نفس النطاق)
const APP_SHELL = [
  './index.html',
  './admin.html',
  './library.html',
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

// مكتبات خارجية يحتاجها التطبيق ليعمل بدون إنترنت
const EXTERNAL_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',
  'https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;900&display=swap'
];

// لا نخزّن أبداً طلبات السحابة (قاعدة البيانات / التخزين / المصادقة) حتى لا تظهر بيانات قديمة
function isCloudRequest(url) {
  return url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in');
}

function isCacheable(response) {
  return response && (response.status === 200 || response.type === 'opaque');
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // addAll تفشل كاملة لو ملف واحد غير موجود (مثل أيقونة) — لذلك نضيف كل ملف على حدة
    await Promise.allSettled([
      ...APP_SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' }))),
      ...EXTERNAL_ASSETS.map((u) => cache.add(new Request(u, { mode: 'no-cors' })))
    ]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const d = event.data || {};
  if (d.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (d.type === 'SCHEDULE_BIRTHDAY_NOTIFS') { scheduleBirthdayNotifications(d.people); return; }
  if (d.type === 'SEND_NOW') {
    event.waitUntil(self.registration.showNotification(d.title, {
      body: d.body,
      icon: d.icon || '',
      badge: d.badge || '',
      tag: d.tag || 'birthday',
      dir: 'rtl',
      lang: 'ar',
      vibrate: [200, 100, 200],
      requireInteraction: false
    }));
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.headers.has('range')) return; // الاستجابات الجزئية (صوت/فيديو) لا تُخزَّن

  const url = new URL(req.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (isCloudRequest(url)) return;      // السحابة دائماً من الشبكة مباشرة

  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    // ملفات التطبيق: الشبكة أولاً (لتصل التحديثات) مع رجوع للكاش عند انقطاع الاتصال
    event.respondWith((async () => {
      try {
        const response = await fetch(req);
        if (isCacheable(response)) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {}));
        }
        return response;
      } catch (err) {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        if (req.mode === 'navigate') {
          const fallback = await caches.match('./index.html');
          if (fallback) return fallback;
        }
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })());
    return;
  }

  // مكتبات وخطوط خارجية: الكاش أولاً مع تحديث في الخلفية
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then((response) => {
      if (isCacheable(response)) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {}));
      }
      return response;
    }).catch(() => null);
    if (cached) return cached;
    const response = await network;
    return response || new Response('', { status: 504, statusText: 'Offline' });
  })());
});

// ===================== إشعارات أعياد الميلاد =====================
function scheduleBirthdayNotifications(people) {
  if (!people || !people.length) return;
  const now = Date.now();
  people.forEach((person) => {
    (person.triggers || []).forEach((trigger) => {
      const delay = trigger.ts - now;
      if (delay > 0 && delay < 8 * 24 * 60 * 60 * 1000) {
        setTimeout(() => {
          self.registration.showNotification(trigger.title, {
            body: trigger.body,
            icon: trigger.icon || '',
            tag: trigger.tag,
            dir: 'rtl',
            lang: 'ar',
            vibrate: [200, 100, 200, 100, 200],
            requireInteraction: true,
            data: { url: self.location.origin }
          });
        }, delay);
      }
    });
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      if (list.length > 0) { return list[0].focus(); }
      return self.clients.openWindow(self.registration.scope);
    })
  );
});
