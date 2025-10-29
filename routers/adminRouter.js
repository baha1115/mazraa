// routers/adminRouter.js
const express = require('express');
const router = express.Router();
const ContractorRequest = require('../models/contractorRequestModel');
const Farm = require('../models/farmModel');
const PromoBanner = require('../models/PromoBanner'); // ← جديد
const Contractor = require('../models/contactorsModel');
const User = require('../models/usermodels');
const SubscriptionRequest = require('../models/subscriptionRequest');
const HomeQuickLinks = require('../models/HomeQuickLinks');
const PromoConfig = require('../models/PromoConfig');
const { enforceExpiry } = require('../utils/enforceExpiry');
const { checkQuota } = require('../utils/quota');
const HeroSlide = require('../models/HeroSlide');
const HomeShowcase = require('../models/homeShowcase');
const SubscriptionConfig = require('../models/SubscriptionConfig');

// استخدم مايلرين منفصلين مع أسماء مستعارة واضحة
const { sendMail: sendFarmMail } = require('../utils/mailer');   // SMTP للأراضي
const { sendMail: sendContractorMail } = require('../utils/mailer2'); // SMTP للمقاولين
// === إضافة في أعلى adminRouter.js ===
// يضبط المزارع المسموح بها حسب مستوى الاشتراك ويعلّق الباقي
async function applyContractorPlanLimitsForUser(userId, tier) {
  const cfg = await SubscriptionConfig.findOne({ key:'sub-plans' }).lean().catch(()=>null);
  const limitByTier = {
    Basic:   cfg?.basicLimit   ?? 1,
    Premium: cfg?.premiumLimit ?? 2,
    VIP:     cfg?.vipLimit     ?? 999,
  };
  const allow = limitByTier[tier] ?? 1;

  // نجيب كل كروت المقاول (المعتمدة أولاً) وبالأحدث:
  const all = await ContractorRequest.find({
    user: userId,
    deletedAt: null
  }).sort({ status: -1, createdAt: -1 }); // approved قبل pending

  const keep    = all.slice(0, allow);
  const suspend = all.slice(allow);

  await ContractorRequest.updateMany(
    { _id: { $in: keep.map(d => d._id) } },
    { $set: { isSuspended: false, suspendedReason: '' } }
  );

  await ContractorRequest.updateMany(
    { _id: { $in: suspend.map(d => d._id) } },
    { $set: { isSuspended: true,  suspendedReason: 'limit' } }
  );
}
async function applyPlanLimitsForUser(userId, tier) {
  const cfg = await SubscriptionConfig.findOne({ key:'sub-plans' }).lean().catch(()=>null);
  const limitByTier = {
    Basic:   cfg?.basicLimit   ?? 1,
    Premium: cfg?.premiumLimit ?? 2,
    VIP:     cfg?.vipLimit     ?? 999,
  };
  const allow = limitByTier[tier] ?? 1;

  const farms = await Farm.find({ owner: userId, deletedAt: null }).sort({ createdAt: -1 });
  const keep = farms.slice(0, allow);
  const suspend = farms.slice(allow);

  await Farm.updateMany(
    { _id: { $in: keep.map(f => f._id) } },
    { $set: { isSuspended: false, suspendedReason: '' } }
  );

  await Farm.updateMany(
    { _id: { $in: suspend.map(f => f._id) } },
    { $set: { isSuspended: true, suspendedReason: 'limit' } }
  );
}

// --- أعلى adminRouter.js ---
const path = require('path');
const fs = require('fs/promises');
const multer = require('multer');
const sharp = require('sharp');

// بدّل التخزين إلى الذاكرة
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

// حفظ صورة مضغوطة داخل /uploads/<subdir> باسم baseName.jpg
async function saveSharpImageToUploads(fileBuffer, subdir, baseName = Date.now().toString()) {
  const uploadsDir = path.join(__dirname, '..', 'uploads', subdir);
  await fs.mkdir(uploadsDir, { recursive: true });

  const outName = `${baseName}.jpg`;
  const outFull = path.join(uploadsDir, outName);

  await sharp(fileBuffer)
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(outFull);

  return `/uploads/${subdir}/${outName}`;
}

// حارس: يجب أن يكون المستخدم أدمن
function requireAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin') return next();
  return res.status(403).json({ ok: false, msg: 'Forbidden' });
}

// هل العميل يريد JSON (fetch/AJAX)؟
function wantsJSON(req) {
  const accept = req.get('accept') || '';
  return accept.includes('application/json') || req.query.ajax === '1' || req.xhr;
}

/* =========================
   أراضي (FARMS) — مراجعة
   ========================= */

