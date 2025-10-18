// routers/loginrouter.js
const express = require('express');
const router = express.Router();
const ContractorRequest = require('../models/contractorRequestModel');
const { signupSchema, loginSchema, forgotSchema, resetSchema } = require('../validators/loginSchema');
const crypto = require('crypto');
const User = require('../models/usermodels');
const Farm = require('../models/farmModel');
const  SubscriptionRequest = require('../models/subscriptionRequest');
// ========= Helpers =========
function isAdminEmail(email) {
  const list = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(String(email || '').toLowerCase());
}
// Joi validator wrapper
function validate(schema, view, viewData = {}, tabName) {
  return (req, res, next) => {
    const { value, error } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (!error) {
      req.validated = value;
      return next();
    }

    const errors = {};
    for (const d of error.details) {
      if (!errors[d.path[0]]) errors[d.path[0]] = d.message;
    }
    const data = {
      ...viewData,
      errors,
      old: req.body,
      msg: 'تحقق من الحقول أدناه',
      type: 'error',
    };
    if (tabName) data.tab = tabName;

    return res.status(400).render(view, data);
  };
}

// ========= Auth middlewares =========
function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.session.msg = 'يلزم تسجيل الدخول للوصول إلى هذه الصفحة.';
    req.session.type = 'error';
    return res.redirect('/auth?tab=login');
  }
  next();
}
function requireRole(role) {
  return (req, res, next) => {
    if (!req.session.user || req.session.user.role !== role) {
      req.session.msg = 'أنت لا تملك صلاحية الوصول إلى هذه الصفحة.';
      req.session.type = 'error';
      return res.redirect('/auth?tab=login');
    }
    next();
  };
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    req.session.msg = 'صلاحية غير كافية — هذه الصفحة للأدمن فقط.';
    req.session.type = 'error';
    return res.redirect('/auth?tab=login');
  }
  next();
}

// ========= Auth Views =========
router.get('/auth', (req, res) => {
  const tab = req.query.tab || 'signup';
  const msg = req.session.msg || null;
  const type = req.session.type || null;
  delete req.session.msg;
  delete req.session.type;

  res.render('signup', {
    tab,
    old: {},
    errors: {},
    msg,
    type,
  });
});

router.get('/auth/forgot', (req, res) => {
  const msg = req.session.msg || null;
  const type = req.session.type || null;
  delete req.session.msg;
  delete req.session.type;

  res.render('forgot', {
    old: {},
    errors: {},
    msg,
    type,
  });
});

// ========= Sign up =========
router.post('/signup', validate(signupSchema, 'signup', {}, 'signup'), async (req, res) => {
  try {
    const { name, email, phone, password, role } = req.validated;

    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(400).render('signup', {
        tab: 'signup',
        errors: { email: 'البريد مستخدم بالفعل' },
        old: req.body,
        msg: 'البريد مستخدم بالفعل',
        type: 'error',
      });
    }

    const user = await User.create({ name, email, phone, password, role });

    // ضع الدور في الجلسة (إعطاء admin عبر .env إن كان البريد ضمن القائمة)
    const sessionRole = isAdminEmail(email) ? 'admin' : user.role;

    req.session.user = {
      _id: user._id.toString(),
      id: user._id.toString(), // للمرونة
      name: user.name,
      email: user.email,
      role: sessionRole,
    };
    req.session.msg = `مرحبًا ${user.name}! تم إنشاء الحساب.`;
    req.session.type = 'success';

    if (sessionRole === 'admin') return res.redirect('/dashboard/admin');
    if (sessionRole === 'contractor') return res.redirect('/dashboard/contractor');
    return res.redirect('/dashboard/owner');
  } catch (e) {
    console.error(e);
    return res.status(500).render('signup', {
      tab: 'signup',
      errors: {},
      old: req.body,
      msg: 'حدث خطأ غير متوقع.',
      type: 'error',
    });
  }
});

