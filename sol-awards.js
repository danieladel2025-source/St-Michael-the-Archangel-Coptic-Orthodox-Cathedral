/**
 * 🏅 sol-awards.js — النياشين والمستويات والمميزون (امتداد لمنظومة أبناء النور)
 * يُحمَّل بعد sol-features.js ولا يغيّر شكل البيانات القديمة (الأوسمة/النقاط تبقى كما هي).
 */
(function (w) {
  'use strict';
  const SOL = w.SOL;
  if (!SOL) return;

  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Date().toISOString().split('T')[0];
  const studs = () => w.students || [];
  const find = (id) => studs().find(x => x.id === id);

  // ---------- المستويات (النياشين) حسب مجموع النقاط ----------
  const LEVELS = [
    { min: 0,   name: 'مبتدئ',        icon: '🌱', color: '#64748b' },
    { min: 60,  name: 'نيشان برونزي', icon: '🥉', color: '#b45309' },
    { min: 150, name: 'نيشان فضي',    icon: '🥈', color: '#475569' },
    { min: 300, name: 'نيشان ذهبي',   icon: '🥇', color: '#b8860b' },
    { min: 500, name: 'نيشان النور',  icon: '👑', color: '#7c3aed' }
  ];
  SOL.LEVELS = LEVELS;
  SOL.getLevel = function (pts) {
    pts = pts || 0;
    let i = 0;
    LEVELS.forEach((l, k) => { if (pts >= l.min) i = k; });
    return { cur: LEVELS[i], next: LEVELS[i + 1] || null, index: i };
  };

  // ---------- أوسمة جديدة (تُضاف مرة واحدة فقط إن لم تكن موجودة) ----------
  const EXTRA_BADGES = [
    { id: 'b_streak4', name: 'مواظب ٤ جمعات', icon: '📅', points: 40, desc: 'حضور ٤ جمعات متتالية' },
    { id: 'b_streak8', name: 'مواظب ٨ جمعات', icon: '🔥', points: 80, desc: 'حضور ٨ جمعات متتالية' },
    { id: 'b_mass4',   name: 'محب القداس',    icon: '🕯️', points: 35, desc: 'حضور ٤ قداسات أو أكثر' },
    { id: 'b_confess', name: 'صديق الاعتراف', icon: '✝️', points: 30, desc: 'مواظبة على سر الاعتراف' }
  ];
  function ensureBadges() {
    EXTRA_BADGES.forEach(b => { if (!SOL.badgesList.some(x => x.id === b.id)) SOL.badgesList.push(Object.assign({}, b)); });
  }
  ensureBadges();
  const _init = SOL.initFromSnapshot;
  SOL.initFromSnapshot = function (snap) { _init.call(SOL, snap); ensureBadges(); };

  // ---------- شارات صغيرة تظهر بجانب اسم المخدوم ----------
  SOL.badgeChips = function (s, max) {
    if (!s) return '';
    max = max || 4;
    const ids = Array.isArray(s.badges) ? s.badges : [];
    const lv = SOL.getLevel(s.points).cur;
    const items = ids.map(id => SOL.badgesList.find(b => b.id === id)).filter(Boolean);
    if (!items.length && !(s.points > 0)) return '';
    const shown = items.slice(0, max).map(b => `<span title="${esc(b.name)}" style="font-size:15px;">${esc(b.icon)}</span>`).join('');
    const more = items.length > max ? `<span style="font-size:10px;color:#7c3aed;font-weight:800;">+${items.length - max}</span>` : '';
    const lvl = lv.min > 0 ? `<span style="background:${lv.color};color:#fff;border-radius:10px;padding:1px 7px;font-size:10px;font-weight:800;">${lv.icon} ${lv.name}</span>` : '';
    return `<div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;margin-top:3px;">${lvl}${shown}${more}</div>`;
  };

  // ---------- منح/سحب الوسام مع تسجيل التاريخ دون إغلاق نوافذ أخرى ----------
  SOL.toggleBadge = function (studentId, badgeId) {
    const s = find(studentId);
    if (!s) return;
    if (!Array.isArray(s.badges)) s.badges = [];
    if (!s.badgeDates) s.badgeDates = {};
    const badge = SOL.badgesList.find(b => b.id === badgeId);
    const idx = s.badges.indexOf(badgeId);
    if (idx !== -1) {
      s.badges.splice(idx, 1);
      delete s.badgeDates[badgeId];
      if (badge) SOL.addPoints(studentId, -badge.points, 'إلغاء وسام: ' + badge.name);
    } else {
      s.badges.push(badgeId);
      s.badgeDates[badgeId] = today();
      if (badge) SOL.addPoints(studentId, badge.points, 'الحصول على وسام: ' + badge.name);
    }
    if (typeof w.save === 'function') w.save();
    document.querySelectorAll('.overlay.active').forEach(o => { if (o.textContent.includes('أوسمة وشارات —')) o.remove(); });
    SOL.openBadgesModal(studentId);
  };

  // ---------- تنبيه عند الترقي لمستوى أعلى ----------
  const _add = SOL.addPoints;
  SOL.addPoints = function (studentId, amount, reason) {
    const s = find(studentId);
    const before = s ? SOL.getLevel(s.points).index : 0;
    _add.call(SOL, studentId, amount, reason);
    if (s && amount > 0) {
      const after = SOL.getLevel(s.points);
      if (after.index > before && typeof w.showToast === 'function') {
        w.showToast(`🎊 ${s.name} ترقّى إلى ${after.cur.icon} ${after.cur.name}`);
      }
    }
  };

  // ---------- فحص الاستحقاق التلقائي من بيانات الحضور ----------
  function recentFridayStreak(id) {
    const att = w.attendance || {};
    const dates = Object.keys(att).filter(d => typeof w.isFridayDate === 'function' ? w.isFridayDate(d) : true).sort().reverse();
    let n = 0;
    for (const d of dates) {
      const v = att[d] && att[d][id];
      if (v === 'present' || v === 'late') n++;
      else if (v === 'absent') break;
      // أيام بلا تسجيل لهذا المخدوم لا تكسر السلسلة ولا تزيدها
    }
    return n;
  }
  SOL.scanEligible = function () {
    const out = [];
    const ms = w.massAttendance || {}, cf = w.confessions || {};
    studs().forEach(s => {
      const has = new Set(s.badges || []);
      const st = recentFridayStreak(s.id);
      const add = (badgeId, why) => { if (!has.has(badgeId)) out.push({ s, badgeId, why }); };
      if (st >= 8) add('b_streak8', `حضر ${st} جمعات متتالية`);
      else if (st >= 4) add('b_streak4', `حضر ${st} جمعات متتالية`);
      if ((ms[s.id] || 0) >= 4) add('b_mass4', `حضر ${ms[s.id]} قداسات`);
      if ((cf[s.id] || 0) >= 3) add('b_confess', `اعترف ${cf[s.id]} مرات`);
    });
    return out;
  };

  function shell(inner, title) {
    document.querySelectorAll('.sol-awards-ov').forEach(o => o.remove());
    const o = document.createElement('div');
    o.className = 'overlay active sol-awards-ov';
    o.style.cssText = 'display:flex;z-index:99999;align-items:center;justify-content:center;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);position:fixed;inset:0;padding:12px;';
    o.innerHTML = `<div style="background:var(--paper,#f5f0e8);border-radius:18px;padding:20px;width:100%;max-width:640px;max-height:92vh;overflow-y:auto;direction:rtl;box-shadow:0 24px 60px rgba(0,0,0,.3);border-top:5px solid #d4a017;font-family:'Cairo',sans-serif;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
        <h2 style="font-size:19px;font-weight:900;color:#92400e;margin:0;">${title}</h2>
        <button style="background:none;border:none;font-size:22px;cursor:pointer;color:#888;" onclick="this.closest('.overlay').remove()">✕</button>
      </div>${inner}</div>`;
    document.body.appendChild(o);
  }

  const tabBtn = (id, label, cur) => `<button class="btn ${cur === id ? '' : 'btn-outline'}" style="font-size:12px;padding:6px 12px;${cur === id ? 'background:#d4a017;color:#fff;' : ''}" onclick="SOL.openAwardsCenter('${id}')">${label}</button>`;

  // ---------- مركز النياشين: المميزون / الاستحقاق / إدارة الأوسمة ----------
  SOL.openAwardsCenter = function (tab) {
    tab = tab || 'top';
    let body = '';
    if (tab === 'top') {
      const list = studs().slice().sort((a, b) => (b.points || 0) - (a.points || 0)).filter(s => (s.points || 0) > 0 || (s.badges || []).length).slice(0, 15);
      body = list.length ? list.map((s, i) => {
        const lv = SOL.getLevel(s.points);
        const need = lv.next ? `باقي ${lv.next.min - (s.points || 0)} نقطة لـ ${lv.next.icon} ${lv.next.name}` : 'وصل لأعلى مستوى 👑';
        const pct = lv.next ? Math.min(100, Math.round(((s.points || 0) - lv.cur.min) / (lv.next.min - lv.cur.min) * 100)) : 100;
        return `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px;margin-bottom:8px;${i < 3 ? 'border-color:#fcd34d;background:#fffbeb;' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
            <div><strong style="font-size:14px;">${['🥇', '🥈', '🥉'][i] || (i + 1) + '.'} ${esc(s.name)}</strong>${SOL.badgeChips(s, 6)}</div>
            <div style="text-align:center;"><div style="font-weight:900;color:#b45309;font-size:16px;">${s.points || 0}</div><div style="font-size:10px;color:#92400e;">نقطة</div></div>
          </div>
          <div style="height:6px;background:#e2e8f0;border-radius:6px;margin:8px 0 4px;overflow:hidden;"><div style="height:100%;width:${pct}%;background:${lv.cur.color};"></div></div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#64748b;">
            <span>${need}</span>
            <span><button class="btn btn-outline" style="font-size:11px;padding:3px 8px;" onclick="SOL.openBadgesModal('${s.id}')">🎖️ أوسمة</button>
            <button class="btn" style="font-size:11px;padding:3px 8px;background:#d4a017;color:#fff;" onclick="SOL.printCertificate('${s.id}')">🎓 شهادة</button></span>
          </div></div>`;
      }).join('') : '<div style="text-align:center;color:#94a3b8;padding:24px;">لا يوجد مميزون بعد — امنح نقاطًا أو أوسمة لتظهر هنا.</div>';
    } else if (tab === 'auto') {
      const el = SOL.scanEligible();
      body = `<p style="font-size:12px;color:#555;margin:0 0 10px;">يفحص الحضور والقداس والاعتراف ويقترح الأوسمة المستحقة. لن يُمنح شيء إلا بموافقتك.</p>` +
        (el.length ? `<button class="btn" style="background:#16a34a;color:#fff;font-size:12px;padding:7px 14px;margin-bottom:10px;" onclick="SOL.awardAllEligible()">✅ منح الكل (${el.length})</button>` +
          el.map((e, i) => { const b = SOL.badgesList.find(x => x.id === e.badgeId); return `<div style="display:flex;justify-content:space-between;align-items:center;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:8px 12px;margin-bottom:6px;">
            <div><strong>${esc(e.s.name)}</strong> <span style="font-size:12px;">${b ? esc(b.icon) + ' ' + esc(b.name) : ''}</span><div style="font-size:11px;color:#64748b;">${esc(e.why)}</div></div>
            <button class="btn" style="font-size:11px;padding:4px 10px;background:#8e44ad;color:#fff;" onclick="SOL.toggleBadge('${e.s.id}','${e.badgeId}');SOL.openAwardsCenter('auto')">منح</button></div>`; }).join('')
          : '<div style="text-align:center;color:#94a3b8;padding:24px;">لا يوجد مستحقون حاليًا 👍</div>');
    } else {
      body = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin-bottom:12px;">` +
        SOL.badgesList.map(b => `<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:10px;text-align:center;">
          <div style="font-size:28px;">${esc(b.icon)}</div><div style="font-weight:800;font-size:12px;">${esc(b.name)}</div>
          <div style="font-size:10px;color:#64748b;min-height:26px;">${esc(b.desc || '')}</div>
          <div style="font-size:11px;color:#9333ea;font-weight:700;">+${b.points} نقطة</div>
          <div style="margin-top:4px;"><button class="btn btn-outline" style="font-size:10px;padding:2px 8px;" onclick="SOL.editBadge('${b.id}')">تعديل</button>
          <button class="btn btn-outline" style="font-size:10px;padding:2px 8px;color:#dc2626;" onclick="SOL.deleteBadge('${b.id}')">حذف</button></div></div>`).join('') +
        `</div><button class="btn" style="background:#8e44ad;color:#fff;font-size:12px;padding:7px 14px;" onclick="SOL.editBadge()">➕ وسام جديد</button>`;
    }
    const lvLegend = LEVELS.map(l => `${l.icon} ${l.name} (${l.min}+)`).join(' • ');
    shell(`<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">${tabBtn('top', '🏆 المميزون', tab)}${tabBtn('auto', '🤖 المستحقون', tab)}${tabBtn('manage', '⚙️ إدارة الأوسمة', tab)}</div>${body}
      <div style="font-size:10px;color:#94a3b8;margin-top:10px;border-top:1px solid #e2e8f0;padding-top:8px;">المستويات: ${lvLegend}</div>`, '🏅 النياشين والمميزون');
  };

  SOL.awardAllEligible = function () {
    const el = SOL.scanEligible();
    if (!el.length || !confirm(`منح ${el.length} وسام للمستحقين؟`)) return;
    el.forEach(e => {
      const s = e.s;
      if (!Array.isArray(s.badges)) s.badges = [];
      if (s.badges.includes(e.badgeId)) return;
      const b = SOL.badgesList.find(x => x.id === e.badgeId);
      s.badges.push(e.badgeId);
      (s.badgeDates = s.badgeDates || {})[e.badgeId] = today();
      if (b) _add.call(SOL, s.id, b.points, 'الحصول على وسام: ' + b.name);
    });
    if (typeof w.save === 'function') w.save();
    if (typeof w.renderAll === 'function') w.renderAll();
    SOL.openAwardsCenter('auto');
  };

  SOL.editBadge = function (id) {
    const b = id ? SOL.badgesList.find(x => x.id === id) : null;
    const name = prompt('اسم الوسام:', b ? b.name : '');
    if (!name || !name.trim()) return;
    const icon = prompt('رمز تعبيري للوسام:', b ? b.icon : '🎖️') || '🎖️';
    const pts = parseInt(prompt('النقاط الممنوحة مع الوسام:', b ? b.points : 20), 10);
    const desc = prompt('وصف قصير (سبب الاستحقاق):', b ? b.desc : '') || '';
    const data = { name: name.trim(), icon: icon.trim(), points: isNaN(pts) ? 20 : pts, desc: desc.trim() };
    if (b) Object.assign(b, data); else SOL.badgesList.push(Object.assign({ id: 'b_custom_' + Date.now() }, data));
    if (typeof w.save === 'function') w.save();
    SOL.openAwardsCenter('manage');
  };

  SOL.deleteBadge = function (id) {
    const b = SOL.badgesList.find(x => x.id === id);
    if (!b || !confirm(`حذف الوسام "${b.name}" من القائمة؟ (لن تُسحب النقاط ممن حصلوا عليه سابقًا)`)) return;
    SOL.badgesList = SOL.badgesList.filter(x => x.id !== id);
    studs().forEach(s => { if (Array.isArray(s.badges)) s.badges = s.badges.filter(x => x !== id); });
    if (typeof w.save === 'function') w.save();
    SOL.openAwardsCenter('manage');
  };

  // ---------- شهادة تقدير قابلة للطباعة ----------
  SOL.printCertificate = function (id) {
    const s = find(id);
    if (!s) return;
    const lv = SOL.getLevel(s.points).cur;
    const items = (s.badges || []).map(x => SOL.badgesList.find(b => b.id === x)).filter(Boolean);
    const cls = typeof w.getClassName === 'function' ? w.getClassName() : '';
    const win = w.open('', '_blank');
    if (!win) { alert('اسمح بالنوافذ المنبثقة لطباعة الشهادة'); return; }
    win.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>شهادة تقدير</title>
      <style>@page{size:A4 landscape;margin:0}body{margin:0;font-family:'Cairo','Tahoma',sans-serif;text-align:center}
      .c{margin:14mm;padding:16mm 12mm;border:8px double #b8860b;min-height:150mm;background:#fffdf5}
      h1{font-size:44px;color:#92400e;margin:0 0 6px}h2{font-size:34px;margin:14px 0;color:#1e293b}
      p{font-size:18px;color:#475569;margin:8px 0}.b{font-size:22px;margin:14px 0;color:#6b21a8}.l{font-size:28px;color:${lv.color};font-weight:900}</style></head>
      <body><div class="c"><div style="font-size:50px">✝️</div><h1>شهادة تقدير</h1>
      <p>تُمنح هذه الشهادة للمخدوم المتميز</p><h2>${esc(s.name)}</h2>
      ${cls ? `<p>فصل ${esc(cls)}</p>` : ''}
      <div class="l">${lv.icon} ${lv.name} — ${s.points || 0} نقطة</div>
      ${items.length ? `<div class="b">${items.map(b => esc(b.icon) + ' ' + esc(b.name)).join(' &nbsp;•&nbsp; ')}</div>` : ''}
      <p>تقديرًا لمواظبته ونشاطه — ${new Date().toLocaleDateString('ar-EG')}</p>
      <p style="margin-top:36px">أمين الخدمة: ............................</p></div>
      <script>setTimeout(function(){window.print()},400)<\/script></body></html>`);
    win.document.close();
  };
})(window);
