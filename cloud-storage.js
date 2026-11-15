/**
 * =====================================================================
 *  ☁️ CloudStorage — محرك التخزين السحابي الموحد للكنيسة
 *  مستوحى من نظام التخزين السحابي لتطبيق "أبناء النور" (Sons of Light - AWS S3)
 * 
 *  المميزات:
 *  1. رفع الصور والملفات وتخزين روابط سحابية دائمة (URLs) بدلاً من Base64
 *  2. تقليل حجم قاعدة البيانات من ميجابايتات ضخمة إلى كيلوبايتات خفيفة
 *  3. تسريع الحفظ والمزامنة ومنع أخطاء الـ Timeout
 *  4. دعم موفرين سحابيين:
 *     - Supabase Storage (متوافق مع بروتوكول S3 ومثبت افتراضياً)
 *     - Amazon AWS S3 المباشر (مثل أبناء النور: s3.us-east-2.amazonaws.com)
 *  5. مسارات تنظيمية متوافقة تماماً مع Sons of Light:
 *     - صور المخدومين والخدام: defaults/user/{id}/...
 *     - صور الفصول: defaults/activityClass/{id}/...
 *     - وسائط المناهج والمكتبة: defaults/media/{category}/...
 * =====================================================================
 */

(function (window) {
  'use strict';

  // الإعدادات الافتراضية
  const DEFAULT_CONFIG = {
    provider: 'supabase', // 'supabase' أو 'aws-s3'
    // إعدادات Supabase Storage (S3-Compatible)
    supabaseUrl: 'https://tnpokrdrhactzjrhlyjv.supabase.co',
    supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRucG9rcmRyaGFjdHpqcmhseWp2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMTg4MDYsImV4cCI6MjEwNjc5NDgwNn0.GAR0ckTxCGwHg4LeR1GAU5CTXnDLLpQkuY2lL6BycBw',
    primaryBucket: 'library-files', // الحاوية النشطة في المشروع (أو 'cathedral-media')
    // إعدادات Amazon AWS S3 (نمط أبناء النور)
    awsBucket: 'cathedral-media',
    awsRegion: 'us-east-2',
    awsEndpoint: '', // مخصص إذا كان Cloudflare R2 / MinIO
    // خيارات الضغط
    maxImageDim: 800,
    imageQuality: 0.82
  };

  const STORAGE_KEY = 'sol_cathedral_cloud_storage_v1';

  function loadConfig() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return Object.assign({}, DEFAULT_CONFIG, JSON.parse(saved));
    } catch (e) {}
    return Object.assign({}, DEFAULT_CONFIG);
  }

  function saveConfig(cfg) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch (e) {}
  }

  const CloudStorage = {
    config: loadConfig(),

    /**
     * الحصول على عميل Supabase المناسب للرفع
     */
    getSupabaseClient: function () {
      if (window._supabaseClient) return window._supabaseClient;
      if (window.supabase && typeof window.supabase.createClient === 'function') {
        window._supabaseClient = window.supabase.createClient(
          this.config.supabaseUrl,
          this.config.supabaseKey
        );
        return window._supabaseClient;
      }
      return null;
    },

    /**
     * تصغير وضغط الصورة وتحويلها إلى Blob ثنائي خفيف مع DataURL للمعاينة الفورية
     */
    compressImage: function (file, maxDim, quality) {
      const dim = maxDim || this.config.maxImageDim;
      const q = quality || this.config.imageQuality;

      return new Promise((resolve, reject) => {
        if (!file) return reject(new Error('لم يتم تحديد ملف'));
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('تعذر قراءة ملف الصورة'));
        reader.onload = () => {
          const img = new Image();
          img.onerror = () => reject(new Error('صيغة الصورة غير صالحة'));
          img.onload = () => {
            let width = img.width;
            let height = img.height;
            if (width > dim || height > dim) {
              if (width >= height) {
                height = Math.round((height * dim) / width);
                width = dim;
              } else {
                width = Math.round((width * dim) / height);
                height = dim;
              }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const dataUrl = canvas.toDataURL('image/jpeg', q);
            canvas.toBlob(
              (blob) => {
                if (blob) {
                  resolve({ blob, dataUrl, width, height, size: blob.size });
                } else {
                  reject(new Error('فشل توليد ملف الصورة المضغوطة'));
                }
              },
              'image/jpeg',
              q
            );
          };
          img.src = reader.result;
        };
        reader.readAsDataURL(file);
      });
    },

    /**
     * الرفع السحابي الأساسي لملف/Blob
     * @param {string} storagePath - المسار السحابي (مثل defaults/user/123/profile.jpg)
     * @param {Blob|File} fileBlob - الملف
     * @param {string} contentType - نوع المحتوى (image/jpeg, application/pdf ...)
     */
    uploadFile: async function (storagePath, fileBlob, contentType = 'image/jpeg') {
      const cleanPath = String(storagePath).replace(/^\/+/, '');

      // 1. إذا كان الموفر Supabase Storage
      if (this.config.provider === 'supabase') {
        const client = this.getSupabaseClient();
        if (!client) throw new Error('عميل السحابة غير مهيأ');

        const bucket = this.config.primaryBucket;
        const { data, error } = await client.storage
          .from(bucket)
          .upload(cleanPath, fileBlob, {
            contentType: contentType,
            upsert: true,
            cacheControl: '31536000' // كاش سنة واحدة للصور الثابتة
          });

        if (error) {
          // إذا لم تكن الحاوية موجودة، تجربة الحاوية البديلة
          if (bucket !== 'library-files') {
            const fallbackRes = await client.storage
              .from('library-files')
              .upload(cleanPath, fileBlob, {
                contentType: contentType,
                upsert: true,
                cacheControl: '31536000'
              });
            if (fallbackRes.error) throw fallbackRes.error;
            const pub = client.storage.from('library-files').getPublicUrl(cleanPath);
            return pub.data ? pub.data.publicUrl : '';
          }
          throw error;
        }

        const pubUrl = client.storage.from(bucket).getPublicUrl(cleanPath);
        return pubUrl.data ? pubUrl.data.publicUrl : '';
      }

      // 2. إذا كان الموفر Amazon AWS S3
      if (this.config.provider === 'aws-s3') {
        const region = this.config.awsRegion || 'us-east-2';
        const bucket = this.config.awsBucket;
        let endpoint = this.config.awsEndpoint;
        if (!endpoint) {
          endpoint = `https://${bucket}.s3.${region}.amazonaws.com`;
        }
        const fullUrl = `${endpoint.replace(/\/+$/, '')}/${cleanPath}`;

        // محاولة الرفع عبر PUT مباشر (إذا تم ضبط S3 Bucket مع CORS مناسب)
        try {
          const res = await fetch(fullUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': contentType,
              'x-amz-acl': 'public-read'
            },
            body: fileBlob
          });
          if (!res.ok) {
            throw new Error(`خطأ S3: ${res.status} ${res.statusText}`);
          }
          return fullUrl;
        } catch (s3Err) {
          console.warn('تعذر الرفع المباشر لـ S3، جاري الرجوع لـ Supabase Storage:', s3Err);
          // الرجوع التلقائي لموفر Supabase المدمج لضمان استمرار عمل التطبيق
          const client = this.getSupabaseClient();
          if (client) {
            const res = await client.storage.from('library-files').upload(cleanPath, fileBlob, {
              contentType: contentType,
              upsert: true
            });
            if (!res.error) {
              const p = client.storage.from('library-files').getPublicUrl(cleanPath);
              return p.data ? p.data.publicUrl : fullUrl;
            }
          }
          throw s3Err;
        }
      }

      throw new Error('موفر سحابي غير مدعوم');
    },

    /**
     * رفع صورة مخدوم بنمط Sons of Light
     * المسار: defaults/user/{studentId}/profile_{timestamp}.jpg
     */
    uploadStudentPhoto: async function (studentId, fileOrBlob) {
      const sId = String(studentId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
      const compressed = await this.compressImage(fileOrBlob);
      const path = `defaults/user/${sId}/profile_${Date.now()}.jpg`;
      const publicUrl = await this.uploadFile(path, compressed.blob, 'image/jpeg');
      return { url: publicUrl, previewDataUrl: compressed.dataUrl };
    },

    /**
     * رفع صورة خادم بنمط Sons of Light
     * المسار: defaults/user/{servantId}/servant_{timestamp}.jpg
     */
    uploadServantPhoto: async function (servantId, fileOrBlob) {
      const sId = String(servantId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
      const compressed = await this.compressImage(fileOrBlob);
      const path = `defaults/user/${sId}/servant_${Date.now()}.jpg`;
      const publicUrl = await this.uploadFile(path, compressed.blob, 'image/jpeg');
      return { url: publicUrl, previewDataUrl: compressed.dataUrl };
    },

    /**
     * رفع صورة الفصل بنمط Sons of Light
     * المسار: defaults/activityClass/{classId}/Class_{timestamp}.jpg
     */
    uploadClassPhoto: async function (classId, fileOrBlob) {
      const cId = String(classId || 'default_class').replace(/[^a-zA-Z0-9_-]/g, '_');
      const compressed = await this.compressImage(fileOrBlob, 900, 0.85);
      const path = `defaults/activityClass/${cId}/Class_${Date.now()}.jpg`;
      const publicUrl = await this.uploadFile(path, compressed.blob, 'image/jpeg');
      return { url: publicUrl, previewDataUrl: compressed.dataUrl };
    },

    /**
     * أداة ترحيل الصور القديمة المخزنة بصيغة Base64 إلى السحابة تلقائياً
     * هذا الإجراء يقلل حجم قاعدة البيانات بنسبة تصل إلى 95%!
     */
    migrateLegacyPhotos: async function (students, servants, classPhoto, onProgress) {
      let migratedCount = 0;
      let totalTasks = 0;

      // حساب العناصر التي تحتاج لترحيل
      if (classPhoto && classPhoto.startsWith('data:image')) totalTasks++;
      if (Array.isArray(students)) {
        students.forEach((s) => {
          if (s.photo && s.photo.startsWith('data:image')) totalTasks++;
        });
      }
      if (Array.isArray(servants)) {
        servants.forEach((sv) => {
          if (sv.photo && sv.photo.startsWith('data:image')) totalTasks++;
        });
      }

      if (totalTasks === 0) {
        return { success: true, count: 0, message: 'جميع الصور مرفوعة ومحدثة على السحابة بالفعل!' };
      }

      function dataURItoBlob(dataURI) {
        const byteString = atob(dataURI.split(',')[1]);
        const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i);
        }
        return new Blob([ab], { type: mimeString });
      }

      let currentStep = 0;
      function report(name) {
        currentStep++;
        if (typeof onProgress === 'function') {
          onProgress({ current: currentStep, total: totalTasks, name });
        }
      }

      // ترحيل صورة الفصل
      let newClassPhoto = classPhoto;
      if (classPhoto && classPhoto.startsWith('data:image')) {
        try {
          report('صورة الفصل');
          const blob = dataURItoBlob(classPhoto);
          const res = await CloudStorage.uploadClassPhoto('general', blob);
          newClassPhoto = res.url;
          migratedCount++;
        } catch (e) {
          console.warn('تعذر ترحيل صورة الفصل:', e);
        }
      }

      // ترحيل صور المخدومين
      if (Array.isArray(students)) {
        for (let i = 0; i < students.length; i++) {
          const s = students[i];
          if (s.photo && s.photo.startsWith('data:image')) {
            try {
              report(`مخدوم: ${s.name || s.id}`);
              const blob = dataURItoBlob(s.photo);
              const res = await CloudStorage.uploadStudentPhoto(s.id || `stu_${i}`, blob);
              s.photo = res.url;
              migratedCount++;
            } catch (e) {
              console.warn(`تعذر ترحيل صورة المخدوم ${s.name}:`, e);
            }
          }
        }
      }

      // ترحيل صور الخدام
      if (Array.isArray(servants)) {
        for (let i = 0; i < servants.length; i++) {
          const sv = servants[i];
          if (sv.photo && sv.photo.startsWith('data:image')) {
            try {
              report(`خادم: ${sv.name || sv.sid}`);
              const blob = dataURItoBlob(sv.photo);
              const res = await CloudStorage.uploadServantPhoto(sv.sid || `srv_${i}`, blob);
              sv.photo = res.url;
              migratedCount++;
            } catch (e) {
              console.warn(`تعذر ترحيل صورة الخادم ${sv.name}:`, e);
            }
          }
        }
      }

      return {
        success: true,
        count: migratedCount,
        newClassPhoto,
        message: `تم ترحيل ${migratedCount} من أصل ${totalTasks} صورة إلى السحابة بنجاح!`
      };
    }
  };

  window.CloudStorage = CloudStorage;
})(window);