// ========= Login =========
router.post('/login', validate(loginSchema, 'signup', {}, 'login'), async (req, res) => {
  try {
    const { identifier, password } = req.validated;

    const user = await User.findOne({ email: identifier });
    if (!user) {
      return res.status(400).render('signup', {
        tab: 'login',
        errors: { identifier: 'بيانات الدخول غير صحيحة' },
        old: req.body,
        msg: 'بيانات الدخول غير صحيحة',
        type: 'error',
      });
    }

    const ok = await user.comparePassword(password);
    if (!ok) {
      return res.status(400).render('signup', {
        tab: 'login',
        errors: { identifier: 'بيانات الدخول غير صحيحة' },
        old: req.body,
        msg: 'بيانات الدخول غير صحيحة',
        type: 'error',
      });
    }

    const sessionRole = isAdminEmail(user.email) ? 'admin' : user.role;

    req.session.user = {
      _id: user._id.toString(),
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: sessionRole,
    };
    req.session.msg = `مرحبًا ${user.name}! تم تسجيل الدخول.`;
    req.session.type = 'success';

    if (sessionRole === 'admin') return res.redirect('/dashboard/admin');
    if (sessionRole === 'contractor') return res.redirect('/dashboard/contractor');
    return res.redirect('/dashboard/owner');
  } catch (e) {
    console.error(e);
    return res.status(500).render('signup', {
      tab: 'login',
      errors: {},
      old: req.body,
      msg: 'حدث خطأ غير متوقع.',
      type: 'error',
    });
  }
});

// ========= Forgot / Reset =========
router.post('/auth/forgot', validate(forgotSchema, 'forgot'), async (req, res) => {
  try {
    const { email } = req.validated;
    const user = await User.findOne({ email });

    const token = crypto.randomBytes(32).toString('hex');
    if (user) {
      user.resetPasswordToken = token;
      user.resetPasswordExpires = Date.now() + 60 * 60 * 1000;
      await user.save();
    }

    const resetUrl = `${req.protocol}://${req.get('host')}/auth/reset/${token}`;
    const transporter = req.app.locals.transporter;

    if (user && transporter) {
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'no-reply@example.com',
        to: user.email,
        subject: 'إعادة تعيين كلمة المرور',
        html: `<p>لإعادة تعيين كلمة المرور اضغط الرابط التالي (صالح لمدة ساعة):</p>
               <p><a href="${resetUrl}" target="_blank">${resetUrl}</a></p>`,
      });
    } else {
      console.log('🔐 Reset link:', resetUrl);
    }

    req.session.msg = 'إن كان البريد مسجلاً، أرسلنا رابط الاسترجاع.';
    req.session.type = 'success';
    return res.redirect('/auth/forgot');
  } catch (e) {
    console.error(e);
    return res.status(500).render('forgot', {
      errors: {},
      old: req.body,
      msg: 'حدث خطأ غير متوقع.',
      type: 'error',
    });
  }
});

router.get('/auth/reset/:token', async (req, res) => {
  const { token } = req.params;
  const user = await User.findOne({
    resetPasswordToken: token,
    resetPasswordExpires: { $gt: new Date() },
  });

  if (!user) {
    req.session.msg = 'رابط الاسترجاع غير صالح أو منتهي.';
    req.session.type = 'error';
    return res.redirect('/auth?tab=login');
  }

  res.render('reset', { token, errors: {}, old: {}, msg: null, type: null });
});

router.post(
  '/auth/reset/:token',
  validate(resetSchema, 'reset', {}, null),
  async (req, res) => {
    try {
      const { token } = req.params;
      const { password } = req.validated;

      const user = await User.findOne({
        resetPasswordToken: token,
        resetPasswordExpires: { $gt: new Date() },
      });

      if (!user) {
        req.session.msg = 'رابط الاسترجاع غير صالح أو منتهي.';
        req.session.type = 'error';
        return res.redirect('/auth?tab=login');
      }

      user.password = password;
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      await user.save();

      req.session.msg = 'تم تحديث كلمة المرور — سجّل الدخول الآن.';
      req.session.type = 'success';
      return res.redirect('/auth?tab=login');
    } catch (e) {
      console.error(e);
      return res.status(500).render('reset', {
        token: req.params.token,
        errors: {},
        old: req.body,
        msg: 'حدث خطأ غير متوقع.',
        type: 'error',
      });
    }
  }
);

