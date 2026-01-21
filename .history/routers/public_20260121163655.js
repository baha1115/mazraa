// routes/public.js
const express = require('express');
const router = express.Router();
const User = require('../models/usermodels'); // تأكد من المسار الصحيح عندك
const HeroSlide = require('../models/HeroSlide');
const HomeQuickLinks = require('../models/HomeQuickLinks');
const Farm        = require('../models/farmModel');
const Contractor  = require('../models/contractorRequestModel');
const PromoConfig = require('../models/PromoConfig');
const PromoBanner = require('../models/PromoBanner');
const HomeShowcase = require('../models/homeShowcase');
// ===== Helpers =====
router.get('/', async (req,res) => {
  try{
     const [rentTop, saleTop, bestContractors] = await Promise.all([
    HomeShowcase.findOne({ key:'rentTop' }).lean(),
    HomeShowcase.findOne({ key:'saleTop' }).lean(),
    HomeShowcase.findOne({ key:'bestContractors' }).lean(),
  ]);
      
       const quickLinks = await HomeQuickLinks.findOne({ key: 'default' }).lean().catch(()=>null);
    const heroSlides = await HeroSlide.find({ enabled: { $ne: false } })
      .sort({ order: 1, createdAt: 1 })
      .lean();

    // أي متغيرات أخرى يحتاجها الـhome.ejs مرّرها أيضًا
    res.render('home', { heroSlides,quickLinks,rentTop, saleTop, bestContractors});
  }catch(e){
    console.error(e);
    res.render('home', { heroSlides: [],quickLinks:null });
  }
});

// helpers عامة (ضعها قرب أعلى الملف، تحت التعليقات/الهيلبرز)
const withTimeout = (p, ms = 8000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))
  ]);

// أعلى N مزارع حسب المشاهدات لنوع محدد (sale|rent)، مع إمكانية استثناء مزرعة معيّنة
// أعلى N مزارع حسب المشاهدات لنوع محدد (sale|rent)، مع إمكانية استثناء مزرعة معيّنة
async function getTopFarms(kindWanted, excludeId = null, limit = 3) {
  const q = {
    kind:   { $regex: new RegExp('^' + kindWanted + '$', 'i') },
    status: { $in: ['approved', 'Approved'] },
    isSuspended: { $ne: true },
    deletedAt: null
  };
  if (excludeId) q._id = { $ne: excludeId };

  let rows = await Farm.find(q)
    .sort({ views: -1, updatedAt: -1, createdAt: -1 })
    .limit(limit)
        .select('title area city size price currency photos views kind status rentPeriod')
    .lean();

  // fallback لو ما في نتائج
  if (!rows.length) {
    const q2 = {
      kind: { $regex: new RegExp('^' + kindWanted + '$', 'i') },
      isSuspended: { $ne: true },
      deletedAt: null
    };
    if (excludeId) q2._id = { $ne: excludeId };
    rows = await Farm.find(q2)
      .sort({ views: -1, updatedAt: -1, createdAt: -1 })
      .limit(limit)
          .select('title area city size price currency photos views kind status rentPeriod')

      .lean();
  }
  return rows;
}


// ===== Pages: Lists =====

// صفحة البيع (القائمة). الكروت تُجلب عبر fetch من /api/farms/sale
router.get('/sale', async (req, res) => {
  const bannersDoc = await PromoBanner.findOne({ key:'sale-banners' }).lean();
  const topSale = await getTopFarms('sale');
  const topRent = await getTopFarms('rent');
 const promoBottom = await PromoConfig.findOne({ key: 'promo-bottom:sale' }).lean();
  res.render('sellfarm', { topSale, topRent,promoBottom,bannersDoc  });
});

// صفحة الإيجار (القائمة). الكروت تُجلب عبر fetch من /api/farms/rent
  router.get('/rent', async (req, res) => {
    const bannersDoc = await PromoBanner.findOne({ key:'rent-banners' }).lean();
  try {
    const [topRent, topSale] = await Promise.all([
      getTopFarms('rent'),
      getTopFarms('sale'),
    ]);
       const promoBottom = await PromoConfig.findOne({ key: 'promo-bottom:rent' }).lean();

    return res.render('rent', { topRent, topSale,bannersDoc,promoBottom });
  } catch (e) {
    console.error(e);
    // حتى لو حصل خطأ، نعرض الصفحة بدون بيانات بدل كسرها
    return res.render('rent', { topRent: [], topSale: [],promoBottom:null });
  }
});

// ===== API: Farms for lists (used by client-side fetch) =====

