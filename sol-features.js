/**
 * =====================================================================
 *  🌟 sol-features.js — حزمة مميزات "أبناء النور" (Sons of Light Features)
 *  منقولة ومطورة خصيصاً لكاتدرائية رئيس الملائكة ميخائيل - طنطا
 * 
 *  تحتوي على:
 *  1. نظام الأوسمة والنقاط والتحفيز (Gamification & Badges & Points)
 *  2. لوحة الشرف والمتصدرين (Leaderboard)
 *  3. سجل الافتقاد الميداني التفصيلي وحصر الغائبين بدون افتقاد (Pastoral Visits)
 *  4. نظام المناهج والدروس والواجبات والمهمات (Curriculum & Lessons)
 *  5. نظام الوسوم والتصنيفات المخصصة (Custom Tags & Filters)
 * =====================================================================
 */

(function (window) {
  'use strict';

  // الأوسمة الافتراضية المستوحاة من أبناء النور
  const DEFAULT_BADGES = [
    { id: 'b_star', name: 'نجم الأسبوع', icon: '🌟', points: 30, desc: 'للمتميز في الحضور والمشاركة الفعالة' },
    { id: 'b_verse', name: 'حافظ الآية', icon: '📖', points: 25, desc: 'لحفظ الآية الذهبية وتسميع الدرس بإتقان' },
    { id: 'b_deacon', name: 'شماس القداس', icon: '⛪', points: 35, desc: 'للمواظبة على خدمة المذبح وصلاة القداس' },
    { id: 'b_angel', name: 'سلوك ملائكي', icon: '🕊️', points: 20, desc: 'لحسن الخلق والهدوء والتعاون مع الزملاء' },
    { id: 'b_hymn', name: 'عازف ومرتل الألحان', icon: '🎵', points: 25, desc: 'لإتقان الألحان القبطية والترانيم' },
    { id: 'b_perfect', name: 'المواظب المثالي', icon: '🎯', points: 40, desc: 'حضور مستمر دون أي غياب على مدار الشهر' },
    { id: 'b_helper', name: 'المحب والمتعاون', icon: '🤝', points: 20, desc: 'لمساعدة الخدام وإخوته المخدومين بروح الخدمة' },
    { id: 'b_active', name: 'شعلة النشاط', icon: '💡', points: 30, desc: 'للمشاركة الإيجابية في كافة الأنشطة والمهمات' }
  ];

  // الأوسمة والتصنيفات المبدئية
  const DEFAULT_TAGS = [
    { id: 't_deacon', name: 'شماس', color: '#c8392b', icon: '⛪' },
    { id: 't_choir', name: 'كورال', color: '#8e44ad', icon: '🎵' },
    { id: 't_scout', name: 'كشافة', color: '#27ae60', icon: '🏕️' },
    { id: 't_talent', name: 'موهوب', color: '#d4a017', icon: '🎨' },
    { id: 't_followup', name: 'متابعة خاصة', color: '#e67e22', icon: '⚠️' }
  ];

  // أنواع الافتقاد
  const VISIT_TYPES = [
    { id: 'home', name: 'زيارة منزلية', icon: '🏠' },
    { id: 'phone', name: 'اتصال هاتفي', icon: '📞' },
    { id: 'church', name: 'لقاء كنسي', icon: '⛪' },
    { id: 'social', name: 'رسالة إلكترونية / شات', icon: '💬' }
  ];

  const SOL = {
    // حالة البيانات المخزنة محلياً في الفصل الحالي
    badgesList: DEFAULT_BADGES.slice(),
    customTags: DEFAULT_TAGS.slice(),
    visitsData: {},    // { studentId: [ { id, date, servant, type, result, notes, nextDate } ] }
    curriculumData: [], // [ { id, weekDate, topic, verse, reference, duties, missions, mediaUrls, isPrepared } ]
    pointsLog: {},     // { studentId: [ { date, amount, reason } ] }

    /**
     * تهيئة البيانات من الـ Snapshot
     */
    initFromSnapshot: function (snap) {
      if (!snap) return;
      if (Array.isArray(snap.sol_badges)) this.badgesList = snap.sol_badges;
      if (Array.isArray(snap.sol_tags)) this.customTags = snap.sol_tags;
      if (snap.sol_visits && typeof snap.sol_visits === 'object') this.visitsData = snap.sol_visits;
      if (Array.isArray(snap.sol_curriculum)) this.curriculumData = snap.sol_curriculum;
      if (snap.sol_points_log && typeof snap.sol_points_log === 'object') this.pointsLog = snap.sol_points_log;
    },

    /**
     * تصدير البيانات لتضمينها في الـ Snapshot
     */
    exportToSnapshot: function () {
      return {
        sol_badges: this.badgesList,
        sol_tags: this.customTags,
        sol_visits: this.visitsData,
        sol_curriculum: this.curriculumData,
        sol_points_log: this.pointsLog
      };
    },

    // =========================================================
    //  1. نظام النقاط والتحفيز (Points System)
    // =========================================================
    getStudentPoints: function (studentId) {
      const s = (window.students || []).find(x => x.id === studentId);
      return (s && typeof s.points === 'number') ? s.points : 0;
    },

    addPoints: function (studentId, amount, reason) {
      const s = (window.students || []).find(x => x.id === studentId);
      if (!s) return;
      s.points = (s.points || 0) + amount;
      if (s.points < 0) s.points = 0;

      if (!this.pointsLog[studentId]) this.pointsLog[studentId] = [];
      this.pointsLog[studentId].unshift({
        id: 'pt_' + Date.now(),
        date: new Date().toISOString().split('T')[0],
        amount: amount,
        reason: reason || 'تعديل نقاط'
      });

      if (typeof window.save === 'function') window.save();
      if (typeof window.renderAll === 'function') window.renderAll();
      if (typeof window.showToast === 'function') {
        window.showToast(`🎉 تم إضافة ${amount > 0 ? '+' + amount : amount} نقطة لـ ${s.name}`);
      }
    },

    openPointsModal: function (studentId) {
      const s = (window.students || []).find(x => x.id === studentId);
      if (!s) return;

      const currentPts = s.points || 0;
      const history = this.pointsLog[studentId] || [];

      const overlay = document.createElement('div');
      overlay.className = 'overlay active';
      overlay.style.cssText = 'display:flex;z-index:99999;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);position:fixed;inset:0;padding:16px;';
      
      overlay.innerHTML = `
        <div style="background:var(--paper,#f5f0e8);border-radius:18px;padding:24px;width:100%;max-width:520px;max-height:90vh;overflow-y:auto;direction:rtl;box-shadow:0 24px 60px rgba(0,0,0,0.3);border-top:5px solid #d4a017;font-family:'Cairo',sans-serif;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
            <h2 style="font-size:18px;font-weight:900;color:#92400e;margin:0;">🪙 رصيد وسجل النقاط — ${s.name}</h2>
            <button style="background:none;border:none;font-size:22px;cursor:pointer;color:#888;" onclick="this.closest('.overlay').remove()">✕</button>
          </div>

          <div style="background:linear-gradient(135deg, #fef3c7, #fde68a);border-radius:14px;padding:16px;text-align:center;margin-bottom:16px;border:1px solid #fcd34d;">
            <div style="font-size:13px;color:#78350f;font-weight:700;">مجموع النقاط الحالي</div>
            <div style="font-size:36px;font-weight:900;color:#b45309;margin:4px 0;">${currentPts} <span style="font-size:16px;">نقطة</span></div>
            <div style="font-size:11px;color:#92400e;">(نظام مكافآت أبناء النور - Sons of Light)</div>
          </div>

          <div style="font-size:13px;font-weight:800;color:#1e293b;margin-bottom:8px;">⚡ إضافة نقاط سريعة:</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px;">
            <button class="btn" style="background:#1a7a4a;color:white;font-size:12px;padding:8px;" onclick="SOL.addPoints('${s.id}', 10, 'حضور في الموعد المحدد'); this.closest('.overlay').remove();">⏰ حضور مبكر (+10)</button>
            <button class="btn" style="background:#2980b9;color:white;font-size:12px;padding:8px;" onclick="SOL.addPoints('${s.id}', 15, 'حفظ الآية والتسميع'); this.closest('.overlay').remove();">📖 حفظ الآية والتسميع (+15)</button>
            <button class="btn" style="background:#c8392b;color:white;font-size:12px;padding:8px;" onclick="SOL.addPoints('${s.id}', 20, 'حضور ومشاركة بالقداس'); this.closest('.overlay').remove();">⛪ صلاة القداس الإلهي (+20)</button>
            <button class="btn" style="background:#8e44ad;color:white;font-size:12px;padding:8px;" onclick="SOL.addPoints('${s.id}', 10, 'إتمام مهمة روحية'); this.closest('.overlay').remove();">🕊️ إتمام مهمة روحية (+10)</button>
          </div>

          <div style="background:white;border-radius:12px;padding:14px;border:1px solid #e2e8f0;margin-bottom:16px;">
            <div style="font-size:13px;font-weight:800;color:#1e293b;margin-bottom:8px;">✏️ تخصيص يدوي للنقاط:</div>
            <div style="display:flex;gap:8px;">
              <input type="number" id="manualPointsVal" class="input" placeholder="مثال: 5 أو -5" style="width:100px;padding:6px;font-size:12px;text-align:center;">
              <input type="text" id="manualPointsReason" class="input" placeholder="السبب (مثال: إجابة سؤال مسابقة)" style="flex:1;padding:6px;font-size:12px;">
              <button class="btn" style="background:#d4a017;color:white;font-size:12px;padding:6px 14px;" onclick="
                const val = parseInt(document.getElementById('manualPointsVal').value, 10);
                const rsn = document.getElementById('manualPointsReason').value.trim();
                if (!isNaN(val) && val !== 0) {
                  SOL.addPoints('${s.id}', val, rsn || 'تعديل يدوي');
                  this.closest('.overlay').remove();
                } else { alert('يرجى إدخال قيمة صحيحة للنقاط'); }
              ">حفظ</button>
            </div>
          </div>

          <div style="font-size:13px;font-weight:800;color:#1e293b;margin-bottom:8px;">📜 سجل الحركات الأخيرة:</div>
          <div style="max-height:160px;overflow-y:auto;background:white;border-radius:10px;padding:8px;border:1px solid #e2e8f0;font-size:12px;">
            ${history.length ? history.map(h => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;border-bottom:1px solid #f1f5f9;">
                <div>
                  <span style="font-weight:700;color:#334155;">${h.reason}</span>
                  <div style="font-size:10px;color:#94a3b8;">${h.date}</div>
                </div>
                <span style="font-weight:800;color:${h.amount > 0 ? '#16a34a' : '#dc2626'};">${h.amount > 0 ? '+' + h.amount : h.amount}</span>
              </div>
            `).join('') : '<div style="text-align:center;color:#94a3b8;padding:12px;">لا توجد حركات مسجلة بعد</div>'}
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    },

    // =========================================================
    //  2. لوحة الشرف والمتصدرين (Leaderboard)
    // =========================================================
    openLeaderboardModal: function () {
      const studs = (window.students || []).slice().sort((a, b) => (b.points || 0) - (a.points || 0));

      const overlay = document.createElement('div');
      overlay.className = 'overlay active';
      overlay.style.cssText = 'display:flex;z-index:99999;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);position:fixed;inset:0;padding:16px;';

      overlay.innerHTML = `
        <div style="background:var(--paper,#f5f0e8);border-radius:18px;padding:24px;width:100%;max-width:620px;max-height:90vh;overflow-y:auto;direction:rtl;box-shadow:0 24px 60px rgba(0,0,0,0.3);border-top:5px solid #d4a017;font-family:'Cairo',sans-serif;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
            <h2 style="font-size:20px;font-weight:900;color:#92400e;margin:0;">🏆 لوحة الشرف والمتصدرين (Hall of Fame)</h2>
            <button style="background:none;border:none;font-size:22px;cursor:pointer;color:#888;" onclick="this.closest('.overlay').remove()">✕</button>
          </div>
          <p style="font-size:12px;color:#666;margin-bottom:14px;">ترتيب مخدومي الفصل وفقاً لمجموع النقاط المكتسبة من الحضور والتسميع والمهمات الروحية.</p>

          <div style="background:white;border-radius:14px;border:1px solid #e2e8f0;overflow:hidden;margin-bottom:16px;">
            <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:right;">
              <thead>
                <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;color:#475569;">
                  <th style="padding:10px 12px;width:50px;text-align:center;">المركز</th>
                  <th style="padding:10px 12px;">المخدوم</th>
                  <th style="padding:10px 12px;text-align:center;">الأوسمة</th>
                  <th style="padding:10px 12px;text-align:center;">النقاط</th>
                </tr>
              </thead>
              <tbody>
                ${studs.length ? studs.map((s, idx) => {
                  const rankIcon = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`;
                  const badgesCount = (s.badges || []).length;
                  return `
                    <tr style="border-bottom:1px solid #f1f5f9;background:${idx < 3 ? '#fffbeb' : 'transparent'};">
                      <td style="padding:10px 12px;text-align:center;font-weight:900;font-size:${idx < 3 ? '18px' : '13px'};">${rankIcon}</td>
                      <td style="padding:10px 12px;">
                        <div style="font-weight:800;color:#1e293b;">${s.name}</div>
                        <div style="font-size:11px;color:#64748b;">رقم: ${s.id}</div>
                      </td>
                      <td style="padding:10px 12px;text-align:center;">
                        <span style="background:#f1f5f9;padding:3px 8px;border-radius:12px;font-size:11px;font-weight:700;">🎖️ ${badgesCount}</span>
                      </td>
                      <td style="padding:10px 12px;text-align:center;">
                        <span style="color:#b45309;font-weight:900;font-size:15px;">${s.points || 0}</span>
                      </td>
                    </tr>
                  `;
                }).join('') : '<tr><td colspan="4" style="text-align:center;padding:20px;color:#888;">لا يوجد مخدومين مسجلين بعد</td></tr>'}
              </tbody>
            </table>
          </div>

          <div style="display:flex;justify-content:space-between;gap:10px;">
            <button class="btn btn-outline" style="font-size:12px;padding:8px 16px;" onclick="this.closest('.overlay').remove()">إغلاق</button>
            <button class="btn" style="background:#d4a017;color:white;font-size:12px;padding:8px 16px;" onclick="window.print()">🖨️ طباعة لوحة الشرف</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    },

    // =========================================================
    //  3. نظام الأوسمة والشارات (Badges System)
    // =========================================================
    openBadgesModal: function (studentId) {
      const s = (window.students || []).find(x => x.id === studentId);
      if (!s) return;
      if (!Array.isArray(s.badges)) s.badges = [];

      const overlay = document.createElement('div');
      overlay.className = 'overlay active';
      overlay.style.cssText = 'display:flex;z-index:99999;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);position:fixed;inset:0;padding:16px;';

      const renderBadgesUI = () => {
        const studentBadgeIds = new Set(s.badges || []);
        return `
          <div style="background:var(--paper,#f5f0e8);border-radius:18px;padding:24px;width:100%;max-width:580px;max-height:90vh;overflow-y:auto;direction:rtl;box-shadow:0 24px 60px rgba(0,0,0,0.3);border-top:5px solid #8e44ad;font-family:'Cairo',sans-serif;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
              <h2 style="font-size:18px;font-weight:900;color:#6b21a8;margin:0;">🎖️ أوسمة وشارات — ${s.name}</h2>
              <button style="background:none;border:none;font-size:22px;cursor:pointer;color:#888;" onclick="this.closest('.overlay').remove()">✕</button>
            </div>
            <p style="font-size:12px;color:#555;margin-bottom:14px;">اضغط على الوسام لمنحه أو سحبه من المخدوم (نظام مكافآت أبناء النور):</p>

            <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(120px, 1fr));gap:10px;margin-bottom:18px;">
              ${this.badgesList.map(b => {
                const hasIt = studentBadgeIds.has(b.id);
                return `
                  <div onclick="SOL.toggleBadge('${s.id}', '${b.id}');" style="cursor:pointer;border-radius:12px;padding:12px 8px;text-align:center;background:${hasIt ? '#f3e8ff' : '#f8fafc'};border:2px solid ${hasIt ? '#9333ea' : '#e2e8f0'};box-shadow:${hasIt ? '0 4px 12px rgba(147, 51, 234, 0.15)' : 'none'};transition:all 0.2s;">
                    <div style="font-size:32px;margin-bottom:4px;filter:${hasIt ? 'none' : 'grayscale(100%) opacity(40%)'};">${b.icon}</div>
                    <div style="font-size:12px;font-weight:800;color:${hasIt ? '#581c87' : '#64748b'};">${b.name}</div>
                    <div style="font-size:10px;color:#9333ea;font-weight:700;margin-top:2px;">+${b.points} نقطة</div>
                    <div style="margin-top:6px;font-size:10px;font-weight:800;color:${hasIt ? '#16a34a' : '#94a3b8'};">${hasIt ? '✓ ممنوح' : '+ منح'}</div>
                  </div>
                `;
              }).join('')}
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid #e2e8f0;padding-top:14px;">
              <button class="btn btn-outline" style="font-size:12px;padding:6px 14px;" onclick="SOL.openCreateCustomBadgeModal('${s.id}');">➕ إنشاء وسام مخصص</button>
              <button class="btn" style="background:#8e44ad;color:white;font-size:12px;padding:6px 18px;" onclick="this.closest('.overlay').remove()">تم</button>
            </div>
          </div>
        `;
      };

      overlay.innerHTML = renderBadgesUI();
      document.body.appendChild(overlay);
    },

    toggleBadge: function (studentId, badgeId) {
      const s = (window.students || []).find(x => x.id === studentId);
      if (!s) return;
      if (!Array.isArray(s.badges)) s.badges = [];

      const badge = this.badgesList.find(b => b.id === badgeId);
      const idx = s.badges.indexOf(badgeId);
      if (idx !== -1) {
        s.badges.splice(idx, 1);
        if (badge) this.addPoints(studentId, -badge.points, `إلغاء وسام: ${badge.name}`);
      } else {
        s.badges.push(badgeId);
        if (badge) this.addPoints(studentId, badge.points, `الحصول على وسام: ${badge.name}`);
      }

      if (typeof window.save === 'function') window.save();
      if (typeof window.renderAll === 'function') window.renderAll();

      // إعادة رسم المودال إذا كان مفتوحاً
      const activeModal = document.querySelector('.overlay.active');
      if (activeModal) {
        activeModal.remove();
        this.openBadgesModal(studentId);
      }
    },

    openCreateCustomBadgeModal: function (currentStudentId) {
      const name = prompt('أدخل اسم الوسام الجديد:');
      if (!name) return;
      const icon = prompt('أدخل رمز تعبيري (Emoji) للوسام (مثال: 🏆, 🎖️, 👑, 🎯):', '🎖️') || '🎖️';
      const points = parseInt(prompt('عدد النقاط الممنوحة مع هذا الوسام:', '20'), 10) || 20;

      const newBadge = {
        id: 'b_custom_' + Date.now(),
        name: name.trim(),
        icon: icon.trim(),
        points: points,
        desc: 'وسام مخصص'
      };
      this.badgesList.push(newBadge);
      if (typeof window.save === 'function') window.save();
      if (currentStudentId) this.openBadgesModal(currentStudentId);
    },

    // =========================================================
    //  4. سجل الافتقاد الميداني التفصيلي (Pastoral Visits)
    // =========================================================
    openVisitsManagerModal: function () {
      const allStudents = window.students || [];
      const visits = this.visitsData;

      // حساب المتغيبين بدون افتقاد (نفس ميزة absent_without_visit في أبناء النور)
      const absentsWithoutVisit = allStudents.filter(s => {
        const absCount = typeof window.getStudentAbsenceCount === 'function' ? window.getStudentAbsenceCount(s.id) : 0;
        const studentVisits = visits[s.id] || [];
        return absCount >= 2 && studentVisits.length === 0;
      });

      const overlay = document.createElement('div');
      overlay.className = 'overlay active';
      overlay.style.cssText = 'display:flex;z-index:99999;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);position:fixed;inset:0;padding:16px;';

      overlay.innerHTML = `
        <div style="background:var(--paper,#f5f0e8);border-radius:18px;padding:24px;width:100%;max-width:760px;max-height:92vh;overflow-y:auto;direction:rtl;box-shadow:0 24px 60px rgba(0,0,0,0.3);border-top:5px solid #2980b9;font-family:'Cairo',sans-serif;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
            <h2 style="font-size:20px;font-weight:900;color:#1e3a8a;margin:0;">🚗 سجل الافتقاد الراعوي الميداني (Sons of Light Visits)</h2>
            <button style="background:none;border:none;font-size:22px;cursor:pointer;color:#888;" onclick="this.closest('.overlay').remove()">✕</button>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
            <div style="background:#fee2e2;border:1px solid #f87171;border-radius:12px;padding:14px;color:#991b1b;">
              <div style="font-size:12px;font-weight:700;">⚠️ متغيبون يحتاجون افتقاد عاجل (بدون زيارات مسجلة)</div>
              <div style="font-size:24px;font-weight:900;margin-top:4px;">${absentsWithoutVisit.length} مخدوم</div>
            </div>
            <div style="background:#dbeafe;border:1px solid #93c5fd;border-radius:12px;padding:14px;color:#1e40af;">
              <div style="font-size:12px;font-weight:700;">✅ إجمالي الزيارات الميدانية المسجلة</div>
              <div style="font-size:24px;font-weight:900;margin-top:4px;">
                ${Object.values(visits).reduce((acc, list) => acc + (list.length || 0), 0)} زيارة
              </div>
            </div>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <div style="font-size:14px;font-weight:800;color:#1e293b;">📋 قائمة المخدومين وسجل افتقاد كل منهم:</div>
            <input type="text" id="visitSearchInput" placeholder="🔍 بحث في المخدومين..." style="padding:6px 12px;border-radius:8px;border:1px solid #cbd5e1;font-size:12px;width:200px;" oninput="
              const q = this.value.toLowerCase();
              document.querySelectorAll('.visit-row').forEach(r => {
                r.style.display = r.dataset.name.toLowerCase().includes(q) ? '' : 'none';
              });
            ">
          </div>

          <div style="background:white;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;max-height:360px;overflow-y:auto;margin-bottom:16px;">
            <table style="width:100%;border-collapse:collapse;font-size:13px;text-align:right;">
              <thead>
                <tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0;color:#475569;">
                  <th style="padding:10px 12px;">المخدوم</th>
                  <th style="padding:10px 12px;text-align:center;">مرات الغياب</th>
                  <th style="padding:10px 12px;">آخر افتقاد</th>
                  <th style="padding:10px 12px;text-align:center;">إجراء</th>
                </tr>
              </thead>
              <tbody>
                ${allStudents.map(s => {
                  const studentVisits = visits[s.id] || [];
                  const lastVisit = studentVisits[0];
                  const absCount = typeof window.getStudentAbsenceCount === 'function' ? window.getStudentAbsenceCount(s.id) : 0;
                  return `
                    <tr class="visit-row" data-name="${s.name}" style="border-bottom:1px solid #f1f5f9;">
                      <td style="padding:10px 12px;">
                        <div style="font-weight:800;color:#0f172a;">${s.name}</div>
                        <div style="font-size:11px;color:#64748b;">${s.phone || 'بدون هاتف'} &bull; ${s.address || 'بدون عنوان'}</div>
                      </td>
                      <td style="padding:10px 12px;text-align:center;">
                        <span style="background:${absCount >= 3 ? '#fee2e2' : '#f1f5f9'};color:${absCount >= 3 ? '#dc2626' : '#475569'};padding:2px 8px;border-radius:10px;font-weight:700;font-size:11px;">
                          ${absCount} غياب
                        </span>
                      </td>
                      <td style="padding:10px 12px;font-size:12px;">
                        ${lastVisit ? `
                          <div style="font-weight:700;color:#1e40af;">${lastVisit.typeIcon} ${lastVisit.date}</div>
                          <div style="font-size:11px;color:#64748b;">بواسطة: ${lastVisit.servant || 'خادم'}</div>
                        ` : '<span style="color:#ef4444;font-size:11px;font-weight:700;">لم يتم الافتقاد بعد</span>'}
                      </td>
                      <td style="padding:10px 12px;text-align:center;">
                        <button class="btn" style="background:#2980b9;color:white;font-size:11px;padding:5px 10px;" onclick="SOL.openRecordVisitModal('${s.id}');">➕ تسجيل افتقاد</button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>

          <div style="display:flex;justify-content:flex-end;">
            <button class="btn btn-outline" style="font-size:12px;padding:8px 20px;" onclick="this.closest('.overlay').remove()">إغلاق</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    },

    openRecordVisitModal: function (studentId) {
      const s = (window.students || []).find(x => x.id === studentId);
      if (!s) return;
      const existing = this.visitsData[studentId] || [];

      const overlay = document.createElement('div');
      overlay.className = 'overlay active';
      overlay.style.cssText = 'display:flex;z-index:999999;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);position:fixed;inset:0;padding:16px;';

      overlay.innerHTML = `
        <div style="background:var(--paper,#f5f0e8);border-radius:18px;padding:24px;width:100%;max-width:540px;max-height:90vh;overflow-y:auto;direction:rtl;box-shadow:0 24px 60px rgba(0,0,0,0.3);border-top:5px solid #1a7a4a;font-family:'Cairo',sans-serif;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
            <h2 style="font-size:18px;font-weight:900;color:#166534;margin:0;">📝 تسجيل افتقاد — ${s.name}</h2>
            <button style="background:none;border:none;font-size:22px;cursor:pointer;color:#888;" onclick="this.closest('.overlay').remove()">✕</button>
          </div>

          <div style="background:white;border-radius:12px;padding:14px;border:1px solid #e2e8f0;margin-bottom:14px;font-size:13px;">
            <div style="margin-bottom:10px;">
              <label style="display:block;font-weight:700;margin-bottom:4px;">تاريخ الافتقاد:</label>
              <input type="date" id="vDate" class="input" style="width:100%;padding:6px 10px;" value="${new Date().toISOString().split('T')[0]}">
            </div>
            <div style="margin-bottom:10px;">
              <label style="display:block;font-weight:700;margin-bottom:4px;">نوع الافتقاد:</label>
              <select id="vType" class="input" style="width:100%;padding:6px 10px;">
                ${VISIT_TYPES.map(vt => `<option value="${vt.id}">${vt.icon} ${vt.name}</option>`).join('')}
              </select>
            </div>
            <div style="margin-bottom:10px;">
              <label style="display:block;font-weight:700;margin-bottom:4px;">الخادم القائم بالافتقاد:</label>
              <input type="text" id="vServant" class="input" style="width:100%;padding:6px 10px;" placeholder="اسم الخادم أو الخادمة">
            </div>
            <div style="margin-bottom:10px;">
              <label style="display:block;font-weight:700;margin-bottom:4px;">حالة ونتيجة الافتقاد:</label>
              <select id="vResult" class="input" style="width:100%;padding:6px 10px;">
                <option value="success">✅ تم الافتقاد والمخدوم مستعد للحضور</option>
                <option value="sick">🩺 مريض ويحتاج صلاة وافتقاد مستمر</option>
                <option value="family">👨‍👩‍👧 ظروف أسرية أو دراسية</option>
                <option value="travel">✈️ مسافر أو خارج المدينة</option>
                <option value="no_answer">📵 لم يتم الرد / تعذر التواصل</option>
                <option value="other">📌 أخرى (يرجى توضيحها بالملاحظات)</option>
              </select>
            </div>
            <div style="margin-bottom:10px;">
              <label style="display:block;font-weight:700;margin-bottom:4px;">ملاحظات الافتقاد:</label>
              <textarea id="vNotes" class="input" rows="3" style="width:100%;padding:6px 10px;" placeholder="تفاصيل الزيارة، الاحتياجات الروحية، طلبات الصلاة..."></textarea>
            </div>
            <div>
              <label style="display:block;font-weight:700;margin-bottom:4px;">موعد المتابعة القادم (اختياري):</label>
              <input type="date" id="vNextDate" class="input" style="width:100%;padding:6px 10px;">
            </div>
          </div>

          <div style="display:flex;justify-content:space-between;gap:8px;">
            <button class="btn btn-outline" style="font-size:12px;padding:8px 16px;" onclick="this.closest('.overlay').remove()">إلغاء</button>
            <button class="btn" style="background:#1a7a4a;color:white;font-size:12px;padding:8px 20px;" onclick="
              const v = {
                id: 'v_' + Date.now(),
                date: document.getElementById('vDate').value,
                type: document.getElementById('vType').value,
                typeIcon: document.getElementById('vType').options[document.getElementById('vType').selectedIndex].text.split(' ')[0],
                servant: document.getElementById('vServant').value.trim(),
                result: document.getElementById('vResult').value,
                resultText: document.getElementById('vResult').options[document.getElementById('vResult').selectedIndex].text,
                notes: document.getElementById('vNotes').value.trim(),
                nextDate: document.getElementById('vNextDate').value
              };
              if (!SOL.visitsData['${s.id}']) SOL.visitsData['${s.id}'] = [];
              SOL.visitsData['${s.id}'].unshift(v);
              if (typeof window.save === 'function') window.save();
              if (typeof window.renderAll === 'function') window.renderAll();
              if (typeof window.showToast === 'function') window.showToast('✅ تم تسجيل الافتقاد بنجاح');
              this.closest('.overlay').remove();
            ">💾 حفظ الافتقاد</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    },

    // =========================================================
    //  5. نظام المناهج والدروس والواجبات (Curriculum & Lessons)
    // =========================================================
    openCurriculumModal: function () {
      const lessons = this.curriculumData || [];

      const overlay = document.createElement('div');
      overlay.className = 'overlay active';
      overlay.style.cssText = 'display:flex;z-index:99999;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);position:fixed;inset:0;padding:16px;';

      overlay.innerHTML = `
        <div style="background:var(--paper,#f5f0e8);border-radius:18px;padding:24px;width:100%;max-width:760px;max-height:92vh;overflow-y:auto;direction:rtl;box-shadow:0 24px 60px rgba(0,0,0,0.3);border-top:5px solid #c8392b;font-family:'Cairo',sans-serif;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
            <h2 style="font-size:20px;font-weight:900;color:#991b1b;margin:0;">📖 تحضير المناهج والدروس (Sons of Light Curriculum)</h2>
            <button style="background:none;border:none;font-size:22px;cursor:pointer;color:#888;" onclick="this.closest('.overlay').remove()">✕</button>
          </div>
          <p style="font-size:12px;color:#555;margin-bottom:14px;">إدارة دروس مرحلة الفصل، الواجبات التطبيقية، المهمات الروحية، والوسائط التعليمية (فيديو / صوت / PDF):</p>

          <div style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;">
            <button class="btn" style="background:#c8392b;color:white;font-size:12px;padding:8px 16px;" onclick="SOL.openAddLessonModal();">➕ إضافة درس جديد للمنهج</button>
            <span style="font-size:12px;color:#64748b;font-weight:700;">عدد الدروس المسجلة: ${lessons.length}</span>
          </div>

          <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:16px;">
            ${lessons.length ? lessons.map((les, i) => `
              <div style="background:white;border-radius:14px;padding:16px;border:1px solid #e2e8f0;box-shadow:0 2px 6px rgba(0,0,0,0.04);">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
                  <div>
                    <span style="background:#fee2e2;color:#991b1b;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:800;">الأسبوع ${i+1} &bull; ${les.weekDate || '—'}</span>
                    <h3 style="font-size:16px;font-weight:900;color:#1e293b;margin:6px 0 2px 0;">${les.topic}</h3>
                    <div style="font-size:12px;color:#64748b;">الشاهد الكتابي: <strong>${les.reference || '—'}</strong></div>
                  </div>
                  <span style="background:${les.isPrepared ? '#dcfce7' : '#fef3c7'};color:${les.isPrepared ? '#166534' : '#92400e'};padding:4px 10px;border-radius:12px;font-size:11px;font-weight:800;">
                    ${les.isPrepared ? '✅ تم التحضير' : '⏳ قيد الإعداد'}
                  </span>
                </div>

                <div style="background:#f8fafc;border-radius:8px;padding:10px;margin-bottom:10px;font-size:12px;">
                  <strong style="color:#b45309;">🌟 الآية الذهبية:</strong>
                  <div style="margin-top:2px;font-weight:700;color:#334155;">« ${les.verse || 'لم تُحدد بعد'} »</div>
                </div>

                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:12px;margin-bottom:10px;">
                  <div style="background:#f0fdf4;padding:8px 10px;border-radius:8px;border:1px solid #bbf7d0;">
                    <strong style="color:#166534;">📝 واجب الدرس (Duties):</strong>
                    <div style="margin-top:2px;color:#374151;">${les.duties || 'لا يوجد واجبات'}</div>
                  </div>
                  <div style="background:#eff6ff;padding:8px 10px;border-radius:8px;border:1px solid #bfdbfe;">
                    <strong style="color:#1e40af;">🕊️ مهمة روحية (Missions):</strong>
                    <div style="margin-top:2px;color:#374151;">${les.missions || 'صلاة وقراءة إنجيل'}</div>
                  </div>
                </div>

                ${les.mediaUrl ? `
                  <div style="font-size:12px;margin-bottom:10px;">
                    <a href="${les.mediaUrl}" target="_blank" style="color:#2563eb;text-decoration:none;font-weight:700;">🔗 فتح وسائط الدرس (فيديو / ملخص / ملف) ↗</a>
                  </div>
                ` : ''}

                <div style="display:flex;justify-content:flex-end;gap:8px;border-top:1px solid #f1f5f9;padding-top:10px;">
                  <button class="btn btn-outline" style="font-size:11px;padding:4px 10px;" onclick="
                    les.isPrepared = !les.isPrepared;
                    if (typeof window.save === 'function') window.save();
                    this.closest('.overlay').remove();
                    SOL.openCurriculumModal();
                  ">${les.isPrepared ? 'إلغاء التحضير' : 'اعتماد التحضير ✅'}</button>
                  <button class="btn" style="background:#ef4444;color:white;font-size:11px;padding:4px 10px;" onclick="
                    if (confirm('هل أنت متأكد من حذف هذا الدرس؟')) {
                      SOL.curriculumData.splice(${i}, 1);
                      if (typeof window.save === 'function') window.save();
                      this.closest('.overlay').remove();
                      SOL.openCurriculumModal();
                    }
                  ">🗑️ حذف</button>
                </div>
              </div>
            `).join('') : '<div style="text-align:center;padding:30px;color:#888;background:white;border-radius:12px;">لا يوجد دروس مسجلة في المنهج بعد</div>'}
          </div>

          <div style="display:flex;justify-content:flex-end;">
            <button class="btn btn-outline" style="font-size:12px;padding:8px 20px;" onclick="this.closest('.overlay').remove()">إغلاق</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    },

    openAddLessonModal: function () {
      const overlay = document.createElement('div');
      overlay.className = 'overlay active';
      overlay.style.cssText = 'display:flex;z-index:999999;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);position:fixed;inset:0;padding:16px;';

      overlay.innerHTML = `
        <div style="background:var(--paper,#f5f0e8);border-radius:18px;padding:24px;width:100%;max-width:560px;max-height:90vh;overflow-y:auto;direction:rtl;box-shadow:0 24px 60px rgba(0,0,0,0.3);border-top:5px solid #c8392b;font-family:'Cairo',sans-serif;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
            <h2 style="font-size:18px;font-weight:900;color:#991b1b;margin:0;">➕ إضافة درس جديد للمنهج</h2>
            <button style="background:none;border:none;font-size:22px;cursor:pointer;color:#888;" onclick="this.closest('.overlay').remove()">✕</button>
          </div>

          <div style="background:white;border-radius:12px;padding:14px;border:1px solid #e2e8f0;margin-bottom:14px;font-size:13px;">
            <div style="margin-bottom:10px;">
              <label style="display:block;font-weight:700;margin-bottom:4px;">تاريخ إلقاء الدرس:</label>
              <input type="date" id="lesDate" class="input" style="width:100%;padding:6px 10px;" value="${new Date().toISOString().split('T')[0]}">
            </div>
            <div style="margin-bottom:10px;">
              <label style="display:block;font-weight:700;margin-bottom:4px;">عنوان وموضوع الدرس *:</label>
              <input type="text" id="lesTopic" class="input" style="width:100%;padding:6px 10px;" placeholder="مثال: يوسف الصديق والأمانة">
            </div>
            <div style="margin-bottom:10px;">
              <label style="display:block;font-weight:700;margin-bottom:4px;">الشاهد الكتابي:</label>
              <input type="text" id="lesRef" class="input" style="width:100%;padding:6px 10px;" placeholder="مثال: تكوين 39 : 1-23">
            </div>
            <div style="margin-bottom:10px;">
              <label style="display:block;font-weight:700;margin-bottom:4px;">الآية الذهبية للحفظ:</label>
              <input type="text" id="lesVerse" class="input" style="width:100%;padding:6px 10px;" placeholder="نص الآية للحفظ الأسبوعي">
            </div>
            <div style="margin-bottom:10px;">
              <label style="display:block;font-weight:700;margin-bottom:4px;">واجبات الدرس (Duties):</label>
              <textarea id="lesDuties" class="input" rows="2" style="width:100%;padding:6px 10px;" placeholder="أسئلة الواجب والأنشطة"></textarea>
            </div>
            <div style="margin-bottom:10px;">
              <label style="display:block;font-weight:700;margin-bottom:4px;">مهمات روحية أسبوعية (Missions):</label>
              <textarea id="lesMissions" class="input" rows="2" style="width:100%;padding:6px 10px;" placeholder="صلاة مخدع، قراءة إصحاح، عمل محبة..."></textarea>
            </div>
            <div>
              <label style="display:block;font-weight:700;margin-bottom:4px;">رابط وسائط ومصادر الدرس (فيديو/PDF):</label>
              <input type="url" id="lesMedia" class="input" style="width:100%;padding:6px 10px;" placeholder="رابط يوتيوب أو ملف سحابي">
            </div>
          </div>

          <div style="display:flex;justify-content:space-between;gap:8px;">
            <button class="btn btn-outline" style="font-size:12px;padding:8px 16px;" onclick="this.closest('.overlay').remove()">إلغاء</button>
            <button class="btn" style="background:#c8392b;color:white;font-size:12px;padding:8px 20px;" onclick="
              const topic = document.getElementById('lesTopic').value.trim();
              if (!topic) { alert('يرجى إدخال عنوان الدرس'); return; }
              const newLesson = {
                id: 'les_' + Date.now(),
                weekDate: document.getElementById('lesDate').value,
                topic: topic,
                reference: document.getElementById('lesRef').value.trim(),
                verse: document.getElementById('lesVerse').value.trim(),
                duties: document.getElementById('lesDuties').value.trim(),
                missions: document.getElementById('lesMissions').value.trim(),
                mediaUrl: document.getElementById('lesMedia').value.trim(),
                isPrepared: false
              };
              SOL.curriculumData.push(newLesson);
              if (typeof window.save === 'function') window.save();
              if (typeof window.showToast === 'function') window.showToast('✅ تم إضافة الدرس إلى المنهج');
              this.closest('.overlay').remove();
              SOL.openCurriculumModal();
            ">💾 حفظ الدرس</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    },

    // =========================================================
    //  6. نظام الوسوم والتصنيفات المخصصة (Custom Tags)
    // =========================================================
    openTagsManagerModal: function () {
      const overlay = document.createElement('div');
      overlay.className = 'overlay active';
      overlay.style.cssText = 'display:flex;z-index:99999;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);position:fixed;inset:0;padding:16px;';

      overlay.innerHTML = `
        <div style="background:var(--paper,#f5f0e8);border-radius:18px;padding:24px;width:100%;max-width:540px;max-height:90vh;overflow-y:auto;direction:rtl;box-shadow:0 24px 60px rgba(0,0,0,0.3);border-top:5px solid #1a7a4a;font-family:'Cairo',sans-serif;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
            <h2 style="font-size:18px;font-weight:900;color:#166534;margin:0;">🏷️ نظام الوسوم والتصنيفات (Custom Tags)</h2>
            <button style="background:none;border:none;font-size:22px;cursor:pointer;color:#888;" onclick="this.closest('.overlay').remove()">✕</button>
          </div>
          <p style="font-size:12px;color:#555;margin-bottom:14px;">تصنيف المخدومين حسب المجموعات والمواهب والأنشطة (نفس ميزة Custom Tags بأبناء النور):</p>

          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
            ${this.customTags.map((tag, idx) => `
              <div style="background:${tag.color}15;border:1px solid ${tag.color};color:${tag.color};padding:6px 12px;border-radius:20px;font-size:13px;font-weight:800;display:flex;align-items:center;gap:6px;">
                <span>${tag.icon} ${tag.name}</span>
                <button style="background:none;border:none;color:${tag.color};cursor:pointer;font-size:14px;" onclick="
                  SOL.customTags.splice(${idx}, 1);
                  if (typeof window.save === 'function') window.save();
                  this.closest('.overlay').remove();
                  SOL.openTagsManagerModal();
                ">✕</button>
              </div>
            `).join('')}
          </div>

          <div style="background:white;border-radius:12px;padding:14px;border:1px solid #e2e8f0;margin-bottom:16px;">
            <div style="font-size:13px;font-weight:800;color:#1e293b;margin-bottom:8px;">➕ إضافة تصنيف/وسم جديد:</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
              <input type="text" id="newTagName" class="input" placeholder="اسم الوسم (مثال: شماس)">
              <input type="text" id="newTagIcon" class="input" placeholder="أيقونة (Emoji) مثال: ⛪">
            </div>
            <div style="display:flex;gap:8px;align-items:center;">
              <input type="color" id="newTagColor" value="#2563eb" style="width:40px;height:34px;border:none;border-radius:6px;cursor:pointer;">
              <button class="btn" style="flex:1;background:#1a7a4a;color:white;font-size:12px;padding:8px;" onclick="
                const n = document.getElementById('newTagName').value.trim();
                const ic = document.getElementById('newTagIcon').value.trim() || '🏷️';
                const col = document.getElementById('newTagColor').value;
                if (!n) return;
                SOL.customTags.push({ id: 'tag_' + Date.now(), name: n, icon: ic, color: col });
                if (typeof window.save === 'function') window.save();
                this.closest('.overlay').remove();
                SOL.openTagsManagerModal();
              ">إضافة الوسم</button>
            </div>
          </div>

          <div style="display:flex;justify-content:flex-end;">
            <button class="btn btn-outline" style="font-size:12px;padding:8px 20px;" onclick="this.closest('.overlay').remove()">إغلاق</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    },

    openStudentTagsModal: function (studentId) {
      const s = (window.students || []).find(x => x.id === studentId);
      if (!s) return;
      if (!Array.isArray(s.tags)) s.tags = [];

      const overlay = document.createElement('div');
      overlay.className = 'overlay active';
      overlay.style.cssText = 'display:flex;z-index:99999;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);position:fixed;inset:0;padding:16px;';

      const renderTagsUI = () => {
        const studentTagIds = new Set(s.tags || []);
        return `
          <div style="background:var(--paper,#f5f0e8);border-radius:18px;padding:24px;width:100%;max-width:480px;max-height:90vh;overflow-y:auto;direction:rtl;box-shadow:0 24px 60px rgba(0,0,0,0.3);border-top:5px solid #1a7a4a;font-family:'Cairo',sans-serif;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
              <h2 style="font-size:18px;font-weight:900;color:#166534;margin:0;">🏷️ تصنيفات ووسوم — ${s.name}</h2>
              <button style="background:none;border:none;font-size:22px;cursor:pointer;color:#888;" onclick="this.closest('.overlay').remove()">✕</button>
            </div>
            <p style="font-size:12px;color:#555;margin-bottom:14px;">حدد التصنيفات التابع لها المخدوم (شماس / كورال / كشافة...):</p>

            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px;">
              ${this.customTags.map(tag => {
                const hasIt = studentTagIds.has(tag.id);
                return `
                  <button type="button" onclick="
                    if (s.tags.includes('${tag.id}')) {
                      s.tags = s.tags.filter(t => t !== '${tag.id}');
                    } else {
                      s.tags.push('${tag.id}');
                    }
                    if (typeof window.save === 'function') window.save();
                    if (typeof window.renderAll === 'function') window.renderAll();
                    this.closest('.overlay').remove();
                    SOL.openStudentTagsModal('${s.id}');
                  " style="cursor:pointer;border-radius:20px;padding:8px 14px;font-size:13px;font-weight:800;border:2px solid ${tag.color};background:${hasIt ? tag.color : 'white'};color:${hasIt ? 'white' : tag.color};display:flex;align-items:center;gap:6px;transition:all 0.2s;">
                    <span>${tag.icon} ${tag.name}</span>
                    <span>${hasIt ? '✓' : '+'}</span>
                  </button>
                `;
              }).join('')}
            </div>

            <div style="display:flex;justify-content:flex-end;">
              <button class="btn" style="background:#1a7a4a;color:white;font-size:12px;padding:8px 20px;" onclick="this.closest('.overlay').remove()">تم</button>
            </div>
          </div>
        `;
      };

      overlay.innerHTML = renderTagsUI();
      document.body.appendChild(overlay);
    }
  };

  window.SOL = SOL;
})(window);
