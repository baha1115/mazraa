// routers/loginrouter.js
const express = require('express');
const router = express.Router();
const ContractorRequest = require('../models/contractorRequestModel');
const { signupSchema, loginSchema, forgotSchema, resetSchema } = require('../validators/loginSchema');
const crypto = require('crypto');
const User = require('../models/usermodels');
const Farm = require('../models/farmModel');
const  SubscriptionRequest = require('../models/subscriptionRequest');
const SubscriptionConfig = require('../models/SubscriptionConfig');
// === رفع صور المقاولين بالذاكرة + sharp ===
const path = require('path');
const fs = require('fs/promises');
// ـــــــــ Cloudinary ـــــــــ
const multer = require('multer');
const uploadMem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 } // 8MB للصورة الواحدة
});

const { uploadBufferToCloudinary } = require('../utils/cloudinary');

// دعم تحويل DataURL إلى Buffer
function dataURLtoBuffer(src){
  const i = src.indexOf(',');
  const b64 = i >= 0 ? src.slice(i+1) : src;
  return Buffer.from(b64, 'base64');
}

/**
 * يرفع كل الصور (ملفات multipart و/أو DataURL من body) إلى Cloudinary
 * ويُرجع مصفوفة URLs (secure_url). يبقي الروابط http(s) كما هي،
 * ويقبل أيضاً مسارات legacy من /uploads/ (للخلفية).
 */
async function buildContractorPhotosArrayCloud(req, { folder='contractors' } = {}){
  const out = [];

  // 1) ملفات مرفوعة عبر multipart: photos[]
  const files = (req.files && req.files.photos) ? req.files.photos : [];
  for (const f of files){
    if (f?.buffer){
      const r = await uploadBufferToCloudinary(f.buffer, { folder });
      if (r?.secure_url) out.push(r.secure_url);
    }
  }

  // 2) body.photos (قد تصل JSON string أو CSV أو Array)
  let bodyPhotos = req.body?.photos;
  if (typeof bodyPhotos === 'string'){
    try { bodyPhotos = JSON.parse(bodyPhotos); }
    catch { bodyPhotos = bodyPhotos.split(',').map(s=>s.trim()).filter(Boolean); }
  }
  if (Array.isArray(bodyPhotos)){
    for (const item of bodyPhotos){
      if (typeof item === 'string' && item.startsWith('data:image/')){
        const buf = dataURLtoBuffer(item);
        const r = await uploadBufferToCloudinary(buf, { folder });
        if (r?.secure_url) out.push(r.secure_url);
      } else if (typeof item === 'string' && /^https?:\/\//.test(item)){
        out.push(item);              // رابط خارجي جاهز
      } else if (typeof item === 'string' && item.startsWith('/uploads/')){
        out.push(item);              // إبقاء صور قديمة في السيرفر إن وُجدت
      }
    }
  }

  // إزالة التكرارات
  return Array.from(new Set(out));
}


/**
 * يبني مصفوفة الصور النهائية للمقاول:
 * - يدمج الروابط النصّية القادمة من body (photos أو photos[])
 * - يضيف أي صور رُفعت (req.files.photos) بعد ضغطها بـ sharp
 * - يزيل التكرار
 */


async function contractorPlanLimit(plan){
  const cfg = await SubscriptionConfig.findOne({ key:'sub-plans' }).lean().catch(()=>null);
  const limitByTier = {
    Basic:   cfg?.basicLimit   ?? 1,
    Premium: cfg?.premiumLimit ?? 2,
    VIP:     cfg?.vipLimit     ?? 999,
  };
  return limitByTier[plan] ?? 1;
}
// ========= Helpers =========
// --- normalize phone helper (أعلى الملف) ---
// --- normalize phone helper (سوريا: +963 ثم 9 أرقام) ---
function normalizePhone(raw = '') {
  if (raw == null) return '';
  let s = String(raw).trim();

  // أزل الفراغات وكل شيء غير الرقم + علامة +
  s = s.replace(/\s+/g, '');
  // أمثلة مقبولة محلياً نحولها إلى الصيغة الدولية:
  // 09XXXXXXXXX  -> +9639XXXXXXXX
  // 9XXXXXXXX    -> +9639XXXXXXXX  (لو نسي الصفر)
  // 009639XXXXXXXX -> +9639XXXXXXXX
  // 9639XXXXXXXX  -> +9639XXXXXXXX
  if (/^0\d{9}$/.test(s)) {
    // يبدأ بـ 0 وطوله 10
    s = '+963' + s.slice(1); // احذف 0
  } else if (/^\+?963\d{9}$/.test(s)) {
    // 963 + تسعة أرقام، مع أو بدون +
    s = (s.startsWith('+') ? '' : '+') + s.replace(/^(\+?)/,'');
  } else if (/^00963\d{9}$/.test(s)) {
    s = '+' + s.slice(2);
  }

  // بعد التحويل يجب أن يطابق بالضبط +963 ثم 9 أرقام
  if (!/^\+963\d{9}$/.test(s)) return '';
  return s;
}


