// routers/adminRouter.js
const express = require('express');
const router = express.Router();
const ContractorRequest = require('../models/contractorRequestModel');
const Farm = require('../models/farmModel');
const PromoBanner = require('../models/PromoBanner'); // ← جديد
const Contractor = require('../models/contactorsModel');
const User = require('../models/usermodels');
const SubscriptionRequest = require('../models/subscriptionRequest');
const PromoConfig = require('../models/PromoConfig');
const { enforceExpiry } = require('../utils/enforceExpiry');
const { checkQuota } = require('../utils/quota');
const HeroSlide = require('../models/HeroSlide');
const HomeShowcase = require('../models/homeShowcase');
const SubscriptionConfig = require('../models/SubscriptionConfig');
const FooterSettings = require('../models/FooterSettings');

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
// --- Cloudinary (رفع الصور من الذاكرة) ---
const multer = require('multer');
const uploadMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 } // حد 8MB للصورة (عدّل لو تحب)
});

const { uploadBufferToCloudinary } = require('../utils/cloudinary');

// مساعد صغير: يرفع ملف واحد إن وُجد ويرجع secure_url
async function uploadImgIfAny(file, { folder = 'promo', publicIdPrefix = 'img' } = {}) {
  if (!file?.buffer) return '';
  const r = await uploadBufferToCloudinary(file.buffer, {
    folder,
    publicId: `${publicIdPrefix}_${Date.now()}`
  });
  return r?.secure_url || '';
}

// مساعد لاختيار مفتاح البنرات من query/params مع افتراضي
function bannerKey(req) {
  return (req.query.key || req.params.key || 'home-banners');
}

// مفتاح البانر السفلي (sale | rent | contractors)
function bottomKey(req) {
  return (req.query.key || req.body.__key__ || 'sale');
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
      // قبل: const { ok, used, limit, tier } = await checkQuota(ownerId, 'farm');
const { ok, used, limit, tier } = await checkQuota(ownerId, 'farm', null, { mode: 'approve' });
;
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
// حفظ إعدادات برومو المقاولين — رفع الصورة إلى Cloudinary
router.post(
  '/promo/contractors',
  requireAdmin,
  uploadMem.single('imgFile'),          // حقل الملف في الفورم اسمه imgFile كما هو
  async (req, res) => {
    try {
      const Promo = require('../models/PromoConfig');   // تأكد من المسار النسبي الصحيح

      // 1) لو رُفع ملف نستعمل Cloudinary، وإلا نسمح برابط نصّي بديل من input[name=img]
      let img = (req.body.img || '').trim();

      if (req.file?.buffer) {
        // نرفع بتهيئة مناسبة للبنرات (resize/auto format/auto quality من util عندك)
        const up = await uploadBufferToCloudinary(req.file.buffer, {
          folder: 'promo',                            // مجلد منطقي على كلاوديناري
          publicId: 'contractors_promo_' + Date.now() // اختياري: اسم عام
        });
        if (up?.secure_url) img = up.secure_url;
      }

      if (!img) {
        return res.status(400).json({ ok: false, msg: 'الصورة مطلوبة (رفع ملف أو رابط)' });
      }

      // 2) حمولة الحقول (نفس المنطق السابق تمامًا)
      const payload = {
        enabled: req.body.enabled === 'on' || req.body.enabled === 'true',
        img,
        title: (req.body.title || '').trim(),
        text:  (req.body.text  || '').trim(),
        link:  (req.body.link  || '').trim(),
        btn:   (req.body.btn   || '').trim() || 'التفاصيل'
      };

      // 3) نحفظ تحت المفتاح الثابت contractors
      await Promo.findOneAndUpdate(
        { key: 'contractors' },
        { $set: payload, $setOnInsert: { key: 'contractors' } },
        { upsert: true, new: true }
      );

      // 4) نعيد الريندر للداشبورد بنفس ما كنت تفعله
      const fresh = await Promo.findOne({ key: 'contractors' }).lean();
      return res.render('adminDashbord', {
        user: req.session.user,
        promo: fresh || {}
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ ok: false, msg: 'Server error' });
    }
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
    const key = bannerKey(req);
    const doc = await PromoBanner.findOne({ key }).lean();
    res.json({ ok: true, data: doc || { key, enabled: false, items: [] } });
  } catch (e) {
    console.error(e); res.status(500).json({ ok:false, msg:'Server error' });
  }
});


