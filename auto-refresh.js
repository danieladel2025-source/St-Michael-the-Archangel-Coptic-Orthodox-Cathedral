/* =====================================================================
   auto-refresh.js — التحديث التلقائي المستمر للصفحة
   ---------------------------------------------------------------------
   • عند ترك الصفحة دون أي لمس أو تفاعل لمدة (idleMs) تُحدَّث الصفحة تلقائياً
     لإظهار أحدث البيانات وأحدث إصدار من التطبيق، ويتكرر ذلك طالما بقيت الصفحة بلا تفاعل.
   • زر التشغيل/الإيقاف:   أي عنصر فيه الوسم  data-ar-toggle
   • زر "تحديث الآن":      أي عنصر فيه الوسم  data-ar-now
   • الحالة (مفعّل/متوقف) تُحفظ على الجهاز، والوضع الافتراضي: مفعّل.

   🛡️ حماية البيانات: لا يُحدَّث شيء في أي من الحالات التالية (ويُعاد الفحص كل ثانية):
     - توجد تعديلات لم تُرفع للسحابة بعد (أو رفع جارٍ) — لأن بيانات المخدومين لا تُحفظ إلا في السحابة
     - لا يوجد اتصال بالإنترنت
     - نافذة/مودال مفتوح، أو شاشة الترحيب/الدخول ظاهرة
     - المستخدم يكتب في حقل (أو كتب خلال آخر 5 دقائق)، أو يحدّد نصاً، أو يشغّل صوتاً/فيديو
     - الصفحة في الخلفية (التبويب غير ظاهر)
   • قبل التحديث يُستدعى _flushBeforeLeave() (إن وُجدت) للتأكد أن كل شيء محفوظ.
   • التحديث سلس: تُخفى شاشة البداية/اختيار الفصل/تسجيل الدخول مؤقتاً، ويُستعاد موضع التمرير
     (وفي لوحة المشرفين يُستعاد القسم المفتوح).
   • إن بقيت الشاشة بلا استخدام طويلاً (10 تحديثات متتالية) يتباطأ التحديث إلى كل 5 دقائق لتوفير البيانات.
   ===================================================================== */