// ========= Dashboards =========
router.get('/dashboard', requireAuth, (req, res) => {
  const role = req.session.user.role;
  if (role === 'admin') return res.redirect('/dashboard/admin');
  if (role === 'contractor') return res.redirect('/dashboard/contractor');
  return res.redirect('/dashboard/owner');
});

router.get(['/contractor/dashboard', '/dashboard/contractor'], requireAuth, requireRole('contractor'), async (req, res) => {
  // إن رغبت بجلب بروفايل من DB ضعّه هنا
  const profile = {};
  const msg = req.session.msg || null;
  const type = req.session.type || null;
  delete req.session.msg;
  delete req.session.type;

  return res.render('contractorDashbord', {
    user: req.session.user,
    profile,
    errors: null,
    old: null,
    msg,
    type,
  });
});

router.get(['/owner/dashboard', '/dashboard/owner'], requireAuth, requireRole('landowner'), (req, res) => {
  const msg = req.session.msg || null;
  const type = req.session.type || null;
  delete req.session.msg;
  delete req.session.type;

  return res.render('ownerDashbord', {
    user: req.session.user,
    msg,
    type,
  });
});

router.get(['/dashboard/admin'], requireAuth, requireAdmin, (req, res) => {
  return res.render('adminDashbord', { user: req.session.user });
});

// ========= Contractor profile (يُرسل للمراجعة) =========
// ========= Contractor profile (يُرسل للمراجعة) =========

// ========= Owner Lands (JSON API لعرض بطاقاته) =========
// إنشاء أرض (تذهب Pending)
// إنشاء أرض من لوحة المالك + تضمين فيديو URL اختياري
// routers/ownerRouter.js  (أو loginrouter.js حسب تنظيمك)
router.post('/owner/lands', requireAuth, async (req, res) => {
  try {
    const b = req.body || {};
    const lat = Number(b?.location?.lat);
    const lng = Number(b?.location?.lng);
    const address = (b?.location?.address || '').toString().trim();
    // ⚠️ اجعل owner مرجع المستخدم، و ownerInfo للعرض فقط
    const doc = await Farm.create({
      owner: req.session.user._id,                 // ObjectId
      ownerInfo: {
        first: (b.ownerFirst || '').trim(),
        last:  (b.ownerLast  || '').trim(),
        whatsapp: (b.ownerWhatsapp || '').trim(),
      },

      title: (b.title || '').trim(),
      kind : (b.kind === 'rent' ? 'rent' : 'sale'),
      area : (b.area || '').trim(),
      city : (b.city || '').trim(),
      size : Number(b.size)  || 0,
      price: Number(b.price) || 0,

      photos: Array.isArray(b.photos) ? b.photos : [],
      poolDesc:      (b.poolDesc      || '').toString().trim(),
      amenitiesDesc: (b.amenitiesDesc || '').toString().trim(),
      buildingDesc:  (b.buildingDesc  || '').toString().trim(),
      description: (b.desc || b.description || '').toString().trim(),         // لاحظ: نخزن في description

      // 👇 مهم: lat/lng أرقام حقيقية
    location: (Number.isFinite(lat) && Number.isFinite(lng))
        ? { lat, lng, address }
        : undefined,

      videoUrl: (b.videoUrl || '').trim(),         // حقل جذري (ليس داخل location)

      status: 'pending',
      approvedAt: null,
      reviewNote: '',
      createdBy: req.session.user._id
    });

    return res.json({ ok:true, msg:'تم إرسال إعلانك للمراجعة', id: doc._id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok:false, msg:'حصل خطأ أثناء الإرسال' });
  }
});