// GET /admin/farms?status=pending|approved|rejected
router.get('/farms', requireAdmin, async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const farms = await Farm.find({ status }).sort({ createdAt: -1 }).lean();
    return res.json({ ok: true, data: farms });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, msg: 'Server error' });
  }
});

// GET /admin/farms/:id  (تفاصيل للمعاينة)
router.get('/farms/:id', requireAdmin, async (req, res) => {
  try {
    const farm = await Farm.findById(req.params.id).lean();
    if (!farm) return res.status(404).json({ ok: false, msg: 'Not found' });
    return res.json({ ok: true, data: farm });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, msg: 'Server error' });
  }
});

// PATCH /admin/farms/:id/approve
router.patch('/farms/:id/approve', requireAdmin, async (req, res) => {
  try {
    // احضر الوثيقة أولاً بدون تعديل
    const farm = await Farm.findById(req.params.id).lean();
    if (!farm) {
      if (wantsJSON(req)) return res.status(404).json({ ok: false, msg: 'Not found' });
      return res.redirect('/admin/dashboard?type=danger&msg=العنصر%20غير%20موجود');
    }

    const ownerId = farm.owner || farm.owner?._id;
    if (ownerId) {
      // تأكد إن الاشتراك لم ينتهِ — إن انتهى يرجّع Basic
      await enforceExpiry(ownerId);

      // تحقّق من الكوته
      const { ok, used, limit, tier } = await checkQuota(ownerId, 'farm');
      if (!ok) {
        // ارفض الطلب بدل الموافقة
        await Farm.findByIdAndUpdate(farm._id, {
          status: 'rejected',
          rejectedAt: new Date(),
          reviewNote: `تجاوز حد خطة ${tier} (${used}/${limit})`
        });

        if (wantsJSON(req)) {
          return res.status(403).json({ ok:false, msg:`تجاوز حد خطة ${tier} (${used}/${limit})` });
        }
        return res.redirect('/admin/dashboard?type=warning&msg=تجاوز%20حد%20الخطة');
      }
    }

    // طالما ضمن الحد → وافق الآن
    const updated = await Farm.findByIdAndUpdate(
      req.params.id,
      { status: 'approved', approvedAt: new Date(), reviewNote: '' },
      { new: true }
    );

    // (إرسال بريد كما في كودك الأصلي إن رغبت)
    // ...
    try {
      let recipient = farm.ownerEmail || null;
      if (!recipient && farm.owner) {
        const user = await User.findById(farm.owner).lean().catch(() => null);
        if (user?.email) recipient = user.email;
      }
      if (!recipient && farm.owner && typeof farm.owner === 'object' && farm.owner.email) {
        recipient = farm.owner.email;
      }
      if (recipient) {
        const subject = `تمت الموافقة على إعلان أرضك: ${farm.title || ''}`;
        const text = `تمت الموافقة على إعلان أرضك (${farm.title || ''}).`;
        const html = `<p>تمت الموافقة على إعلان أرضك <strong>${farm.title || ''}</strong>.</p>`;
        sendFarmMail({ to: recipient, subject, text, html }).catch(err =>
          console.error('Farm mail error:', err.message)
        );
      }
    } catch (_) {}

    if (wantsJSON(req)) return res.json({ ok: true, msg: 'Approved', data: updated });
    return res.redirect('/admin/dashboard?type=success&msg=تمت%20الموافقة');
  } catch (err) {
    console.error(err);
    if (wantsJSON(req)) return res.status(500).json({ ok: false, msg: 'Server error' });
    return res.redirect('/admin/dashboard?type=danger&msg=خطأ%20داخلي');
  }
});
// PATCH /admin/farms/:id/reject
router.patch('/farms/:id/reject', requireAdmin, async (req, res) => {
  try {
    const note = (req.body && req.body.note) ? String(req.body.note) : '';

    const farm = await Farm.findByIdAndUpdate(
      req.params.id,
      { status: 'rejected', reviewNote: note, rejectedAt: new Date() }, // rejectedAt لدعم TTL إن مُفعل
      { new: true }
    );

    if (!farm) {
      if (wantsJSON(req)) return res.status(404).json({ ok: false, msg: 'Not found' });
      return res.redirect('/admin/dashboard?type=danger&msg=العنصر%20غير%20موجود');
    }

    // إشعار رفض عبر mailer (SMTP المخصص للأراضي)
    try {
      let recipient = farm.ownerEmail || null;
      if (!recipient && farm.owner) {
        const user = await User.findById(farm.owner).lean().catch(() => null);
        if (user?.email) recipient = user.email;
      }
      if (!recipient && farm.owner && typeof farm.owner === 'object' && farm.owner.email) {
        recipient = farm.owner.email;
      }

      if (recipient) {
        const subject = `تم رفض إعلان الأرض: ${farm.title || ''}`;
        const reasonBlock = note ? `<p><strong>سبب الرفض:</strong> ${note}</p>` : '';
        const html = `
          <div style="font-family:Tahoma,Arial,sans-serif;line-height:1.6">
            <p>مرحبًا،</p>
            <p>نأسف لإبلاغك بأن إعلان أرضك <strong>${farm.title || ''}</strong> قد تم رفضه.</p>
            ${reasonBlock}
            <p>يمكنك تعديل البيانات وإعادة الإرسال للمراجعة.</p>
          </div>`;
        const text = `تم رفض إعلان الأرض: ${farm.title || ''}${note ? '\nسبب الرفض: '+note : ''}`;
        sendFarmMail({ to: recipient, subject, html, text }).catch(err =>
          console.error('Farm mail error:', err.message)
        );
      }
    } catch (_) {}

    if (wantsJSON(req)) return res.json({ ok: true, msg: 'Rejected', data: farm });
    return res.redirect('/admin/dashboard?type=warn&msg=تم%20الرفض');
  } catch (err) {
    console.error(err);
    if (wantsJSON(req)) return res.status(500).json({ ok: false, msg: 'Server error' });
    return res.redirect('/admin/dashboard?type=danger&msg=خطأ%20داخلي');
  }
});

