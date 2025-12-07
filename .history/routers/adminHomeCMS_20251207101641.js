// routers/adminHomeCMS.js
const express = require('express');
const router = express.Router();
const HomeCMS = require('../models/HomeCMS');
const { requireAdmin } = require('./_middlewares'); // غيّر المسار لو مختلف

// ===== Helpers =====

// احصل/أنشئ الوثيقة الأساسية إن لم تكن موجودة
async function getDoc() {
  let doc = await HomeCMS.findOne({ key: 'home' });
  if (!doc) {
    doc = await HomeCMS.create({ key: 'home', heroSlides: [], testimonials: [] });
  }
  return doc;
}

// ريديركت موحد عند الخطأ مع رسالة
function cmsErrorRedirect(res, msg) {
  const url = '/admin/home-cms?type=error&msg=' + encodeURIComponent(msg || 'حدث خطأ غير متوقع');
  return res.redirect(url);
}

// ===== Routes =====

// صفحة إدارة بسيطة
router.get('/admin/home-cms', requireAdmin, async (req, res) => {
  try {
    const doc = await getDoc();
    return res.render('admin-home-cms', { doc });
  } catch (err) {
    console.error('GET /admin/home-cms error:', err);
    // ممكن تعرض صفحة خطأ لطيفة أو نفس الصفحة بدون بيانات
    return res.status(500).render('admin-home-cms', {
      doc: null,
      error: 'تعذر تحميل بيانات الصفحة، حاول مجددًا.'
    });
  }
});

// ====== HERO CRUD ======

router.post('/admin/home-cms/hero', requireAdmin, async (req, res) => {
  try {
    const { img, title, lead, order = 0, enabled = true } = req.body;
    const doc = await getDoc();

    doc.heroSlides.push({
      img,
      title,
      lead,
      order: Number(order) || 0,
      enabled: !!enabled
    });

    await doc.save();
    return res.redirect('/admin/home-cms?type=success&msg=' + encodeURIComponent('تم الإضافة'));
  } catch (err) {
    console.error('POST /admin/home-cms/hero error:', err);
    return cmsErrorRedirect(res, 'تعذر إضافة الشريحة، حاول مجددًا.');
  }
});

router.patch('/admin/home-cms/hero/:sid', requireAdmin, async (req, res) => {
  try {
    const { sid } = req.params;
    const { img, title, lead, order, enabled } = req.body;
    const doc = await getDoc();
    const s = doc.heroSlides.id(sid);

    if (!s) {
      return res.status(404).send('Not found');
    }

    if (img !== undefined) s.img = img;
    if (title !== undefined) s.title = title;
    if (lead !== undefined) s.lead = lead;
    if (order !== undefined) s.order = Number(order) || 0;
    if (enabled !== undefined) s.enabled = !!enabled;

    await doc.save();
    return res.redirect('/admin/home-cms?type=success&msg=' + encodeURIComponent('تم التحديث'));
  } catch (err) {
    console.error('PATCH /admin/home-cms/hero/:sid error:', err);
    return cmsErrorRedirect(res, 'تعذر تحديث الشريحة، حاول مجددًا.');
  }
});

router.delete('/admin/home-cms/hero/:sid', requireAdmin, async (req, res) => {
  try {
    const doc = await getDoc();
    const s = doc.heroSlides.id(req.params.sid);

    if (!s) {
      return res.status(404).send('Not found');
    }

    s.deleteOne();
    await doc.save();

    return res.redirect('/admin/home-cms?type=success&msg=' + encodeURIComponent('تم الحذف'));
  } catch (err) {
    console.error('DELETE /admin/home-cms/hero/:sid error:', err);
    return cmsErrorRedirect(res, 'تعذر حذف الشريحة، حاول مجددًا.');
  }
});

// ====== TESTIMONIALS CRUD ======

router.post('/admin/home-cms/testimonial', requireAdmin, async (req, res) => {
  try {
    const {
      name,
      role,
      img,
      stars = 5,
      text,
      order = 0,
      enabled = true
    } = req.body;

    const doc = await getDoc();

    doc.testimonials.push({
      name,
      role,
      img,
      stars: Math.max(1, Math.min(5, Number(stars) || 5)),
      text,
      order: Number(order) || 0,
      enabled: !!enabled
    });

    await doc.save();
    return res.redirect('/admin/home-cms?type=success&msg=' + encodeURIComponent('تم الإضافة'));
  } catch (err) {
    console.error('POST /admin/home-cms/testimonial error:', err);
    return cmsErrorRedirect(res, 'تعذر إضافة التوصية، حاول مجددًا.');
  }
});

router.patch('/admin/home-cms/testimonial/:tid', requireAdmin, async (req, res) => {
  try {
    const { tid } = req.params;
    const { name, role, img, stars, text, order, enabled } = req.body;

    const doc = await getDoc();
    const t = doc.testimonials.id(tid);

    if (!t) {
      return res.status(404).send('Not found');
    }

    if (name !== undefined) t.name = name;
    if (role !== undefined) t.role = role;
    if (img !== undefined)  t.img  = img;
    if (text !== undefined) t.text = text;
    if (stars !== undefined) t.stars = Math.max(1, Math.min(5, Number(stars) || 5));
    if (order !== undefined) t.order = Number(order) || 0;
    if (enabled !== undefined) t.enabled = !!enabled;

    await doc.save();
    return res.redirect('/admin/home-cms?type=success&msg=' + encodeURIComponent('تم التحديث'));
  } catch (err) {
    console.error('PATCH /admin/home-cms/testimonial/:tid error:', err);
    return cmsErrorRedirect(res, 'تعذر تحديث التوصية، حاول مجددًا.');
  }
});

router.delete('/admin/home-cms/testimonial/:tid', requireAdmin, async (req, res) => {
  try {
    const doc = await getDoc();
    const t = doc.testimonials.id(req.params.tid);

    if (!t) {
      return res.status(404).send('Not found');
    }

    t.deleteOne();
    await doc.save();

    return res.redirect('/admin/home-cms?type=success&msg=' + encodeURIComponent('تم الحذف'));
  } catch (err) {
    console.error('DELETE /admin/home-cms/testimonial/:tid error:', err);
    return cmsErrorRedirect(res, 'تعذر حذف التوصية، حاول مجددًا.');
  }
});

module.exports = router;