// POST: إضافة بانر جديد
router.post('/promo/banners',
  requireAdmin,
  uploadMem.single('imgFile'),
  async (req, res) => {
    try {
      const key = bannerKey(req);
      const { title = '', text = '', link = '', btn = 'التفاصيل' } = req.body;

      // لو فيه ملف: ارفعه إلى كلوديناري
      const uploadedUrl = await uploadImgIfAny(req.file, { folder: 'promo', publicIdPrefix: 'banner' });
      const imgFromUrl  = (req.body.img || '').trim();
      const img         = uploadedUrl || imgFromUrl;

      if (!img) return res.status(400).json({ ok:false, msg:'الصورة مطلوبة (رفع ملف أو رابط)' });

      const doc = await PromoBanner.findOneAndUpdate(
        { key },
        {
          $setOnInsert: { key, enabled: true },
          $push: { items: { img, title, text, link, btn, order: Date.now() } }
        },
        { new: true, upsert: true }
      );

      res.json({ ok: true, data: doc });
    } catch (e) {
      console.error(e); res.status(500).json({ ok:false, msg:'Server error' });
    }
  }
);

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
  uploadMem.single('imgFile'),
  async (req, res) => {
    try {
      const key = bannerKey(req);
      const { title = '', text = '', link = '', btn = 'التفاصيل' } = req.body;

      const uploadedUrl = await uploadImgIfAny(req.file, { folder: 'promo', publicIdPrefix: 'banner' });
      const imgFromUrl  = (req.body.img || '').trim();
      const img         = uploadedUrl || imgFromUrl;
      if (!img) return res.status(400).json({ ok:false, msg:'الصورة مطلوبة' });

      const doc = await PromoBanner.findOneAndUpdate(
        { key },
        {
          $setOnInsert: { key, enabled: true },
          $push: { items: { img, title, text, link, btn, order: Date.now() } }
        },
        { new: true, upsert: true }
      );

      res.json({ ok: true, data: doc });
    } catch (e) {
      console.error(e); res.status(500).json({ ok:false, msg:'Server error' });
    }
  }
);


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
  uploadMem.single('imgFile'),
  async (req, res) => {
    try {
      const title = (req.body.title || '').trim();
      const lead  = (req.body.lead  || '').trim();

      const uploadedUrl = await uploadImgIfAny(req.file, { folder: 'promo', publicIdPrefix: 'hero' });
      const imgFromUrl  = (req.body.img || '').trim();
      const img         = uploadedUrl || imgFromUrl;

      if (!img) return res.status(400).json({ ok:false, msg:'الصورة مطلوبة' });

      const max = await HeroSlide.findOne().sort({ order: -1 }).lean();
      const row = await HeroSlide.create({
        img, title, lead,
        order: (max?.order ?? -1) + 1,
        enabled: true
      });

      res.json({ ok:true, data: row });
    } catch (e) {
      console.error(e); res.status(500).json({ ok:false, msg:'Server error' });
    }
  }
);
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

// جلب كل الأقسام (للداشبورد)
router.get('/home/showcase', async (req,res) => {
  const rows = await HomeShowcase.find({}).lean();
  res.json({ ok:true, data: rows });
});

