// =====================================================================
//  📖 تنبيه تحضير الدرس — قبل ميعاد الدرس بـ 3 أيام (قابل للتعديل)
//  ميعاد الدرس = "يوم أخذ الغياب" المختار في أعلى الصفحة (الجمعة افتراضياً)
//  - بطاقة في الصفحة تعرض الحالة وزر "تم التحضير"
//  - إشعار فوري عند فتح التطبيق إذا دخلنا فترة التحضير
//  - جدولة إشعار عبر الـ Service Worker لوقت التنبيه القادم
//  - موضوع الدرس القادم يُؤخذ تلقائياً من «منهج الكرازة» حسب مرحلة الفصل (جدول curriculum_lessons)،
//    ويبقى حقل الكتابة اليدوية احتياطياً فقط لو لا يوجد درس مسجّل للمرحلة
// =====================================================================
(function () {
  'use strict';

  var DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var MS_DAY = 86400000;
  var DEFAULTS = { enabled: true, daysBefore: 3, hour: 9, done: {}, notified: {}, topics: {} };
  var _lastSig = '';
  var CUR_TTL = 10 * 60 * 1000;                       // تحديث المنهج من السحابة كل 10 دقائق
  var _cur = { stage: '', lessons: [], at: 0, busy: false, loaded: false };

  // ---------- أدوات ----------
  function meetingDow() {
    var d = (typeof getAbsenceDayOfWeek === 'function') ? getAbsenceDayOfWeek() : 5;
    return (isNaN(d) || d < 0 || d > 6) ? 5 : d;
  }
  function chapterId() {
    return (typeof ACTIVE_CHAPTER_ID !== 'undefined' && ACTIVE_CHAPTER_ID) ? ACTIVE_CHAPTER_ID : 'default';
  }
  function storeKey() { return 'lessonReminder_v1_' + chapterId(); }

  function load() {
    var s;
    try { s = JSON.parse(localStorage.getItem(storeKey()) || '{}'); } catch (e) { s = {}; }
    s = Object.assign({}, DEFAULTS, s);
    s.done = s.done || {}; s.notified = s.notified || {}; s.topics = s.topics || {};
    s.daysBefore = Math.min(6, Math.max(1, parseInt(s.daysBefore, 10) || 3));
    s.hour = Math.min(22, Math.max(5, isNaN(parseInt(s.hour, 10)) ? 9 : parseInt(s.hour, 10)));
    return s;
  }
  function prune(obj) {
    var keys = Object.keys(obj).sort();
    while (keys.length > 20) delete obj[keys.shift()];
  }
  function save(s) {
    prune(s.done); prune(s.notified); prune(s.topics);
    try { localStorage.setItem(storeKey(), JSON.stringify(s)); } catch (e) {}
  }

  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmtHour(h) { return (h < 12 ? h : (h === 12 ? 12 : h - 12)) + (h < 12 ? ' ص' : ' م'); }
  function daysText(n) {
    if (n <= 0) return 'اليوم';
    if (n === 1) return 'يوم واحد';
    if (n === 2) return 'يومان';
    return n + ' أيام';
  }

  function escH(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  // ---------- منهج الكرازة (الدرس القادم حسب مرحلة الفصل) ----------
  function stageId() {
    return (typeof ACTIVE_CHAPTER_STAGE !== 'undefined' && ACTIVE_CHAPTER_STAGE) ? ACTIVE_CHAPTER_STAGE : '';
  }
  function curCacheKey(stage) { return 'lessonReminder_cur_v1_' + stage; }
  function readCurCache(stage) {
    var yesterday = ymd(addDays(startOfDay(new Date()), -1)), out = [];
    try {
      var c = JSON.parse(localStorage.getItem(curCacheKey(stage)) || 'null');
      ((c && c.lessons) || []).forEach(function (l) { if (l && l.d >= yesterday && l.t) out.push(l); });
    } catch (e) {}
    return out;
  }
  function ensureCurriculum() {
    var stage = stageId();
    if (!stage) { if (_cur.stage) _cur = { stage: '', lessons: [], at: 0, busy: false, loaded: false }; return; }
    if (_cur.stage !== stage) {
      _cur = { stage: stage, lessons: readCurCache(stage), at: 0, busy: false, loaded: false };
      _lastSig = '';
    }
    if (_cur.busy || Date.now() - _cur.at < CUR_TTL) return;
    var sb = (typeof _supabaseClient !== 'undefined') ? _supabaseClient : null;
    if (!sb) return;
    _cur.busy = true; _cur.at = Date.now();
    var from = ymd(addDays(startOfDay(new Date()), -1));
    Promise.resolve(
      sb.from('curriculum_lessons').select('lesson_date,title,ref')
        .eq('stage', stage).gte('lesson_date', from)
        .order('lesson_date', { ascending: true }).order('created_at', { ascending: true }).limit(40)
    ).then(function (res) {
      if (_cur.stage !== stage) return;                // تغيّر الفصل أثناء الجلب
      _cur.busy = false;
      if (!res || res.error) return;
      _cur.lessons = (res.data || []).map(function (r) { return { d: r.lesson_date, t: r.title, ref: r.ref || '' }; });
      _cur.loaded = true;
      try { localStorage.setItem(curCacheKey(stage), JSON.stringify({ lessons: _cur.lessons })); } catch (e) {}
      _lastSig = '';
      check();
    }).catch(function () { if (_cur.stage === stage) _cur.busy = false; });
  }
  // الدرس المسجّل في يوم الميعاد، وإلا أقرب درس مسجّل له (ويُذكر تاريخه)
  function autoLesson(c) {
    var stage = stageId();
    if (!stage || _cur.stage !== stage || !_cur.lessons.length) return null;
    var exact = _cur.lessons.filter(function (l) { return l.d === c.key; });
    if (exact.length) return { list: exact, date: c.key, exact: true };
    var best = '', bd = 1e9, base = new Date(c.key + 'T12:00:00');
    _cur.lessons.forEach(function (l) {
      var diff = Math.abs(Math.round((new Date(l.d + 'T12:00:00') - base) / MS_DAY));
      if (diff <= bd) { bd = diff; best = l.d; }
    });
    return best ? { list: _cur.lessons.filter(function (l) { return l.d === best; }), date: best, exact: false } : null;
  }
  function lessonLine(l) { return l.t + (l.ref ? ' (' + l.ref + ')' : ''); }
  function topicFor(c) {
    var a = autoLesson(c);
    if (a) {
      var t = a.list.map(lessonLine).join(' + ');
      return a.exact ? t : t + ' [' + a.date + ']';
    }
    return (c.s.topics[c.key] || '').trim();
  }

  function compute() {
    var s = load();
    var now = new Date();
    var today = startOfDay(now);
    var meeting = addDays(today, (meetingDow() - today.getDay() + 7) % 7);
    var key = ymd(meeting);
    var rs = addDays(meeting, -s.daysBefore);
    rs.setHours(s.hour, 0, 0, 0);
    var daysLeft = Math.round((meeting - today) / MS_DAY);
    var state = !s.enabled ? 'off' : (s.done[key] ? 'done' : (now >= rs ? 'due' : 'wait'));
    return { s: s, now: now, meeting: meeting, key: key, rs: rs, daysLeft: daysLeft, state: state };
  }

  function notifTexts(c) {
    var topic = topicFor(c);
    var when = c.daysLeft <= 0 ? 'درس اليوم' : 'باقي ' + daysText(c.daysLeft) + ' على الدرس';
    return {
      title: '📖 وقت تحضير الدرس',
      body: when + ' (' + DAYS[c.meeting.getDay()] + ' ' + ymd(c.meeting) + ')' +
        (topic ? ' — الموضوع: ' + topic : '') + ' — ابدأ التحضير الآن 🙏'
    };
  }

  function sendNotif(title, body, tag) {
    var opts = {
      body: body, tag: tag, dir: 'rtl', lang: 'ar',
      icon: './icons/icon-192.png', badge: './icons/icon-192.png',
      vibrate: [200, 100, 200], requireInteraction: true
    };
    if (typeof showNotificationSafe === 'function') return showNotificationSafe(title, opts);
    if (!('Notification' in window) || Notification.permission !== 'granted') return Promise.resolve(false);
    try { new Notification(title, opts); return Promise.resolve(true); } catch (e) { return Promise.resolve(false); }
  }

  // ---------- جدولة عبر الـ Service Worker (تُرسل مرة لكل تغيير فقط) ----------
  function scheduleSW(c) {
    if (!('serviceWorker' in navigator)) return;
    var triggers = [];
    if (c.state === 'wait' && c.rs.getTime() - Date.now() < 8 * MS_DAY) {
      var t = notifTexts(c);
      // وقت التنبيه المجدول: نحسب عدد الأيام المتبقية عند وقت التنبيه نفسه
      var at = Object.assign({}, c, { daysLeft: c.s.daysBefore });
      t = notifTexts(at);
      triggers.push({ ts: c.rs.getTime(), title: t.title, body: t.body, tag: 'lesson-prep-' + c.key });
    }
    var sig = chapterId() + '|' + JSON.stringify(triggers);
    if (sig === _lastSig) return;
    _lastSig = sig;
    navigator.serviceWorker.ready.then(function (reg) {
      if (reg && reg.active) {
        reg.active.postMessage({ type: 'SCHEDULE_LESSON_NOTIFS', triggers: triggers });
      }
    }).catch(function () {});
  }

  // ---------- الفحص الدوري ----------
  function check() {
    ensureCurriculum();
    var c = compute();
    if (c.state === 'due' && !c.s.notified[c.key] &&
        'Notification' in window && Notification.permission === 'granted') {
      c.s.notified[c.key] = true;          // نعلّمها قبل الإرسال لمنع التكرار
      save(c.s);
      var t = notifTexts(c);
      sendNotif(t.title, t.body, 'lesson-prep-' + c.key).then(function (ok) {
        if (!ok) { var s2 = load(); delete s2.notified[c.key]; save(s2); }
      });
    }
    render(c);
    scheduleSW(c);
  }

  // ---------- الواجهة ----------
  function injectStyles() {
    if (document.getElementById('lpStyles')) return;
    var st = document.createElement('style');
    st.id = 'lpStyles';
    st.textContent =
      '.lp-card{background:#fff;border:1px solid #e5dfd0;border-top:4px solid var(--gold,#d4a017);border-radius:12px;padding:14px 18px;margin-bottom:16px;box-shadow:0 4px 12px var(--shadow,rgba(13,17,23,.12));font-family:Cairo,sans-serif;direction:rtl}' +
      '.lp-card.due{border-top-color:var(--accent,#c8392b);background:#fff7f6}' +
      '.lp-card.done{border-top-color:var(--green,#1a7a4a);background:#f4fbf7}' +
      '.lp-card.off{opacity:.8}' +
      '.lp-head{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}' +
      '.lp-title{font-weight:900;font-size:15px;color:var(--ink,#0d1117)}' +
      '.lp-switch{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;cursor:pointer}' +
      '.lp-status{font-size:14px;font-weight:700;line-height:1.7;margin-bottom:10px}' +
      '.lp-card.due .lp-status{color:#991b1b}.lp-card.done .lp-status{color:#166534}' +
      '.lp-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px}' +
      '.lp-row label{display:flex;flex-direction:column;gap:3px;font-size:12px;font-weight:700;color:#555}' +
      '.lp-row input,.lp-row select{padding:7px 10px;border:2px solid #e2d9bd;border-radius:8px;font-family:Cairo,sans-serif;font-size:13px;outline:none;background:#fff}' +
      '.lp-row input[type=text]{min-width:200px}' +
      '.lp-actions{display:flex;gap:8px;flex-wrap:wrap}' +
      '.lp-btn{border:none;border-radius:8px;padding:8px 14px;font-family:Cairo,sans-serif;font-size:13px;font-weight:700;cursor:pointer;background:#f1ece0;color:var(--ink,#0d1117)}' +
      '.lp-btn.primary{background:var(--green,#1a7a4a);color:#fff}' +
      '.lp-btn.warn{background:var(--accent2,#2980b9);color:#fff}' +
      '.lp-lesson{background:#f7f3e8;border:1px dashed #d4c89a;border-radius:10px;padding:10px 12px;margin-bottom:10px;font-size:14px;line-height:1.8}' +
      '.lp-lesson .lp-lbl{display:block;font-size:12px;font-weight:700;color:#7a735f}' +
      '.lp-lesson b{display:block;font-size:16px;font-weight:900;color:var(--ink,#0d1117)}' +
      '.lp-lesson .lp-ref{font-family:Amiri,serif;font-size:15px;color:#57503f}' +
      '.lp-lesson.muted{color:#7a735f;font-weight:600}' +
      '.lp-lesson a{color:var(--accent2,#2980b9);font-weight:700;font-size:12.5px;margin-inline-start:8px}';
    document.head.appendChild(st);
  }

  function dayOptions() {
    var h = '';
    for (var i = 1; i <= 6; i++) h += '<option value="' + i + '">' + i + '</option>';
    return h;
  }
  function hourOptions() {
    var h = '';
    for (var i = 5; i <= 22; i++) h += '<option value="' + i + '">' + fmtHour(i) + '</option>';
    return h;
  }

  function ensureCard() {
    var card = document.getElementById('lessonPrepCard');
    if (card) return card;
    var anchor = document.querySelector('.class-name-card');
    if (!anchor || !anchor.parentNode) return null;
    injectStyles();
    card = document.createElement('div');
    card.id = 'lessonPrepCard';
    card.className = 'lp-card';
    card.innerHTML =
      '<div class="lp-head">' +
        '<div class="lp-title">📖 تنبيه تحضير الدرس</div>' +
        '<label class="lp-switch"><input type="checkbox" id="lpEnabled"> مفعّل</label>' +
      '</div>' +
      '<div class="lp-status" id="lpStatus"></div>' +
      '<div class="lp-lesson muted" id="lpLesson"></div>' +
      '<div class="lp-row">' +
        '<label id="lpTopicWrap" style="display:none">موضوع الدرس القادم (اختياري)<input type="text" id="lpTopic" maxlength="120" placeholder="مثال: قصة القديس ونس"></label>' +
        '<label>التنبيه قبل (أيام)<select id="lpDays">' + dayOptions() + '</select></label>' +
        '<label>الساعة<select id="lpHour">' + hourOptions() + '</select></label>' +
      '</div>' +
      '<div class="lp-actions">' +
        '<button type="button" class="lp-btn primary" id="lpDone">✅ تم التحضير</button>' +
        '<button type="button" class="lp-btn warn" id="lpNotif" style="display:none">🔔 تفعيل الإشعارات</button>' +
        '<button type="button" class="lp-btn" id="lpTest">🧪 تجربة التنبيه</button>' +
      '</div>';
    anchor.parentNode.insertBefore(card, anchor.nextSibling);

    var topicTimer = null;
    document.getElementById('lpEnabled').addEventListener('change', function (e) {
      var s = load(); s.enabled = e.target.checked; save(s); _lastSig = ''; check();
    });
    document.getElementById('lpDays').addEventListener('change', function (e) {
      var s = load(); s.daysBefore = parseInt(e.target.value, 10); save(s); _lastSig = ''; check();
    });
    document.getElementById('lpHour').addEventListener('change', function (e) {
      var s = load(); s.hour = parseInt(e.target.value, 10); save(s); _lastSig = ''; check();
    });
    document.getElementById('lpTopic').addEventListener('input', function (e) {
      var v = e.target.value;
      clearTimeout(topicTimer);
      topicTimer = setTimeout(function () {
        var c = compute(); c.s.topics[c.key] = v; save(c.s); _lastSig = ''; scheduleSW(compute());
      }, 500);
    });
    document.getElementById('lpDone').addEventListener('click', function () {
      var c = compute();
      if (c.s.done[c.key]) delete c.s.done[c.key]; else c.s.done[c.key] = true;
      save(c.s); _lastSig = ''; check();
    });
    document.getElementById('lpNotif').addEventListener('click', function () {
      if (typeof enableNotifications === 'function') {
        Promise.resolve(enableNotifications()).then(function () { setTimeout(check, 500); });
      } else if ('Notification' in window) {
        Notification.requestPermission().then(function () { check(); });
      }
    });
    document.getElementById('lpTest').addEventListener('click', function () {
      var c = compute();
      var t = notifTexts(Object.assign({}, c, { daysLeft: c.s.daysBefore }));
      if (!('Notification' in window) || Notification.permission !== 'granted') {
        alert('فعّل الإشعارات أولاً بالضغط على زر "تفعيل الإشعارات"');
        return;
      }
      sendNotif(t.title, t.body, 'lesson-prep-test');
    });
    return card;
  }

  function setIfIdle(id, prop, val) {
    var el = document.getElementById(id);
    if (el && document.activeElement !== el) el[prop] = val;
  }

  function render(c) {
    var card = ensureCard();
    if (!card) return;
    card.className = 'lp-card ' + c.state;
    setIfIdle('lpEnabled', 'checked', c.s.enabled);
    setIfIdle('lpDays', 'value', String(c.s.daysBefore));
    setIfIdle('lpHour', 'value', String(c.s.hour));
    setIfIdle('lpTopic', 'value', c.s.topics[c.key] || '');

    // الدرس القادم من منهج الكرازة (تلقائي) — والكتابة اليدوية احتياطية فقط
    var box = document.getElementById('lpLesson'), wrap = document.getElementById('lpTopicWrap');
    if (box && wrap) {
      var a = autoLesson(c), stage = stageId(), link = './curriculum.html' + (stage ? '?y=' + encodeURIComponent(stage) : '');
      var html, manual = false;
      if (a) {
        var when = DAYS[new Date(a.date + 'T12:00:00').getDay()] + ' ' + a.date;
        html = '<span class="lp-lbl">📜 ' + (a.exact ? 'درس ' : 'أقرب درس مسجّل في المنهج: ') + escH(when) + '</span>' +
          a.list.map(function (l) { return '<b>' + escH(l.t) + '</b>' + (l.ref ? '<span class="lp-ref">' + escH(l.ref) + '</span>' : ''); }).join('') +
          '<a href="' + escH(link) + '">منهج الكرازة ↗</a>';
        box.className = 'lp-lesson';
      } else {
        box.className = 'lp-lesson muted';
        manual = true;
        if (!stage) html = 'حدّد المرحلة الدراسية للفصل (تعديل الفصل) ليظهر درسه القادم تلقائياً من منهج الكرازة. ويمكنك كتابة الموضوع يدوياً:';
        else if (_cur.busy && !_cur.loaded) html = '⏳ جاري تحميل منهج الكرازة...';
        else html = 'لم يُضَف لهذه المرحلة درس في منهج الكرازة بعد. ويمكنك كتابة الموضوع يدوياً:';
        if (_cur.busy && !_cur.loaded && stage) manual = false;
      }
      if (box.innerHTML !== html) box.innerHTML = html;
      wrap.style.display = manual ? '' : 'none';
    }

    var meetingTxt = DAYS[c.meeting.getDay()] + ' ' + ymd(c.meeting);
    var status;
    if (c.state === 'off') {
      status = 'التنبيه متوقف. ميعاد الدرس القادم: ' + meetingTxt;
    } else if (c.state === 'done') {
      status = '✅ تم تحضير درس ' + meetingTxt + ' — بارك الله تعبك';
    } else if (c.state === 'due') {
      status = '⏰ ' + (c.daysLeft <= 0 ? 'الدرس اليوم!' : 'باقي ' + daysText(c.daysLeft) + ' على الدرس') +
        ' (' + meetingTxt + ') — حان وقت التحضير';
    } else {
      status = 'ميعاد الدرس القادم: ' + meetingTxt + ' — سيصلك التنبيه ' +
        DAYS[c.rs.getDay()] + ' ' + ymd(c.rs) + ' الساعة ' + fmtHour(c.s.hour);
    }
    var st = document.getElementById('lpStatus');
    if (st) st.textContent = status;

    var done = document.getElementById('lpDone');
    if (done) {
      done.textContent = c.s.done[c.key] ? '↩️ إلغاء علامة التحضير' : '✅ تم التحضير';
      done.style.display = c.state === 'off' ? 'none' : '';
    }
    var nb = document.getElementById('lpNotif');
    if (nb) {
      var granted = ('Notification' in window) && Notification.permission === 'granted';
      nb.style.display = granted || !('Notification' in window) ? 'none' : '';
    }
  }

  // ---------- ربط مع تغيير "يوم أخذ الغياب" ----------
  function hookAbsenceDay() {
    if (typeof window.saveAbsenceDay === 'function' && !window.saveAbsenceDay.__lp) {
      var orig = window.saveAbsenceDay;
      var wrapped = function () {
        var r = orig.apply(this, arguments);
        try { _lastSig = ''; check(); } catch (e) {}
        return r;
      };
      wrapped.__lp = true;
      window.saveAbsenceDay = wrapped;
    }
  }

  function start() {
    hookAbsenceDay();
    setTimeout(check, 1200);
    setInterval(check, 20000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') check();
    });
  }

  window.LessonReminder = { check: check, compute: compute };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