// GET /api/farms/sale?vipOnly=1|0
// GET /api/farms/sale?vipOnly=1|0&limit=40// GET /api/farms/sale?vipOnly=1|0&limit=40
router.get('/api/farms/sale', async (req, res) => {
  try {
    const vipOnly = String(req.query.vipOnly || '') === '1';
    const limit   = Math.min(parseInt(req.query.limit || '40', 10), 96);

    const match = {
      kind: { $regex: /^sale$/i },
      status: { $in: ['approved', 'Approved'] },
      isSuspended: { $ne: true },
     $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }]
    };

    // base: لا تعمل limit بدري لو vipOnly
    const base = [
      { $match: match },
      { $sort: { createdAt: -1 } },
      ...(vipOnly ? [] : [{ $limit: limit }]),
    ];

    const pipe = [
      ...base,
      { $lookup: { from: 'users', localField: 'owner', foreignField: '_id', as: 'u' } },
      { $addFields: { ownerTier: { $ifNull: [{ $arrayElemAt: ['$u.subscriptionTier', 0] }, 'Basic'] } } },

      ...(vipOnly ? [{ $match: { ownerTier: { $regex: /^vip$/i } } }
, { $limit: limit }] : []),

      { $project: {
          _id: 1, title: 1, area: 1, city: 1, size: 1, price: 1, currency: 1,
          videoUrl: 1, views: 1, ownerTier: 1, kind: 1,
          photos: { $cond: [
            { $and: [ { $isArray: '$photos' }, { $gt: [ { $size: '$photos' }, 0 ] } ] },
            { $slice: ['$photos', 1] }, [] ] }
      } }
    ];

    let rows = await Farm.aggregate(pipe).allowDiskUse(true);

    const small = u => /^https?:\/\/res\.cloudinary\.com\//.test(u)
      ? u.replace('/upload/', '/upload/f_auto,q_auto,w_480/')
      : u;

    rows = rows.map(r => ({
      ...r,
      photos: Array.isArray(r.photos) && r.photos.length ? [ small(r.photos[0]) ] : []
    }));

    res.set('Cache-Control', 'public, max-age=30');
    return res.json({ ok: true, data: rows });
  } catch (e) {
    console.error('api/farms/sale', e);
    return res.status(500).json({ ok: false, data: [] });
  }
});

// GET /api/farms/rent?vipOnly=1|0&limit=40// GET /api/farms/rent?vipOnly=1|0&limit=40
router.get('/api/farms/rent', async (req, res) => {
  try {
    const vipOnly = String(req.query.vipOnly || '') === '1';
    const limit   = Math.min(parseInt(req.query.limit || '40', 10), 96);

    const match = {
      kind: { $regex: /^rent$/i },
      status: { $in: ['approved', 'Approved'] },
      isSuspended: { $ne: true },
      $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }]

    };

    const base = [
      { $match: match },
      { $sort: { createdAt: -1 } },
      ...(vipOnly ? [] : [{ $limit: limit }]),
    ];

    const pipe = [
      ...base,
      { $lookup: { from: 'users', localField: 'owner', foreignField: '_id', as: 'u' } },
      { $addFields: { ownerTier: { $ifNull: [{ $arrayElemAt: ['$u.subscriptionTier', 0] }, 'Basic'] } } },

      ...(vipOnly ? [{ $match: { ownerTier: { $regex: /^vip$/i } } }
, { $limit: limit }] : []),

      { $project: {
          _id: 1, title: 1, area: 1, city: 1, size: 1, price: 1, rentPeriod: 1, currency: 1,
          videoUrl: 1, views: 1, ownerTier: 1, kind: 1,
          photos: { $cond: [
            { $and: [ { $isArray: '$photos' }, { $gt: [ { $size: '$photos' }, 0 ] } ] },
            { $slice: ['$photos', 1] }, [] ] }
      } }
    ];

    let rows = await Farm.aggregate(pipe).allowDiskUse(true);

    const small = u => /^https?:\/\/res\.cloudinary\.com\//.test(u)
      ? u.replace('/upload/', '/upload/f_auto,q_auto,w_480/')
      : u;

    rows = rows.map(r => ({
      ...r,
      photos: Array.isArray(r.photos) && r.photos.length ? [ small(r.photos[0]) ] : []
    }));

    res.set('Cache-Control', 'public, max-age=30');
    return res.json({ ok: true, data: rows });
  } catch (e) {
    console.error('api/farms/rent', e);
    return res.status(500).json({ ok: false, data: [] });
  }
});

// ===== Pages: Farm Single (details) + views counter =====