// جلب أراضي المستخدم
router.get('/owner/lands', requireAuth, requireRole('landowner'), async (req, res) => {
  try{
    const rows = await Farm.find({ owner: req.session.user._id })
      .sort({ createdAt: -1 })
      .lean();
    return res.json({ ok:true, data: rows });
  }catch(err){
    console.error(err);
    return res.status(500).json({ ok:false, msg:'Server error' });
  }
});

// ========== حذف أرض يملكها المستخدم ==========
router.delete('/owner/lands/:id', requireAuth, requireRole('landowner'), async (req, res) => {
  try{
    const r = await Farm.findOneAndDelete({ _id: req.params.id, owner: req.session.user._id });
    if (!r) return res.status(404).json({ ok:false, msg:'Not found' });
    return res.json({ ok:true, msg:'Deleted' });
  }catch(err){
    console.error(err);
    return res.status(500).json({ ok:false, msg:'Server error' });
  }
});

// ========= Logout =========
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.redirect('/auth?tab=login');
  });
});

// ========= Root =========
// loginrouter.js

// يتطلب تسجيل الدخول
function requireAuth(req, res, next){
  if (req.session?.user) return next();
  return res.status(401).json({ ok:false, msg:'غير مصرح' });
}

// وسطيتان واضحتان: للصفحات و للـAPI
function requireAuthPage(req, res, next){
  if (!req.session?.user){
    req.session.msg  = 'يلزم تسجيل الدخول للوصول إلى هذه الصفحة.';
    req.session.type = 'error';
    return res.redirect('/auth?tab=login');
  }
  next();
}
function requireAuthApi(req, res, next){
  if (!req.session?.user) return res.status(401).json({ ok:false, msg:'غير مصرح' });
  next();
}
// لوحات الصفحات (HTML)
router.get('/dashboard/contractor', requireAuthPage, requireRole('contractor'), (req,res)=>{
  return res.render('contractorDashbord', { user: req.session.user });
});
router.get('/dashboard/owner', requireAuthPage, requireRole('landowner'), (req,res)=>{
  return res.render('ownerDashbord', { user: req.session.user });
});
// أبقِ هذه النسخة فقط (التي تنشئ في ContractorRequest)
// إنشاء/إرسال ملف مقاول للمراجعة مع التحقق من الحصة
router.post('/contractor/profile', requireAuthApi, async (req,res)=>{
  try{
    const {
      name='', email='', phone='', region='', bio='',
      companyName='', services=[], city='', description='',
      avatar='', photos=[], submitForReview, videoUrl = ''
    } = req.body || {};

    // تحقق من خطة المستخدم وحد النشر
    const userId = req.session.user._id;
    const user = await User.findById(userId).lean();
    const plan = (user?.plan) || 'Basic';
    const limit = contractorPlanLimit(plan);
    const used = await ContractorRequest.countDocuments({
      user: userId,
      status: { $in: ['pending','approved'] }
    });
    if (limit !== Infinity && used >= limit) {
      return res.status(403).json({
        ok:false,
        msg:`بلغت حدّ النشر المسموح في خطتك (${plan}). قم بالترقية لزيادة الحد.`
      });
    }

    const doc = await ContractorRequest.create({
      user: userId,
      name, email, phone, region, bio,
      companyName,
      services: Array.isArray(services) ? services
              : String(services||'').split(',').map(s=>s.trim()).filter(Boolean),
      city, description, avatar,
      photos: Array.isArray(photos) ? photos : [],
      videoUrl: (videoUrl||'').trim(),
      status: 'pending',
      reviewNote: '',
      approvedAt: null,
      rejectedAt: null,
    });

    return res.json({ ok:true, msg:'تم إرسال طلبك للمراجعة', data: doc });
  }catch(err){
    console.error(err);
    return res.status(500).json({ ok:false, msg:'تعذر الحفظ' });
  }
});


