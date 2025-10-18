// routers/ownerRouter.js
const express = require('express');
const Joi = require('joi');
const Farm = require('../models/farmModel');
const User = require('../models/usermodels'); // عدّل المسار لو مختلف
const router = express.Router();

/* ========= Middlewares ========= */
function requireAuth(req, res, next){
  if (req.session?.user?._id) return next();
  return res.status(401).json({ ok:false, msg:'Unauthorized' });
}

// خريطة الحصص حسب الخطة
function planLimit(plan) {
  if (plan === 'VIP') return Infinity;
  if (plan === 'Premium') return 2;
  return 1; // Basic
}

/* ========= Validation =========
   الـ frontend يُرسل:
   - ownerFirst/ownerLast/ownerWhatsapp
   - title, kind(sale|rent), area, city, size, price
   - photos[] (DataURL أو URL)
   - description أو desc
   - videoUrl (اختياري)
   - location {lat,lng,address} (اختياري)
*/
const landSchema = Joi.object({
  ownerFirst: Joi.string().allow(''),
  ownerLast: Joi.string().allow(''),
  ownerWhatsapp: Joi.string().allow(''),

  title: Joi.string().min(3).required(),
  kind: Joi.string().valid('sale','rent').required(),
  area: Joi.string().min(2).required(),
  city: Joi.string().allow(''),
  size: Joi.number().min(0).required(),
  price: Joi.number().min(0).required(),

  photos: Joi.array().items(Joi.string()).default([]),

   poolDesc: Joi.string().allow(''),
  amenitiesDesc: Joi.string().allow(''),
  buildingDesc: Joi.string().allow(''),

  description: Joi.string().allow(''),
  desc: Joi.string().allow(''),

  videoUrl: Joi.string().uri().allow(''),

  location: Joi.object({
    lat: Joi.number(),
    lng: Joi.number(),
    address: Joi.string().allow(''),
  }).allow(null),
});

/* ========= Routes ========= */

// POST /owner/lands — إنشاء أرض جديدة مع فحص الحصة حسب الخطة
router.post('/owner/lands', requireAuth, async (req, res) => {
  try {
    // 1) فاليديشن
    const { value, error } = landSchema.validate(req.body || {}, { abortEarly:false });
    if (error) {
      return res.status(400).json({ ok:false, msg:'Validation error', details:error.details });
    }

    const userId = req.session.user._id;

    // 2) اجلب خطة المستخدم (User.plan أو subscriptionTier)
    const user = await User.findById(userId).lean();
    const plan = (user?.subscriptionTier || 'Basic');
    const limit = planLimit(plan);

    // 3) عدّ الأراضي الحالية للمستخدم
    // إن أردت احتساب pending/approved فقط، استخدم: { status: { $in: ['pending','approved'] } }
    const used = await Farm.countDocuments({ owner: userId });

    if (used >= limit) {
      const limitTxt = (limit === Infinity) ? 'غير محدود' : String(limit);
      return res.status(403).json({
        ok:false,
        msg: `لقد بلغت الحد المسموح به للنشر حسب خطتك (${plan}). المسموح: ${limitTxt} — الحالي: ${used}.`
      });
    }

    // 4) جهّز الحقول: ownerInfo, description, location, videoUrl
    const ownerInfo = {
      first: (value.ownerFirst || '').trim(),
      last:  (value.ownerLast  || '').trim(),
      whatsapp: (value.ownerWhatsapp || '').trim(),
    };

    // اختر الوصف المرسل (description أولاً ثم desc fallback)
    const description = (value.description ?? value.desc ?? '').toString().trim();

    // تحقق من location
    let location;
    if (value.location && typeof value.location === 'object') {
      const lat = Number(value.location.lat);
      const lng = Number(value.location.lng);
      const address = (value.location.address || '').toString();
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        location = { lat, lng, address };
      }
    }

    const doc = await Farm.create({
      owner: userId,
      ownerInfo,

      title: value.title.trim(),
      kind: value.kind === 'rent' ? 'rent' : 'sale',
      area: (value.area || '').trim(),
      city: (value.city || '').trim(),
      size: Number(value.size) || 0,
      price: Number(value.price) || 0,

      photos: Array.isArray(value.photos) ? value.photos : [],
        poolDesc: (value.poolDesc || '').toString().trim(),
  amenitiesDesc: (value.amenitiesDesc || '').toString().trim(),
  buildingDesc: (value.buildingDesc || '').toString().trim(),
      description,
      location,

      // مهم: الفيديو في الجذر وليس داخل location
      videoUrl: (value.videoUrl || '').trim(),

      status: 'pending',
      approvedAt: null,
      reviewNote: '',
      createdBy: userId,
    });

    return res.json({ ok:true, msg:'تم إرسال إعلانك للمراجعة', data:{ id: doc._id } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, msg:'Server error' });
  }
});

