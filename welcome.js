/* =====================================================================
   welcome.js — صفحة الترحيب وتحديد هوية المستخدم
   ---------------------------------------------------------------------
   • الخادم: يكتب اسمه + السنة (المرحلة الدراسية) + بنين/بنات
             → تظهر له الفصول المطابقة فقط.
   • المشرف العام: يجيب "نعم" ثم يدخل البريد وكلمة المرور (نفس لوحة المشرفين)
             → يرى كل الفصول ويدخلها دون كلمة سر الفصل.
   • الاسم يُستخدم في سجل النشاط (افتقاد / حذف مخدوم).
   يُحمَّل بعد السكربت الرئيسي في index.html مباشرة.
   ===================================================================== */
(function () {
  'use strict';

  var PROFILE_KEY     = 'church_user_profile_v1';   // بيانات الخادم (تبقى على الجهاز)
  var ADMIN_KEY       = 'church_admin_session_v1';  // جلسة المشرف العام (sessionStorage فقط)
  var ADMIN_EMAIL_KEY = 'church_admin_email_v1';    // لتعبئة البريد تلقائياً (بدون كلمة المرور)
  var FORCE_KEY       = 'church_welcome_force_v1';  // لفتح صفحة الترحيب بعد "تغيير بياناتي"
  var CHAPTER_SESSION = 'absence_active_chapter_v1';
  var START_TS = Date.now();

  function readJSON(store, key) { try { return JSON.parse(store.getItem(key) || 'null'); } catch (e) { return null; } }
  function writeJSON(store, key, v) { try { store.setItem(key, JSON.stringify(v)); } catch (e) {} }
  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function $(id) { return document.getElementById(id); }

  /* ---------------------------- الحالة ---------------------------- */
  function stageValid(id) { return typeof STAGE_INDEX !== 'undefined' && !!STAGE_INDEX[id]; }
  function profileValid(p) {
    return !!p && typeof p.name === 'string' && p.name.trim().length >= 2 &&
           stageValid(p.stage) && (p.gender === 'boys' || p.gender === 'girls');
  }

  var profile = readJSON(localStorage, PROFILE_KEY);
  if (!profileValid(profile)) profile = null;
  var admin = readJSON(sessionStorage, ADMIN_KEY);
  if (!(admin && admin.email)) admin = null;

  var forceOpen = false;
  try { forceOpen = sessionStorage.getItem(FORCE_KEY) === '1'; sessionStorage.removeItem(FORCE_KEY); } catch (e) {}

  var mode = 'servant';   // الوضع المختار داخل النموذج
  var gender = '';
  var el = null;

  function role() { return admin ? 'admin' : (profile ? 'servant' : ''); }
  function adminName() { return (admin && (admin.name || String(admin.email || '').split('@')[0])) || 'المشرف'; }
  function actor() {
    if (admin) return adminName() + ' (مشرف عام)';
    return profile ? profile.name : '';
  }
  function stageName() { return profile && stageValid(profile.stage) ? STAGE_INDEX[profile.stage].stage.name : ''; }
  function genderName() { return profile ? (profile.gender === 'girls' ? 'بنات' : 'بنين') : ''; }
  function summary() { return profile ? (stageName() + ' - ' + genderName()) : ''; }

  // هل الفصل مناسب للخادم الحالي؟ (المشرف العام يرى الكل)
  function chapterAllowed(id) {
    var r = role();
    if (r === 'admin') return true;
    if (r !== 'servant') return false;
    return _genderOf(id) === profile.gender && _stageOf(id) === profile.stage;
  }

  // هل ما زالت بيانات الفصول (المرحلة/الجنس) قيد التحميل من السحابة؟
  function isLoading() {
    if (Date.now() - START_TS > 20000) return false;
    if (typeof _supabaseClient === 'undefined' || !_supabaseClient) return false;
    if (typeof _statsPending !== 'undefined' && _statsPending.size) return true;
    return _chaptersCache.some(function (c) {
      var id = String(c.chapter_id), m = _chapterMeta[id];
      return !_genderOf(id) && !(m && m.gChecked);
    });
  }

  /* ---------------------------- التنسيق ---------------------------- */
  function injectCss() {
    if ($('wgStyles')) return;
    var st = document.createElement('style');
    st.id = 'wgStyles';
    st.textContent = [
      '#welcomeGate{position:fixed;inset:0;z-index:999999;overflow-y:auto;display:flex;justify-content:center;',
      ' padding:22px 14px calc(36px + env(safe-area-inset-bottom,0px));direction:rtl;font-family:"Cairo",sans-serif;',
      ' background:radial-gradient(circle at 30% 10%,#1f2a3a 0%,#0d1117 60%);transition:opacity .3s,visibility .3s}',
      '#welcomeGate.wg-hide{opacity:0;visibility:hidden;pointer-events:none}',
      '#welcomeGate [hidden]{display:none !important}',
      '#welcomeGate .wg-card{background:var(--paper,#f5f0e8);width:100%;max-width:460px;margin:auto;border-radius:18px;',
      ' padding:26px 20px 24px;box-shadow:0 20px 60px rgba(0,0,0,.5);border-top:5px solid var(--gold,#d4a017)}',
      '#welcomeGate .wg-icon{font-size:46px;text-align:center;line-height:1}',
      '#welcomeGate h1{font-size:22px;font-weight:900;text-align:center;color:var(--ink,#0d1117);margin:8px 0 4px}',
      '#welcomeGate .wg-sub{font-size:13px;text-align:center;color:#666;margin-bottom:18px;line-height:1.7}',
      '#welcomeGate .wg-q{font-size:14px;font-weight:900;color:var(--ink,#0d1117);margin-bottom:8px}',
      '#welcomeGate label{display:block;font-size:13px;font-weight:700;color:#444;margin:14px 0 6px}',
      '#welcomeGate input,#welcomeGate select{width:100%;padding:12px 14px;border:2px solid var(--line,#b5a98a);',
      ' border-radius:10px;font-family:inherit;font-size:16px;background:#fff;color:var(--ink,#0d1117);outline:none}',
      '#welcomeGate input:focus,#welcomeGate select:focus{border-color:var(--accent2,#2980b9)}',
      '#welcomeGate .wg-seg{display:flex;gap:10px}',
      '#welcomeGate .wg-seg button{flex:1;padding:12px 8px;border:2px solid var(--line,#b5a98a);border-radius:10px;',
      ' background:#fff;color:var(--ink,#0d1117);font-family:inherit;font-size:14px;font-weight:700;cursor:pointer}',
      '#welcomeGate .wg-seg button.sel{color:#fff;background:var(--ink,#0d1117);border-color:var(--ink,#0d1117)}',
      '#welcomeGate .wg-seg button.sel[data-m="admin"]{background:var(--accent,#c8392b);border-color:var(--accent,#c8392b)}',
      '#welcomeGate .wg-seg button.sel[data-g="boys"]{background:var(--accent2,#2980b9);border-color:var(--accent2,#2980b9)}',
      '#welcomeGate .wg-seg button.sel[data-g="girls"]{background:#c2185b;border-color:#c2185b}',
      '#welcomeGate .wg-hint{font-size:12px;color:#888;margin-top:8px}',
      '#welcomeGate .wg-error{background:#fee2e2;color:#991b1b;border:1px solid #fca5a5;border-radius:10px;',
      ' padding:10px 12px;font-size:13px;font-weight:700;margin-top:14px}',
      '#welcomeGate .wg-go{width:100%;margin-top:18px;padding:14px;border:none;border-radius:12px;background:var(--green,#1a7a4a);',
      ' color:#fff;font-family:inherit;font-size:16px;font-weight:900;cursor:pointer}',
      '#welcomeGate .wg-go:disabled{opacity:.6;cursor:wait}',
      '#wgUserBar{display:flex;align-items:center;gap:12px;position:relative;overflow:hidden;',
      ' background:linear-gradient(135deg,#ffffff 0%,#eaf3fb 100%);border:1px solid rgba(41,128,185,.28);',
      ' border-right:5px solid var(--accent2,#2980b9);border-radius:14px;padding:12px 14px;margin-bottom:16px;',
      ' box-shadow:0 4px 14px rgba(41,128,185,.14);color:var(--ink,#0d1117);font-family:inherit}',
      '#wgUserBar.admin{background:linear-gradient(135deg,#ffffff 0%,#fdeeec 100%);border-color:rgba(200,57,43,.3);',
      ' border-right-color:var(--accent,#c8392b);box-shadow:0 4px 14px rgba(200,57,43,.14)}',
      '#wgUserBar.girls{background:linear-gradient(135deg,#ffffff 0%,#fdeaf2 100%);border-color:rgba(194,24,91,.28);',
      ' border-right-color:#c2185b;box-shadow:0 4px 14px rgba(194,24,91,.12)}',
      '#wgUserBar .wg-av{flex:0 0 auto;width:46px;height:46px;border-radius:50%;display:flex;align-items:center;justify-content:center;',
      ' font-size:21px;font-weight:900;color:#fff;background:linear-gradient(135deg,#3498db,#1f6fa5);',
      ' box-shadow:0 3px 10px rgba(41,128,185,.4);border:2px solid #fff}',
      '#wgUserBar.admin .wg-av{background:linear-gradient(135deg,#e74c3c,#a82a1e);box-shadow:0 3px 10px rgba(200,57,43,.4)}',
      '#wgUserBar.girls .wg-av{background:linear-gradient(135deg,#e91e8c,#a3134f);box-shadow:0 3px 10px rgba(194,24,91,.4)}',
      '#wgUserBar .wg-info{flex:1 1 auto;min-width:0;text-align:right}',
      '#wgUserBar .wg-hi{font-size:11px;font-weight:700;color:#7a7a7a;line-height:1.3}',
      '#wgUserBar .wg-name{font-size:16px;font-weight:900;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '#wgUserBar .wg-chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:4px}',
      '#wgUserBar .wg-chip{font-size:11px;font-weight:800;padding:2px 9px;border-radius:20px;background:#fff;',
      ' border:1px solid rgba(0,0,0,.1);color:#444;white-space:nowrap}',
      '#wgUserBar .wg-chip.boys{background:#e3f1fb;color:#1f6fa5;border-color:#b9dcf3}',
      '#wgUserBar .wg-chip.girls{background:#fde4ef;color:#a3134f;border-color:#f6b8d2}',
      '#wgUserBar .wg-chip.admin{background:#fde4e1;color:#a82a1e;border-color:#f3b3ac}',
      '#wgUserBar .wg-btn{flex:0 0 auto;font-family:inherit;font-size:12.5px;font-weight:800;padding:9px 13px;border-radius:10px;',
      ' border:none;cursor:pointer;color:#fff;background:var(--ink,#0d1117);box-shadow:0 3px 8px rgba(0,0,0,.2);',
      ' display:inline-flex;align-items:center;gap:5px;transition:transform .15s,background .15s}',
      '#wgUserBar .wg-btn:hover{background:var(--gold,#d4a017);color:var(--ink,#0d1117);transform:translateY(-1px)}',
      '#wgUserBar.admin .wg-btn{background:var(--accent,#c8392b)}',
      '#wgUserBar.admin .wg-btn:hover{background:#a82a1e;color:#fff}',
      '@media(max-width:420px){#wgUserBar{flex-wrap:wrap}#wgUserBar .wg-btn{width:100%;justify-content:center}}',
      '#wgHeaderUser{display:inline-flex !important;align-items:center;gap:7px;max-width:190px;padding:4px 12px 4px 6px !important;',
      ' border-radius:30px !important;background:rgba(255,255,255,.14) !important;border:1px solid rgba(255,255,255,.35) !important}',
      '#wgHeaderUser .wg-hav{flex:0 0 auto;width:26px;height:26px;border-radius:50%;display:inline-flex;align-items:center;',
      ' justify-content:center;font-size:13px;font-weight:900;background:#3498db;color:#fff;border:1.5px solid #fff}',
      '#wgHeaderUser.admin .wg-hav{background:#e74c3c}',
      '#wgHeaderUser.girls .wg-hav{background:#e91e8c}',
      '#wgHeaderUser .wg-hname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:800;font-size:12.5px}',
      '#wgHeaderUser .wg-hedit{font-size:11px;opacity:.8}',
      'body.role-servant #genderTabs,body.role-servant #stageChips{display:none !important}'
    ].join('');
    document.head.appendChild(st);
  }

  /* ---------------------------- بناء الصفحة ---------------------------- */
  function stageOptionsHtml() {
    var h = '<option value="">— اختر السنة الدراسية —</option>';
    if (typeof STAGE_GROUPS === 'undefined') return h;
    STAGE_GROUPS.forEach(function (g) {
      h += '<optgroup label="' + esc(g.icon + ' ' + g.name) + '">' +
        g.stages.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('') +
        '</optgroup>';
    });
    return h;
  }

  function build() {
    if (el) return;
    injectCss();
    el = document.createElement('div');
    el.id = 'welcomeGate';
    el.className = 'wg-hide';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML =
      '<div class="wg-card">' +
        '<div class="wg-icon">⛪</div>' +
        '<h1>مرحباً بك 👋</h1>' +
        '<div class="wg-sub">من فضلك أدخل بياناتك ليظهر لك الفصل المناسب</div>' +

        '<div class="wg-q">هل أنت مشرف عام؟</div>' +
        '<div class="wg-seg" id="wgRole">' +
          '<button type="button" data-m="servant" class="sel">لا، أنا خادم / خادمة</button>' +
          '<button type="button" data-m="admin">نعم، مشرف عام</button>' +
        '</div>' +

        '<div id="wgServant">' +
          '<label for="wgName">اسمك</label>' +
          '<input id="wgName" type="text" autocomplete="name" placeholder="اكتب اسمك">' +
          '<label for="wgStage">السنة التي ستخدم فيها</label>' +
          '<select id="wgStage">' + stageOptionsHtml() + '</select>' +
          '<label>الفئة</label>' +
          '<div class="wg-seg" id="wgGender">' +
            '<button type="button" data-g="boys">👦 بنين</button>' +
            '<button type="button" data-g="girls">👧 بنات</button>' +
          '</div>' +
        '</div>' +

        '<div id="wgAdmin" hidden>' +
          '<label for="wgEmail">البريد الإلكتروني</label>' +
          '<input id="wgEmail" type="email" dir="ltr" autocomplete="username" placeholder="name@example.com">' +
          '<label for="wgPass">كلمة المرور</label>' +
          '<input id="wgPass" type="password" dir="ltr" autocomplete="current-password" placeholder="********">' +
          '<label for="wgAdminName">اسمك (اختياري — يظهر في سجل النشاط)</label>' +
          '<input id="wgAdminName" type="text" autocomplete="name" placeholder="مثال: أبونا / أ. مينا">' +
          '<div class="wg-hint">نفس بيانات الدخول إلى لوحة المشرفين. ستظهر لك كل الفصول.</div>' +
        '</div>' +

        '<div id="wgError" class="wg-error" hidden></div>' +
        '<button type="button" id="wgSubmit" class="wg-go">متابعة ←</button>' +
      '</div>';
    document.body.insertBefore(el, document.body.firstChild);
    wire();
    prefill();
  }

  function setMode(m) {
    mode = m;
    $('wgServant').hidden = (m !== 'servant');
    $('wgAdmin').hidden = (m !== 'admin');
    Array.prototype.forEach.call($('wgRole').querySelectorAll('button'), function (b) {
      b.classList.toggle('sel', b.getAttribute('data-m') === m);
    });
    showError('');
  }
  function setGender(g) {
    gender = g;
    Array.prototype.forEach.call($('wgGender').querySelectorAll('button'), function (b) {
      b.classList.toggle('sel', b.getAttribute('data-g') === g);
    });
  }
  function showError(msg) {
    var box = $('wgError');
    if (!box) return;
    box.textContent = msg || '';
    box.hidden = !msg;
  }
  function busy(on, label) {
    var b = $('wgSubmit');
    b.disabled = !!on;
    b.textContent = on ? (label || '...') : 'متابعة ←';
  }

  function prefill() {
    if (profile) {
      $('wgName').value = profile.name;
      $('wgStage').value = profile.stage;
      setGender(profile.gender);
    }
    try { $('wgEmail').value = localStorage.getItem(ADMIN_EMAIL_KEY) || ''; } catch (e) {}
  }

  function wire() {
    Array.prototype.forEach.call($('wgRole').querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { setMode(b.getAttribute('data-m')); });
    });
    Array.prototype.forEach.call($('wgGender').querySelectorAll('button'), function (b) {
      b.addEventListener('click', function () { setGender(b.getAttribute('data-g')); showError(''); });
    });
    $('wgSubmit').addEventListener('click', submit);
    el.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target && e.target.tagName !== 'BUTTON') { e.preventDefault(); submit(); }
    });
  }

  /* ---------------------------- التحقق من المشرف العام ---------------------------- */
  // نستخدم عميلاً مؤقتاً (بدون حفظ جلسة) حتى لا نغيّر هوية العميل الذي يقرأ بيانات الفصول.
  async function verifyAdmin(email, password) {
    if (!(window.supabase && window.supabase.createClient) || typeof SUPABASE_URL === 'undefined') {
      throw new Error('تعذر تحميل خدمة الاتصال — تحقق من الإنترنت ثم أعد المحاولة');
    }
    var c = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    var res = await c.auth.signInWithPassword({ email: email, password: password });
    if (res.error) {
      var bad = res.error.status === 400 || /invalid login/i.test(res.error.message || '');
      throw new Error(bad ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة' : 'تعذر الاتصال — تحقق من الإنترنت ثم أعد المحاولة');
    }
    // نفس ما تقرأه لوحة المشرفين: سجلات كل الفصول
    var probe = await c.from('class_records').select('class_id').limit(1);
    try { await c.auth.signOut(); } catch (e) {}
    if (probe.error) throw new Error('هذا الحساب لا يملك صلاحية المشرف العام');
    return res.data.user;
  }

  async function submit() {
    showError('');
    if (mode === 'servant') {
      var name = $('wgName').value.trim().replace(/\s+/g, ' ');
      var stage = $('wgStage').value;
      if (name.length < 2) return showError('من فضلك اكتب اسمك');
      if (!stage) return showError('من فضلك اختر السنة التي ستخدم فيها');
      if (!gender) return showError('من فضلك اختر بنين أم بنات');
      profile = { name: name, stage: stage, gender: gender, at: new Date().toISOString() };
      writeJSON(localStorage, PROFILE_KEY, profile);
      admin = null;
      try { sessionStorage.removeItem(ADMIN_KEY); } catch (e) {}
      finish('👋 أهلاً ' + name);
      return;
    }
    // مشرف عام
    var email = $('wgEmail').value.trim();
    var pass = $('wgPass').value;
    if (!email || !pass) return showError('من فضلك أدخل البريد الإلكتروني وكلمة المرور');
    busy(true, 'جاري التحقق...');
    try {
      var user = await verifyAdmin(email, pass);
      admin = { email: (user && user.email) || email, name: $('wgAdminName').value.trim() };
      writeJSON(sessionStorage, ADMIN_KEY, admin);
      try { localStorage.setItem(ADMIN_EMAIL_KEY, email); } catch (e) {}
      $('wgPass').value = '';
      busy(false);
      finish('🛡️ أهلاً ' + adminName() + ' — تظهر لك كل الفصول');
    } catch (e) {
      busy(false);
      showError(e && e.message ? e.message : 'تعذر التحقق، حاول مرة أخرى');
    }
  }

  function finish(msg) {
    try { sessionStorage.removeItem(CHAPTER_SESSION); } catch (e) {}
    hide();
    applyRole();
    if (typeof showToast === 'function') { try { showToast(msg); } catch (e) {} }
  }

  /* ---------------------------- إظهار / إخفاء ---------------------------- */
  function show() {
    build();
    el.classList.remove('wg-hide');
    document.body.style.overflow = 'hidden';
    setTimeout(function () {
      var f = mode === 'admin' ? $('wgEmail') : $('wgName');
      if (f && !f.value) { try { f.focus(); } catch (e) {} }
    }, 150);
  }
  function hide() {
    if (el) el.classList.add('wg-hide');
    document.body.style.overflow = '';
  }

  /* ---------------------------- شريط المستخدم ---------------------------- */
  function label() {
    if (admin) return adminName() + ' — مشرف عام (كل الفصول)';
    return profile ? (profile.name + ' — ' + stageName() + ' — ' + genderName()) : '';
  }

  function changeUser() {
    var msg = admin ? 'هل تريد تسجيل الخروج من حساب المشرف العام؟' : 'هل تريد تغيير بياناتك (الاسم / السنة / بنين-بنات)؟';
    if (!confirm(msg)) return;
    try {
      sessionStorage.removeItem(ADMIN_KEY);
      sessionStorage.removeItem(CHAPTER_SESSION);
      sessionStorage.setItem(FORCE_KEY, '1');
    } catch (e) {}
    location.reload();
  }

  function initialOf(name) {
    var t = String(name || '').trim();
    return t ? Array.from(t)[0] : '👤';
  }

  function renderBars() {
    var r = role();
    var isGirls = r === 'servant' && profile && profile.gender === 'girls';
    var nm = r === 'admin' ? adminName() : (profile ? profile.name : '');

    var card = document.querySelector('#chapterGate .gate-card');
    if (card) {
      var bar = $('wgUserBar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'wgUserBar';
        card.insertBefore(bar, card.firstChild);
      }
      bar.className = r === 'admin' ? 'admin' : (isGirls ? 'girls' : '');
      bar.style.display = r ? 'flex' : 'none';
      if (r) {
        var chips = r === 'admin'
          ? '<span class="wg-chip admin">🛡️ مشرف عام</span><span class="wg-chip">📚 كل الفصول</span>'
          : '<span class="wg-chip">📚 ' + esc(stageName()) + '</span>' +
            '<span class="wg-chip ' + (isGirls ? 'girls' : 'boys') + '">' + (isGirls ? '👧 ' : '👦 ') + esc(genderName()) + '</span>';
        bar.innerHTML =
          '<div class="wg-av">' + (r === 'admin' ? '🛡️' : esc(initialOf(nm))) + '</div>' +
          '<div class="wg-info">' +
            '<div class="wg-hi">' + (r === 'admin' ? 'مسجّل الدخول كـ' : 'أهلاً بك 👋') + '</div>' +
            '<div class="wg-name">' + esc(nm) + '</div>' +
            '<div class="wg-chips">' + chips + '</div>' +
          '</div>' +
          '<button type="button" class="wg-btn" id="wgChangeBtn">' +
            (r === 'admin' ? '🚪 تسجيل الخروج' : '✏️ تغيير بياناتي') + '</button>';
        $('wgChangeBtn').addEventListener('click', changeUser);
      }
    }
    var hdr = document.querySelector('.header > div:last-child');
    if (hdr) {
      var hb = $('wgHeaderUser');
      if (!hb) {
        hb = document.createElement('button');
        hb.id = 'wgHeaderUser';
        hb.type = 'button';
        hb.className = 'switch-chapter-btn';
        hb.addEventListener('click', changeUser);
        hdr.insertBefore(hb, hdr.firstChild);
      }
      hb.style.display = r ? '' : 'none';
      hb.className = 'switch-chapter-btn ' + (r === 'admin' ? 'admin' : (isGirls ? 'girls' : ''));
      hb.title = r === 'admin' ? 'تسجيل الخروج من المشرف العام' : 'تغيير بياناتي';
      hb.innerHTML = '<span class="wg-hav">' + (r === 'admin' ? '🛡️' : esc(initialOf(nm))) + '</span>' +
        '<span class="wg-hname">' + esc(nm) + '</span><span class="wg-hedit">✏️</span>';
    }
  }

  function applyRole() {
    var r = role();
    document.body.classList.toggle('role-servant', r === 'servant');
    document.body.classList.toggle('role-admin', r === 'admin');
    if (r === 'servant') {
      try { _genderFilter = profile.gender; _stageFilter = 'all'; } catch (e) {}
    }
    renderBars();
    if (typeof renderChapterCards === 'function' && typeof _chaptersCache !== 'undefined' && _chaptersCache.length) {
      try { renderChapterCards(); } catch (e) {}
    }
  }

  /* ---------------------------- ربط مع باقي النظام ---------------------------- */
  // المشرف العام يدخل أي فصل مباشرة دون كلمة سر الفصل
  var _origOpenPass = window.openChapterPasswordModal;
  if (typeof _origOpenPass === 'function') {
    window.openChapterPasswordModal = function (chapterId) {
      if (role() === 'admin') {
        var ch = (_chaptersCache || []).find(function (c) { return String(c.chapter_id) === String(chapterId); });
        return unlockChapter(String(chapterId), ch ? ch.chapter_name : '');
      }
      return _origOpenPass.apply(this, arguments);
    };
  }

  // الخادم عند إضافة فصل جديد: نملأ المرحلة والفئة من بياناته
  var _origAddChapter = window.openAddChapterModal;
  if (typeof _origAddChapter === 'function') {
    window.openAddChapterModal = function () {
      var out = _origAddChapter.apply(this, arguments);
      if (role() === 'servant' && profile) {
        try { populateStageSelect(profile.stage); setEditGender(profile.gender); } catch (e) {}
      }
      return out;
    };
  }

  window.WelcomeGate = {
    role: role,
    actor: actor,
    summary: summary,
    chapterAllowed: chapterAllowed,
    isLoading: isLoading,
    profile: function () { return profile; },
    change: changeUser,
    open: show
  };

  /* ---------------------------- التشغيل ---------------------------- */
  if (!role()) {
    // لا نترك فصلاً مفتوحاً من جلسة سابقة خلف صفحة الترحيب
    try { sessionStorage.removeItem(CHAPTER_SESSION); } catch (e) {}
  }
  applyRole();
  if (!role() || forceOpen) show();
})();
