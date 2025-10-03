// app.js
require('dotenv').config();
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const nodemailer = require('nodemailer');
const methodOverride = require('method-override');
const { verifyTransporter } = require('./utils/mailer2');

verifyTransporter(); // يطبع جاهزية SMTP
// مثال
const Farm = require('./models/farmModel');
const User = require('./models/usermodels'); 



// Routers
const loginRouter   = require('./routers/loginrouter');
const publicRouter  = require('./routers/public');       // إن كان عندك هذا الراوتر
const adminRouter   = require('./routers/adminRouter');  // راوتر الأدمن
const ownerRouter   = require('./routers/ownerRouter');  // راوتر المالك (إن وجد)

const app = express();
const port = process.env.PORT || 3000;


// السماح باستخدام ?_method=PATCH/DELETE من الفورم
app.use(methodOverride('_method'));

// ملفات ثابتة (لو عندك مجلد public)
app.use('/public', express.static(path.join(__dirname, 'public')));

// Body parsers (لازم قبل الراوترات)
app.use(express.urlencoded({ extended:true, limit: '25mb' })); // أو 50mb حسب حاجتك
app.use(express.json({ limit: '25mb' }));

// الجلسات (قبل الراوترات)
app.use(session({
  name: 'sid',
  secret: process.env.SESSION_SECRET || 'devsecret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 * 7,
    sameSite: 'lax'
  },
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    collectionName: 'sessions'
  })
}));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// اتصال MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// تمرير المستخدم/الرسائل للمشاهد (مرّة واحدة فقط)
// بعد إعدادات الجلسة وقبل تعريف الراوترات
// غيّر المسار حسب مشروعك

app.use(async (req, res, next) => {
  try {
    const u = req.session?.user || null;

    // اجلب نسخة محدثة من قاعدة البيانات لو المستخدم موجود
    if (u?._id) {
      const fresh = await User.findById(u._id, 'subscriptionTier plan role name email').lean();
      if (fresh) {
        const tier = fresh.subscriptionTier || fresh.plan || 'Basic';
        // حدّث الجلسة لو تغيّرت
        if (req.session.user.subscriptionTier !== tier) {
          req.session.user.subscriptionTier = tier;
        }
        // ارفع نسخة آمنة للـEJS
        res.locals.safeUser = {
          ...req.session.user,
          subscriptionTier: tier,
        };
      } else {
        res.locals.safeUser = u;
      }
    } else {
      res.locals.safeUser = null;
    }

    // بقية الـlocals المعتادة
    res.locals.currentUser  = req.session?.user || null;
    res.locals.isAuth       = !!req.session?.user;
    res.locals.role         = req.session?.user?.role || 'guest';
    res.locals.isAdmin      = req.session?.user?.role === 'admin';
    res.locals.isContractor = req.session?.user?.role === 'contractor';
    res.locals.isOwner      = req.session?.user?.role === 'owner';

    // رسائل فلاش
    res.locals.msg  = req.session.msg  || '';
    res.locals.type = req.session.type || '';
    delete req.session.msg;
    delete req.session.type;

    next();
  } catch (e) {
    console.warn('session sync error:', e);
    next();
  }
});

app.get('/login',       (req,res)=> res.render('signup')); 
app.get('/signup',       (req,res)=> res.render('signup')); 
// إعداد مرسل البريد (اختياري)
const transporter = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
}) : null;

if (transporter) {
  transporter.verify((err) => {
    if (err) console.error('SMTP verify error:', err);
    else console.log('✅ SMTP ready to send');
  });
}
app.locals.transporter = transporter;
// loginrouter.js
app.get('/',(req,res)=> res.render('home'));           // الرئيسية



// راوترات الموقع (بعد كل الإعدادات بالأعلى)
app.use('/admin', adminRouter);     // لوحة التحكم للأدمن وكل REST الخاصة بالموافقة
app.use('/', loginRouter);          // تسجيل/دخول/خروج
app.use('/', publicRouter); // صفحات عامة (إيجار/مقاولون) إن وجد
app.use('/',ownerRouter);       // مسارات المالك إن وجدت
app.get('/farm/:id', async (req, res) => {
  try {
    const farm = await Farm.findById(req.params.id).lean();
    if (!farm || farm.kind !== 'sale' || farm.status === 'rejected') {
      return res.status(404).render('sellfarmsingle', { farm: null });
    }
    // لو حابب تُظهر شارة خطة المالك
    const ownerTier = farm.ownerTier || farm.subscriptionTier || farm.plan || 'Basic';
    res.render('sellfarmsingle', { farm: { ...farm, ownerTier } });
  } catch (e) {
    console.error(e);
    res.status(500).render('sellfarmsingle', { farm: null });
  }
});
// صفحة القائمة: الإيجار
app.get('/rent', (req, res) => {
  res.render('rent'); // تأكد أن اسم الملف هو rent.ejs
});

// صفحة التفاصيل: الإيجار
app.get('/rent/farm/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // نجيب مزرعة “للإيجار” ومقبولة
    const farm = await Farm.findOne({ _id: id, kind: 'rent', status: 'approved' })
      .lean();

    return res.render('singlefarm', { farm }); // تأكد من اسم الملف singlefarm.ejs
  } catch (e) {
    console.error(e);
    return res.render('singlefarm', { farm: null });
  }
});
// /api/farms/rent  (كل المزارع للإيجار المقبولة)
// ?vipOnly=1      (فقط VIP)
app.get('/api/farms/rent', async (req, res) => {
  try {
    const vipOnly = String(req.query.vipOnly || '') === '1';

    // نجلب المزارع للإيجار + مقبولة
    let rows = await Farm.find({ kind: 'rent', status: 'approved' })
      .populate('owner', 'subscriptionTier') // يجلب اشتراك المالك
      .sort({ createdAt: -1 })
      .lean();

    // نضيف ownerTier من حساب المالك (Basic/Premium/VIP)
    rows = rows.map(f => ({
      ...f,
      ownerTier: (f.owner?.subscriptionTier || 'Basic')
    }));

    if (vipOnly) {
      rows = rows.filter(f => f.ownerTier === 'VIP');
    }

    return res.json({ ok: true, data: rows });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, msg: 'Server error' });
  }
});

app.listen(port, () => {
  console.log(`🚀 Server on http://localhost:${port}`);
});