(function () {
  'use strict';
  if (window.AutoRefresh) return;

  /* ---------------------------- الإعدادات ---------------------------- */
  var CFG = {
    idleMs: 60 * 1000,            // مدة عدم التفاعل قبل التحديث التلقائي
    backoffAfter: 10,             // بعد هذا العدد من التحديثات المتتالية بلا أي تفاعل...
    backoffIdleMs: 5 * 60 * 1000, // ...نوسّع المدة إلى 5 دقائق
    returnIdleMs: 5 * 1000,       // عند العودة لصفحة قديمة (كانت في الخلفية) ننتظر هذه المدة ثم نحدّث
    staleMs: 2 * 60 * 1000,       // الصفحة تُعتبر "قديمة" بعد هذه المدة من آخر تحميل
    typingGraceMs: 5 * 60 * 1000, // بعد الكتابة في أي حقل لا نحدّث قبل مرور هذه المدة
    minLoadAgeMs: 20 * 1000,      // لا تحديث قبل مرور هذه المدة على آخر تحميل (يمنع الدوران المتكرر)
    markerMaxAgeMs: 30 * 1000,    // عمر العلامة التي تُستعاد بعد التحديث
    restoreTimeoutMs: 12 * 1000   // أقصى مدة لانتظار ظهور المحتوى قبل استعادة التمرير
  };
  var KEY_ENABLED = 'auto_refresh_enabled_v1';   // localStorage
  var KEY_MARKER  = 'auto_refresh_marker_v1';    // sessionStorage
  var ADMIN_VIEWS = ['classes', 'pastoral', 'chapters', 'servants', 'announcements', 'reasons', 'dups', 'security', 'promotion'];
  var DIALOG_SELECTORS = '.overlay, .servant-overlay, #detailOverlay, #studentOverlay, #chapterEditOverlay, #wgServModal, #wgAnnModal';
  var NON_TEXT_INPUTS = /^(checkbox|radio|button|submit|reset|file|range|color|image|hidden)$/i;

  /* ----------------------------- الحالة ------------------------------ */
  var enabled = readEnabled();
  var loadedAt = Date.now();
  var lastActivity = loadedAt;
  var lastTyping = 0;
  var streak = 0;              // عدد التحديثات التلقائية المتتالية بلا أي تفاعل من المستخدم
  var reloading = false;
  var restoring = false;       // أثناء استعادة موضع التمرير بعد التحديث
  var userTouched = false;     // لمس المستخدم الشاشة بعد التحميل (نلغي حينها استعادة التمرير)
  var progScrollUntil = 0;     // نتجاهل أحداث التمرير الناتجة عن استعادتنا نحن
  var customBlockers = [];

  /* ----------------------------- أدوات ------------------------------- */
  function $(id) { return document.getElementById(id); }
  function now() { return Date.now(); }
  function readEnabled() {
    try { return localStorage.getItem(KEY_ENABLED) !== '0'; } catch (e) { return true; }
  }
  function isShown(el) {
    if (!el) return false;
    var cs = window.getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }
  function isTextField(el) {
    if (!el || !el.tagName) return false;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName === 'INPUT') return !NON_TEXT_INPUTS.test(el.type || 'text');
    return !!el.isContentEditable;
  }
  function needMs() { return streak >= CFG.backoffAfter ? CFG.backoffIdleMs : CFG.idleMs; }

  function toast(msg) {
    try {
      if (typeof window.showToast === 'function') { window.showToast(msg); return; }
    } catch (e) {}
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:30px;left:50%;transform:translateX(-50%);background:#222;color:#fff;' +
      'padding:12px 22px;border-radius:10px;font:700 14px Cairo,sans-serif;z-index:2147483000;max-width:90vw;text-align:center;direction:rtl';
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 3500);
  }

  /* --------------------- هل توجد بيانات غير محفوظة؟ -------------------- */
  // متغيرات الرفع السحابي في index.html (let على مستوى السكربت — ظاهرة لهذا الملف بالاسم المجرّد)
  function unsaved() {
    try {
      if (typeof _cloudDirty !== 'undefined' && _cloudDirty) return true;
      if (typeof _cloudSyncing !== 'undefined' && _cloudSyncing) return true;
      if (typeof _cloudPendingAgain !== 'undefined' && _cloudPendingAgain) return true;
    } catch (e) {}
    return false;
  }

  /* ----------- موانع "ناعمة": المستخدم قد يكون في منتصف عمل ------------ */
  function softBlock() {
    var i, el, list;

    list = document.querySelectorAll(DIALOG_SELECTORS);
    for (i = 0; i < list.length; i++) if (isShown(list[i])) return 'dialog';

    el = $('welcomeGate');
    if (el && !el.classList.contains('wg-hide')) return 'welcome';
    if (isShown($('splashScreen'))) return 'splash';
    if (isShown($('loginScreen'))) return 'login';

    if (now() - lastTyping < CFG.typingGraceMs) return 'typing';
    el = document.activeElement;
    if (isTextField(el) && el.value) return 'editing';

    list = document.querySelectorAll('audio, video');
    for (i = 0; i < list.length; i++) if (!list[i].paused && !list[i].ended) return 'media';

    try {
      var sel = window.getSelection && window.getSelection();
      if (sel && !sel.isCollapsed && String(sel).length > 0) return 'selecting';
    } catch (e) {}

    for (i = 0; i < customBlockers.length; i++) {
      try { if (customBlockers[i]()) return 'custom'; } catch (e) {}
    }
    return '';
  }

  function blockReason() {
    if (document.visibilityState !== 'visible') return 'hidden';
    if (navigator.onLine === false) return 'offline';
    if (unsaved()) return 'unsaved';
    return softBlock();
  }

  /* --------------------- حفظ/استعادة حالة الصفحة ---------------------- */
  function currentAdminView() {
    if (!$('dashScreen')) return '';
    for (var i = 0; i < ADMIN_VIEWS.length; i++) {
      var v = $(ADMIN_VIEWS[i] + 'View');
      if (v && isShown(v)) return ADMIN_VIEWS[i];
    }
    return '';
  }

  function saveMarker(manual) {
    var gate = $('chapterGate'), dash = $('dashScreen');
    var m = {
      t: now(),
      y: Math.round(window.pageYOffset || 0),
      view: currentAdminView(),
      inChapter: !!gate && gate.classList.contains('gate-hide'),   // فصل مفتوح فعلاً (لا نخفي شاشة الاختيار إن لم يكن)
      inDash: !!dash && isShown(dash),                              // مشرف مسجّل دخوله
      streak: manual ? 0 : streak + 1
    };
    try { sessionStorage.setItem(KEY_MARKER, JSON.stringify(m)); } catch (e) {}
  }

  function readMarker() {
    try {
      var m = JSON.parse(sessionStorage.getItem(KEY_MARKER) || 'null');
      if (m && typeof m.t === 'number' && now() - m.t < CFG.markerMaxAgeMs) return m;
      sessionStorage.removeItem(KEY_MARKER);
    } catch (e) {}
    return null;
  }

  function unhideAfterReload() {
    var c = document.documentElement.classList;
    c.remove('ar-r'); c.remove('ar-r-chapter'); c.remove('ar-r-dash');
  }

  function restoreAfterReload(m) {
    streak = m.streak || 0;
    restoring = true;
    var tries = 0, max = Math.ceil(CFG.restoreTimeoutMs / 250), viewDone = false, shown = false;

    var timer = setInterval(function () {
      tries++;
      var gate = $('chapterGate'), dash = $('dashScreen');
      var ready = true;
      if (m.inChapter && gate) ready = ready && gate.classList.contains('gate-hide');
      if (m.inDash && dash) ready = ready && dash.style.display === 'block';

      if (ready && !shown) { shown = true; unhideAfterReload(); }

      if (ready && !viewDone) {
        viewDone = true;
        if (m.view && m.view !== 'classes' && typeof window.showView === 'function') {
          try { window.showView(m.view); } catch (e) {}
        }
      }

      var done = false;
      if (userTouched) {
        done = true;                                   // المستخدم بدأ يتفاعل: لا نزاحمه
      } else if (ready && viewDone && m.y > 0) {
        var room = document.documentElement.scrollHeight - window.innerHeight;
        if (room >= m.y - 4 || tries >= max) {         // انتظر حتى يصير المحتوى طويلاً بما يكفي
          progScrollUntil = now() + 600;
          window.scrollTo(0, m.y);
          done = true;
        }
      } else if (ready && viewDone && !m.y) {
        done = true;
      }

      if (done || tries >= max) {
        clearInterval(timer);
        unhideAfterReload();
        restoring = false;
        try { sessionStorage.removeItem(KEY_MARKER); } catch (e) {}
      }
    }, 250);
  }

  /* ----------------------------- التحديث ------------------------------ */
  async function refresh(manual) {
    if (reloading) return;
    reloading = true;
    var willReload = false;
    try {
      if (manual) {
        if (navigator.onLine === false) { toast('📡 لا يوجد اتصال بالإنترنت — لا يمكن التحديث الآن'); return; }
        if (softBlock() && !confirm('هناك نافذة مفتوحة أو بيانات قيد الكتابة قد تضيع عند التحديث.\n\nهل تريد التحديث الآن؟')) return;
        toast('⟳ جاري حفظ آخر التعديلات ثم تحديث الصفحة...');
      }

      // نتأكد أن كل شيء مرفوع للسحابة قبل أن نغادر (دالة index.html الموجودة أصلاً)
      if (typeof _flushBeforeLeave === 'function') {
        var ok = await _flushBeforeLeave();
        if (!ok) {
          if (manual) toast('⚠️ لم تُرفع آخر التعديلات بعد — لم تُحدَّث الصفحة حتى لا تضيع');
          return;
        }
      }
      if (unsaved()) { if (manual) toast('⚠️ توجد تعديلات لم تُحفظ بعد — حاول بعد لحظات'); return; }

      // أثناء الانتظار قد يكون المستخدم عاد للتفاعل: نعيد الفحص قبل أن نحدّث تلقائياً
      if (!manual && (now() - lastActivity < needMs() || blockReason())) return;

      saveMarker(manual);
      willReload = true;
      location.reload();
    } catch (e) {
      console.warn('تعذر التحديث التلقائي:', e);
    } finally {
      if (!willReload) reloading = false;
    }
  }

  function tick() {
    if (!enabled || reloading) return;
    var t = now();
    if (t - lastActivity < needMs()) return;
    if (t - loadedAt < CFG.minLoadAgeMs) return;
    if (blockReason()) return;
    refresh(false);
  }

  /* ------------------------------ الواجهة ----------------------------- */
  function renderButtons() {
    var state = enabled ? 'on' : 'off';
    var list = document.querySelectorAll('[data-ar-toggle]');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.getAttribute('data-ar-state') === state) continue;
      el.setAttribute('data-ar-state', state);
      el.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      el.title = enabled
        ? 'التحديث التلقائي يعمل — اضغط لإيقافه'
        : 'التحديث التلقائي متوقف — اضغط لتشغيله';
      el.innerHTML = '<span class="ar-dot" aria-hidden="true"></span><span>تحديث تلقائي: ' + (enabled ? 'يعمل' : 'متوقف') + '</span>';
    }
  }

  function setEnabled(v, silent) {
    enabled = !!v;
    try { localStorage.setItem(KEY_ENABLED, enabled ? '1' : '0'); } catch (e) {}
    if (enabled) lastActivity = now();
    renderButtons();
    if (!silent) {
      toast(enabled
        ? '✅ تم تشغيل التحديث التلقائي — تُحدَّث الصفحة إذا تُركت دون لمس ' + Math.round(CFG.idleMs / 1000) + ' ثانية'
        : '⏸️ تم إيقاف التحديث التلقائي');
    }
  }

  function injectCss() {
    var st = document.createElement('style');
    st.id = 'arStyles';
    st.textContent =
      '[data-ar-toggle]{display:inline-flex;align-items:center;gap:6px}' +
      '[data-ar-toggle] .ar-dot{width:8px;height:8px;border-radius:50%;background:#2ecc71;flex:none}' +
      '[data-ar-toggle][aria-pressed="false"] .ar-dot{background:#9aa3b2}';
    (document.head || document.documentElement).appendChild(st);
  }

  function init() {
    injectCss();
    renderButtons();

    var m = readMarker();
    if (m) restoreAfterReload(m);
    else unhideAfterReload();

    // أزرار: تفويض الأحداث حتى تعمل مع أي زر يُضاف لاحقاً
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-ar-toggle],[data-ar-now]') : null;
      if (!t) return;
      if (t.hasAttribute('data-ar-toggle')) setEnabled(!enabled, false);
      else refresh(true);
    });

    // تفاعل المستخدم
    var STRONG = ['pointerdown', 'touchstart', 'touchmove', 'mousedown', 'keydown', 'wheel'];
    var WEAK = ['mousemove', 'scroll', 'input', 'change', 'focusin', 'click'];
    var opts = { capture: true, passive: true };
    STRONG.forEach(function (n) {
      document.addEventListener(n, function (e) {
        if (e.isTrusted === false) return;
        lastActivity = now(); streak = 0; userTouched = true;
      }, opts);
    });
    WEAK.forEach(function (n) {
      document.addEventListener(n, function (e) {
        if (e.isTrusted === false) return;
        if (n === 'scroll' && (restoring || now() < progScrollUntil)) return;
        lastActivity = now();
      }, opts);
    });
    // الكتابة في الحقول تؤخّر التحديث مدة أطول (typingGraceMs)
    ['input', 'keydown'].forEach(function (n) {
      document.addEventListener(n, function (e) {
        if (e.isTrusted !== false && isTextField(e.target)) lastTyping = now();
      }, opts);
    });

    // العودة لصفحة كانت في الخلفية: نحدّثها بعد لحظات إن لم يلمسها المستخدم
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && now() - loadedAt > CFG.staleMs) {
        lastActivity = now() - needMs() + CFG.returnIdleMs;
      }
    });

    // مزامنة حالة الزر بين التبويبات/الصفحات (index و admin)
    window.addEventListener('storage', function (e) {
      if (e.key === KEY_ENABLED) { enabled = readEnabled(); renderButtons(); }
    });

    setInterval(tick, 1000);
  }

  window.AutoRefresh = {
    enable: function () { setEnabled(true, false); },
    disable: function () { setEnabled(false, false); },
    toggle: function () { setEnabled(!enabled, false); },
    refreshNow: function () { return refresh(true); },
    isEnabled: function () { return enabled; },
    // لأي كود آخر يريد منع التحديث مؤقتاً: AutoRefresh.addBlocker(function(){ return حالة_مشغول; })
    addBlocker: function (fn) { if (typeof fn === 'function') customBlockers.push(fn); },
    config: CFG
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