/* =========================
   مقاولون (CONTRACTORS) — مراجعة
   ========================= */

// GET /admin/contractors?status=pending|approved|rejected
router.get('/contractors', requireAdmin, async (req, res) => {
  try {
    const status = req.query.status || 'pending';
    const rows = await ContractorRequest.find({ status }).sort({ updatedAt: -1 }).lean();
    return res.json({ ok: true, data: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, msg: 'Server error' });
  }
});

// GET /admin/contractors/:id  (تفاصيل للمعاينة)
router.get('/contractors/:id', requireAdmin, async (req, res) => {
  try {
    const doc = await ContractorRequest.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ ok: false, msg: 'Not found' });
    return res.json({ ok: true, data: doc });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, msg: 'Server error' });
  }
});

// PATCH /admin/contractors/:id/approve
router.patch('/contractors/:id/approve', requireAdmin, async (req, res) => {
  try {
    // احضر الوثيقة أولاً بدون تعديل
    const doc = await ContractorRequest.findById(req.params.id).lean();
    if (!doc) {
      if (wantsJSON(req)) return res.status(404).json({ ok:false, msg:'Not found' });
      return res.redirect('/admin/dashboard?type=danger&msg=العنصر%20غير%20موجود');
    }

    const userId = doc.user || doc.user?._id;
    if (userId) {
      await enforceExpiry(userId);

      const { ok, used, limit, tier } = await checkQuota(userId, 'contractor');
      if (!ok) {
        // ارفض بدل الموافقة
        await ContractorRequest.findByIdAndUpdate(doc._id, {
          status: 'rejected',
          rejectedAt: new Date(),
          reviewNote: `تجاوز حد خطة ${tier} (${used}/${limit})`
        });

        if (wantsJSON(req)) {
          return res.status(403).json({ ok:false, msg:`تجاوز حد خطة ${tier} (${used}/${limit})` });
        }
        return res.redirect('/admin/dashboard?type=warning&msg=تجاوز%20حد%20الخطة');
      }
    }

    // ضمن الحد → وافق الآن
    const updated = await ContractorRequest.findByIdAndUpdate(
      req.params.id,
      { status: 'approved', approvedAt: new Date(), reviewNote: '' },
      { new: true }
    );

    // (إرسال بريد كما في كودك الأصلي إن رغبت)
    // ...
    if (doc.email) {
      const subject = `تمت الموافقة على ملفك — ${doc.companyName || doc.name || 'مقاول'}`;
      const text = `تمت الموافقة على ملفك كمقاول وسيظهر للجمهور.`;
      const html = `<p>تمت الموافقة على ملفك كمقاول وسيظهر للجمهور.</p>`;
      sendContractorMail({ to: doc.email, subject, text, html }).catch(err =>
        console.error('Contractor mail error:', err.message)
      );
    }
    if (wantsJSON(req)) return res.json({ ok:true, msg:'Approved', data:updated });
    return res.redirect('/admin/dashboard?type=success&msg=تمت%20الموافقة');
  } catch (e) {
    console.error(e);
    if (wantsJSON(req)) return res.status(500).json({ ok:false, msg:'Server error' });
    return res.redirect('/admin/dashboard?type=danger&msg=خطأ%20داخلي');
  }
});
// PATCH /admin/contractors/:id/reject
router.patch('/contractors/:id/reject', requireAdmin, async (req, res) => {
  try {
    const note = (req.body && req.body.note) ? String(req.body.note) : '';
    const doc = await ContractorRequest.findByIdAndUpdate(
      req.params.id,
      { status: 'rejected', reviewNote: note, rejectedAt: new Date() },
      { new: true }
    );
    if (!doc) {
      if (wantsJSON(req)) return res.status(404).json({ ok:false, msg:'Not found' });
      return res.redirect('/admin/dashboard?type=danger&msg=العنصر%20غير%20موجود');
    }

    if (doc.email) {
      const subject = `تم رفض طلبك — ${doc.companyName || doc.name || 'مقاول'}`;
      const html = `
        <div style="font-family:Tahoma,Arial,sans-serif">
          <p>مرحباً ${doc.name || ''},</p>
          <p>نأسف لإبلاغك أنه تم رفض ملفك.</p>
          ${note ? `<p><strong>السبب:</strong> ${note}</p>` : ''}
          <p>يمكنك تعديل بياناتك وإعادة الإرسال للمراجعة.</p>
        </div>`;
      const text = `تم رفض ملفك.${note ? ' السبب: ' + note : ''}`;
      sendContractorMail({ to: doc.email, subject, html, text }).catch(err =>
        console.error('Contractor mail error:', err.message)
      );
    }

    if (wantsJSON(req)) return res.json({ ok:true, msg:'Rejected', data:doc });
    return res.redirect('/admin/dashboard?type=warn&msg=تم%20الرفض');
  } catch (e) {
    console.error(e);
    if (wantsJSON(req)) return res.status(500).json({ ok:false, msg:'Server error' });
    return res.redirect('/admin/dashboard?type=danger&msg=خطأ%20داخلي');
  }
});
// GET /admin/dashboard  ← صفحة لوحة الإدارة
router.get('/dashboard', requireAdmin, (req, res) => {
  // مرّر رسالة التنبيه الاختيارية من الكويري إلى القالب
  res.render('adminDashbord', {
    user: req.session.user || null,
    msg:  req.query.msg  || '',
    type: req.query.type || '' // success | warn | danger .. إلخ
  });
});

