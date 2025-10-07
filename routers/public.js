// routes/public.js
const express = require('express');
const router = express.Router();

const Farm        = require('../models/farmModel');
const Contractor  = require('../models/contractorRequestModel');
const PromoConfig = require('../models/PromoConfig');

// ===== Helpers =====
router.get('/',async(req,res)=> {
  const promoContractors = await PromoConfig.findOne({ key: 'contractors' }).lean(); // مثال
  res.render('home', { promoContractors });
}); 
// أعلى N مزارع حسب المشاهدات لنوع محدد (sale|rent)، مع إمكانية استثناء مزرعة معيّنة
async function getTopFarms(kindWanted, excludeId = null, limit = 3) {
  const q = {
    kind:   { $regex: new RegExp('^' + kindWanted + '$', 'i') },
    status: { $in: ['approved', 'Approved'] }
  };
  if (excludeId) q._id = { $ne: excludeId };

  let rows = await Farm.find(q)
    .sort({ views: -1, updatedAt: -1, createdAt: -1 })
    .limit(limit)
    .select('title area city size price photos views kind status')
    .lean();

  // fallback للتطوير لو ما في نتائج (مثلاً الداتا لسه قليلة)
  if (!rows.length) {
    const q2 = { kind: { $regex: new RegExp('^' + kindWanted + '$', 'i') } };
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
  const topSale = await getTopFarms('sale');
  const topRent = await getTopFarms('rent');
 const promoContractors = await PromoConfig.findOne({ key: 'contractors' }).lean(); // مثال
  res.render('sellfarm', { topSale, topRent, promoContractors });
});

// صفحة الإيجار (القائمة). الكروت تُجلب عبر fetch من /api/farms/rent
router.get('/rent', async (req, res) => {
  const topRent = await getTopFarms('rent');
  const topSale = await getTopFarms('sale');
  const promoContractors = await PromoConfig.findOne({ key: 'contractors' }).lean(); // مثال
  res.render('rent', { topRent, topSale,promoContractors });
});

// ===== API: Farms for lists (used by client-side fetch) =====

// GET /api/farms/sale?vipOnly=1|0
router.get('/api/farms/sale', async (req, res) => {
  try {
    const vipOnly = String(req.query.vipOnly || '') === '1';

    const rows = await Farm.aggregate([
      { $match: { kind: 'sale', status: 'approved' } },
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
      { $match: { kind: 'rent', status: 'approved' } },
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
  const promoContractors = await PromoConfig.findOne({ key: 'contractors' }).lean(); // مثال
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
        topRent: [],promoContractors
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
      topRent,promoContractors
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
  const promoContractors = await PromoConfig.findOne({ key: 'contractors' }).lean(); // مثال
  try {
    // زِد العداد لمزارع الإيجار المقبولة فقط
    await Farm.updateOne(
      { _id: id, kind: { $regex: /^rent$/i }, status: { $in: ['approved','Approved'] } },
      { $inc: { views: 1 } }
    );

    // اجلب الوثيقة بعد الزيادة
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
        topSale: [],promoContractors
      });
    }

    // بقية مزارع نفس المالك (إن وُجد) باستثناء الحالية
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

    res.render('singlefarm', {
      farm,
      viewsCount: Number(farm.views || 0),
      sameOwnerFarms,
      topRent,
      topSale,promoContractors
    });
  } catch (e) {
    console.error(e);
    res.status(500).render('singlefarm', {
      farm: null,
      viewsCount: 0,
      sameOwnerFarms: [],
      topRent: [],
      topSale: []
    });
  }
});

// ===== Contractors =====

// قائمة المقاولين + إعدادات البانر من لوحة الأدمن
router.get('/contractors', async (req, res, next) => {
  try {
    const promo = await PromoConfig.findOne({ key: 'contractors' }).lean();
    const contractors = await Contractor
      .find({ status: 'approved' })
      .sort({ // ترتيب يدعم VIP أولاً ثم Premium ثم Basic
        subscriptionTier: 1 // سنرتّبه يدويًا بالذاكرة لسهولة الـweight
      })
      .lean();

    const weight = t => (t === 'VIP' ? 3 : t === 'Premium' ? 2 : 1);
    contractors.sort((a, b) => weight(b.subscriptionTier || 'Basic') - weight(a.subscriptionTier || 'Basic'));

    res.render('contractors', {
      contractors,
      promoContractors: promo || { enabled: false }
    });
  } catch (err) {
    next(err);
  }
});

// صفحة مقاول فردية
router.get('/contractor/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const contractor = await Contractor.findById(id).lean();
    if (!contractor) {
      return res.status(404).render('contractorssingle', { contractor: null, topRated: [] });
    }
     const topRated = await Contractor.find({
      status: 'approved',
      _id: { $ne: id }
    })
    .sort({ ratingAvg: -1, ratingCount: -1, createdAt: -1 })
    .limit(3)
    .select('name companyName services region city avatar subscriptionTier ratingAvg ratingCount')
    .lean();

    res.render('contractorssingle', { contractor ,topRated});
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
