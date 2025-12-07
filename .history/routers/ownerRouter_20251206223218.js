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
   - photos[] (DataURL أو URL أو ملفات)
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
currency: Joi.string().valid('USD','SYP').default('USD'),
  rentPeriod: Joi.string().valid('daily','monthly').allow(''),

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

/* ========= Cloudinary Upload Helpers ========= */
// نرفع بالذاكرة
const multer = require('multer');

const MAX_FILE_BYTES   = 2 * 1024 * 1024;  // 2MB للصورة
const MAX_TOTAL_BYTES  = 5 * 1024 * 1024;  // 5MB للطلب

const uploadMem = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: 10
  }
});

const { uploadBufferToCloudinary } = require('../utils/cloudinary');

// حوّل dataURL إلى Buffer
function dataURLtoBuffer(src){
  const i = src.indexOf(',');
  const b64 = i >= 0 ? src.slice(i+1) : src;
  return Buffer.from(b64, 'base64');
}

/**
 * يبني مصفوفة صور برفع أي ملفات/داتا-URL إلى Cloudinary
 * ويحتفظ بأي روابط http(s) موجودة كما هي.
 * - يدعم:
 *   - ملفات multipart (input name="photos")
 *   - body.photos: Array<string> يمكن أن تحتوي DataURL أو URL
 */
async function buildPhotosArrayCloud(req, { folder='farms' } = {}){
  const out = [];

  // 1) ملفات multipart (photos[] أو req.files.photos)
  const files = Array.isArray(req.files) ? req.files : (req.files?.photos || []);
  for (const f of files){
    if (f?.buffer){
      const r = await uploadBufferToCloudinary(f.buffer, { folder });
      if (r?.secure_url) out.push(r.secure_url);
    }
  }

  // 2) body.photos = [url|dataURL]
  let bodyPhotos = req.body?.photos;
  if (typeof bodyPhotos === 'string'){
    try { bodyPhotos = JSON.parse(bodyPhotos); } catch {}
  }
  if (Array.isArray(bodyPhotos)){
    for (const item of bodyPhotos){
      if (typeof item === 'string' && item.startsWith('data:image/')){
        const buf = dataURLtoBuffer(item);
        const r = await uploadBufferToCloudinary(buf, { folder });
        if (r?.secure_url) out.push(r.secure_url);
      } else if (typeof item === 'string' && /^https?:\/\//.test(item)){
        // رابط خارجي/Cloudinary جاهز — أبقه كما هو
        out.push(item);
      }
      // لم نعد ندعم /uploads/... (انتقلت الصور إلى Cloudinary)،
      // لكن لو واجهت قيماً قديمة يمكنك إبقاءها بإضافة شرط startsWith('/uploads/')
    }
  }

  // إزالة التكرار
  return Array.from(new Set(out));
}

/* ========= Routes ========= */