// (اختياري) لو زار /admin مباشرةً، حوّله للداشبورد
router.get('/', requireAdmin, (req, res) => {
  res.redirect('/admin/dashboard');
});


// GET /admin/subscriptions?status=pending|approved|rejected
router.get('/subscriptions', requireAdmin, async (req,res)=>{
  try{
    const status = (req.query.status || 'pending');
    const rows = await SubscriptionRequest.find({ status })
      .populate('user', 'name email subscriptionTier subscriptionExpiresAt subscriptionGraceUntil role')
      .lean();
    res.json({ ok:true, data: rows });
  }catch(e){
    console.error(e);
    res.status(500).json({ ok:false, msg:'Server error' });
  }
});

// --- PATCH /admin/subscriptions/:id/approve  (يحدد شهر/سنة) ---
router.patch('/subscriptions/:id/approve', requireAdmin, async (req,res)=>{
  try{
    const doc = await SubscriptionRequest.findById(req.params.id).populate('user','_id');
    if(!doc) return res.status(404).json({ ok:false, msg:'Not found' });

    // حدّث حالة الطلب
    doc.status = 'approved';
    doc.reviewNote = '';
    await doc.save();

    // مدة من الواجهة: 'month' أو 'year' (افتراضي شهر)
    const duration = (req.body?.duration === 'year') ? 'year' : 'month';
    //
   

    // قراءة قيم الأيام من SubscriptionConfig
    const plans = await SubscriptionConfig.findOne({ key:'sub-plans' }).lean().catch(()=>null);
    const monthDays = plans?.monthDays ?? 30;
    const yearDays  = plans?.yearDays  ?? 365;
    const days = duration === 'year' ? yearDays : monthDays;

    // حساب تاريخ الانتهاء
    const now = new Date();
    const expiresAt = new Date(now.getTime() + days*24*60*60*1000);

    // تفعيل الخطة على المستخدم + تصفير مهلة السماح
    if (doc.user?._id) {
      await User.findByIdAndUpdate(doc.user._id, {
        $set: {
          subscriptionTier: doc.plan,          // Premium أو VIP
          subscriptionExpiresAt: expiresAt,
          subscriptionGraceUntil: null
        }
      });

      // مزامنة اختيارية مع سجلات المقاول
      await ContractorRequest.updateMany(
        { user: doc.user._id },
        { $set: { subscriptionTier: doc.plan || 'Basic' } }
      );
       await applyPlanLimitsForUser(doc.user._id, doc.plan);
       await applyContractorPlanLimitsForUser(doc.user._id, doc.plan);
    }

    res.json({ ok:true, expiresAt, duration });
  }catch(e){
    console.error(e);
    res.status(500).json({ ok:false, msg:'Server error' });
  }
});