// تفاصيل مزرعة للبيع + زيادة العدّاد + تمرير Top
// تفاصيل مزرعة للبيع: فتح سريع + مهلات للاستعلامات الثانوية
router.get('/farm/:id', async (req, res) => {
  const id = req.params.id;
  try {
    // 1) احصل على المزرعة بمهلة معقولة (أساسي)
   const farm = await withTimeout(
  Farm.findByIdAndUpdate(id, { $inc: { views: 1 } }, { new: true })
      .maxTimeMS(7000)
      .lean(),
  8000
);


    // تحقّق النوع والحالة كما في نسختك
    if (
      !farm ||
      String(farm.kind).toLowerCase() !== 'sale' ||
      !['approved','Approved'].includes(farm.status)
    ) {
      return res.status(404).render('sellfarmsingle', {
        farm: null,
        viewsCount: 0,
        sameOwnerFarms: [],
        topSale: [],
        topRent: []
      });
    }

    // 2) اطلب الثانويات بمهلات أقصر ولا تمنع الرندر إن تأخرت
    const sameOwnerP = withTimeout(
      farm.owner
        ? Farm.find({
            owner: farm.owner,
            status: { $in: ['approved','Approved'] },
            _id: { $ne: farm._id }
          })
          .sort({ createdAt: -1 })
          .limit(12)
          .select('title area city size price currency photos kind views')
          .lean()
        : Promise.resolve([]),
      5000
    ).catch(() => []);

    const topSaleP = withTimeout(
      getTopFarms('sale', id, 3),
      5000
    ).catch(() => []);

    const topRentP = withTimeout(
      getTopFarms('rent', null, 3),
      5000
    ).catch(() => []);

    // 3) لا تنتظر أكثر من 5 ثواني لكل ثانوي — أعطِ [] لو تأخر
    const [sameOwnerFarms, topSale, topRent] = await Promise.allSettled([
      sameOwnerP, topSaleP, topRentP
    ]).then(arr => arr.map(r => (r.status === 'fulfilled' ? r.value : [])));

    return res.render('sellfarmsingle', {
      farm,
      viewsCount: Number(farm.views || 0),
      sameOwnerFarms,
      topSale,
      topRent
    });
  } catch (e) {
    // حتى لو Mongo تعطل—نُرجع صفحة "خفيفة" بدل التعليق
    console.error('farm page fail-fast:', e.message);
    return res.status(200).render('sellfarmsingle', {
      farm: null,
      viewsCount: 0,
      sameOwnerFarms: [],
      topSale: [],
      topRent: []
    });
  }
});

// تفاصيل مزرعة للإيجار: زيادة مشاهدات + مزارع نفس المالك + Top
// تفاصيل مزرعة للإيجار: فتح سريع + مهلات للاستعلامات الثانوية
router.get('/rent/farm/:id', async (req, res) => {
  const id = req.params.id;

  try {
    // 1) احصل على المزرعة (Rent + Approved) وزِد العدّاد بمهلة معقولة
const farm = await withTimeout(
  Farm.findOneAndUpdate(
    { _id: id, kind: { $regex: /^rent$/i }, status: { $in: ['approved','Approved'] } },
    { $inc: { views: 1 } },
    { new: true }
  )
  .maxTimeMS(7000)
  .lean(),
  8000
);

    if (!farm) {
      return res.status(404).render('singlefarm', {
        farm: null,
        viewsCount: 0,
        sameOwnerFarms: [],
        topRent: [],
        topSale: [],
      });
    }

    // 2) الاستعلامات الثانوية بمهلات أقصر — تأخّرها لا يمنع الرندر
    const sameOwnerP = withTimeout(
      farm.owner
        ? Farm.find({
            owner: farm.owner,
            status: { $in: ['approved','Approved'] },
            _id: { $ne: farm._id }
          })
          .sort({ createdAt: -1 })
          .limit(12)
          .select('title area city size price currency photos kind views')
          .lean()
        : Promise.resolve([]),
      5000
    ).catch(() => []);

    const topRentP = withTimeout(
      getTopFarms('rent', id, 3),
      5000
    ).catch(() => []);

    const topSaleP = withTimeout(
      getTopFarms('sale', null, 3),
      5000
    ).catch(() => []);

    // 3) اجمع النتائج بدون كسر الصفحة عند الفشل/المهلة
    const [sameOwnerFarms, topRent, topSale] = await Promise.allSettled([
      sameOwnerP, topRentP, topSaleP
    ]).then(arr => arr.map(r => (r.status === 'fulfilled' ? r.value : [])));

    return res.render('singlefarm', {
      farm,
      viewsCount: Number(farm.views || 0),
      sameOwnerFarms,
      topRent,
      topSale,
    });
  } catch (e) {
    // حتى لو Mongo تعطل — أرسل صفحة خفيفة بدل التعليق
    console.error('rent farm fail-fast:', e.message);
    return res.status(200).render('singlefarm', {
      farm: null,
      viewsCount: 0,
      sameOwnerFarms: [],
      topRent: [],
      topSale: [],
    });
  }
});

