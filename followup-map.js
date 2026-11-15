/* =====================================================================
   🗺️ خريطة الافتقاد
   - تعرض المخدومين المطلوب افتقادهم على خريطة مرسومة (تعمل بدون إنترنت)
   - ترتّب الزيارات بحيث تكون المحطات المتقاربة متتالية (أقصر مسار تقريبي)
   - تقسّم المسار على أكثر من خادم عند الحاجة
   - تفتح المسار كاملًا في خرائط جوجل
   تعتمد على المتغيرات العامة: students, attendance, followupStore
   وعلى الدوال: getStudentAbsenceCount, getFollowupData, toggleFollowupDone
   ===================================================================== */
(function () {
  'use strict';

  var FM = {
    start: 'urgent',       // urgent = من الأكثر غيابًا | me = من موقعي الحالي
    me: null,              // {lat, lng}
    groups: 1,
    includeDone: false,
    route: [],             // المحطات مرتبة
    noLoc: []              // من ليس لهم إحداثيات
  };
  var GROUP_COLORS = ['#2980b9', '#c8392b', '#1a7a4a', '#8e44ad', '#d4a017', '#e67e22'];

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, kind) {
    if (typeof qrToast === 'function') qrToast(msg, kind);
    else alert(msg);
  }
  function num(v) { return (v === null || v === undefined || v === '') ? NaN : Number(v); }
  function validLL(lat, lng) {
    return isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  }
  function hasLL(p) { return p && validLL(num(p.lat), num(p.lng)); }

  // المسافة بين نقطتين بالكيلومتر (خط مستقيم)
  function km(a, b) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function fmtKm(d) {
    if (d < 0.95) return Math.max(50, Math.round(d * 1000 / 50) * 50) + ' م';
    return (Math.round(d * 10) / 10).toString().replace('.', '٫') + ' كم';
  }

  // ---------- جمع المخدومين المطلوب افتقادهم (نفس شروط جدول الافتقاد) ----------
  function collect() {
    var minEl = document.getElementById('followupMinAbsence');
    var min = parseInt(minEl && minEl.value, 10) || 2;
    var data = getFollowupData();
    var list = students.map(function (s) {
      return {
        s: s,
        id: s.id,
        name: s.name,
        abs: getStudentAbsenceCount(s.id),
        done: !!(data[s.id] && data[s.id].done),
        lat: num(s.lat), lng: num(s.lng)
      };
    }).filter(function (x) {
      return x.abs >= min && (FM.includeDone || !x.done);
    });
    FM.route = [];
    FM.noLoc = [];
    var located = [];
    list.forEach(function (x) { (hasLL(x.s) ? located : FM.noLoc).push(x); });
    FM.noLoc.sort(function (a, b) { return b.abs - a.abs; });
    return located;
  }

  // ---------- ترتيب المسار: أقرب جار + تحسين 2-opt ----------
  function buildRoute(points) {
    if (!points.length) return [];
    var startPt, pool = points.slice();
    var order = [];

    if (FM.start === 'me' && FM.me) {
      startPt = FM.me;
    } else {
      // نبدأ من الأكثر غيابًا (وعند التساوي الأقدم في القائمة)
      pool.sort(function (a, b) { return b.abs - a.abs; });
      var first = pool.shift();
      order.push(first);
      startPt = first;
    }
    var cur = startPt;
    while (pool.length) {
      var bi = 0, bd = Infinity;
      for (var i = 0; i < pool.length; i++) {
        var d = km(cur, pool[i]);
        if (d < bd) { bd = d; bi = i; }
      }
      cur = pool.splice(bi, 1)[0];
      order.push(cur);
    }

    // تحسين 2-opt للمسار المفتوح (للأعداد الصغيرة والمتوسطة)
    if (order.length > 3 && order.length <= 60) {
      var path = (FM.start === 'me' && FM.me) ? [FM.me].concat(order) : order.slice();
      var improved = true, guard = 0;
      while (improved && guard++ < 40) {
        improved = false;
        for (var a = 0; a < path.length - 2; a++) {
          for (var b = a + 2; b < path.length; b++) {
            var before = km(path[a], path[a + 1]) + (b + 1 < path.length ? km(path[b], path[b + 1]) : 0);
            var after = km(path[a], path[b]) + (b + 1 < path.length ? km(path[a + 1], path[b + 1]) : 0);
            if (after + 1e-9 < before) {
              var seg = path.slice(a + 1, b + 1).reverse();
              path = path.slice(0, a + 1).concat(seg, path.slice(b + 1));
              improved = true;
            }
          }
        }
      }
      order = (FM.start === 'me' && FM.me) ? path.slice(1) : path;
    }

    // المسافات من المحطة السابقة + تقسيم على الخدام
    var total = 0, prev = (FM.start === 'me' && FM.me) ? FM.me : null;
    order.forEach(function (x, i) {
      x.leg = prev ? km(prev, x) : 0;
      total += x.leg;
      prev = x;
      x.n = i + 1;
    });
    var g = Math.max(1, Math.min(FM.groups, order.length));
    var per = Math.ceil(order.length / g);
    order.forEach(function (x, i) { x.g = Math.min(g - 1, Math.floor(i / per)); });
    order.total = total;
    return order;
  }

  // ---------- رسم الخريطة (SVG) ----------
  function renderSvg() {
    var pts = FM.route;
    if (!pts.length) return '';
    var all = pts.map(function (p) { return { lat: p.lat, lng: p.lng }; });
    if (FM.start === 'me' && FM.me) all.push(FM.me);
    var minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    all.forEach(function (p) {
      minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
      minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
    });
    var midLat = (minLat + maxLat) / 2;
    var kx = Math.cos(midLat * Math.PI / 180);
    var W = 600, H = 360, pad = 34;
    var spanX = Math.max((maxLng - minLng) * kx, 0.002), spanY = Math.max(maxLat - minLat, 0.002);
    var sc = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);
    var offX = (W - spanX * sc) / 2, offY = (H - spanY * sc) / 2;
    function X(lng) { return offX + (lng - minLng) * kx * sc; }
    function Y(lat) { return offY + (maxLat - lat) * sc; }

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block;background:#eef3f7;border-radius:12px;border:1px solid #d6e4ef;" direction="ltr">';
    // شبكة خفيفة
    for (var gx = 1; gx < 6; gx++) svg += '<line x1="' + (W / 6 * gx) + '" y1="0" x2="' + (W / 6 * gx) + '" y2="' + H + '" stroke="#dde7ef" stroke-width="1"/>';
    for (var gy = 1; gy < 4; gy++) svg += '<line x1="0" y1="' + (H / 4 * gy) + '" x2="' + W + '" y2="' + (H / 4 * gy) + '" stroke="#dde7ef" stroke-width="1"/>';

    // خطوط المسار لكل مجموعة
    var prev = (FM.start === 'me' && FM.me) ? FM.me : null;
    pts.forEach(function (p, i) {
      var from = prev;
      if (from) {
        var newGroup = i > 0 && pts[i - 1].g !== p.g;
        svg += '<line x1="' + X(from.lng) + '" y1="' + Y(from.lat) + '" x2="' + X(p.lng) + '" y2="' + Y(p.lat) +
               '" stroke="' + GROUP_COLORS[p.g % GROUP_COLORS.length] + '" stroke-width="2.5" stroke-linecap="round"' +
               (newGroup ? ' stroke-dasharray="2 7" opacity="0.45"' : ' opacity="0.85"') + '/>';
      }
      prev = p;
    });

    // نقطة البداية (موقعي)
    if (FM.start === 'me' && FM.me) {
      svg += '<circle cx="' + X(FM.me.lng) + '" cy="' + Y(FM.me.lat) + '" r="9" fill="#0d1117"/>' +
             '<text x="' + X(FM.me.lng) + '" y="' + (Y(FM.me.lat) + 4) + '" text-anchor="middle" font-size="11" fill="#fff" font-weight="700">أنا</text>';
    }
    // المحطات
    pts.forEach(function (p) {
      var col = p.done ? '#9aa5b1' : (p.abs >= 5 ? '#c8392b' : p.abs >= 3 ? '#d4a017' : '#1a7a4a');
      var gc = GROUP_COLORS[p.g % GROUP_COLORS.length];
      svg += '<g><circle cx="' + X(p.lng) + '" cy="' + Y(p.lat) + '" r="13" fill="' + col + '" stroke="' + gc + '" stroke-width="3.5"/>' +
             '<text x="' + X(p.lng) + '" y="' + (Y(p.lat) + 4.5) + '" text-anchor="middle" font-size="12.5" fill="#fff" font-weight="800">' + p.n + '</text></g>';
    });
    svg += '</svg>';
    return svg;
  }

  // ---------- روابط خرائط جوجل ----------
  function ll(p) { return p.lat + ',' + p.lng; }
  // جوجل يقبل حتى 9 محطات وسيطة؛ نقسم المسار إلى أجزاء كل جزء 10 محطات
  function routeLinks(list) {
    var out = [], CH = 10;
    for (var i = 0; i < list.length; i += CH) {
      var part = list.slice(i, i + CH);
      var dest = part[part.length - 1];
      var way = part.slice(0, -1).map(ll).join('|');
      var url = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(ll(dest));
      if (i === 0 && FM.start === 'me' && FM.me) url += '&origin=' + encodeURIComponent(ll(FM.me));
      else if (i > 0) url += '&origin=' + encodeURIComponent(ll(list[i - 1]));
      if (way) url += '&waypoints=' + encodeURIComponent(way);
      out.push({ from: part[0].n, to: dest.n, url: url });
    }
    return out;
  }

  function phoneOf(s) { return s.phone || s.phone2 || s.ownPhone || ''; }

  // ---------- بناء الواجهة ----------
  function ensureModal() {
    if (document.getElementById('fuMapOverlay')) return;
    var st = document.createElement('style');
    st.textContent =
      '#fuMapOverlay{z-index:195}' +
      '.fum-modal{max-width:760px!important;padding:20px!important}' +
      '.fum-bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}' +
      '.fum-bar select,.fum-bar label{font-family:Cairo,sans-serif;font-size:12.5px;font-weight:700}' +
      '.fum-bar select{padding:7px 9px;border:1.5px solid var(--line);border-radius:8px;background:#fff}' +
      '.fum-btn{font-family:Cairo,sans-serif;font-size:12.5px;font-weight:800;padding:8px 12px;border-radius:9px;border:1.5px solid var(--accent2);background:#fff;color:var(--accent2);cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:5px}' +
      '.fum-btn.pri{background:var(--accent2);color:#fff}' +
      '.fum-btn.ok{background:var(--green);border-color:var(--green);color:#fff}' +
      '.fum-sum{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}' +
      '.fum-chip{background:#fff;border:1px solid var(--line);border-radius:20px;padding:4px 12px;font-size:12px;font-weight:700}' +
      '.fum-legend{font-size:11.5px;color:#666;margin:6px 0 10px;line-height:1.9}' +
      '.fum-stop{display:flex;gap:10px;align-items:flex-start;background:#fff;border:1px solid var(--line);border-right-width:5px;border-radius:10px;padding:10px;margin-top:8px}' +
      '.fum-stop.done{opacity:.6}' +
      '.fum-num{min-width:28px;height:28px;border-radius:50%;color:#fff;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center}' +
      '.fum-info{flex:1;min-width:0}' +
      '.fum-name{font-weight:800;font-size:14px}' +
      '.fum-meta{font-size:11.5px;color:#666;margin-top:2px;line-height:1.7}' +
      '.fum-acts{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}' +
      '.fum-acts .fum-btn{padding:5px 9px;font-size:12px}' +
      '.fum-gh{font-weight:900;font-size:13px;margin:14px 0 2px;display:flex;align-items:center;gap:6px}' +
      '.fum-empty{text-align:center;color:#888;padding:22px;font-size:13px}';
    document.head.appendChild(st);

    var ov = document.createElement('div');
    ov.className = 'overlay';
    ov.id = 'fuMapOverlay';
    ov.innerHTML =
      '<div class="modal fum-modal">' +
        '<h2>🗺️ خريطة الافتقاد</h2>' +
        '<div class="fum-bar">' +
          '<label>🚩 ابدأ من:</label>' +
          '<select id="fumStart" onchange="fuMapSetStart(this.value)">' +
            '<option value="urgent">الأكثر غيابًا</option>' +
            '<option value="me">موقعي الحالي</option>' +
          '</select>' +
          '<label>👥 عدد الخدام:</label>' +
          '<select id="fumGroups" onchange="fuMapSetGroups(this.value)">' +
            '<option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option><option value="6">6</option>' +
          '</select>' +
          '<label style="display:flex;align-items:center;gap:5px;"><input type="checkbox" id="fumDone" onchange="fuMapSetDone(this.checked)"> إظهار من تم افتقادهم</label>' +
        '</div>' +
        '<div id="fumBody"></div>' +
        '<div class="modal-actions"><button class="btn btn-outline" onclick="closeFollowupMap()">إغلاق</button></div>' +
      '</div>';
    ov.addEventListener('click', function (e) { if (e.target === ov) closeFollowupMap(); });
    document.body.appendChild(ov);
  }

  function render() {
    var body = document.getElementById('fumBody');
    if (!body) return;
    var located = collect();
    FM.route = buildRoute(located);
    var route = FM.route;
    var html = '';

    if (!route.length && !FM.noLoc.length) {
      body.innerHTML = '<div class="fum-empty">🎉 لا يوجد مخدومون مطلوب افتقادهم حاليًا بحسب الفلاتر الحالية.</div>';
      return;
    }

    if (route.length) {
      var total = route.total || 0;
      html += '<div class="fum-sum">' +
        '<span class="fum-chip">📍 ' + route.length + ' محطة</span>' +
        (total ? '<span class="fum-chip">🛣️ حوالي ' + fmtKm(total) + ' (خط مستقيم)</span>' : '') +
        (FM.noLoc.length ? '<span class="fum-chip" style="border-color:#e67e22;color:#b45309;">⚠️ ' + FM.noLoc.length + ' بدون موقع</span>' : '') +
        '</div>';
      html += renderSvg();
      html += '<div class="fum-legend"><span style="color:#c8392b">●</span> غياب 5 فأكثر &nbsp; <span style="color:#d4a017">●</span> 3–4 &nbsp; <span style="color:#1a7a4a">●</span> أقل &nbsp; <span style="color:#9aa5b1">●</span> تم افتقاده &nbsp;— الإطار الخارجي يدل على الخادم/المجموعة. المسافات تقريبية بخط مستقيم وليست طريق السير الفعلي.</div>';

      var g = Math.max(1, Math.min(FM.groups, route.length));
      for (var gi = 0; gi < g; gi++) {
        var items = route.filter(function (x) { return x.g === gi; });
        if (!items.length) continue;
        var col = GROUP_COLORS[gi % GROUP_COLORS.length];
        var links = routeLinks(items);
        if (g > 1) {
          html += '<div class="fum-gh"><span style="width:12px;height:12px;border-radius:50%;background:' + col + ';display:inline-block"></span> الخادم ' + (gi + 1) + ' — ' + items.length + ' محطة</div>';
        }
        html += '<div class="fum-acts" style="margin:6px 0 0;">' + links.map(function (l, k) {
          var label = links.length > 1 ? ('🧭 المحطات ' + l.from + '–' + l.to + ' في جوجل') : '🧭 فتح المسار كاملًا في خرائط جوجل';
          return '<a class="fum-btn pri" target="_blank" rel="noopener" href="' + esc(l.url) + '">' + label + '</a>';
        }).join('') + '</div>';
        items.forEach(function (x) {
          var s = x.s, ph = phoneOf(s).replace(/\D/g, '');
          var dir = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(ll(x));
          html += '<div class="fum-stop' + (x.done ? ' done' : '') + '" style="border-right-color:' + col + '">' +
            '<div class="fum-num" style="background:' + col + '">' + x.n + '</div>' +
            '<div class="fum-info">' +
              '<div class="fum-name">' + esc(x.name) + '</div>' +
              '<div class="fum-meta">❌ ' + x.abs + ' غياب' +
                (x.leg ? ' • ' + fmtKm(x.leg) + (x.n === 1 ? ' من موقعك' : ' عن المحطة السابقة') : '') +
                (s.address ? '<br>🏠 ' + esc(s.address) : '') + '</div>' +
              '<div class="fum-acts">' +
                '<a class="fum-btn" target="_blank" rel="noopener" href="' + esc(dir) + '">🧭 الاتجاهات</a>' +
                (ph ? '<a class="fum-btn" href="tel:' + esc(phoneOf(s)) + '">📞 اتصال</a>' : '') +
                '<button class="fum-btn ' + (x.done ? '' : 'ok') + '" onclick="fuMapToggleDone(\'' + String(x.id).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\')">' + (x.done ? '↩️ إلغاء "تم"' : '✅ تم الافتقاد') + '</button>' +
              '</div>' +
            '</div></div>';
        });
      }
    }

    if (FM.noLoc.length) {
      html += '<div class="fum-gh" style="color:#b45309;margin-top:18px;">⚠️ مخدومون بدون موقع محدد (' + FM.noLoc.length + ')</div>' +
              '<div class="fum-meta">لا يمكن إدخالهم في المسار. أضف موقعهم من زر التعديل ✏️ (استخدم موقعي الحالي أو الصق رابط الخريطة).</div>';
      FM.noLoc.forEach(function (x) {
        var s = x.s, link = '';
        if (s.mapUrl && /^https?:\/\//i.test(s.mapUrl)) link = s.mapUrl;
        else if (s.address) link = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(s.address);
        html += '<div class="fum-stop' + (x.done ? ' done' : '') + '" style="border-right-color:#e67e22">' +
          '<div class="fum-info"><div class="fum-name">' + esc(x.name) + '</div>' +
          '<div class="fum-meta">❌ ' + x.abs + ' غياب' + (s.address ? ' • 🏠 ' + esc(s.address) : ' • لا يوجد عنوان') + '</div>' +
          '<div class="fum-acts">' +
            (link ? '<a class="fum-btn" target="_blank" rel="noopener" href="' + esc(link) + '">📍 فتح في الخرائط</a>' : '') +
            (phoneOf(s) ? '<a class="fum-btn" href="tel:' + esc(phoneOf(s)) + '">📞 اتصال</a>' : '') +
          '</div></div></div>';
      });
    }
    body.innerHTML = html;
  }

  // ---------- واجهة عامة ----------
  window.openFollowupMap = function () {
    ensureModal();
    document.getElementById('fumStart').value = FM.start;
    document.getElementById('fumGroups').value = String(FM.groups);
    document.getElementById('fumDone').checked = FM.includeDone;
    document.getElementById('fuMapOverlay').classList.add('active');
    render();
  };
  window.closeFollowupMap = function () {
    var o = document.getElementById('fuMapOverlay');
    if (o) o.classList.remove('active');
  };
  window.fuMapSetGroups = function (v) { FM.groups = parseInt(v, 10) || 1; render(); };
  window.fuMapSetDone = function (v) { FM.includeDone = !!v; render(); };
  window.fuMapSetStart = function (v) {
    if (v !== 'me') { FM.start = 'urgent'; render(); return; }
    if (!navigator.geolocation) {
      toast('⚠️ المتصفح لا يدعم تحديد الموقع', 'err');
      document.getElementById('fumStart').value = 'urgent';
      return;
    }
    toast('⏳ جاري تحديد موقعك...');
    navigator.geolocation.getCurrentPosition(function (pos) {
      FM.me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      FM.start = 'me';
      render();
    }, function (err) {
      FM.start = 'urgent';
      document.getElementById('fumStart').value = 'urgent';
      toast('⚠️ ' + (err && err.code === 1 ? 'لم يُسمح بالوصول للموقع — فعّله من إعدادات المتصفح' : 'تعذر تحديد الموقع'), 'err');
      render();
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  };
  window.fuMapToggleDone = function (id) {
    toggleFollowupDone(id);   // تسجّل الاسم والنشاط وتعيد رسم جدول الافتقاد
    render();
  };
})();