// إنشاء/تحديث سكشن (upsert)
// إضافة عنصر (كارت) عبر الرفع لسكشن من سلايدر الصفحة الرئيسية
// إضافة عنصر (كارت) إلى سِكشن من عرض الصفحة الرئيسية (rentTop | saleTop | bestContractors)
router.post(
  '/home/showcase/:key/item',
  requireAdmin,
  uploadMem.single('imgFile'),
  async (req, res) => {
    try {
      const { key } = req.params; // rentTop | saleTop | bestContractors
      const title = (req.body.title || '').trim();
      const desc  = (req.body.desc  || '').trim();
      const link  = (req.body.link  || '').trim();

      // نسمح إمّا برفع ملف، أو تمرير رابط جاهز من الحقل النصّي "img"
      let img = (req.body.img || '').trim();

      if (req.file?.buffer) {
        // ارفع إلى Cloudinary داخل فولدر واضح حسب السِكشن
        const up = await uploadBufferToCloudinary(req.file.buffer, {
          folder: `showcase/${key}`,            // مثال: showcase/bestContractors
          // publicId اختياري
        });
        if (up?.secure_url) img = up.secure_url;
      }

      if (!img) return res.status(400).send('الرجاء اختيار صورة أو إدخال رابط صورة');

      // بدون تغيير في منطق التخزين: items[].img يظل URL (صار Cloudinary بدل /uploads)
      const doc = await HomeShowcase.findOneAndUpdate(
        { key },
        {
          $setOnInsert: { key, title: '', enabled: true },
          $push: { items: { img, title, desc, link, order: Date.now() } }
        },
        { new: true, upsert: true }
      );

      return res.redirect('/admin?type=success&msg=تم%20الإضافة');
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
  uploadMem.single('imgFile'),
  async (req, res) => {
    try {
      const k = bottomKey(req);

      const uploadedUrl = await uploadImgIfAny(req.file, { folder: 'promo', publicIdPrefix: `bottom_${k}` });
      const img         = uploadedUrl || (req.body.img || '').trim();

      const payload = {
        enabled: req.body.enabled === 'on' || req.body.enabled === 'true',
        img,
        title: (req.body.title || '').trim(),
        text:  (req.body.text  || '').trim(),
        link:  (req.body.link  || '').trim(),
        btn:   (req.body.btn   || '').trim() || 'التفاصيل',
      };

      await PromoConfig.findOneAndUpdate(
        { key: `promo-bottom:${k}` },
        { $set: payload, $setOnInsert: { key: `promo-bottom:${k}` } },
        { upsert: true }
      );

      return res.redirect('/admin?type=success&msg=تم%20الحفظ');
    } catch (e) {
      console.error(e); return res.status(500).send('Server error');
    }
  }
);

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
// GET: قراءة إعدادات الفوتر
router.get('/site/footer', requireAdmin, async (req, res) => {
  try {
    const doc = await FooterSettings.findOne({ key: 'default' }).lean();
    return res.json({ ok: true, data: doc || {} });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, msg:'Server error' });
  }
});

// POST: حفظ إعدادات الفوتر
router.post('/site/footer', requireAdmin,uploadMem.none(), async (req, res) => {
  try {
     const clean = v => String(v || '').trim();
      const payload = {
        email:    clean(req.body.email),
        phone:    clean(req.body.phone),
        whatsapp: clean(req.body.whatsapp),
        address:  clean(req.body.address),
        facebook: clean(req.body.facebook),
        twitter:  clean(req.body.twitter),
        youtube:  clean(req.body.youtube),
        instagram:clean(req.body.instagram),
        tiktok:   clean(req.body.tiktok),
      };

    await FooterSettings.findOneAndUpdate(
      { key: 'default' },
      { $set: payload, $setOnInsert: { key: 'default' } },
      { upsert: true, new: true }
    );

    // حافظ على نفس سلوك مسارات الأدمن الأخرى: رد JSON أو Redirect مع رسالة
    const wantsJSON = /json/i.test(req.headers.accept || '');
    if (wantsJSON) return res.json({ ok:true, msg:'تم الحفظ' });
    return res.redirect('/admin/dashboard?type=success&msg=تم%20حفظ%20الفوتر');
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, msg:'Server error' });
  }
});
// قائمة المستخدمين (المسجّلون فقط افتراضيًا)
// قائمة المستخدمين (أدوار محددة فقط)
// GET /admin/users
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const { q = '', role = 'all', limit = 200, page = 1, verified } = req.query;

    // الأدوار المسموح عرضها
    const allowed = ['contractor', 'owner', 'landowner', 'admin'];
    const filter = {};

    // فلترة الدور
    if (role && role !== 'all') {
      filter.role = (role === 'owner') ? { $in: ['owner', 'landowner'] } : role;
    } else {
      filter.role = { $in: allowed };
    }

    // تفعيل البريد (اختياري عبر ?verified=1)
    if (String(verified) === '1') filter.emailVerified = true;

    // بحث نصي
    if (q && q.trim()) {
      const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(esc(q.trim()), 'i');
      filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
    }

    const lim  = Math.max(1, Math.min(1000, parseInt(limit)));
    const pg   = Math.max(1, parseInt(page));
    const skip = (pg - 1) * lim;

    const [items, total] = await Promise.all([
      User.find(filter)
        .select('name email phone role subscriptionTier subscriptionExpiresAt createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(lim)
        .lean(),
      User.countDocuments(filter)
    ]);

    res.json({ ok: true, data: items, total, page: pg, limit: lim });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'users_list_failed' });
  }
});

module.exports = router;