// ===== Contractors =====

// قائمة المقاولين + إعدادات البانر من لوحة الأدمن
router.get('/contractors', async (req, res, next) => {
  try {
     const bannersDoc = await PromoBanner.findOne({ key:'contractors-banners' }).lean();
const promoBottom = await PromoConfig.findOne({ key: 'promo-bottom:contractors' }).lean();
    // 1) اجلب المقاولين واملأ user.subscriptionTier
   const contractorsRaw = await Contractor.find({
  status: 'approved',
  isSuspended: { $ne: true },
  deletedAt: null
}).limit(24) 
.select({
  name: 1,
  services: 1,
  city: 1,
  region: 1,
  avatar: 1,
  photos: { $slice: 1 },     // ✅ فقط أول صورة (بدل كل الألبوم)
  subscriptionTier: 1,
  ratingAvg: 1,
  ratingCount: 1,
  user: 1
})
.populate({ path: 'user', select: 'subscriptionTier', model: 'User' })
.lean();

    // 2) اشتق الخطة الفعالة وضعها داخل subscriptionTier لضمان التوافق مع القالب الحالي
    const contractors = contractorsRaw.map(c => {
      const userTier = c?.user?.subscriptionTier;
      const effective = userTier || c.subscriptionTier || 'Basic';
      return {
        ...c,
        subscriptionTier: effective // نُسقِطها على نفس الحقل الذي يستخدمه القالب
      };
    });

    // 3) ترتيب يدعم VIP ثم Premium ثم Basic
    const weight = t => (t === 'VIP' ? 3 : t === 'Premium' ? 2 : 1);
    contractors.sort((a, b) => weight(b.subscriptionTier || 'Basic') - weight(a.subscriptionTier || 'Basic'));
   

    // 4) الرندر (لا تغييرات على القالب)
    res.render('contractors', {
      contractors,
      bannersDoc,promoBottom,
    });
    
  } catch (err) {
    next(err);
  }
});
// GET /api/contractors?vipOnly=1|0&limit=40
router.get('/api/contractors', async (req, res) => {
  try {
    const vipOnly = String(req.query.vipOnly || '') === '1';
    //const limit = Math.min(parseInt(req.query.limit || '40', 10), 96);

    const q = {
      status: 'approved',
      isSuspended: { $ne: true },
      deletedAt: null,
      ...(vipOnly ? { subscriptionTier: 'VIP' } : {})
    };

    // ✅ select خفيف + slice للصور
    let rows = await Contractor.find(q)
      .sort({ createdAt: -1 })
      .limit(70)
      .select('name services city region avatar photos subscriptionTier ratingAvg ratingCount')
      .lean();

    // ✅ فقط أول صورة من الأعمال
    const small = u => /^https?:\/\/res\.cloudinary\.com\//.test(u)
  ? u.replace('/upload/', '/upload/f_auto,q_auto,w_160,h_160,c_fill,g_face/')
  : u;

rows = rows.map(r => ({
  ...r,
  avatar: r.avatar ? small(r.avatar) : r.avatar,
  photos: Array.isArray(r.photos) && r.photos.length ? [ small(r.photos[0]) ] : []
}));


    res.set('Cache-Control', 'public, max-age=30');
    return res.json({ ok: true, data: rows });
  } catch (e) {
    console.error('api/contractors', e);
    return res.status(500).json({ ok: false, data: [] });
  }
});