// === API المقاول: جلب كل طلباتي ككروت ===
router.get('/contractor/requests', requireAuthApi, async (req,res)=>{
  try{
    const rows = await ContractorRequest.find({ user: req.session.user._id })
      .sort({ createdAt: -1 }).lean();
    return res.json({ ok:true, data: rows });
  }catch(err){
    console.error(err);
    return res.status(500).json({ ok:false, msg:'Server error' });
  }
});

// === API المقاول: حذف طلب ===
router.delete('/contractor/requests/:id', requireAuthApi, async (req,res)=>{
  try{
    const r = await ContractorRequest.findOneAndDelete({
      _id: req.params.id,
      user: req.session.user._id
    });
    if (!r) return res.status(404).json({ ok:false, msg:'غير موجود' });
    return res.json({ ok:true, msg:'تم الحذف' });
  }catch(err){
    console.error(err);
    return res.status(500).json({ ok:false, msg:'Server error' });
  }
});
// === API المقاول: تعديل طلب (يعيده إلى pending للمراجعة) ===
router.patch('/contractor/requests/:id', requireAuthApi, async (req,res)=>{
  try{
    // نسمح بتعديل بعض الحقول الشائعة؛ عدّل القائمة حسب حاجتك
    const {
      name, email, phone, region, bio,
      companyName, services, city, description,
      avatar, photos
    } = req.body || {};

    // جهّز حقول التحديث فقط مما وصلك
    const update = {};
    if (name != null)        update.name = String(name).trim();
    if (email != null)       update.email = String(email).trim();
    if (phone != null)       update.phone = String(phone).trim();
    if (region != null)      update.region = String(region).trim();
    if (bio != null)         update.bio = String(bio).trim();
    if (companyName != null) update.companyName = String(companyName).trim();
    if (city != null)        update.city = String(city).trim();
    if (description != null) update.description = String(description).trim();
    if (avatar != null)      update.avatar = String(avatar);
    if (photos != null)      update.photos = Array.isArray(photos) ? photos : [];

    if (services != null) {
      update.services = Array.isArray(services)
        ? services
        : String(services||'').split(',').map(s=>s.trim()).filter(Boolean);
    }

    // أي تعديل يُعيد الحالة إلى pending حتى تراجعه الإدارة
    update.status = 'pending';
    update.reviewNote = '';
    update.approvedAt = null;
    update.rejectedAt = null;

    const doc = await ContractorRequest.findOneAndUpdate(
      { _id: req.params.id, user: req.session.user._id },
      { $set: update },
      { new: true }
    );

    if (!doc) return res.status(404).json({ ok:false, msg:'غير موجود' });
    return res.json({ ok:true, msg:'تم التعديل وإرسال الطلب للمراجعة', data: doc });
  }catch(err){
    console.error(err);
    return res.status(500).json({ ok:false, msg:'Server error' });
  }
});
// POST /owner/subscriptions  — يحفظ طلب الاشتراك
// داخل راوتر المالك (ليس adminRouter)
router.post('/owner/subscriptions', requireAuth, async (req, res) => {
  const { plan='Premium', ownerFirst='', ownerLast='', ownerWhatsapp='', notes='' } = req.body || {};
  const name = `${ownerFirst.trim()} ${ownerLast.trim()}`.trim();
  const doc = await SubscriptionRequest.create({
    user: req.session.user._id,
    name,
    whatsapp: ownerWhatsapp.trim(),
    plan: plan === 'VIP' ? 'VIP' : 'Premium',
    notes: (notes||'').trim(),
    status: 'pending'
  });
  res.json({ ok:true, msg:'تم استلام طلب الاشتراك', data: doc });
});

// === Subscription helpers for Contractor ===
function contractorPlanLimit(plan) {
  if (plan === 'VIP') return Infinity;
  if (plan === 'Premium') return 2;
  return 1; // Basic
}