// GET /owner/lands — جلب أراضي المستخدم (للواجهة: قائمة "أراضيي")
router.get('/owner/lands', requireAuth, async (req, res) => {
  try {
    const rows = await Farm.find({ owner: req.session.user._id })
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ ok:true, data: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, msg:'Server error' });
  }
});

// DELETE /owner/lands/:id — حذف أرض يملكها المستخدم
router.delete('/owner/lands/:id', requireAuth, async (req, res) => {
  try {
    const r = await Farm.findOneAndDelete({ _id: req.params.id, owner: req.session.user._id });
    if (!r) return res.status(404).json({ ok:false, msg:'Not found' });
    return res.json({ ok:true, msg:'Deleted' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, msg:'Server error' });
  }
});

// GET /owner/lands/quota — معرفة الحصة المتبقية (اختياري للواجهة)
router.get('/owner/lands/quota', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user._id;
    const user = await User.findById(userId).lean();
   const plan = (user?.subscriptionTier || 'Basic');
    const limit = planLimit(plan);
    const used = await Farm.countDocuments({ owner: userId });
    const left = (limit === Infinity) ? Infinity : Math.max(0, limit - used);
    return res.json({ ok:true, data:{ plan, limit, used, left } });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, msg:'Server error' });
  }
});
// PATCH /owner/lands/:id  — تعديل أرض موجودة للمستخدم الحالي
// PATCH /owner/lands/:id — تعديل أرض موجودة للمستخدم الحالي
router.patch('/owner/lands/:id', requireAuth, async (req,res)=>{
  try{
    const b = req.body || {};

    const update = {
      title: (b.title||'').trim(),
      kind : (b.kind==='rent' ? 'rent' : 'sale'),
      area : (b.area||'').trim(),
      city : (b.city||'').trim(),
      size : Number(b.size)||0,
      price: Number(b.price)||0,
      photos: Array.isArray(b.photos) ? b.photos : [],
        poolDesc: (b.poolDesc || '').toString(),
  amenitiesDesc: (b.amenitiesDesc || '').toString(),
  buildingDesc: (b.buildingDesc || '').toString(),
      description: (b.description||b.desc||'').toString(),
      videoUrl: (b.videoUrl||'').trim(),
      ownerInfo: {
        first: (b.ownerFirst||'').trim(),
        last:  (b.ownerLast||'').trim(),
        whatsapp: (b.ownerWhatsapp||'').trim(),
      },
      status:'pending',
      reviewNote:'',
      approvedAt:null,
      rejectedAt:null,
    };

    if (b.location && typeof b.location==='object' &&
        Number.isFinite(b.location.lat) && Number.isFinite(b.location.lng)){
      update.location = {
        lat: Number(b.location.lat),
        lng: Number(b.location.lng),
        address: (b.location.address||'').toString()
      };
    }

    const doc = await Farm.findOneAndUpdate(
      { _id: req.params.id, owner: req.session.user._id }, // ← هنا التعديل
      { $set: update },
      { new:true }
    );

    if (!doc) return res.status(404).json({ ok:false, msg:'غير موجود' });
    return res.json({ ok:true, msg:'تم التعديل وإرسال الطلب للمراجعة', data: doc });
  }catch(e){
    console.error(e);
    return res.status(500).json({ ok:false, msg:'Server error' });
  }
});

// GET /owner/lands/:id — يعيد إعلان المالك الحالي بصيغة JSON للتعديل
router.get('/owner/lands/:id', requireAuth, async (req, res) => {
  try{
    const doc = await Farm.findOne({
      _id: req.params.id,
      owner: req.session.user._id, // ← هنا أيضًا
    }).lean();

    if (!doc) return res.status(404).json({ ok:false, msg:'غير موجود' });
    return res.json({ ok:true, data: doc });
  }catch(e){
    console.error(e);
    return res.status(500).json({ ok:false, msg:'Server error' });
  }
});


module.exports = router;

