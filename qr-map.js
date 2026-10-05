  // =====================================================================
  //  🔳 ميزة الحضور والغياب بالـ QR  +  📍 موقع المخدوم/الخادم على خرائط جوجل
  // =====================================================================

  // ---------- أدوات مساعدة ----------
  function qEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // نص آمن للاستخدام داخل onclick="fn('...')"
  function qJs(s) {
    return qEsc(String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"));
  }
  function qEl(id) { return document.getElementById(id); }
  function qLocalToday() {
    var n = new Date();
    return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
  }
  var _qToastTimer = null;
  function qrToast(msg, kind) {
    var t = qEl('qrToast');
    if (!t) { t = document.createElement('div'); t.id = 'qrToast'; document.body.appendChild(t); }
    t.className = 'qr-toast ' + (kind || '');
    t.textContent = msg;
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(_qToastTimer);
    _qToastTimer = setTimeout(function () { t.classList.remove('show'); }, 2800);
  }

  // ===================================================================
  //  📍 الخرائط
  // ===================================================================
  function _num(v) { return (v === null || v === undefined || v === '') ? NaN : Number(v); }
  function _validLatLng(lat, lng) {
    return isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  }

  // يقبل: رابط خرائط جوجل (طويل أو مختصر) / إحداثيات "30.78,31.00" / نص عنوان
  function parseMapInput(raw) {
    raw = String(raw || '').trim();
    if (!raw) return { mapUrl: '', lat: null, lng: null };
    var lat = NaN, lng = NaN, m;
    var coordRe = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,،]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;
    var isUrl = /^https?:\/\//i.test(raw);
    if ((m = raw.match(coordRe))) {
      lat = parseFloat(m[1]); lng = parseFloat(m[2]);
    } else if (isUrl) {
      var dec = raw;
      try { dec = decodeURIComponent(raw); } catch (e) {}
      m = dec.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/) ||
          dec.match(/[?&](?:q|query|ll|destination|center|daddr)=(-?\d+(?:\.\d+)?)[,\s+]+(-?\d+(?:\.\d+)?)/) ||
          dec.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
      if (m) { lat = parseFloat(m[1]); lng = parseFloat(m[2]); }
    }
    var hasCoords = _validLatLng(lat, lng);
    var url;
    if (isUrl) url = raw;
    else if (hasCoords) url = 'https://www.google.com/maps?q=' + lat + ',' + lng;
    else url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(raw);
    return { mapUrl: url, lat: hasCoords ? lat : null, lng: hasCoords ? lng : null };
  }
  function readMapFields(inputId) {
    var el = qEl(inputId);
    var r = parseMapInput(el ? el.value : '');
    return { mapUrl: r.mapUrl, lat: r.lat, lng: r.lng };
  }
  function _hasCoords(p) { return p && _validLatLng(_num(p.lat), _num(p.lng)); }
  function mapLink(p) {
    if (!p) return '';
    if (_hasCoords(p)) return 'https://www.google.com/maps/search/?api=1&query=' + _num(p.lat) + ',' + _num(p.lng);
    if (p.mapUrl && /^https?:\/\//i.test(p.mapUrl)) return p.mapUrl;
    return '';
  }
  function mapDirectionsLink(p) {
    return _hasCoords(p) ? 'https://www.google.com/maps/dir/?api=1&destination=' + _num(p.lat) + ',' + _num(p.lng) : '';
  }
  function mapAddressLink(addr) {
    return addr ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr) : '';
  }
  function mapActionBtn(p) {
    var l = mapLink(p);
    return l ? '<a class="action-btn" title="الموقع على خرائط جوجل" href="' + qEsc(l) + '" target="_blank" rel="noopener">📍</a>' : '';
  }

  // قسم الخريطة داخل بطاقة البيانات
  function personMapSectionHtml(p, sectionStyle) {
    var head = '<div style="' + sectionStyle + '"><span>📍</span><span>الموقع على خرائط جوجل</span></div>';
    var link = mapLink(p);
    if (_hasCoords(p)) {
      var lat = _num(p.lat), lng = _num(p.lng);
      var embed = 'https://maps.google.com/maps?q=' + lat + ',' + lng + '&z=16&output=embed';
      return head +
        '<div class="map-card">' +
          '<iframe src="' + qEsc(embed) + '" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="الموقع على الخريطة"></iframe>' +
          '<div class="map-card-actions">' +
            '<a class="map-link-btn" href="' + qEsc(link) + '" target="_blank" rel="noopener">🗺️ فتح في خرائط جوجل</a>' +
            '<a class="map-link-btn alt" href="' + qEsc(mapDirectionsLink(p)) + '" target="_blank" rel="noopener">🧭 الاتجاهات</a>' +
          '</div>' +
        '</div>';
    }
    if (link) {
      return head + '<div class="map-card"><div class="map-card-actions">' +
        '<a class="map-link-btn" href="' + qEsc(link) + '" target="_blank" rel="noopener">🗺️ فتح الموقع في خرائط جوجل</a></div></div>';
    }
    if (p && p.address) {
      return head + '<div class="map-card"><div class="map-card-actions">' +
        '<a class="map-link-btn alt" href="' + qEsc(mapAddressLink(p.address)) + '" target="_blank" rel="noopener">🔎 البحث عن العنوان في الخرائط</a></div>' +
        '<div class="qr-note" style="padding:0 12px 10px;">لم يُحدَّد موقع دقيق بعد — يمكن إضافته من زر التعديل ✏️</div></div>';
    }
    return head + '<div class="qr-note" style="text-align:right;padding:4px 8px;">— لم يُحدَّد موقع بعد، يمكن إضافته من زر التعديل ✏️</div>';
  }

  function useMyLocation(inputId) {
    if (!navigator.geolocation) { qrToast('⚠️ المتصفح لا يدعم تحديد الموقع', 'err'); return; }
    qrToast('⏳ جاري تحديد موقعك...');
    navigator.geolocation.getCurrentPosition(function (pos) {
      var lat = +pos.coords.latitude.toFixed(6), lng = +pos.coords.longitude.toFixed(6);
      var el = qEl(inputId);
      if (el) el.value = 'https://www.google.com/maps?q=' + lat + ',' + lng;
      qrToast('✅ تم أخذ موقعك الحالي — لا تنسَ الضغط على حفظ', 'ok');
    }, function (err) {
      var msg = err && err.code === 1 ? 'لم يُسمح بالوصول للموقع — فعّله من إعدادات المتصفح' : 'تعذر تحديد الموقع، جرّب مرة أخرى أو الصق الرابط يدويًا';
      qrToast('⚠️ ' + msg, 'err');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }
  function previewMapField(inputId, addressInputId) {
    var raw = (qEl(inputId) || {}).value || '';
    var r = parseMapInput(raw);
    var url = mapLink(r) || r.mapUrl;
    if (!url) {
      var a = addressInputId ? ((qEl(addressInputId) || {}).value || '').trim() : '';
      url = mapAddressLink(a);
    }
    if (!url) { qrToast('اكتب رابطًا أو إحداثيات أو عنوانًا أولًا', 'err'); return; }
    window.open(url, '_blank', 'noopener');
  }

  // ===================================================================
  //  🔳 توليد رمز QR
  // ===================================================================
  // الرمز لا يحمل أي بيانات شخصية — فقط رقم التعريف + رقم الفصل.
  // البيانات تظهر داخل النظام بعد إدخال كلمة سر الفصل.
  function qrPayload(type, key) {
    var t = type === 'servant' ? 'v' : 's';
    var c = (typeof ACTIVE_CHAPTER_ID !== 'undefined' && ACTIVE_CHAPTER_ID) ? ACTIVE_CHAPTER_ID : '';
    if (/^https?:$/.test(location.protocol)) {
      return location.origin + location.pathname + '?qr=' + t + '.' + encodeURIComponent(key) + (c ? '&c=' + encodeURIComponent(c) : '');
    }
    return 'CHQR|' + t + '|' + key + '|' + c;
  }
  function parseQrText(text) {
    text = String(text || '').trim();
    if (!text) return null;
    var m;
    if (/^https?:\/\//i.test(text)) {
      try {
        var u = new URL(text);
        var q = u.searchParams.get('qr');
        if (q) {
          var i = q.indexOf('.');
          if (i > 0) {
            var t = q.slice(0, i), id = q.slice(i + 1);
            if ((t === 's' || t === 'v') && id) return { type: t === 'v' ? 'servant' : 'student', id: id, chapter: u.searchParams.get('c') || '' };
          }
        }
      } catch (e) {}
      return null;
    }
    if (text.indexOf('CHQR|') === 0) {
      var p = text.split('|');
      if (p.length >= 4 && (p[1] === 's' || p[1] === 'v')) {
        return { type: p[1] === 'v' ? 'servant' : 'student', id: p.slice(2, p.length - 1).join('|'), chapter: p[p.length - 1] || '' };
      }
    }
    return null;
  }
  function qrDataUrl(text, cell, margin) {
    if (typeof qrcode !== 'function') throw new Error('qr-lib-missing');
    var q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createDataURL(cell || 6, margin == null ? 2 : margin);
  }
  function qrFind(type, key) {
    return type === 'servant' ? servants.find(function (x) { return x.sid === key; }) : students.find(function (x) { return x.id === key; });
  }

  // قسم الـ QR داخل بطاقة البيانات
  function qrSectionHtml(type, key, sectionStyle) {
    var head = '<div style="' + sectionStyle + '"><span>🔳</span><span>رمز QR للحضور</span></div>';
    var src = '';
    try { src = qrDataUrl(qrPayload(type, key), 6, 2); }
    catch (e) {
      return head + '<div class="qr-note">⚠️ تعذر تحميل مكتبة QR — تأكد من الاتصال بالإنترنت ثم أعد فتح البطاقة.</div>';
    }
    return head +
      '<div class="qr-card-box">' +
        '<img src="' + src + '" alt="رمز QR">' +
        '<div class="qr-card-actions">' +
          '<button type="button" class="map-mini-btn" onclick="downloadQrCard(\'' + type + '\',\'' + qJs(key) + '\')">⬇️ تحميل الصورة</button>' +
          '<button type="button" class="map-mini-btn" onclick="printQrCards([{type:\'' + type + '\',key:\'' + qJs(key) + '\'}])">🖨️ طباعة البطاقة</button>' +
        '</div>' +
        '<div class="qr-note">يحتوي الرمز على رقم التعريف فقط، وتظهر البيانات الكاملة داخل النظام بعد إدخال كلمة سر الفصل.</div>' +
      '</div>';
  }

  function downloadQrCard(type, key) {
    var p = qrFind(type, key);
    if (!p) return;
    var url;
    try { url = qrDataUrl(qrPayload(type, key), 10, 2); } catch (e) { qrToast('⚠️ تعذر إنشاء الرمز', 'err'); return; }
    var img = new Image();
    img.onload = function () {
      var W = 640, H = 840, c = document.createElement('canvas');
      c.width = W; c.height = H;
      var x = c.getContext('2d');
      x.fillStyle = '#ffffff'; x.fillRect(0, 0, W, H);
      x.strokeStyle = '#b5a98a'; x.lineWidth = 4; x.strokeRect(10, 10, W - 20, H - 20);
      x.direction = 'rtl'; x.textAlign = 'center'; x.fillStyle = '#0d1117';
      x.font = '700 28px Cairo, Arial, sans-serif';
      x.fillText(type === 'servant' ? 'خادم' : 'مخدوم', W / 2, 62);
      x.imageSmoothingEnabled = false;
      x.drawImage(img, 70, 90, 500, 500);
      var size = 44, name = String(p.name || '');
      do { x.font = '800 ' + size + 'px Cairo, Arial, sans-serif'; size -= 2; } while (x.measureText(name).width > W - 70 && size > 20);
      x.fillText(name, W / 2, 665);
      x.fillStyle = '#555'; x.font = '600 28px Cairo, Arial, sans-serif';
      x.fillText(type === 'servant' ? (p.role || '') : ('رقم المخدوم: ' + p.id), W / 2, 718);
      var cls = (typeof getClassName === 'function') ? getClassName() : '';
      if (cls) { x.fillStyle = '#888'; x.font = '600 22px Cairo, Arial, sans-serif'; x.fillText(cls.length > 48 ? cls.slice(0, 46) + '…' : cls, W / 2, 780); }
      c.toBlob(function (b) {
        if (!b) return;
        var a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = 'QR-' + String(p.name || key).replace(/[\\/:*?"<>|]+/g, '_') + '.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
      }, 'image/png');
    };
    img.src = url;
  }

  function printQrCards(items) {
    if (typeof qrcode !== 'function') { qrToast('⚠️ مكتبة QR غير محمّلة — تأكد من الإنترنت', 'err'); return; }
    var cls = qEsc((typeof getClassName === 'function' ? getClassName() : '') || '');
    var cards = items.map(function (it) {
      var p = qrFind(it.type, it.key);
      if (!p) return '';
      var src = '';
      try { src = qrDataUrl(qrPayload(it.type, it.key), 8, 2); } catch (e) { return ''; }
      var sub = it.type === 'servant' ? qEsc(p.role || 'خادم') : 'رقم: ' + qEsc(p.id);
      return '<div class="c"><div class="t">' + (it.type === 'servant' ? 'خادم' : 'مخدوم') + '</div><img src="' + src + '"><div class="n">' + qEsc(p.name) + '</div><div class="s">' + sub + '</div></div>';
    }).join('');
    if (!cards) { qrToast('لا توجد بطاقات للطباعة', 'err'); return; }
    var w = window.open('', '_blank');
    if (!w) { qrToast('⚠️ اسمح بالنوافذ المنبثقة ثم أعد المحاولة', 'err'); return; }
    w.document.write('<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>بطاقات QR</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@600;800&display=swap" rel="stylesheet">' +
      '<style>@page{size:A4;margin:8mm}*{box-sizing:border-box}body{font-family:Cairo,Arial,sans-serif;margin:0;color:#0d1117}' +
      '.hd{text-align:center;font-weight:800;font-size:14px;margin-bottom:6mm}' +
      '.g{display:grid;grid-template-columns:repeat(3,1fr);gap:4mm}' +
      '.c{border:1px dashed #999;border-radius:3mm;padding:4mm 3mm;text-align:center;break-inside:avoid;page-break-inside:avoid}' +
      '.t{font-size:11px;font-weight:800;color:#555;margin-bottom:2mm}' +
      '.c img{width:42mm;height:42mm;image-rendering:pixelated}' +
      '.n{font-size:13px;font-weight:800;line-height:1.4;margin-top:2mm;word-break:break-word}' +
      '.s{font-size:11px;color:#555;margin-top:1mm}</style></head><body>' +
      '<div class="hd">' + cls + '</div><div class="g">' + cards + '</div>' +
      '<script>setTimeout(function(){window.print()},700)<\/script></body></html>');
    w.document.close();
  }

  // نافذة اختيار من تُطبع بطاقاتهم
  function openQrPrintModal() {
    qEl('qrPrintCountStudents').textContent = students.length;
    qEl('qrPrintCountServants').textContent = servants.length;
    qEl('qrPrintOverlay').classList.add('active');
  }
  function closeQrPrintModal() { qEl('qrPrintOverlay').classList.remove('active'); }
  function doQrPrint() {
    var scope = (document.querySelector('input[name="qrPrintScope"]:checked') || {}).value || 'both';
    var items = [];
    if (scope === 'students' || scope === 'both') students.forEach(function (s) { items.push({ type: 'student', key: s.id }); });
    if (scope === 'servants' || scope === 'both') servants.forEach(function (v) { items.push({ type: 'servant', key: v.sid }); });
    if (!items.length) { qrToast('لا يوجد أشخاص لطباعة بطاقاتهم', 'err'); return; }
    closeQrPrintModal();
    printQrCards(items);
  }

  // ===================================================================
  //  📷 ماسح QR لتسجيل الحضور
  // ===================================================================
  var _qrStream = null, _qrRaf = null, _qrDetector = null, _qrFacing = 'environment';
  var _qrCanvas = null, _qrCtx = null, _qrBusy = false, _qrLastTick = 0;
  var _qrLastText = '', _qrLastAt = 0, _qrMode = 'present', _qrLast = null, _qrLog = [], _qrAudio = null;

  function qrBeep(ok) {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        _qrAudio = _qrAudio || new AC();
        if (_qrAudio.state === 'suspended') _qrAudio.resume();
        var o = _qrAudio.createOscillator(), g = _qrAudio.createGain();
        o.frequency.value = ok ? 880 : 220; g.gain.value = 0.08;
        o.connect(g); g.connect(_qrAudio.destination);
        o.start(); o.stop(_qrAudio.currentTime + 0.13);
      }
    } catch (e) {}
    try { if (navigator.vibrate) navigator.vibrate(ok ? 60 : [80, 60, 80]); } catch (e) {}
  }

  function setQrMode(m) {
    _qrMode = m === 'late' ? 'late' : 'present';
    qEl('qrModePresent').classList.toggle('active', _qrMode === 'present');
    qEl('qrModeLate').classList.toggle('active', _qrMode === 'late');
  }

  function _qrInfoOpen() {
    var a = qEl('viewOverlay'), b = qEl('viewServantOverlay');
    return !!((a && a.classList.contains('active')) || (b && b.classList.contains('active')));
  }

  function _qrCounts(list, store, keyFn, date) {
    var r = { p: 0, l: 0, a: 0, u: 0, t: list.length };
    list.forEach(function (x) {
      var st = (store[date] || {})[keyFn(x)];
      if (st === 'present') r.p++; else if (st === 'late') r.l++; else if (st === 'absent') r.a++; else r.u++;
    });
    return r;
  }

  function qrRenderPanel() {
    var date = getToday();
    var days = (typeof DAY_NAMES_AR !== 'undefined') ? DAY_NAMES_AR : ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    var d = new Date(date + 'T00:00:00');
    var dn = isNaN(d.getTime()) ? '' : days[d.getDay()];
    qEl('qrDateLine').innerHTML = '📅 تسجيل حضور يوم ' + qEsc(dn) + ' ' + qEsc(date) +
      (date !== qLocalToday() ? '<div class="qr-warn">⚠️ التاريخ المختار ليس تاريخ اليوم — غيّره من خانة التاريخ بالصفحة إن لزم</div>' : '');

    var cs = _qrCounts(students, attendance, function (x) { return x.id; }, date);
    var cv = _qrCounts(servants, servantsAttendance, function (x) { return x.sid; }, date);
    function row(label, c) {
      if (!c.t) return '<div class="qr-count-row"><b>' + label + '</b><span class="c u">لا يوجد</span></div>';
      return '<div class="qr-count-row"><b>' + label + '</b>' +
        '<span class="c p">🟢 ' + c.p + '</span><span class="c l">🟡 ' + c.l + '</span><span class="c a">🔴 ' + c.a + '</span>' +
        '<span class="c u">⚪ ' + c.u + ' لم يُسجَّل</span></div>';
    }
    qEl('qrCounts').innerHTML = row('🎓 المخدومين', cs) + row('⛪ الخدام', cv);

    var u = cs.u + cv.u;
    qEl('qrSetupBar').innerHTML = u > 0
      ? '<div class="qr-setup"><div>ℹ️ ' + u + ' شخص لم يُسجَّل لهم حضور أو غياب اليوم، والنظام يعتبرهم <b>حاضرين افتراضيًا</b>. عند انتهاء المسح (أو قبل بدئه) اضغط الزر ليُحسب من لم يُمسح غائبًا.</div>' +
        '<button type="button" class="btn" style="background:var(--accent);color:#fff;font-size:13px;padding:9px 14px;width:100%;justify-content:center;" onclick="qrMarkUnrecordedAbsent()">🔴 اعتبر غير المسجَّلين غائبين (' + u + ')</button></div>'
      : '';

    var rec = qEl('qrRecent');
    if (!_qrLog.length) { rec.innerHTML = ''; return; }
    var stLbl = { present: '✅ حاضر', late: '⏰ متأخر' };
    rec.innerHTML = '<div class="qr-recent-title">آخر عمليات المسح</div>' + _qrLog.slice(0, 6).map(function (e) {
      return '<div class="qr-recent-row"><span>' + (e.type === 'servant' ? '⛪' : '🎓') + ' ' + qEsc(e.name) + '</span><span>' +
        (e.result === 'already' ? 'مُسجَّل مسبقًا · ' : '') + (stLbl[e.status] || '') + ' · ' + qEsc(e.time) + '</span></div>';
    }).join('');
  }

  function qrMarkUnrecordedAbsent() {
    var date = getToday();
    var nS = 0, nV = 0, blocked = false;
    students.forEach(function (s) { if ((attendance[date] || {})[s.id] === undefined) nS++; });
    servants.forEach(function (v) { if ((servantsAttendance[date] || {})[v.sid] === undefined) nV++; });
    if (!nS && !nV) return;
    if (!confirm('سيتم تسجيل ' + (nS + nV) + ' شخص كغائبين (من لم يُمسح رمزهم). هل تريد المتابعة؟')) return;
    if (nS) {
      if (!isSessionEditable(date)) blocked = true;
      else {
        if (!attendance[date]) attendance[date] = {};
        students.forEach(function (s) { if (attendance[date][s.id] === undefined) attendance[date][s.id] = 'absent'; });
        touchSession(date);
      }
    }
    if (nV) {
      if (!isSessionEditable('SV_' + date)) blocked = true;
      else {
        if (!servantsAttendance[date]) servantsAttendance[date] = {};
        servants.forEach(function (v) { if (servantsAttendance[date][v.sid] === undefined) servantsAttendance[date][v.sid] = 'absent'; });
        touchSession('SV_' + date);
      }
    }
    save(); renderAll(); qrRenderPanel();
    if (blocked) qrToast('⛔ بعض الجلسات انتهت مدة تعديلها ولم تتغيّر', 'err'); else qrToast('✅ تم تسجيل غير الممسوحين كغائبين', 'ok');
  }

  async function openQrScanner() {
    qEl('qrScanOverlay').classList.add('active');
    qrRenderPanel();
    try { var AC = window.AudioContext || window.webkitAudioContext; if (AC) { _qrAudio = _qrAudio || new AC(); if (_qrAudio.state === 'suspended') _qrAudio.resume(); } } catch (e) {}
    await startQrCamera();
  }
  function closeQrScanner() {
    stopQrCamera();
    qEl('qrScanOverlay').classList.remove('active');
  }
  function stopQrCamera() {
    if (_qrRaf) { cancelAnimationFrame(_qrRaf); _qrRaf = null; }
    if (_qrStream) { _qrStream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} }); _qrStream = null; }
    var v = qEl('qrVideo'); if (v) { try { v.srcObject = null; } catch (e) {} }
  }
  function switchQrCamera() {
    _qrFacing = _qrFacing === 'environment' ? 'user' : 'environment';
    startQrCamera();
  }
  async function startQrCamera() {
    var msg = qEl('qrScanMsg'), video = qEl('qrVideo');
    stopQrCamera();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      msg.textContent = '⚠️ الكاميرا غير متاحة. افتح النظام عبر رابط https، أو استخدم الإدخال اليدوي بالأسفل.';
      return;
    }
    msg.textContent = '⏳ جاري تشغيل الكاميرا...';
    try {
      _qrStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: _qrFacing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false
      });
      video.srcObject = _qrStream;
      await video.play();
      _qrDetector = null;
      if ('BarcodeDetector' in window) { try { _qrDetector = new BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { _qrDetector = null; } }
      if (!_qrDetector && typeof jsQR !== 'function') { msg.textContent = '⚠️ مكتبة قراءة QR لم تُحمَّل — تأكد من الإنترنت ثم أعد تشغيل الكاميرا.'; return; }
      msg.textContent = 'وجّه الكاميرا نحو رمز QR';
      _qrLoop();
    } catch (e) {
      var n = e && e.name;
      msg.textContent = n === 'NotAllowedError' ? '⚠️ لم يُسمح باستخدام الكاميرا. فعّل الإذن من إعدادات المتصفح أو استخدم الإدخال اليدوي.'
        : n === 'NotFoundError' ? '⚠️ لا توجد كاميرا في هذا الجهاز. استخدم الإدخال اليدوي.'
        : '⚠️ تعذر تشغيل الكاميرا (' + (n || 'خطأ') + '). استخدم الإدخال اليدوي.';
    }
  }
  function _qrLoop() {
    _qrRaf = requestAnimationFrame(async function () {
      if (!_qrStream) return;
      var video = qEl('qrVideo'), now = performance.now();
      if (now - _qrLastTick > 150 && !_qrBusy && !_qrInfoOpen() && video && video.readyState >= 2) {
        _qrLastTick = now; _qrBusy = true;
        try { var text = await _qrDecodeFrame(video); if (text) _qrOnText(text); } catch (e) {}
        _qrBusy = false;
      }
      if (_qrStream) _qrLoop();
    });
  }
  async function _qrDecodeFrame(video) {
    if (_qrDetector) {
      try {
        var r = await _qrDetector.detect(video);
        return (r && r.length) ? r[0].rawValue : '';
      } catch (e) { _qrDetector = null; }
    }
    if (typeof jsQR !== 'function') return '';
    var w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return '';
    var sc = Math.min(1, 640 / w), cw = Math.round(w * sc), ch = Math.round(h * sc);
    if (!_qrCanvas) { _qrCanvas = document.createElement('canvas'); _qrCtx = _qrCanvas.getContext('2d', { willReadFrequently: true }); }
    _qrCanvas.width = cw; _qrCanvas.height = ch;
    _qrCtx.drawImage(video, 0, 0, cw, ch);
    var img = _qrCtx.getImageData(0, 0, cw, ch);
    var code = jsQR(img.data, cw, ch, { inversionAttempts: 'dontInvert' });
    return code ? code.data : '';
  }
  function _qrOnText(text) {
    var now = Date.now();
    if (text === _qrLastText && now - _qrLastAt < 3000) return;
    _qrLastText = text; _qrLastAt = now;
    qrHandleText(text);
  }

  // معالجة نص الرمز المقروء
  function qrHandleText(text) {
    var p = parseQrText(text);
    if (!p) { qrBeep(false); qrToast('⚠️ هذا الرمز ليس من نظام الحضور', 'err'); return; }
    if (p.chapter && typeof ACTIVE_CHAPTER_ID !== 'undefined' && ACTIVE_CHAPTER_ID && p.chapter !== ACTIVE_CHAPTER_ID) {
      qrBeep(false); qrToast('⚠️ هذا الرمز يتبع فصلًا آخر', 'err'); return;
    }
    var person = qrFind(p.type, p.id);
    if (!person) { qrBeep(false); qrToast('⚠️ لا يوجد صاحب لهذا الرمز (ربما حُذف من الكشف)', 'err'); return; }
    qrRegister(p.type, person);
  }

  // تسجيل الحضور + عرض بطاقة البيانات كاملة
  function qrRegister(type, person) {
    var date = getToday();
    var isSv = type === 'servant';
    var key = isSv ? person.sid : person.id;
    var store = isSv ? servantsAttendance : attendance;
    var sessKey = isSv ? 'SV_' + date : date;
    var status = _qrMode;
    var time = new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

    if (!isSessionEditable(sessKey)) {
      qrBeep(false);
      qrShowInfo(type, key, '<div class="qr-result err"><div class="qr-rb-main">⛔ لا يمكن التسجيل: انتهت مدة تعديل هذه الجلسة (٧ أيام)</div></div>');
      return;
    }
    var prev = (store[date] || {})[key];
    var result = 'done';
    if (prev === status) result = 'already';
    else {
      if (!store[date]) store[date] = {};
      store[date][key] = status;
      touchSession(sessKey);
      save(); renderAll();
    }
    _qrLast = { type: type, key: key, date: date, prev: prev, changed: result === 'done' };
    _qrLog.unshift({ type: type, name: person.name, status: status, result: result, time: time });
    if (_qrLog.length > 20) _qrLog.pop();
    qrBeep(true);

    var cls = result === 'already' ? 'info' : (status === 'late' ? 'late' : 'ok');
    var title = result === 'already'
      ? 'ℹ️ مُسجَّل بالفعل ' + (status === 'late' ? 'كمتأخر' : 'كحاضر')
      : (status === 'late' ? '⏰ تم تسجيل التأخير' : '✅ تم تسجيل الحضور');
    var undo = result === 'done' ? '<button type="button" class="qr-undo" onclick="qrUndoLast()">↩️ تراجع</button>' : '';
    qrShowInfo(type, key,
      '<div class="qr-result ' + cls + '"><div><div class="qr-rb-main">' + title + '</div>' +
      '<div class="qr-rb-sub">' + qEsc(time) + ' · ' + qEsc(date) + '</div></div>' + undo + '</div>');
    if (qEl('qrScanOverlay').classList.contains('active')) qrRenderPanel();
  }

  function qrShowInfo(type, key, bannerHtml) {
    if (type === 'servant') viewServant(key); else viewStudent(key);
    var host = qEl(type === 'servant' ? 'viewServantContent' : 'viewContent');
    if (host && bannerHtml) host.insertAdjacentHTML('afterbegin', bannerHtml);
  }

  function qrUndoLast() {
    var l = _qrLast;
    if (!l || !l.changed) return;
    var store = l.type === 'servant' ? servantsAttendance : attendance;
    var sessKey = l.type === 'servant' ? 'SV_' + l.date : l.date;
    if (!isSessionEditable(sessKey)) { blockEditExpired(); return; }
    if (!store[l.date]) store[l.date] = {};
    if (l.prev === undefined) delete store[l.date][l.key]; else store[l.date][l.key] = l.prev;
    touchSession(sessKey);
    save(); renderAll();
    if (_qrLog.length) _qrLog.shift();
    _qrLast = null;
    if (l.type === 'servant') closeViewServantModal(); else closeViewModal();
    qrToast('↩️ تم التراجع عن التسجيل', 'ok');
    if (qEl('qrScanOverlay').classList.contains('active')) qrRenderPanel();
  }

  // إدخال يدوي (بديل عند تعذر الكاميرا أو تلف الرمز)
  function qrManualSubmit() {
    var inp = qEl('qrManualInput');
    var v = (inp.value || '').trim();
    if (!v) return;
    var low = v.toLowerCase();
    var s = students.filter(function (x) { return String(x.id) === v; });
    if (!s.length) s = students.filter(function (x) { return (x.name || '').toLowerCase().indexOf(low) !== -1; });
    var sv = servants.filter(function (x) { return x.sid === v || (x.name || '').toLowerCase().indexOf(low) !== -1; });
    var all = s.map(function (x) { return { t: 'student', p: x }; }).concat(sv.map(function (x) { return { t: 'servant', p: x }; }));
    if (!all.length) { qrBeep(false); qrToast('⚠️ لا يوجد شخص بهذا الرقم أو الاسم', 'err'); return; }
    if (all.length > 1) { qrBeep(false); qrToast('⚠️ أكثر من نتيجة — اكتب الرقم أو الاسم كاملًا', 'err'); return; }
    inp.value = '';
    qrRegister(all[0].t, all[0].p);
  }

  // ===================================================================
  //  🔗 فتح رابط الـ QR من كاميرا الهاتف العادية / اختصار المسح
  // ===================================================================
  var _pendingQr = null, _pendingOpenScanner = false;
  (function () {
    try {
      var sp = new URLSearchParams(location.search);
      if (sp.get('qr')) _pendingQr = parseQrText(location.href);
      if (sp.get('scan') === '1') _pendingOpenScanner = true;
      if (sp.get('qr') || sp.get('scan')) history.replaceState(null, '', location.pathname);
    } catch (e) {}
  })();

  // عند ظهور شاشة اختيار الفصل: افتح مباشرة نافذة كلمة سر الفصل المقصود
  function offerPendingQrChapter() {
    if (!_pendingQr || !_pendingQr.chapter || ACTIVE_CHAPTER_ID) return;
    if (_chaptersCache.some(function (c) { return c.chapter_id === _pendingQr.chapter; })) {
      openChapterPasswordModal(_pendingQr.chapter);
    }
  }
  // بعد دخول الفصل: نفّذ التسجيل المعلّق
  function processPendingQrScan() {
    if (_pendingQr) {
      var p = _pendingQr; _pendingQr = null;
      if (p.chapter && ACTIVE_CHAPTER_ID && p.chapter !== ACTIVE_CHAPTER_ID) {
        qrToast('⚠️ هذا الرمز يتبع فصلًا آخر — بدّل الفصل ثم امسحه مرة أخرى', 'err');
      } else {
        var person = qrFind(p.type, p.id);
        if (!person) qrToast('⚠️ لا يوجد صاحب لهذا الرمز في هذا الفصل', 'err');
        else qrRegister(p.type, person);
      }
    }
    if (_pendingOpenScanner) { _pendingOpenScanner = false; openQrScanner(); }
  }
  window.addEventListener('pagehide', stopQrCamera);