// صفحة مقاول فردية
// routes/public.js
router.get('/contractor/:id', async (req, res, next) => {
  try {
    const id = req.params.id;

    // 1) أجلب المقاول مع خطة المستخدم
    const contractorRaw = await Contractor.findById(id)
      .populate({ path: 'user', select: 'subscriptionTier', model: 'User' })
      .lean();

    if (!contractorRaw) {
      return res.status(404).render('contractorssingle', { contractor: null, topRated: [] });
    }

    // 2) طبّع واحتسب الخطة الفعّالة
    const normalizeTier = (s='') => {
      s = String(s).trim().toLowerCase();
      if (s === 'vip') return 'VIP';
      if (s === 'premium') return 'Premium';
      return 'Basic';
    };
    const effectiveTier = normalizeTier(
      contractorRaw?.user?.subscriptionTier || contractorRaw.subscriptionTier || 'Basic'
    );

    // 3) أسقِطها على الحقل الذي يقرأه القالب
    const contractor = { ...contractorRaw, subscriptionTier: effectiveTier };

    // 4) نفس الشيء لقائمة "أفضل المقاولين" كي تظهر الشارات صحيحة
    const topRatedRaw = await Contractor.find({
      status: 'approved',
      _id: { $ne: id }
    })
      .populate({ path: 'user', select: 'subscriptionTier', model: 'User' })
      .sort({ ratingAvg: -1, ratingCount: -1, createdAt: -1 })
      .limit(3)
      .select('name companyName services region city avatar subscriptionTier ratingAvg ratingCount user')
      .lean();

    const topRated = topRatedRaw.map(c => ({
      ...c,
      subscriptionTier: normalizeTier(c?.user?.subscriptionTier || c.subscriptionTier || 'Basic')
    }));

    return res.render('contractorssingle', { contractor, topRated });
  } catch (err) {
    next(err);
  }
});


// تقييم المقاول: جلب المتوسط والعدد
router.get('/contractor/:id/ratings', async (req, res, next) => {
  try {
    const c = await Contractor.findById(req.params.id).select('ratingAvg ratingCount').lean();
    if (!c) return res.status(404).json({ ok: false, msg: 'Contractor not found' });
    res.json({ ok: true, data: { avg: c.ratingAvg || 0, count: c.ratingCount || 0 } });
  } catch (e) { next(e); }
});

// تقييم المقاول: إرسال تقييم
router.post('/contractor/:id/rate', async (req, res, next) => {
  try {
    const { value } = req.body || {};
    const v = Number(value);
    if (!Number.isFinite(v) || v < 1 || v > 5) {
      return res.status(400).json({ ok: false, msg: 'قيمة تقييم غير صحيحة' });
    }

    const c = await Contractor.findById(req.params.id);
    if (!c) return res.status(404).json({ ok: false, msg: 'Contractor not found' });

    // منع تكرار تقييم المستخدم نفسه (إن وُجد تسجيل دخول)
    if (req.user?._id) {
      const already = Array.isArray(c.ratings) && c.ratings.some(r => String(r.user) === String(req.user._id));
      if (already) {
        return res.status(409).json({ ok: false, msg: 'لقد قيّمت هذا المقاول من قبل' });
      }
    }

    c.ratings = c.ratings || [];
    c.ratings.push({
      user: req.user?._id || null,
      value: v,
      ip: (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().slice(0, 100),
      ua: (req.headers['user-agent'] || '').toString().slice(0, 200)
    });

    const oldAvg   = Number(c.ratingAvg || 0);
    const oldCount = Number(c.ratingCount || 0);
    const newCount = oldCount + 1;
    const newAvg   = ((oldAvg * oldCount) + v) / newCount;

    c.ratingAvg   = Number(newAvg.toFixed(2));
    c.ratingCount = newCount;

    await c.save();
    res.json({ ok: true, msg: 'تم تسجيل تقييمك بنجاح', data: { avg: c.ratingAvg, count: c.ratingCount } });
  } catch (e) { next(e); }
});

router.get('/plans',(req,res)=>{
  res.render('plans')
})
router.get('/about',(req,res)=>{
res.render('aboutUs')
})
router.get('/best-practices', (req, res) => {
  res.render('best-practice', {
    user: req.session?.user || null,
    isAuth: !!req.session?.user
  });
});
router.get('/rates', (req, res) => {
  res.render('rates');
});
// تتبع نقرات واتساب للمقاول
router.post('/contractor/:id/whatsapp-click', async (req, res, next) => {
  try {
    const id = req.params.id;

    // زيادة العدّاد 1 بدون ما نجيب الدوك كامل
    const updated = await Contractor.findByIdAndUpdate(
      id,
      { $inc: { whatsappClicks: 1 } },
      { new: false }
    );

    if (!updated) return res.status(404).json({ ok:false, msg:'Contractor not found' });
    return res.json({ ok:true });
  } catch (e) { next(e); }
});
// ✅ تتبع نقرات واتساب للأراضي/المزارع
router.post('/farm/:id/whatsapp-click', async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, msg: 'bad_id' });

    await Farm.updateOne(
      { _id: id },
      { $inc: { whatsappClicks: 1 } }
    );

    // sendBeacon غالباً لا يحتاج JSON
    return res.status(204).end();
  } catch (e) {
    console.error('farm whatsapp-click error:', e);
    return res.status(500).json({ ok: false, msg: 'whatsapp_click_failed' });
  }
});

module.exports = router;