function isAdminEmail(email) {
  const list = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(String(email || '').toLowerCase());
}
// Joi validator wrapper — Arabic friendly messages
function validate(schema, view, viewData = {}, tabName) {
  // خرائط رسائل عربيّة حسب نوع الخطأ والحقل
  function friendly(detail) {
    const field = (detail.path && detail.path[0]) || '';
    const t = detail.type;                 // مثل: 'string.email' ، 'any.required' ، 'any.only'
    const c = detail.context || {};

    // رسائل عامّة حسب النوع
    const baseByType = {
      'any.required':       'هذا الحقل مطلوب',
      'string.empty':       'يرجى عدم ترك الحقل فارغًا',
      'string.min':         `الحد الأدنى ${c.limit} أحرف`,
      'string.max':         `الحد الأقصى ${c.limit} أحرف`,
      'string.email':       'أدخل بريدًا إلكترونيًا صحيحًا',
      'string.pattern.base':'القيمة المدخلة غير صحيحة',
      'any.only':           'القيمة غير مطابقة',
      'number.base':        'أدخل رقمًا صحيحًا',
    };

    // تخصيص لكل حقل مهم
    if (field === 'email')   return (t==='string.email') ? 'أدخل بريدًا إلكترونيًا صحيحًا' : baseByType[t] || detail.message;
    if (field === 'phone')   return (t==='string.pattern.base')
                                ? 'أدخل رقم هاتف صحيحًا مثل +9639xxxxxxx'
                                : baseByType[t] || detail.message;
    if (field === 'password')return (t==='string.min')
                                ? `كلمة المرور يجب ألا تقل عن ${c.limit} أحرف`
                                : baseByType[t] || detail.message;
    if (field === 'confirm') return (t==='any.only')
                                ? 'تأكيد كلمة المرور يجب أن يطابق كلمة المرور'
                                : baseByType[t] || detail.message;
    if (field === 'role')    return 'يرجى اختيار نوع الحساب (مقاول أو صاحب أرض)';
    if (field === 'identifier') {
      if (t==='string.empty') return 'أدخل بريدًا صحيحًا أو رقم هاتف صالحاً';
      return baseByType[t] || detail.message;
    }

    // افتراضي
    return baseByType[t] || detail.message;
  }

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
      const key = (d.path && d.path[0]) || 'form';
      if (!errors[key]) errors[key] = friendly(d);
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
// ========= Sign up =========
router.post('/signup', validate(signupSchema, 'signup', {}, 'signup'), async (req, res) => {
  try {
    const { name, email, phone, password, role } = req.validated;

    const normPhone = normalizePhone(phone);
    const lowerEmail = String(email || '').toLowerCase();
// داخل POST /signup قبل Promise.all([...]) مباشرة
if (!normPhone) {
  return res.status(400).render('signup', {
    tab: 'signup',
    errors: { phone: 'رقم الهاتف يجب أن يكون بصيغة دولية: +963 متبوعًا بتسعة أرقام (مثل +9639XXXXXXXX)' },
    old: req.body,
    msg: 'تحقق من رقم الهاتف',
    type: 'error',
  });
}

    // ابحث منفصلًا لتعرف أيهما متكرر فعلاً
    const [byEmail, byPhone] = await Promise.all([
      User.findOne({ email: lowerEmail }).lean(),
      normPhone ? User.findOne({ phone: normPhone }).lean() : Promise.resolve(null)
    ]);

    if (byEmail || byPhone) {
      const errors = {};
      if (byEmail) errors.email = 'هذا البريد الإلكتروني مستخدم بالفعل';
      if (byPhone) errors.phone = 'هذا رقم الهاتف مستخدم بالفعل';

      return res.status(400).render('signup', {
        tab: 'signup',
        errors,
        old: req.body,
        msg: Object.values(errors).join(' · '), // يجمع الرسالتين إن وُجدتا
        type: 'error',
      });
    }

    const user = await User.create({
      name,
      email: lowerEmail,
      phone: normPhone || undefined,
      password,
      role
    });

    const sessionRole = isAdminEmail(email) ? 'admin' : user.role;
    req.session.user = {
      _id: user._id.toString(),
      id: user._id.toString(),
      name: user.name,
      email: user.email,
      role: sessionRole,
    };
    req.session.msg  = `مرحبًا ${user.name}! تم إنشاء الحساب.`;
    req.session.type = 'success';

    if (sessionRole === 'admin') return res.redirect('/dashboard/admin');
    if (sessionRole === 'contractor') return res.redirect('/dashboard/contractor');
    return res.redirect('/dashboard/owner');
  } catch (e) {
    // تغطية خطأ الفهرس الفريد (في حال لديك unique على email/phone)
    if (e && e.code === 11000 && e.keyPattern) {
      const errors = {};
      if (e.keyPattern.email) errors.email = 'هذا البريد الإلكتروني مستخدم بالفعل';
      if (e.keyPattern.phone) errors.phone = 'هذا رقم الهاتف مستخدم بالفعل';

      return res.status(400).render('signup', {
        tab: 'signup',
        errors,
        old: req.body,
        msg: Object.values(errors).join(' · '),
        type: 'error',
      });
    }

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

    const id = String(identifier || '').trim();
    const looksLikeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id);
    const by = looksLikeEmail
      ? { email: id.toLowerCase() }
      : { phone: normalizePhone(id) };

    if (!looksLikeEmail && !by.phone) {
      return res.status(400).render('signup', {
        tab: 'login',
        errors: { identifier: 'أدخل بريدًا صحيحًا أو رقم هاتف صالحاً' },
        old: req.body,
        msg: 'أدخل بريدًا صحيحًا أو رقم هاتف صالحاً',
        type: 'error',
      });
    }

    const user = await User.findOne(by);
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
    req.session.msg  = `مرحبًا ${user.name}! تم تسجيل الدخول.`;
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

// جلب أراضي المستخدم


// ========== حذف أرض يملكها المستخدم ==========

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
// إنشاء/إرسال ملف مقاول للمراجعة — يدعم رفع avatar + photos مع sharp
// إنشاء/إرسال ملف مقاول للمراجعة — يدعم avatar + photos عبر Cloudinary
router.post(
  '/contractor/profile',
  requireAuthApi,
  uploadMem.fields([
    { name: 'avatar', maxCount: 1 },
    { name: 'photos', maxCount: 12 }
  ]),
  async (req,res)=>{
    try{
      const {
        name='', email='', phone='', region='', bio='',
        companyName='', services=[], city='', description='',
        videoUrl = ''
      } = req.body || {};

      const userId = req.session.user._id;

      // الخطة لحساب الحصة (من نفس منطقك الحالي)
      const user = await User.findById(userId).lean();
      const plan = (user?.subscriptionTier || user?.plan || 'Basic');

      const used = await ContractorRequest.countDocuments({
        user: userId,
        status: { $in: ['pending','approved'] }
      });

      const limit = await contractorPlanLimit(plan);
      if (limit !== Infinity && used >= limit) {
        return res.status(403).json({
          ok:false,
          msg:`بلغت حدّ النشر المسموح في خطتك (${plan}). قم بالترقية لزيادة الحد.`
        });
      }

      // 1) avatar: أولوية للملف ثم للرابط النصّي
      let avatar = '';
      if (req.files?.avatar?.[0]?.buffer) {
        const up = await uploadBufferToCloudinary(
          req.files.avatar[0].buffer,
          { folder:'contractors', publicId: 'avatar_'+Date.now() }
        );
        avatar = up?.secure_url || '';
      } else if (req.body.avatar) {
        avatar = String(req.body.avatar).trim();
      }

      // 2) photos: من الملفات + body (DataURL/URLs) إلى Cloudinary
      const photos = await buildContractorPhotosArrayCloud(req, { folder:'contractors' });

      const doc = await ContractorRequest.create({
        user: userId,
        name, email, phone, region, bio,
        companyName,
        services: Array.isArray(services)
                  ? services
                  : String(services||'').split(',').map(s=>s.trim()).filter(Boolean),
        city,
        description,
        avatar,
        photos,
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
  }
);

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
// تعديل طلب مقاول — يدعم رفع avatar + photos مع sharp ويعيده pending للمراجعة
// تعديل طلب مقاول — يدعم avatar + photos عبر Cloudinary ويعيد الحالة إلى pending
router.patch(
  '/contractor/requests/:id',
  requireAuthApi,
  uploadMem.fields([
    { name: 'avatar', maxCount: 1 },
    { name: 'photos', maxCount: 12 }
  ]),
  async (req,res)=>{
    try{
      const {
        name, email, phone, region, bio,
        companyName, services, city, description,
        videoUrl
      } = req.body || {};

      const update = {};

      // avatar: ملف ثم رابط نصي
      if (req.files?.avatar?.[0]?.buffer) {
        const up = await uploadBufferToCloudinary(
          req.files.avatar[0].buffer,
          { folder:'contractors', publicId: 'avatar_'+Date.now() }
        );
        update.avatar = up?.secure_url || '';
      } else if (req.body.avatar != null) {
        update.avatar = String(req.body.avatar).trim();
      }

      // photos: ابنِ مصفوفة من الملفات + body (DataURL/URLs)
      const photos = await buildContractorPhotosArrayCloud(req, { folder:'contractors' });
      if (photos.length || req.body.photos != null || (req.files?.photos?.length || 0) > 0) {
        update.photos = photos;
      }

      if (name != null)        update.name = String(name).trim();
      if (email != null)       update.email = String(email).trim();
      if (phone != null)       update.phone = String(phone).trim();
      if (region != null)      update.region = String(region).trim();
      if (bio != null)         update.bio = String(bio).trim();
      if (companyName != null) update.companyName = String(companyName).trim();
      if (city != null)        update.city = String(city).trim();
      if (description != null) update.description = String(description).trim();
      if (services != null) {
        update.services = Array.isArray(services)
          ? services
          : String(services||'').split(',').map(s=>s.trim()).filter(Boolean);
      }
      if (videoUrl != null)    update.videoUrl = String(videoUrl).trim();

      // أي تعديل → pending
      update.status     = 'pending';
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
    } catch (err) {
      console.error(err);
      return res.status(500).json({ ok:false, msg:'Server error' });
    }
  }
);

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
// GET /contractor/quota  — حصة المقاول حسب الخطة (تُقرأ من SubscriptionConfig)
router.get('/contractor/quota', requireAuthApi, async (req, res) => {
  try {
    const userId = req.session.user._id;

    // اجلب المستخدم لمعرفة خطته الحالية
    const u = await User.findById(userId).lean();
    // الأفضلية لـ subscriptionTier ثم plan (للتوافق مع القديم)
    let plan = (u && (u.subscriptionTier || u.plan)) || 'Basic';

    // طبّع اسم الخطة لتلافي فروقات الكتابة مثل premium/ Premium / VIP / vip
    const normalizePlan = (s='') => {
      s = String(s).trim().toLowerCase();
      if (s === 'vip') return 'VIP';
      if (s === 'premium') return 'Premium';
      return 'Basic';
    };
    plan = normalizePlan(plan);

    // اقرأ حدود الخطط من SubscriptionConfig (نفس المصدر الذي تستخدمه لوحة التحكم)
    const cfg = await SubscriptionConfig.findOne({ key: 'sub-plans' })
      .lean()
      .catch(() => null);

    // حدود افتراضية آمنة في حال عدم وجود الوثيقة
    const basicLimit   = cfg?.basicLimit   ?? 1;
    const premiumLimit = cfg?.premiumLimit ?? 2;
    const vipLimit     = cfg?.vipLimit     ?? 999;

    // خريطة الحدود وفق الخطة. إذا أردت حدًّا مختلفًا للمقاولين تحديدًا،
    // عدّل قيم premiumLimit/vipLimit هنا كما تشاء.
    const limitMap = {
      Basic:   basicLimit,
      Premium: premiumLimit,
      VIP:     Infinity // غير محدود فعليًا
    };

    const limitRaw = limitMap[plan] ?? basicLimit;

    // عدّ الطلبات المستخدمة (pending + approved)
    const used = await ContractorRequest.countDocuments({
      user: userId,
      status: { $in: ['pending', 'approved'] }
    });

    // لا نرسل Infinity في JSON: إن كانت غير محدودة نُرجع null
    const unlimited = (limitRaw === Infinity || limitRaw === vipLimit && vipLimit >= 999);
    const limit = unlimited ? null : Number(limitRaw);
    const left  = unlimited ? null : Math.max(0, (limitRaw - used));

    // (اختياري) حدّث الجلسة بالخطة كي تظهر في الـ EJS
    if (req.session.user) {
      req.session.user.subscriptionTier = plan;
    }

    return res.json({
      ok: true,
      data: { plan, limit, used, left, unlimited }
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

module.exports = router;