// POST /owner/lands — إنشاء أرض + رفع الصور إلى Cloudinary
router.post('/owner/lands', requireAuth, uploadMem.array('photos', 12), async (req, res) => {
  try {
    const { value, error } = landSchema.validate(req.body || {}, { abortEarly:false });
    if (error) {
      return res.status(400).json({ ok:false, msg:'Validation error', details:error.details });
    }
    // ===== فحص إجمالي حجم الصور (ملفات + DataURL) =====
    let totalBytes = 0;

    // 1) ملفات من multer (array('photos',..))
    if (Array.isArray(req.files)) {
      for (const f of req.files) {
        totalBytes += f.size || 0;
      }
    } else if (Array.isArray(req.files?.photos)) {
      for (const f of req.files.photos) {
        totalBytes += f.size || 0;
      }
    }

    // 2) DataURL في body.photos (لو أحد التف على الفرونت)
    let bodyPhotosRaw = req.body.photos;
    if (typeof bodyPhotosRaw === 'string') {
      try { bodyPhotosRaw = JSON.parse(bodyPhotosRaw); }
      catch {
        bodyPhotosRaw = bodyPhotosRaw.split(',').map(s=>s.trim()).filter(Boolean);
      }
    }
    if (Array.isArray(bodyPhotosRaw)) {
      for (const item of bodyPhotosRaw) {
        if (typeof item === 'string' && item.startsWith('data:image/')) {
          totalBytes += approxDataUrlBytes(item);
        }
      }
    }

    if (totalBytes > MAX_TOTAL_BYTES) {
      return res.status(400).json({
        ok:false,
        msg:'إجمالي حجم الصور كبير جداً (الحد الأقصى 5MB لكل إعلان أرض).'
      });
    }
    // ===== نهاية فحص الحجم =====

    

    const userId = req.session.user._id;
    const user = await User.findById(userId).lean();
    const plan = (user?.subscriptionTier || 'Basic');

    // الحصة كما هي
    const used  = await Farm.countDocuments({ owner: userId });
    const limit = planLimit(plan);
    if (limit !== Infinity && used >= limit) {
      const limitTxt = String(limit);
      return res.status(403).json({
        ok:false,
        msg: `لقد بلغت الحد المسموح به للنشر حسب خطتك (${plan}). المسموح: ${limitTxt} — الحالي: ${used}.`
      });
    }

    // صور Cloudinary
    const photos = await buildPhotosArrayCloud(req, { folder: 'farms' });

    // الحقول الأخرى كما هي
    const ownerInfo = {
      first: (value.ownerFirst || '').trim(),
      last:  (value.ownerLast  || '').trim(),
      whatsapp: (value.ownerWhatsapp || '').trim(),
    };
    const description = (value.description ?? value.desc ?? '').toString().trim();

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
      rentPeriod: (value.kind === 'rent')
    ? (value.rentPeriod === 'daily' ? 'daily' : 'monthly')
    : null,
      area: (value.area || '').trim(),
      city: (value.city || '').trim(),
      size: Number(value.size) || 0,
      price: Number(value.price) || 0,
     currency: (value.currency === 'SYP' ? 'SYP' : 'USD'),
      photos, // روابط Cloudinary
      poolDesc: (value.poolDesc || '').toString().trim(),
      amenitiesDesc: (value.amenitiesDesc || '').toString().trim(),
      buildingDesc: (value.buildingDesc || '').toString().trim(),
      description,
      location,
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

// GET /owner/lands — جلب أراضي المستخدم
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

// PATCH /owner/lands/:id — تعديل أرض + دعم رفع صور جديدة إلى Cloudinary
router.patch('/owner/lands/:id', requireAuth, uploadMem.array('photos', 12), async (req,res)=>{
  try{
    const b = req.body || {};
    // ===== فحص إجمالي حجم الصور للتعديل =====
    let totalBytes = 0;

    if (Array.isArray(req.files)) {
      for (const f of req.files) {
        totalBytes += f.size || 0;
      }
    } else if (Array.isArray(req.files?.photos)) {
      for (const f of req.files.photos) {
        totalBytes += f.size || 0;
      }
    }

    let bodyPhotosRaw = b.photos;
    if (typeof bodyPhotosRaw === 'string') {
      try { bodyPhotosRaw = JSON.parse(bodyPhotosRaw); }
      catch {
        bodyPhotosRaw = bodyPhotosRaw.split(',').map(s=>s.trim()).filter(Boolean);
      }
    }
    if (Array.isArray(bodyPhotosRaw)) {
      for (const item of bodyPhotosRaw) {
        if (typeof item === 'string' && item.startsWith('data:image/')) {
          totalBytes += approxDataUrlBytes(item);
        }
      }
    }

    if (totalBytes > MAX_TOTAL_BYTES) {
      return res.status(400).json({
        ok:false,
        msg:'إجمالي حجم الصور كبير جداً (الحد الأقصى 5MB لكل إعلان).'
      });
    }
    // ===== نهاية فحص الحجم =====

    // إبقِ الروابط الموجودة + أضف أي ملفات/داتا-URL جديدة (كلاوديناري)
    const photos = await buildPhotosArrayCloud(req, { folder: 'farms' });

    const update = {
      title: (b.title||'').trim(),
      kind : (b.kind==='rent' ? 'rent' : 'sale'),
        rentPeriod: (b.kind === 'rent')
    ? (b.rentPeriod === 'daily' ? 'daily' : 'monthly')
    : null,

      area : (b.area||'').trim(),
      city : (b.city||'').trim(),
      size : Number(b.size)||0,
      price: Number(b.price)||0,
      currency: (b.currency === 'SYP' ? 'SYP' : 'USD'),
      photos, // روابط Cloudinary
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
      { _id: req.params.id, owner: req.session.user._id },
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

// GET /owner/lands/:id — إعلان المالك الحالي للتعديل
router.get('/owner/lands/:id', requireAuth, async (req, res) => {
  try{
    const doc = await Farm.findOne({
      _id: req.params.id,
      owner: req.session.user._id,
    }).lean();

    if (!doc) return res.status(404).json({ ok:false, msg:'غير موجود' });
    return res.json({ ok:true, data: doc });
  }catch(e){
    console.error(e);
    return res.status(500).json({ ok:false, msg:'Server error' });
  }
});

module.exports = router;
