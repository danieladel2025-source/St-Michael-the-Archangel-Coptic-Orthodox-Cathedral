// =====================================================================
//  💬 الشات المباشر — يعمل على Supabase (Realtime) مع تحديث دوري احتياطي
//  غرف المحادثة:
//   • "فصلي"  : خاصة بفصل واحد (خدام نفس الفصل + المشرفون)
//   • "عام"   : لكل الخدام والمشرفين
//  يحتاج تشغيل ملف chat-setup.sql مرة واحدة في Supabase.
//
//  LiveChat.init({
//    role: 'servant' | 'admin',
//    getClient: () => supabaseClient,
//    getRooms: () => [{ id, label }],       // قائمة الغرف المتاحة الآن (فارغة = إخفاء الشات)
//    getIdentity: () => ({ name }),         // للمشرف فقط
//    getNameSuggestions: () => ['..'],      // للخدام: اقتراحات الأسماء
//    getClassName: () => 'اسم الفصل',       // للخدام: يظهر بجوار الاسم في الشات العام
//    watchAll: false                        // للمشرف: اشتراك واحد في كل الغرف
//  })
// =====================================================================
(function (root) {
  'use strict';

  var cfg = null, client = null;
  var store = {};          // room -> [messages] مرتبة تصاعدياً بالـ id
  var seen = {};           // room -> آخر id تمت رؤيته
  var channels = {};       // key -> realtime channel
  var rtOk = {};           // key -> هل الاشتراك اللحظي شغال
  var active = null, isOpen = false, initDone = false;
  var lastSig = '', toastTimer = null;
  var CAP = 300;
  var els = {};

  // ---------- أدوات ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function hhmm(ts) {
    var d = new Date(ts);
    var h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0');
    return (h % 12 || 12) + ':' + m + (h < 12 ? ' ص' : ' م');
  }
  function dayKey(ts) { var d = new Date(ts); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); }
  function dayLabel(ts) {
    var d = new Date(ts), t = new Date();
    if (dayKey(d) === dayKey(t)) return 'اليوم';
    var y = new Date(); y.setDate(y.getDate() - 1);
    if (dayKey(d) === dayKey(y)) return 'أمس';
    return d.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function roomFor(id) { return 'class_' + String(id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100); }

  function myName() {
    if (cfg.role === 'admin') {
      try { return String((cfg.getIdentity() || {}).name || 'مشرف').trim(); } catch (e) { return 'مشرف'; }
    }
    return (localStorage.getItem('lc_name') || '').trim();
  }
  // الاسم والفصل يُخزَّنان معاً في عمود sender بالشكل: الاسم ‖ الفصل (بدون الحاجة لتعديل قاعدة البيانات)
  var SEP = ' ‖ ';
  function parseSender(raw) {
    var s = String(raw == null ? '' : raw), i = s.indexOf(SEP);
    return i < 0 ? { name: s, cls: '' } : { name: s.slice(0, i), cls: s.slice(i + SEP.length) };
  }
  function myClass() {
    if (cfg.role === 'admin') return '';
    try { return String((cfg.getClassName && cfg.getClassName()) || '').trim(); } catch (e) { return ''; }
  }
  function senderValue() {
    var n = myName(), c = myClass();
    return c ? n + SEP + c.slice(0, 60) : n;
  }
  function isMine(m) { return m.role === cfg.role && parseSender(m.sender).name === myName(); }

  function getSeen(room) {
    if (seen[room] != null) return seen[room];
    var v = localStorage.getItem('lc_seen_' + room);
    return v == null ? null : (parseInt(v, 10) || 0);
  }
  function setSeen(room, id) {
    seen[room] = id;
    try { localStorage.setItem('lc_seen_' + room, String(id)); } catch (e) {}
  }
  function maxId(room) {
    var a = store[room];
    return a && a.length ? a[a.length - 1].id : 0;
  }
  function unread(room) {
    var s = getSeen(room) || 0;
    return (store[room] || []).filter(function (m) { return m.id > s && !isMine(m); }).length;
  }
  function totalUnread() {
    return roomsList().reduce(function (n, r) { return n + unread(r.id); }, 0);
  }
  function roomsList() {
    try { return (cfg && cfg.getRooms && cfg.getRooms()) || []; } catch (e) { return []; }
  }

  // ---------- الواجهة ----------
  function injectStyles() {
    if (document.getElementById('lcStyles')) return;
    var st = document.createElement('style');
    st.id = 'lcStyles';
    st.textContent =
      '.lc-fab,.lc-panel,.lc-panel *{box-sizing:border-box;font-family:Cairo,Tahoma,sans-serif}' +
      '.lc-fab{position:fixed;left:16px;bottom:16px;touch-action:none;user-select:none;-webkit-user-select:none;z-index:9000;width:56px;height:56px;border-radius:50%;border:none;background:#0d1117;color:#fff;font-size:26px;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;border:2px solid #d4a017}' +
      '.lc-badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:#c8392b;color:#fff;font-size:12px;font-weight:800;display:flex;align-items:center;justify-content:center}' +
      '.lc-panel{position:fixed;left:16px;bottom:84px;z-index:9001;width:380px;max-width:calc(100vw - 16px);height:540px;max-height:calc(100vh - 24px);background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden;direction:rtl;border:1px solid #e5dfd0}' +
      '.lc-panel[hidden],.lc-badge[hidden],.lc-namebox[hidden],.lc-note[hidden]{display:none!important}' +
      '.lc-head{background:#0d1117;color:#fff;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;gap:8px;cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}' +
      '.lc-head.drag{cursor:grabbing}' +
      '.lc-grip{opacity:.5;font-size:14px;letter-spacing:-2px;margin-inline-end:4px}' +
      '.lc-title{font-weight:900;font-size:15px;display:flex;flex-direction:column;line-height:1.3}' +
      '.lc-conn{font-size:11px;font-weight:600;opacity:.85}' +
      '.lc-iconbtn{background:rgba(255,255,255,.12);border:none;color:#fff;border-radius:8px;width:34px;height:34px;font-size:16px;cursor:pointer;margin-inline-start:4px}' +
      '.lc-tabs{display:flex;gap:6px;padding:8px 10px;background:#f5f0e8;border-bottom:1px solid #e5dfd0;overflow-x:auto}' +
      '.lc-tab{border:none;background:#fff;border:1px solid #d9d0b6;border-radius:18px;padding:5px 12px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;color:#0d1117}' +
      '.lc-tab.on{background:#0d1117;color:#fff;border-color:#0d1117}' +
      '.lc-tab .n{background:#c8392b;color:#fff;border-radius:9px;padding:0 6px;margin-inline-start:5px;font-size:11px}' +
      '.lc-select{width:100%;padding:7px 10px;border:2px solid #d9d0b6;border-radius:8px;font-size:13px;font-weight:700;background:#fff}' +
      '.lc-note{background:#fff3cd;color:#664d03;font-size:12px;font-weight:700;padding:7px 12px;border-bottom:1px solid #ffe69c}' +
      '.lc-msgs{flex:1;overflow-y:auto;padding:12px;background:#faf8f3;display:flex;flex-direction:column;gap:6px;-webkit-overflow-scrolling:touch}' +
      '.lc-day{align-self:center;background:#e9e3d2;color:#555;font-size:11px;font-weight:700;border-radius:10px;padding:2px 10px;margin:6px 0}' +
      '.lc-row{display:flex}.lc-row.mine{justify-content:flex-start}.lc-row:not(.mine){justify-content:flex-end}' +
      '.lc-bubble{max-width:82%;padding:7px 11px;border-radius:14px;background:#fff;border:1px solid #e5dfd0;box-shadow:0 1px 2px rgba(0,0,0,.05)}' +
      '.lc-row.mine .lc-bubble{background:#dcf5e4;border-color:#bfe6cb;border-bottom-right-radius:4px}' +
      '.lc-row:not(.mine) .lc-bubble{border-bottom-left-radius:4px}' +
      '.lc-bubble.admin{border-color:#d4a017;background:#fff9e6}' +
      '.lc-sender{font-size:12px;font-weight:800;color:#2980b9;margin-bottom:2px}' +
      '.lc-cls{display:inline-block;background:#eef3f8;color:#456;border-radius:8px;padding:0 7px;margin-inline-start:6px;font-size:11px;font-weight:700}' +
      '.lc-bubble.admin .lc-sender{color:#9a6b00}' +
      '.lc-text{font-size:14px;line-height:1.6;white-space:pre-wrap;word-break:break-word;color:#0d1117}' +
      '.lc-time{font-size:10px;color:#888;margin-top:2px;text-align:left}' +
      '.lc-del{border:none;background:none;cursor:pointer;font-size:11px;padding:0 0 0 4px;opacity:.6}' +
      '.lc-empty{margin:auto;text-align:center;color:#999;font-size:13px;font-weight:600}' +
      '.lc-compose{display:flex;gap:8px;padding:8px 10px calc(8px + env(safe-area-inset-bottom));background:#fff;border-top:1px solid #e5dfd0;align-items:flex-end}' +
      '.lc-compose textarea{flex:1;resize:none;border:2px solid #e2d9bd;border-radius:12px;padding:8px 12px;font-size:14px;max-height:100px;outline:none;line-height:1.5}' +
      '.lc-compose textarea:focus{border-color:#2980b9}' +
      '.lc-send{border:none;background:#1a7a4a;color:#fff;border-radius:12px;padding:0 16px;height:40px;font-weight:800;font-size:14px;cursor:pointer}' +
      '.lc-send:disabled{opacity:.5}' +
      '.lc-namebox{position:absolute;inset:0;background:rgba(255,255,255,.97);z-index:3;display:flex;flex-direction:column;justify-content:center;gap:10px;padding:24px}' +
      '.lc-namebox h4{font-size:16px;font-weight:900;color:#0d1117}' +
      '.lc-namebox p{font-size:13px;color:#555;line-height:1.7}' +
      '.lc-namebox input{padding:10px 12px;border:2px solid #d9d0b6;border-radius:10px;font-size:15px;outline:none}' +
      '.lc-namebox button{border:none;background:#0d1117;color:#fff;border-radius:10px;padding:10px;font-size:14px;font-weight:800;cursor:pointer}' +
      '.lc-toast{position:fixed;top:14px;left:50%;transform:translateX(-50%) translateY(-120px);z-index:10050;background:#0d1117;color:#fff;border-radius:12px;padding:10px 16px;font-size:13px;font-weight:700;max-width:90vw;box-shadow:0 6px 20px rgba(0,0,0,.35);transition:transform .25s;direction:rtl;font-family:Cairo,Tahoma,sans-serif;cursor:pointer}' +
      '.lc-toast.show{transform:translateX(-50%) translateY(0)}' +
      '@media (max-width:600px){.lc-panel{width:calc(100vw - 16px);height:75vh;height:75dvh;border-radius:16px}}';
    document.head.appendChild(st);
  }

  function ensureUI() {
    if (els.fab) return;
    injectStyles();

    var fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'lc-fab';
    fab.setAttribute('aria-label', 'الشات المباشر');
    fab.style.display = 'none';
    fab.innerHTML = '💬<span class="lc-badge" hidden></span>';
    document.body.appendChild(fab);

    var panel = document.createElement('div');
    panel.className = 'lc-panel';
    panel.hidden = true;
    panel.innerHTML =
      '<div class="lc-head">' +
        '<div class="lc-title"><span><span class="lc-grip">⋮⋮</span>💬 الشات المباشر</span><span class="lc-conn"></span></div>' +
        '<div><button type="button" class="lc-iconbtn lc-btn-name" title="تغيير الاسم">👤</button>' +
        '<button type="button" class="lc-iconbtn lc-btn-close" title="إغلاق">✕</button></div>' +
      '</div>' +
      '<div class="lc-tabs"></div>' +
      '<div class="lc-note" hidden></div>' +
      '<div class="lc-msgs"></div>' +
      '<div class="lc-compose">' +
        '<textarea rows="1" maxlength="1000" placeholder="اكتب رسالتك..."></textarea>' +
        '<button type="button" class="lc-send">إرسال ➤</button>' +
      '</div>' +
      '<div class="lc-namebox" hidden>' +
        '<h4>👤 ما اسمك؟</h4>' +
        '<p>اكتب اسمك ليظهر مع رسائلك في المحادثة. يمكنك اختيار اسمك من قائمة الخدام.</p>' +
        '<input type="text" class="lc-name-input" maxlength="60" list="lcNameList" placeholder="اسمك">' +
        '<datalist id="lcNameList"></datalist>' +
        '<button type="button" class="lc-name-save">حفظ والدخول للمحادثة</button>' +
      '</div>';
    document.body.appendChild(panel);

    var toast = document.createElement('div');
    toast.className = 'lc-toast';
    document.body.appendChild(toast);

    els = {
      fab: fab, badge: fab.querySelector('.lc-badge'), panel: panel,
      conn: panel.querySelector('.lc-conn'), tabs: panel.querySelector('.lc-tabs'),
      note: panel.querySelector('.lc-note'), msgs: panel.querySelector('.lc-msgs'),
      input: panel.querySelector('textarea'), send: panel.querySelector('.lc-send'),
      nameBox: panel.querySelector('.lc-namebox'), nameInput: panel.querySelector('.lc-name-input'),
      nameList: panel.querySelector('#lcNameList'), toast: toast
    };

    restorePos(fab, 'fab');
    makeDraggable(fab, fab, 'fab', function () { isOpen ? closePanel() : openPanel(); });
    makeDraggable(panel, panel.querySelector('.lc-head'), 'panel', null);
    window.addEventListener('resize', keepOnScreen);
    panel.querySelector('.lc-btn-close').addEventListener('click', closePanel);
    panel.querySelector('.lc-btn-name').addEventListener('click', function () {
      if (cfg.role === 'admin') { showNote('اسمك في الشات يظهر تلقائياً من حساب المشرف'); return; }
      showNameBox();
    });
    panel.querySelector('.lc-name-save').addEventListener('click', saveName);
    els.nameInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') saveName(); });
    els.send.addEventListener('click', sendMessage);
    els.input.addEventListener('input', autosize);
    els.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !('ontouchstart' in window)) {
        e.preventDefault(); sendMessage();
      }
    });
    els.tabs.addEventListener('click', function (e) {
      var b = e.target.closest('.lc-tab');
      if (b) switchRoom(b.getAttribute('data-room'));
    });
    els.tabs.addEventListener('change', function (e) {
      if (e.target.classList.contains('lc-select')) switchRoom(e.target.value);
    });
    els.msgs.addEventListener('click', function (e) {
      var d = e.target.closest('.lc-del');
      if (d) deleteMessage(parseInt(d.getAttribute('data-id'), 10));
    });
    toast.addEventListener('click', function () { openPanel(); });
  }

  // ---------- النافذة العائمة (سحب بالماوس أو اللمس) ----------
  var POS_KEY = 'lc_pos_';
  function placeAt(el, x, y) {
    var w = el.offsetWidth, h = el.offsetHeight;
    x = Math.min(Math.max(0, x), Math.max(0, window.innerWidth - w));
    y = Math.min(Math.max(0, y), Math.max(0, window.innerHeight - h));
    el.style.left = x + 'px'; el.style.top = y + 'px';
    el.style.right = 'auto'; el.style.bottom = 'auto';
  }
  function restorePos(el, key) {
    try {
      var v = JSON.parse(localStorage.getItem(POS_KEY + key) || 'null');
      if (v && typeof v.x === 'number') { placeAt(el, v.x, v.y); return true; }
    } catch (e) {}
    return false;
  }
  function defaultPanelPos() {
    // فوق زر الشات وعلى نفس جهته
    var f = els.fab.getBoundingClientRect();
    var y = f.top - els.panel.offsetHeight - 12;
    if (y < 8) y = Math.min(f.bottom + 12, window.innerHeight - els.panel.offsetHeight);
    placeAt(els.panel, f.left, y);
  }
  function makeDraggable(el, handle, key, onTap) {
    var sx, sy, ox, oy, moved = false, down = false, pid = null;
    handle.addEventListener('pointerdown', function (e) {
      if (e.button != null && e.button !== 0) return;
      if (handle !== el && e.target.closest && e.target.closest('button')) return; // أزرار الهيدر لا تسحب
      var r = el.getBoundingClientRect();
      down = true; moved = false; pid = e.pointerId;
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      try { handle.setPointerCapture(pid); } catch (er) {}
    });
    handle.addEventListener('pointermove', function (e) {
      if (!down || e.pointerId !== pid) return;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 6) return;
      moved = true;
      handle.classList.add('drag');
      placeAt(el, ox + dx, oy + dy);
      e.preventDefault();
    });
    function end(e) {
      if (!down || e.pointerId !== pid) return;
      down = false; handle.classList.remove('drag');
      try { handle.releasePointerCapture(pid); } catch (er) {}
      if (moved) {
        var r = el.getBoundingClientRect();
        try { localStorage.setItem(POS_KEY + key, JSON.stringify({ x: Math.round(r.left), y: Math.round(r.top) })); } catch (er) {}
      } else if (onTap) { onTap(); }
    }
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }
  function keepOnScreen() {
    [els.fab, els.panel].forEach(function (el) {
      if (el.style.top && !el.hidden && el.style.display !== 'none') {
        placeAt(el, parseFloat(el.style.left) || 0, parseFloat(el.style.top) || 0);
      }
    });
  }

  function autosize() {
    var t = els.input;
    t.style.height = 'auto';
    t.style.height = Math.min(100, t.scrollHeight) + 'px';
  }

  function showNote(msg) {
    els.note.textContent = msg;
    els.note.hidden = !msg;
    if (msg) { clearTimeout(showNote._t); showNote._t = setTimeout(function () { els.note.hidden = true; }, 9000); }
  }

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { els.toast.classList.remove('show'); }, 4000);
  }

  function updateConn() {
    var any = Object.keys(rtOk).some(function (k) { return rtOk[k]; });
    els.conn.textContent = any ? '● متصل — رسائل لحظية' : '○ يتم التحديث كل بضع ثوانٍ';
    els.conn.style.color = any ? '#7ee2a8' : '#ffd479';
  }

  function updateBadge() {
    var n = totalUnread();
    els.badge.hidden = n === 0;
    els.badge.textContent = n > 99 ? '99+' : String(n);
  }

  function renderTabs() {
    var rooms = roomsList();
    if (rooms.length <= 3) {
      els.tabs.innerHTML = rooms.map(function (r) {
        var n = unread(r.id);
        return '<button type="button" class="lc-tab' + (r.id === active ? ' on' : '') + '" data-room="' + esc(r.id) + '">' +
          esc(r.label) + (n ? '<span class="n">' + n + '</span>' : '') + '</button>';
      }).join('');
    } else {
      var cur = els.tabs.querySelector('.lc-select');
      if (cur && document.activeElement === cur) return; // لا نقاطع المستخدم أثناء الاختيار
      els.tabs.innerHTML = '<select class="lc-select">' + rooms.map(function (r) {
        var n = unread(r.id);
        return '<option value="' + esc(r.id) + '"' + (r.id === active ? ' selected' : '') + '>' +
          esc(r.label) + (n ? ' (' + n + ' جديدة)' : '') + '</option>';
      }).join('') + '</select>';
    }
  }

  function senderHtml(m) {
    var p = parseSender(m.sender);
    var showCls = p.cls && m.room === 'general';   // الفصل يظهر في الشات العام فقط
    return '<div class="lc-sender">' + (m.role === 'admin' ? '🛡️ ' : '') + esc(p.name) +
      (showCls ? '<span class="lc-cls">🏫 ' + esc(p.cls) + '</span>' : '') + '</div>';
  }

  function renderMsgs(forceScroll) {
    var list = store[active] || [];
    var box = els.msgs;
    var nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    var html = '', lastDay = '';
    list.forEach(function (m) {
      var dk = dayKey(m.created_at);
      if (dk !== lastDay) { lastDay = dk; html += '<div class="lc-day">' + esc(dayLabel(m.created_at)) + '</div>'; }
      var mine = isMine(m);
      html += '<div class="lc-row' + (mine ? ' mine' : '') + '"><div class="lc-bubble' + (m.role === 'admin' ? ' admin' : '') + '">' +
        (mine ? '' : senderHtml(m)) +
        '<div class="lc-text">' + esc(m.body) + '</div>' +
        '<div class="lc-time">' + hhmm(m.created_at) +
        (cfg.role === 'admin' ? ' <button type="button" class="lc-del" data-id="' + m.id + '" title="حذف">🗑</button>' : '') +
        '</div></div></div>';
    });
    if (!list.length) html = '<div class="lc-empty">لا توجد رسائل بعد<br>ابدأ المحادثة 👋</div>';
    box.innerHTML = html;
    if (forceScroll || nearBottom) box.scrollTop = box.scrollHeight;
  }

  // ---------- الاسم ----------
  function showNameBox() {
    var names = [];
    try { names = (cfg.getNameSuggestions && cfg.getNameSuggestions()) || []; } catch (e) {}
    els.nameList.innerHTML = names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
    els.nameInput.value = myName();
    els.nameBox.hidden = false;
    setTimeout(function () { els.nameInput.focus(); }, 50);
  }
  function saveName() {
    var v = els.nameInput.value.trim();
    if (!v) { els.nameInput.focus(); return; }
    try { localStorage.setItem('lc_name', v.slice(0, 60)); } catch (e) {}
    els.nameBox.hidden = true;
    renderMsgs(true);
    els.input.focus();
  }

  // ---------- فتح/إغلاق ----------
  function openPanel() {
    ensureUI();
    if (!roomsList().length) return;
    isOpen = true;
    els.panel.hidden = false;
    if (!restorePos(els.panel, 'panel')) defaultPanelPos();
    els.toast.classList.remove('show');
    if (!active) active = roomsList()[0].id;
    // لو فيه رسائل جديدة في غرفة أخرى نفتح عليها مباشرة
    if (!unread(active)) {
      var withNew = roomsList().filter(function (r) { return unread(r.id) > 0; })[0];
      if (withNew) active = withNew.id;
    }
    renderTabs(); updateConn();
    renderMsgs(true);
    loadRoom(active);
    if (cfg.role !== 'admin' && !myName()) showNameBox();
    else if (!('ontouchstart' in window)) setTimeout(function () { els.input.focus(); }, 60);
  }
  function closePanel() {
    isOpen = false;
    els.panel.hidden = true;
  }
  function switchRoom(id) {
    if (!id || id === active) return;
    active = id;
    renderTabs();
    renderMsgs(true);
    loadRoom(id);
  }
  function markSeen(room) {
    var m = maxId(room);
    if (m > (getSeen(room) || 0)) setSeen(room, m);
    updateBadge(); renderTabs();
  }

  // ---------- جلب وتخزين الرسائل ----------
  function mergeQuiet(m) {
    var arr = store[m.room] || (store[m.room] = []);
    if (arr.some(function (x) { return x.id === m.id; })) return;
    arr.push(m);
  }
  function sortAll() {
    Object.keys(store).forEach(function (r) {
      store[r].sort(function (a, b) { return a.id - b.id; });
      if (store[r].length > CAP) store[r].splice(0, store[r].length - CAP);
    });
  }

  function setupHint(err) {
    var msg = String((err && (err.message || err.details)) || err || '');
    if ((err && err.code === '42P01') || /does not exist|schema cache|relation/i.test(msg)) {
      showNote('⚠️ الشات غير مُفعّل بعد: شغّل ملف chat-setup.sql في Supabase (SQL Editor) مرة واحدة');
    } else {
      showNote('⚠️ تعذر الاتصال بالشات: ' + msg);
    }
  }

  function loadRoom(room) {
    if (!client || !room) return Promise.resolve();
    return client.from('chat_messages').select('*').eq('room', room)
      .order('id', { ascending: false }).limit(100)
      .then(function (r) {
        if (r.error) { setupHint(r.error); return; }
        store[room] = (r.data || []).slice().sort(function (a, b) { return a.id - b.id; });
        if (isOpen && room === active) { renderMsgs(true); markSeen(room); }
        else { updateBadge(); renderTabs(); }
      });
  }

  function loadInitial() {
    var rooms = roomsList();
    var qs;
    if (cfg.watchAll) {
      qs = [client.from('chat_messages').select('*').order('id', { ascending: false }).limit(200)];
    } else {
      qs = rooms.map(function (r) {
        return client.from('chat_messages').select('*').eq('room', r.id).order('id', { ascending: false }).limit(60);
      });
    }
    return Promise.all(qs).then(function (res) {
      res.forEach(function (r) {
        if (r.error) { setupHint(r.error); return; }
        (r.data || []).forEach(mergeQuiet);
      });
      sortAll();
      // أول مرة على هذا الجهاز: نعتبر الرسائل القديمة مقروءة
      rooms.forEach(function (r) {
        if (localStorage.getItem('lc_seen_' + r.id) == null) setSeen(r.id, maxId(r.id));
      });
      initDone = true;
      updateBadge(); renderTabs();
    }).catch(function (e) { setupHint(e); });
  }

  // ---------- الاستقبال ----------
  function onIncoming(m, live) {
    if (!m || m.id == null) return;
    var arr = store[m.room] || (store[m.room] = []);
    if (arr.some(function (x) { return x.id === m.id; })) return;
    arr.push(m);
    arr.sort(function (a, b) { return a.id - b.id; });
    if (arr.length > CAP) arr.splice(0, arr.length - CAP);

    var mine = isMine(m);
    var viewing = isOpen && m.room === active && !document.hidden;
    if (viewing || mine) setSeen(m.room, Math.max(getSeen(m.room) || 0, m.id));
    if (isOpen && m.room === active) renderMsgs(mine);
    if (!mine && live && !viewing) {
      showToastIncoming(m);
      if (document.hidden) browserNotify(m);
    }
    updateBadge(); renderTabs();
  }

  function roomLabel(room) {
    var r = roomsList().filter(function (x) { return x.id === room; })[0];
    return r ? r.label : '';
  }
  function showToastIncoming(m) {
    var sp = parseSender(m.sender);
    var txt = '💬 ' + sp.name + (sp.cls && m.room === 'general' ? ' (' + sp.cls + ')' : '') + ': ' + String(m.body).slice(0, 60);
    showToast(txt);
  }
  function browserNotify(m) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    var sp = parseSender(m.sender);
    var title = '💬 ' + sp.name + (sp.cls && m.room === 'general' ? ' (' + sp.cls + ')' : '') + (roomLabel(m.room) ? ' — ' + roomLabel(m.room) : '');
    var opts = { body: String(m.body).slice(0, 120), tag: 'lc-' + m.room, dir: 'rtl', lang: 'ar', icon: './icons/icon-192.png', renotify: true };
    try {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistration().then(function (reg) {
          if (reg && reg.showNotification) reg.showNotification(title, opts);
          else new Notification(title, opts);
        }).catch(function () {});
      } else { new Notification(title, opts); }
    } catch (e) {}
  }

  // ---------- الاشتراك اللحظي + التحديث الاحتياطي ----------
  function subscribe(rooms) {
    function mk(key, room) {
      var opts = { event: 'INSERT', schema: 'public', table: 'chat_messages' };
      if (room) opts.filter = 'room=eq.' + room;
      var ch = client.channel('lc-' + key + '-' + Date.now())
        .on('postgres_changes', opts, function (p) { if (p && p.new) onIncoming(p.new, true); });
      if (!room) { // المشرف: نتابع الحذف أيضاً
        ch = ch.on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'chat_messages' }, function (p) {
          if (!p || !p.old) return;
          Object.keys(store).forEach(function (r) {
            store[r] = store[r].filter(function (x) { return x.id !== p.old.id; });
          });
          if (isOpen) renderMsgs(false);
          updateBadge(); renderTabs();
        });
      }
      ch.subscribe(function (status) { rtOk[key] = (status === 'SUBSCRIBED'); updateConn(); });
      channels[key] = ch;
    }
    if (cfg.watchAll) mk('all', null);
    else rooms.forEach(function (r) { mk(r.id, r.id); });
  }

  function pollQuery(room) {
    var last;
    if (room) last = Math.max(maxId(room), getSeen(room) || 0);
    else last = Object.keys(store).reduce(function (m, r) { return Math.max(m, maxId(r)); }, 0);
    var q = client.from('chat_messages').select('*').gt('id', last).order('id', { ascending: true }).limit(100);
    if (room) q = q.eq('room', room);
    q.then(function (r) {
      if (r.error) return;
      (r.data || []).forEach(function (m) { onIncoming(m, true); });
    });
  }
  function poll() {
    if (!client || !initDone) return;
    if (cfg.watchAll) { if (!rtOk.all) pollQuery(null); }
    else roomsList().forEach(function (r) { if (!rtOk[r.id]) pollQuery(r.id); });
  }

  function teardown() {
    Object.keys(channels).forEach(function (k) { try { client.removeChannel(channels[k]); } catch (e) {} });
    channels = {}; rtOk = {};
  }

  function sync() {
    try { client = cfg.getClient(); } catch (e) { client = null; }
    var rooms = roomsList();
    els.fab.style.display = (client && rooms.length) ? 'flex' : 'none';
    if (!client || !rooms.length) {
      if (isOpen) closePanel();
      if (lastSig) { teardown(); lastSig = ''; initDone = false; }
      return;
    }
    var sig = rooms.map(function (r) { return r.id; }).join('|') + '#' + (cfg.watchAll ? 1 : 0);
    if (sig === lastSig) { renderTabs(); return; }
    lastSig = sig;
    teardown();
    initDone = false;
    if (!rooms.some(function (r) { return r.id === active; })) active = rooms[0].id;
    renderTabs();
    loadInitial().then(function () { if (isOpen) { renderMsgs(true); markSeen(active); } });
    subscribe(rooms);
    updateConn();
  }

  // ---------- الإرسال والحذف ----------
  function sendMessage() {
    var body = els.input.value.trim();
    if (!body || !active || !client) return;
    var name = myName();
    if (!name) { showNameBox(); return; }
    els.send.disabled = true;
    client.from('chat_messages')
      .insert({ room: active, sender: senderValue(), role: cfg.role, body: body.slice(0, 1000) })
      .select().single()
      .then(function (r) {
        els.send.disabled = false;
        if (r.error) { setupHint(r.error); return; }
        els.input.value = ''; autosize();
        onIncoming(r.data, false);
        renderMsgs(true);
      }, function (e) { els.send.disabled = false; setupHint(e); });
  }

  function deleteMessage(id) {
    if (!id || cfg.role !== 'admin' || !client) return;
    if (!confirm('حذف هذه الرسالة؟')) return;
    client.from('chat_messages').delete().eq('id', id).then(function (r) {
      if (r.error) { setupHint(r.error); return; }
      Object.keys(store).forEach(function (rm) { store[rm] = store[rm].filter(function (x) { return x.id !== id; }); });
      renderMsgs(false); updateBadge(); renderTabs();
    });
  }

  // ---------- التهيئة ----------
  var _timers = false;
  function init(c) {
    cfg = c;
    ensureUI();
    lastSig = '';
    sync();
    if (!_timers) {
      _timers = true;
      setInterval(sync, 3000);
      setInterval(poll, 8000);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && cfg && client) {
          poll();
          if (isOpen && active) loadRoom(active);
        }
      });
    }
  }

  root.LiveChat = { init: init, open: function () { ensureUI(); openPanel(); }, close: closePanel, roomFor: roomFor };
})(window);
