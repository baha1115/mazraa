// routes/public.js (مثال) أو أضف في loginrouter.js
const express = require('express');
const router = express.Router();
const Farm = require('../models/farmModel');
const Contractor = require('../models/contractorRequestModel');
const subscription = require('../models/subscriptionRequest');
const User= require('../models/usermodels');
const TIER_ORDER = { VIP: 3, Premium: 2, Basic: 1 };

// GET /rent — قائمة المزارع


// GET /contractors — قائمة المقاولين
router.get('/contractors', async (req, res, next) => {
  const weight = tier => tier==='VIP' ? 3 : tier==='Premium' ? 2 : 1;

  const contractors = (await Contractor
    .find({ status: 'approved' })
    .lean()
  ).sort((a,b) => weight(b.subscriptionTier||'Basic') - weight(a.subscriptionTier||'Basic'));

res.render('contractors', { contractors,subscription });
});
router.get('/farms/sale', async (req, res) => {
  const farms = await Farm.find({ kind: 'sale', status: 'approved' }).lean();
  res.render('sellfarm', { farms }); // تأكد أن sale.ejs يتوقع farms
});
router.get('/farms/rent', async (req, res) => {
  const farms = await Farm.find({ kind: 'rent', status: 'approved' }).lean();
  res.render('rent', { farms }); // تأكد أن rent.ejs يتوقع farms
});
router.get('/bundles', (req, res) => res.render('bundles'));
router.get('/plans',   (req, res) => res.render('plans'));
router.get('/farms/sale',  (req,res)=> res.render('sellfarm'));
router.get('/farms/rent',  (req,res)=> res.render('rent'));
// GET /api/farms/sale?vipOnly=1|0
router.get('/api/farms/sale', async (req, res) => {
  try {
    const vipOnly = req.query.vipOnly === '1';

    // نجيب مزارع البيع المقبولة فقط
    const match = { kind: 'sale', status: 'approved' };

    // نعمل lookup على المستخدم لمعرفة اشتراك المالك
    const rows = await Farm.aggregate([
      { $match: match },
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
          ownerTier: {
            $ifNull: [{ $arrayElemAt: ['$u.subscriptionTier', 0] }, 'Basic']
          }
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


module.exports = router;