// PATCH /admin/subscriptions/:id/reject
router.patch('/subscriptions/:id/reject', requireAdmin, async (req, res) => {
  const note = (req.body?.note || '').toString();
  const r = await SubscriptionRequest.findByIdAndUpdate(
    req.params.id,
    { status:'rejected', rejectedAt:new Date(), reviewNote: note },
    { new:true }
  ).populate('user', 'email name');

  if (!r) return res.status(404).json({ ok:false, msg:'Not found' });
  res.json({ ok:true, msg:'Rejected', data:r });
});
// صفحة لوحة الأدمن الأساسية
router.get('/', requireAdmin, async (req, res) => {
  const Promo = require('../models/PromoConfig'); // انتبه للاسم الصحيح
  const promo = await Promo.findOne({ key: 'contractors' }).lean();
  res.render('adminDashbord', {
    user: req.session.user,
    promo: promo || {}   // ← مهم جداً
  });
});

// صفحة إدارة برومو (إن وجدت)
router.get('/promo/contractors', requireAdmin, async (req,res)=>{
  const Promo = require('../models/PromoConfig');
  const promo = await Promo.findOne({ key:'contractors' }).lean();
  // اعرض نفس الداشبورد أو صفحة خاصة — الأهم تمرير promo
  res.render('adminDashbord', {
    user: req.session.user,
    promo: promo || {}
  });
});

// حفظ إعدادات البرومو
// حفظ إعدادات البرومو (البنر السفلي) — يدعم رفع صورة
router.post(
  '/promo/contractors',
  requireAdmin,
  upload.single('imgFile'), // ← جديد: استقبال ملف باسم imgFile
  async (req, res) => {
    const Promo = require('../models/PromoConfig'); // أو PromoBlock حسب ملفك
    // اختر المصدر: الملف المرفوع أو رابط احتياطي من الحقل النصّي
    const imgFromUpload = req.file ? `/uploads/promo/${req.file.filename}` : '';
    const imgFromUrl    = (req.body.img || '').trim();
    const payload = {
      enabled: req.body.enabled === 'on',
      img:      imgFromUpload || imgFromUrl, // ← الأهم
      title:   (req.body.title||'').trim(),
      text:    (req.body.text||'').trim(),
      link:    (req.body.link||'').trim(),
    };

    await Promo.findOneAndUpdate(
      { key:'contractors' },
      { $set: payload, $setOnInsert: { key:'contractors' } },
      { upsert:true }
    );

    const fresh = await Promo.findOne({ key:'contractors' }).lean();
    res.render('adminDashbord', {
      user: req.session.user,
      promo: fresh || {}
    });
  }
);
// دالة تضمن وجود وثيقة البانرات، وإلا تنشئها
async function getOrInit(key = 'home-banners') {
  let doc = await PromoBanner.findOne({ key });
  if (!doc) {
    doc = await PromoBanner.create({ key, enabled: true, items: [] });
  }
  return doc;
}


// GET: عرض البنرات JSON (لوحة الأدمن تحتاجه)
router.get('/promo/banners', requireAdmin, async (req, res) => {
  try {
    const doc = await getOrInit('home-banners');
    res.json({ ok:true, data: doc });
  } catch (e) {
    console.error(e); res.status(500).json({ ok:false, msg:'Server error' });
  }
});

// POST: إضافة بانر جديد
router.post('/promo/banners',
  requireAdmin,
  upload.single('imgFile'),
  async (req, res) => {
    try {
      const { title='', text='', link='', btn='التفاصيل' } = req.body;

      // لو رفع ملف: خزّنه بـ sharp داخل مجلد promo
      const uploadedPath = req.file
        ? await saveSharpImageToUploads(req.file.buffer, 'promo')
        : '';

      const imgFromUrl = (req.body.img || '').trim();
      const img = uploadedPath || imgFromUrl;

      if (!img) return res.status(400).json({ ok:false, msg:'الصورة مطلوبة (رفع ملف أو رابط)' });

      const doc = await PromoBanner.findOneAndUpdate(
        { key: 'home-banners' },
        {
          $setOnInsert: { key:'home-banners', enabled: true },
          $push: { items: { img, title, text, link, btn, order: Date.now() } }
        },
        { new:true, upsert:true }
      );
      res.json({ ok:true, data: doc });
    } catch (e) {
      console.error(e);
      res.status(500).json({ ok:false, msg:'Server error' });
    }
});

