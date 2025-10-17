// app.js
require('dotenv').config();

const path           = require('path');
const express        = require('express');
const mongoose       = require('mongoose');
const session        = require('express-session');
const MongoStore     = require('connect-mongo');
const nodemailer     = require('nodemailer');
const methodOverride = require('method-override');
const cookieParser   = require('cookie-parser');
const { randomUUID } = require('crypto');

// Utils / Mailer
const { verifyTransporter } = require('./utils/mailer2');
verifyTransporter();

// Models (التي نحتاجها هنا مباشرة)
const Farm = require('./models/farmModel');
const User = require('./models/usermodels'); // غيّر المسار لو اسم الملف مختلف

// Routers
const loginRouter  = require('./routers/loginrouter');
const publicRouter = require('./routers/public');       // إن كان موجودًا
const adminRouter  = require('./routers/adminRouter');
const ownerRouter  = require('./routers/ownerRouter');  // إن وُجد

// App init
const app  = express();
const port = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// إعدادات أساسية
// ---------------------------------------------------------------------------

// يسمح باستخدام ?_method=PATCH/DELETE
app.use(methodOverride('_method'));
app.use(cookieParser());

// Static
app.use('/public',  express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Body parsers
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.json({ limit: '25mb' }));

// Proxy
app.set('trust proxy', 1);

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------------------------------------------------------------------------
// اتصال قاعدة البيانات
// ---------------------------------------------------------------------------
mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ---------------------------------------------------------------------------
/**
 * API Router (بلا جلسات): ضعه قبل session middleware
 * حتى لا يحدث touch للجلسات في طلبات الـfetch العامة.
 */
const api = express.Router();

// /api/farms/rent  (كل المزارع للإيجار المقبولة)
// ?vipOnly=1       (فقط VIP)
api.get('/farms/rent', async (req, res) => {
  try {
    const vipOnly = String(req.query.vipOnly || '') === '1';

    let rows = await Farm.find({ kind: 'rent', status: 'approved' })
      .populate('owner', 'subscriptionTier')
      .sort({ createdAt: -1 })
      .lean();

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

// اربط الـAPI قبل الجلسات
app.use('/api', api);

// ---------------------------------------------------------------------------
// Cookie مميِّز للزائر (لا يتعارض مع شيء)
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  if (!req.cookies.anonId) {
    res.cookie('anonId', randomUUID(), {
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 365 * 24 * 60 * 60 * 1000
    });
  }
  next();
});

// ---------------------------------------------------------------------------
// الجلسات (تعمل لصفحات الواجهة فقط، وليس لراوتر /api)
// ---------------------------------------------------------------------------
app.use(session({
  name: 'sid',
  secret: process.env.SESSION_SECRET || 'devsecret',
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7,
    // secure: true // فعّلها على HTTPS
  },
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI || process.env.MONGO_URI,
    collectionName: 'sessions',
    ttl: 14 * 24 * 60 * 60,
    disableTouch: true,      // الأهم: لا تعمل touch لكل طلب
    autoRemove: 'interval',
    autoRemoveInterval: 10
  })
}));

// تنظيف الكوكي الفاسدة إن حصل خطأ touch (بدون إسقاط الطلب)
app.use((err, req, res, next) => {
  if (err && /Unable to find the session to touch/i.test(err.message)) {
    res.clearCookie('sid', { sameSite: 'lax' });
    return next();
  }
  next(err);
});

// ---------------------------------------------------------------------------
// تمرير بيانات المستخدم إلى القوالب (EJS)
// ---------------------------------------------------------------------------
app.use(async (req, res, next) => {
  try {
    const u = req.session?.user || null;

    if (u?._id) {
      const fresh = await User.findById(u._id, 'subscriptionTier plan role name email').lean();
      if (fresh) {
        const tier = fresh.subscriptionTier || fresh.plan || 'Basic';
        if (req.session.user.subscriptionTier !== tier) {
          req.session.user.subscriptionTier = tier;
        }
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

    res.locals.currentUser  = req.session?.user || null;
    res.locals.isAuth       = !!req.session?.user;
    res.locals.role         = req.session?.user?.role || 'guest';
    res.locals.isAdmin      = req.session?.user?.role === 'admin';
    res.locals.isContractor = req.session?.user?.role === 'contractor';
    res.locals.isOwner      = req.session?.user?.role === 'owner';

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

// ---------------------------------------------------------------------------
// SMTP (اختياري)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// صفحات أساسية
// ---------------------------------------------------------------------------
app.get('/login',  (req, res) => res.render('signup'));
app.get('/signup', (req, res) => res.render('signup'));



// ---------------------------------------------------------------------------
// ربط الراوترات (بعد تهيئة كل شيء)
// ---------------------------------------------------------------------------
app.use('/admin', adminRouter);
app.use('/', loginRouter);
app.use('/', publicRouter);
app.use('/', ownerRouter);


app.use((req, res) => {
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(404).json({ ok:false, msg:'Not found' });
  }
  return res.status(404).send('الصفحة غير موجودة');
});

// ---------------------------------------------------------------------------
// تشغيل السيرفر
// ---------------------------------------------------------------------------
app.listen(port, () => {
  console.log(`🚀 Server on http://localhost:${port}`);
});
