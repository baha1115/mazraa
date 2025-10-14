// routers/adminRouter.js
const express = require('express');
const router = express.Router();
const ContractorRequest = require('../models/contractorRequestModel');
const Farm = require('../models/farmModel');
const Contractor = require('../models/contactorsModel');
const User = require('../models/usermodels');
const SubscriptionRequest = require('../models/subscriptionRequest');
const HomeQuickLinks = require('../models/HomeQuickLinks');
const PromoConfig = require('../models/PromoConfig');
const { enforceExpiry } = require('../utils/enforceExpiry');
const { checkQuota } = require('../utils/quota');
const HeroSlide = require('../models/HeroSlide');
const HomeShowcase = require('../models/homeShowcase');
// استخدم مايلرين منفصلين مع أسماء مستعارة واضحة
const { sendMail: sendFarmMail } = require('../utils/mailer');   // SMTP للأراضي
const { sendMail: sendContractorMail } = require('../utils/mailer2'); // SMTP للمقاولين

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
router.get('/subscriptions', requireAdmin, async (req, res) => {
  const status = req.query.status || 'pending';
  const rows = await SubscriptionRequest.find({ status })
    .sort({ createdAt: -1 })
    .populate('user', 'name email subscriptionTier role'); // (اختياري) معلومات تفيد العرض
  res.json({ ok:true, data: rows });
});

// PATCH /admin/subscriptions/:id/approve
// PATCH /admin/subscriptions/:id/approve
router.patch('/subscriptions/:id/approve', requireAdmin, async (req, res) => {
  const r = await SubscriptionRequest.findByIdAndUpdate(
    req.params.id,
    { status:'approved', approvedAt:new Date(), reviewNote:'' },
    { new:true }
  ).populate('user', '_id');

  if (!r) return res.status(404).json({ ok:false, msg:'Not found' });

  try {
    if (r.user?._id) {
      const until = new Date(Date.now() + 30*24*60*60*1000); // شهر
      await User.findByIdAndUpdate(r.user._id, {
        $set: {
          subscriptionTier: r.plan, // Premium أو VIP
          plan: r.plan,
          subscriptionUntil: until
        }
      });

      // مزامنة اختيارية مع سجلات المقاول الخاصة به
      await ContractorRequest.updateMany(
        { user: r.user._id },
        { $set: { subscriptionTier: r.plan || 'Basic' } }
      );
    }
  } catch (e) {
    console.error('Failed to update user subscription:', e);
  }

  res.json({ ok:true, msg:'Approved', data:r });
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
router.post('/promo/contractors', requireAdmin, async (req,res)=>{
  const Promo = require('../models/PromoConfig');
  const payload = {
    enabled: req.body.enabled === 'on',
    img: (req.body.img||'').trim(),
    title: (req.body.title||'').trim(),
    text: (req.body.text||'').trim(),
    link: (req.body.link||'').trim(),
  };
  await Promo.findOneAndUpdate(
    { key:'contractors' },
    { $set: payload, $setOnInsert: { key:'contractors' } },
    { upsert:true }
  );
  // رجّع للوحة الأدمن مع تحميل promo من جديد
  const fresh = await Promo.findOne({ key:'contractors' }).lean();
  res.render('adminDashbord', {
    user: req.session.user,
    promo: fresh || {}
  });
});
const PromoBanner = require('../models/PromoBanner');
// لو عندك ميدل وير requires:

// احضر/أنشئ وثيقة البنرات الافتراضية
async function getOrInit(key='home-banners'){
  let doc = await PromoBanner.findOne({ key }).lean();
  if (!doc) {
    doc = await PromoBanner.create({ key, enabled: true, items: [] });
    doc = doc.toObject();
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
router.post('/promo/banners', requireAdmin, async (req, res) => {
  try {
    const { img, title, text, link, btn } = req.body;
    if (!img) return res.status(400).json({ ok:false, msg:'img required' });

    const doc = await PromoBanner.findOneAndUpdate(
      { key: 'home-banners' },
      { $setOnInsert: { key:'home-banners', enabled: true },
        $push: { items: { img, title, text, link, btn, order: Date.now() } } },
      { new:true, upsert:true }
    );
    res.json({ ok:true, data: doc });
  } catch (e) {
    console.error(e); res.status(500).json({ ok:false, msg:'Server error' });
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
router.post('/hero/slides', requireAdmin, async (req,res)=>{
  try{
    const { img, title, lead } = req.body;
    const max = await HeroSlide.findOne().sort({ order:-1 }).lean();
    const row = await HeroSlide.create({
      img, title, lead,
      order: (max?.order ?? -1) + 1
    });
    res.json({ ok:true, data: row });
  }catch(e){
    console.error(e); res.status(500).json({ ok:false, msg:'Server error' });
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
router.post('/quick-links', async (req, res) => {
  try {
    const payload = {
      saleImg:        (req.body.saleImg || '').trim(),
      rentImg:        (req.body.rentImg || '').trim(),
      contractorsImg: (req.body.contractorsImg || '').trim(),
      enabled:        !!req.body.enabled
    };
    const doc = await HomeQuickLinks.findOneAndUpdate(
      { key: 'default' },
      { $set: payload },
      { upsert: true, new: true }
    );
    res.json({ ok:true, data: doc });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok:false, msg:'Server error' });
  }
});

// جلب كل الأقسام (للداشبورد)
router.get('/home/showcase', async (req,res) => {
  const rows = await HomeShowcase.find({}).lean();
  res.json({ ok:true, data: rows });
});

// إنشاء/تحديث سكشن (upsert)
router.post('/home/showcase/:key', async (req,res) => {
  const { key } = req.params; // rentTop | saleTop | bestContractors
  const { title, enabled, items } = req.body; // items = [{img,title,desc,link,order}, ...]
  const doc = await HomeShowcase.findOneAndUpdate(
    { key },
    { $set: { title: title||'', enabled: !!enabled, items: Array.isArray(items)?items:[] } },
    { new:true, upsert:true }
  );
  res.json({ ok:true, data:doc });
});

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

module.exports = router;