// PATCH: تفعيل/تعطيل البنرات
router.patch('/promo/banners/enabled', requireAdmin, async (req, res) => {
  try {
    const enabled = !!req.body.enabled;
    const doc = await PromoBanner.findOneAndUpdate(
      { key: 'home-banners' },
      { $set: { enabled } },
      { new:true, upsert:true }
    );
    res.json({ ok:true, data: doc });
  } catch (e) {
    console.error(e); res.status(500).json({ ok:false, msg:'Server error' });
  }
});

// DELETE: حذف عنصر بانر معيّن
router.delete('/promo/banners/:itemId', requireAdmin, async (req, res) => {
  try {
    const { itemId } = req.params;
    const doc = await PromoBanner.findOneAndUpdate(
      { key:'home-banners' },
      { $pull: { items: { _id: itemId } } },
      { new:true }
    );
    res.json({ ok:true, data: doc });
  } catch (e) {
    console.error(e); res.status(500).json({ ok:false, msg:'Server error' });
  }
});
// === عام لأي مفتاح (sale-banners / rent-banners / contractors-banners …) ===

// GET: جلب وثيقة بنرات لِـ key معيّن
router.get('/promo/banners/:key', requireAdmin, async (req, res) => {
  try {
    const doc = await getOrInit(req.params.key);
    res.json({ ok:true, data: doc });
  } catch (e) {
    console.error(e); res.status(500).json({ ok:false, msg:'Server error' });
  }
});

// POST: إضافة عنصر (Upload أو رابط) داخل key معيّن
router.post('/promo/banners/:key',
  requireAdmin,
  upload.single('imgFile'),
  async (req, res) => {
    try {
      const { title='', text='', link='', btn='التفاصيل' } = req.body;

      const uploadedPath = req.file
        ? await saveSharpImageToUploads(req.file.buffer, 'promo')
        : '';

      const imgFromUrl = (req.body.img || '').trim();
      const img = uploadedPath || imgFromUrl;
      if (!img) return res.status(400).json({ ok:false, msg:'الصورة مطلوبة' });

      const doc = await PromoBanner.findOneAndUpdate(
        { key: req.params.key },
        {
          $setOnInsert: { key:req.params.key, enabled: true },
          $push: { items: { img, title, text, link, btn, order: Date.now() } }
        },
        { new:true, upsert:true }
      );
      res.json({ ok:true, data: doc });
    } catch (e) {
      console.error(e); res.status(500).json({ ok:false, msg:'Server error' });
    }
});

// PATCH: تفعيل/تعطيل وثيقة key
router.patch('/promo/banners/:key/enabled', requireAdmin, async (req, res) => {
  try {
    const enabled = !!req.body.enabled;
    const doc = await PromoBanner.findOneAndUpdate(
      { key: req.params.key },
      { $set: { enabled } },
      { new:true, upsert:true }
    );
    res.json({ ok:true, data: doc });
  } catch (e) {
    console.error(e); res.status(500).json({ ok:false, msg:'Server error' });
  }
});

// DELETE: حذف عنصر داخل key معيّن
router.delete('/promo/banners/:key/:itemId', requireAdmin, async (req, res) => {
  try {
    const { key, itemId } = req.params;
    const doc = await PromoBanner.findOneAndUpdate(
      { key },
      { $pull: { items: { _id: itemId } } },
      { new:true }
    );
    res.json({ ok:true, data: doc });
  } catch (e) {
    console.error(e); res.status(500).json({ ok:false, msg:'Server error' });
  }
});


/** GET: جميع الشرائح (JSON) */
router.get('/hero/slides', requireAdmin, async (req,res)=>{
  try{
    const rows = await HeroSlide.find({ enabled: { $ne: false } })
      .sort({ order: 1, createdAt: 1 }).lean();
    res.json({ ok:true, data: rows });
  }catch(e){
    console.error(e); res.status(500).json({ ok:false, msg:'Server error' });
  }
});

/** POST: إضافة شريحة */
// POST: إضافة شريحة هيرو — يدعم رفع صورة أو رابط احتياطي
router.post('/hero/slides',
  requireAdmin,
  upload.single('imgFile'),
  async (req,res)=>{
    try{
      const title = (req.body.title||'').trim();
      const lead  = (req.body.lead ||'').trim();

      const uploadedPath = req.file
        ? await saveSharpImageToUploads(req.file.buffer, 'promo')
        : '';

      const imgFromUrl = (req.body.img || '').trim();
      const img = uploadedPath || imgFromUrl;
      if (!img) return res.status(400).json({ ok:false, msg:'الصورة مطلوبة' });

      const max = await HeroSlide.findOne().sort({ order:-1 }).lean();
      const row = await HeroSlide.create({
        img, title, lead,
        order: (max?.order ?? -1) + 1,
        enabled: true
      });

      res.json({ ok:true, data: row });
    }catch(e){
      console.error(e);
      res.status(500).json({ ok:false, msg:'Server error' });
    }
});

