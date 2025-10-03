// routers/adminRouter.js
const express = require('express');
const router = express.Router();
const ContractorRequest = require('../models/contractorRequestModel');
const Farm = require('../models/farmModel');
const Contractor = require('../models/contactorsModel');
const User = require('../models/usermodels');
const SubscriptionRequest = require('../models/subscriptionRequest');
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
    const farm = await Farm.findByIdAndUpdate(
      req.params.id,
      { status: 'approved', approvedAt: new Date(), reviewNote: '' },
      { new: true }
    );
    if (!farm) {
      if (wantsJSON(req)) return res.status(404).json({ ok: false, msg: 'Not found' });
      return res.redirect('/admin/dashboard?type=danger&msg=العنصر%20غير%20موجود');
    }

    // إشعار موافقة عبر mailer (SMTP المخصص للأراضي)
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

    if (wantsJSON(req)) return res.json({ ok: true, msg: 'Approved', data: farm });
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
    const doc = await ContractorRequest.findByIdAndUpdate(
      req.params.id,
      { status: 'approved', approvedAt: new Date(), reviewNote: '' },
      { new: true }
    );
    if (!doc) {
      if (wantsJSON(req)) return res.status(404).json({ ok:false, msg:'Not found' });
      return res.redirect('/admin/dashboard?type=danger&msg=العنصر%20غير%20موجود');
    }

    if (doc.email) {
      const subject = `تمت الموافقة على ملفك — ${doc.companyName || doc.name || 'مقاول'}`;
      const text = `تمت الموافقة على ملفك كمقاول وسيظهر للجمهور.`;
      const html = `<p>تمت الموافقة على ملفك كمقاول وسيظهر للجمهور.</p>`;
      sendContractorMail({ to: doc.email, subject, text, html }).catch(err =>
        console.error('Contractor mail error:', err.message)
      );
    }

    if (wantsJSON(req)) return res.json({ ok:true, msg:'Approved', data:doc });
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
router.patch('/subscriptions/:id/approve', requireAdmin, async (req, res) => {
  const r = await SubscriptionRequest.findByIdAndUpdate(
    req.params.id,
    { status:'approved', approvedAt:new Date(), reviewNote:'' },
    { new:true }
  ).populate('user', '_id');

  if (!r) return res.status(404).json({ ok:false, msg:'Not found' });

  try {
    if (r.user?._id) {
      await User.findByIdAndUpdate(r.user._id, {
        $set: {
          subscriptionTier: r.plan, // ← الأهم
          plan: r.plan              // ← إبقها للتوافق (اختياري)
        }
      });
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

module.exports = router;