// GET /contractor/quota  — يعرض حدود النشر الحالية
// /contractor/quota (JSON)
router.get('/contractor/quota', requireAuthApi, async (req, res) => {
  try {
    const userId = req.session.user._id;

    // اقرأ الخطة من الحقل الذي يكتبه الأدمن
    const u = await User.findById(userId).lean();
    const plan =
      (u && (u.subscriptionTier|| u.plan))  // الأفضلية لـ subscriptionTier
      || 'Basic';

    // حدّ النشر لكل خطة
    const LIMITS = { Basic: 1, Premium: 2, VIP: Infinity };
    const limitRaw = LIMITS[plan] ?? 1;

    // عدّ الطلبات المستخدمة (pending + approved)
    const used = await ContractorRequest.countDocuments({
      user: userId,
      status: { $in: ['pending', 'approved'] }
    });

    // حساب المتبقي بشكل آمن بدون إرسال Infinity في JSON
    const unlimited = (limitRaw === Infinity);
    const limit = unlimited ? null : limitRaw;                      // null = غير محدود
    const left  = unlimited ? null : Math.max(0, (limitRaw - used));

    // (اختياري) حدّث الجلسة بالخطة الجديدة كي تظهر في الـEJS
    req.session.user.subscriptionTier = plan;

    return res.json({
      ok: true,
      data: { plan, limit, used, left, unlimited }  // أضفنا unlimited للواجهة
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok:false, msg:'Server error' });
  }
});

function normalizePlan(p){
  const x = String(p||'').trim();
  if (x === 'VIP') return 'VIP';
  if (x === 'Premium') return 'Premium';
  return 'Basic';
}
router.post('/contractor/subscriptions', requireAuth, async (req,res)=>{
  try{
    const { plan, name, whatsapp, notes } = req.body || {};
    if (!['Premium','VIP'].includes(plan)) return res.status(400).json({ok:false,msg:'خطة غير صحيحة'});
    await SubscriptionRequest.create({
      user: req.session.user._id,
      role: 'contractor',
      plan, name: name||'', whatsapp: whatsapp||'', notes: notes||'',
      status:'pending'
    });
    res.json({ok:true, msg:'تم تسجيل الطلب'});
  }catch(e){
    console.error(e); res.status(500).json({ok:false,msg:'Server error'});
  }
});
// GET /admin/subscriptions?status=pending|approved|rejected
router.get('/admin/subscriptions', requireAdmin, async (req,res)=>{
  try{
    const status = (req.query.status||'pending');
    const rows = await SubscriptionRequest.find({ status }).populate('user','name email');
    res.json({ok:true, data: rows});
  }catch(e){ console.error(e); res.status(500).json({ok:false,msg:'Server error'}); }
});

// PATCH /admin/subscriptions/:id/approve
router.patch('/admin/subscriptions/:id/approve', requireAdmin, async (req,res)=>{
  try{
    const doc = await SubscriptionRequest.findById(req.params.id);
    if(!doc) return res.status(404).json({ok:false,msg:'غير موجود'});
    doc.status='approved'; doc.reviewNote=''; await doc.save();
 const plan = normalizePlan(doc.plan);
    // فعّل الخطة على حساب المستخدم
    await User.findByIdAndUpdate(doc.user, { $set: { subscriptionTier: doc.plan } });

    res.json({ok:true});
  }catch(e){ console.error(e); res.status(500).json({ok:false,msg:'Server error'}); }
});

// PATCH /admin/subscriptions/:id/reject
router.patch('/admin/subscriptions/:id/reject', requireAdmin, async (req,res)=>{
  try{
    const note = (req.body?.note||'').toString();
    const doc = await SubscriptionRequest.findById(req.params.id);
    if(!doc) return res.status(404).json({ok:false,msg:'غير موجود'});
    doc.status='rejected'; doc.reviewNote=note; await doc.save();
    res.json({ok:true});
  }catch(e){ console.error(e); res.status(500).json({ok:false,msg:'Server error'}); }
});
router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sid');
    res.redirect('home');
  });
});

module.exports = router;