/** PATCH: تعديل شريحة */
router.patch('/hero/slides/:id', requireAdmin, async (req,res)=>{
  try{
    const row = await HeroSlide.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new:true }
    );
    if(!row) return res.status(404).json({ ok:false, msg:'Not found' });
    res.json({ ok:true, data: row });
  }catch(e){
    console.error(e); res.status(500).json({ ok:false, msg:'Server error' });
  }
});

/** DELETE: حذف شريحة */
router.delete('/hero/slides/:id', requireAdmin, async (req,res)=>{
  try{
    const row = await HeroSlide.findByIdAndDelete(req.params.id);
    if(!row) return res.status(404).json({ ok:false, msg:'Not found' });
    res.json({ ok:true });
  }catch(e){
    console.error(e); res.status(500).json({ ok:false, msg:'Server error' });
  }
});

/** PATCH: ترتيب دفعي */
router.patch('/hero/slides/reorder', requireAdmin, async (req,res)=>{
  try{
    // body: [{_id, order}, ...]
    const arr = Array.isArray(req.body) ? req.body : [];
    const ops = arr.map(it => ({
      updateOne: { filter:{ _id: it._id }, update:{ $set:{ order: Number(it.order)||0 } } }
    }));
    if (ops.length) await HeroSlide.bulkWrite(ops);
    res.json({ ok:true });
  }catch(e){
    console.error(e); res.status(500).json({ ok:false, msg:'Server error' });
  }
});


// GET (JSON): جلب الإعدادات الحالية
router.get('/quick-links', async (req, res) => {
  try {
    const doc = await HomeQuickLinks.findOne({ key: 'default' }).lean();
    res.json({ ok:true, data: doc || null });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, msg:'Server error' });
  }
});

