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
    .select('title area city size price photos views kind status')
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
      .select('title area city size price photos views kind status')
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
router.get('/api/farms/sale', async (req, res) => {
  try {
    const vipOnly = String(req.query.vipOnly || '') === '1';

    const rows = await Farm.aggregate([
      { $match: { kind: 'sale', status: 'approved', isSuspended: { $ne: true }, deletedAt: null } },
      {
        $lookup: {
          from: 'users',
          localField: 'owner',
          foreignField: '_id',
          as: 'u'
        }
      },
      {
        $addFields: {
          ownerTier: { $ifNull: [{ $arrayElemAt: ['$u.subscriptionTier', 0] }, 'Basic'] }
        }
      },
      ...(vipOnly ? [{ $match: { ownerTier: 'VIP' } }] : []),
      { $sort: { createdAt: -1 } },
      { $project: { u: 0 } }
    ]);

    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, msg: 'Server error' });
  }
});

// GET /api/farms/rent?vipOnly=1|0
router.get('/api/farms/rent', async (req, res) => {
  try {
    const vipOnly = String(req.query.vipOnly || '') === '1';

    const rows = await Farm.aggregate([
      { $match: { kind: 'rent', status: 'approved', isSuspended: { $ne: true }, deletedAt: null } },
      {
        $lookup: {
          from: 'users',
          localField: 'owner',
          foreignField: '_id',
          as: 'u'
        }
      },
      {
        $addFields: {
          ownerTier: { $ifNull: [{ $arrayElemAt: ['$u.subscriptionTier', 0] }, 'Basic'] }
        }
      },
      ...(vipOnly ? [{ $match: { ownerTier: 'VIP' } }] : []),
      { $sort: { createdAt: -1 } },
      { $project: { u: 0 } }
    ]);

    res.json({ ok: true, data: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, msg: 'Server error' });
  }
});

// ===== Pages: Farm Single (details) + views counter =====

// تفاصيل مزرعة للبيع + زيادة العدّاد + تمرير Top
// تفاصيل مزرعة للبيع: زيادة مشاهدات + مزارع نفس المالك + Top
router.get('/farm/:id', async (req, res) => {
  const id = req.params.id;
  try {
    // زِد العداد وأرجِع الوثيقة المحدثة
    let farm = await Farm.findByIdAndUpdate(
      id,
      { $inc: { views: 1 } },
      { new: true }
    ).lean();

    // تحقّق النوع والحالة
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
        topRent: [],
      });
    }

    // اجلب بقية مزارع نفس المالك (إن كان له owner) باستثناء الحالية
    const sameOwnerPromise = farm.owner
      ? Farm.find({
          owner: farm.owner,
          status: { $in: ['approved','Approved'] },
          _id: { $ne: farm._id }
        })
        .sort({ createdAt: -1 })
        .limit(12)
        .select('title area city size price photos kind views')
        .lean()
      : Promise.resolve([]);

    // قوائم الأكثر مشاهدة (مع استثناء الحالية في البيع)
    const topSalePromise = getTopFarms('sale', id, 3);
    const topRentPromise = getTopFarms('rent', null, 3);

    const [sameOwnerFarms, topSale, topRent] = await Promise.all([
      sameOwnerPromise, topSalePromise, topRentPromise
    ]);

    res.render('sellfarmsingle', {
      farm,
      viewsCount: Number(farm.views || 0),
      sameOwnerFarms,
      topSale,
      topRent,
    });
  } catch (e) {
    console.error(e);
    res.status(500).render('sellfarmsingle', {
      farm: null,
      viewsCount: 0,
      sameOwnerFarms: [],
      topSale: [],
      topRent: []
    });
  }
});

// تفاصيل مزرعة للإيجار: زيادة مشاهدات + مزارع نفس المالك + Top
router.get('/rent/farm/:id', async (req, res) => {
  const id = req.params.id;

  try {

    // زِد المشاهدات فقط لو المزرعة Rent و Approved
    await Farm.updateOne(
      { _id: id, kind: { $regex: /^rent$/i }, status: { $in: ['approved','Approved'] } },
      { $inc: { views: 1 } }
    );

    const farm = await Farm.findOne({
      _id: id,
      kind: { $regex: /^rent$/i },
      status: { $in: ['approved','Approved'] }
    }).lean();

    if (!farm) {
      return res.status(404).render('singlefarm', {
        farm: null,
        viewsCount: 0,
        sameOwnerFarms: [],
        topRent: [],
        topSale: [],
      });
    }

    // بقية مزارع نفس المالك (إن وُجد)، باستثناء الحالية
    const sameOwnerPromise = farm.owner
      ? Farm.find({
          owner: farm.owner,
          status: { $in: ['approved','Approved'] },
          _id: { $ne: farm._id }
        })
        .sort({ createdAt: -1 })
        .limit(12)
        .select('title area city size price photos kind views')
        .lean()
      : Promise.resolve([]);

    // Top (استثنِ الحالية من الإيجار فقط)
    const topRentPromise = getTopFarms('rent', id, 3);
    const topSalePromise = getTopFarms('sale', null, 3);

    const [sameOwnerFarms, topRent, topSale] = await Promise.all([
      sameOwnerPromise, topRentPromise, topSalePromise
    ]);

    return res.render('singlefarm', {
      farm,
      viewsCount: Number(farm.views || 0),
      sameOwnerFarms,
      topRent,
      topSale,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).render('singlefarm', {
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
   const contractorsRaw = await Contractor
  .find({ status: 'approved', isSuspended: { $ne: true }, deletedAt: null })
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
module.exports = router;