// POST: حفظ/تحديث الإعدادات
// حفظ صور "تصفّح الأقسام الشائعة"
// POST: حفظ صور "تصفّح الأقسام الشائعة" بالـ upload
router.post('/quick-links',
  requireAdmin,
  upload.fields([
    { name: 'saleImgFile',        maxCount: 1 },
    { name: 'rentImgFile',        maxCount: 1 },
    { name: 'contractorsImgFile', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      let doc = await HomeQuickLinks.findOne({ key: 'default' });
      if (!doc) doc = new HomeQuickLinks({ key: 'default' });

      // إن وُجدت ملفات، خزّنها بالشّارب
      const f = req.files || {};

      let salePath = doc.saleImg || '';
      if (f.saleImgFile?.[0]?.buffer) {
        salePath = await saveSharpImageToUploads(f.saleImgFile[0].buffer, 'promo');
      }

      let rentPath = doc.rentImg || '';
      if (f.rentImgFile?.[0]?.buffer) {
        rentPath = await saveSharpImageToUploads(f.rentImgFile[0].buffer, 'promo');
      }

      let contPath = doc.contractorsImg || '';
      if (f.contractorsImgFile?.[0]?.buffer) {
        contPath = await saveSharpImageToUploads(f.contractorsImgFile[0].buffer, 'promo');
      }

      doc.enabled        = !!req.body.enabled;
      doc.saleImg        = salePath;
      doc.rentImg        = rentPath;
      doc.contractorsImg = contPath;

      await doc.save();
      res.redirect('/admin?type=success&msg=تم%20الحفظ');
    } catch (e) {
      console.error(e);
      res.status(500).send('Server error');
    }
});

// جلب كل الأقسام (للداشبورد)
router.get('/home/showcase', async (req,res) => {
  const rows = await HomeShowcase.find({}).lean();
  res.json({ ok:true, data: rows });
});

// إنشاء/تحديث سكشن (upsert)
// إضافة عنصر (كارت) عبر الرفع لسكشن من سلايدر الصفحة الرئيسية
router.post(
  '/home/showcase/:key/item',
  requireAdmin,
  upload.single('imgFile'),
  async (req, res) => {
    try {
      const { key } = req.params; // rentTop | saleTop | bestContractors
      const title = (req.body.title || '').trim();
      const desc  = (req.body.desc  || '').trim();
      const link  = (req.body.link  || '').trim();

      const img = req.file ? `/uploads/promo/${req.file.filename}` : '';
      if (!img) return res.status(400).send('الرجاء اختيار صورة');

      // ملاحظة: أزلنا items من $setOnInsert لتفادي التعارض مع $push
      const doc = await HomeShowcase.findOneAndUpdate(
        { key },
        {
          $setOnInsert: { key, title: '', enabled: true }, // ← بدون items هنا
          $push: { items: { img, title, desc, link, order: Date.now() } }
        },
        { new: true, upsert: true }
      );

      return res.redirect('/admin');
    } catch (e) {
      console.error(e);
      return res.status(500).send('Server error');
    }
  }
);

// حذف عنصر داخل سكشن بالاندكس (اختياري)
router.delete('/home/showcase/:key/item/:idx', async (req,res)=>{
  const { key, idx } = req.params;
  const doc = await HomeShowcase.findOne({ key });
  if(!doc) return res.json({ ok:false, msg:'Not found' });
  const i = Number(idx);
  if (Number.isInteger(i) && i>=0 && i<doc.items.length){
    doc.items.splice(i,1);
    await doc.save();
  }
  res.json({ ok:true, data:doc });
});
// --- Promo Bottom (page-specific) ---
// key values: 'sale' | 'rent' | 'contractors'
function bottomKey(req) {
  const k = (req.query.key || '').toString();
  return ['sale','rent','contractors'].includes(k) ? k : 'sale';
}

router.get('/promo/bottom', requireAdmin, async (req, res) => {
  try {
    const k   = bottomKey(req);
    const doc = await PromoConfig.findOne({ key: `promo-bottom:${k}` }).lean();
    res.json({ ok:true, data: doc || { enabled:false } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, msg:'Server error' });
  }
});

router.post('/promo/bottom',
  requireAdmin,
  upload.single('imgFile'),
  async (req, res) => {
    try {
      const k = bottomKey(req);

      const uploadedPath = req.file
        ? await saveSharpImageToUploads(req.file.buffer, 'promo')
        : '';

      const img = uploadedPath || (req.body.img || '').trim();

      const payload = {
        enabled: req.body.enabled === 'on' || req.body.enabled === 'true',
        img,
        title: (req.body.title||'').trim(),
        text:  (req.body.text ||'').trim(),
        link:  (req.body.link ||'').trim(),
        btn:   (req.body.btn  ||'').trim() || 'التفاصيل',
      };

      await PromoConfig.findOneAndUpdate(
        { key: `promo-bottom:${k}` },
        { $set: payload, $setOnInsert: { key: `promo-bottom:${k}` } },
        { upsert:true }
      );

      return res.redirect('/admin?type=success&msg=تم%20الحفظ');
    } catch (e) {
      console.error(e);
      return res.status(500).send('Server error');
    }
});

// DELETE: مسح/تعطيل البنر السفلي لصفحة معيّنة (sale | rent | contractors)
// الاستعمال: DELETE /admin/promo/bottom?key=sale  أو rent/contractors
router.delete('/promo/bottom', requireAdmin, async (req, res) => {
  try {
    const k = bottomKey(req); // يعيد sale/rent/contractors (موجود عندك فوق)
    const cleared = {
      enabled: false,
      img: '',
      title: '',
      text: '',
      link: '',
      btn: ''
    };
    await PromoConfig.findOneAndUpdate(
      { key: `promo-bottom:${k}` },
      { $set: cleared, $setOnInsert: { key: `promo-bottom:${k}` } },
      { new: true, upsert: true }
    );
    return res.json({ ok: true, msg: 'Deleted' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, msg:'Server error' });
  }
});
// بدل PromoConfig بهذا:

// GET
router.get('/sub-plans', requireAdmin, async (req, res) => {
  try {
    const doc = await SubscriptionConfig.findOne({ key: 'sub-plans' }).lean();
    res.json({ ok:true, data: doc || { monthDays:30, yearDays:365, basicLimit:1, premiumLimit:5, vipLimit:999 } });
  } catch (e) { console.error(e); res.status(500).json({ ok:false }); }
});

// POST
router.post('/sub-plans', requireAdmin, async (req, res) => {
  try {
    const { monthDays=30, yearDays=365, basicLimit=1, premiumLimit=5, vipLimit=999 } = req.body;
    const doc = await SubscriptionConfig.findOneAndUpdate(
      { key:'sub-plans' },
      { $set:{
        monthDays:Number(monthDays)||30,
        yearDays:Number(yearDays)||365,
        basicLimit:Number(basicLimit)||1,
        premiumLimit:Number(premiumLimit)||5,
        vipLimit:Number(vipLimit)||999
      }},
      { new:true, upsert:true }
    );
    res.json({ ok:true, data:doc });
  } catch (e) { console.error(e); res.status(500).json({ ok:false }); }
});

module.exports = router;
