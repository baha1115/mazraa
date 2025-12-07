// routers/adminHomeCMS.js
const express = require('express');
const router = express.Router();
const HomeCMS = require('../models/HomeCMS');
// وسطيات الصلاحيات لديك:
const { requireAdmin } = require('./_middlewares'); // غيّر المسار حسب مشروعك

// احصل/أنشئ الوثيقة الأساسية إن لم تكن موجودة
async function getDoc() {
  let doc = await HomeCMS.findOne({ key: 'home' });
  if (!doc) doc = await HomeCMS.create({ key: 'home', heroSlides: [], testimonials: [] });
  return doc;
}

// صفحة إدارة بسيطة (JSON أو EJS حسب ما تحب)
router.get('/admin/home-cms', requireAdmin, async (req, res) => {
  const doc = await getDoc();
  res.render('admin-home-cms', { doc }); // أنشئ ملف EJS بسيط لاحقًا
});

// ====== HERO CRUD ======
router.post('/admin/home-cms/hero', requireAdmin, async (req, res) => {
  const { img, title, lead, order=0, enabled=true } = req.body;
  const doc = await getDoc();
  doc.heroSlides.push({ img, title, lead, order: Number(order)||0, enabled: !!enabled });
  await doc.save();
  res.redirect('/admin/home-cms?type=success&msg=تم%20الإضافة');
});

router.patch('/admin/home-cms/hero/:sid', requireAdmin, async (req, res) => {
  const { sid } = req.params;
  const { img, title, lead, order, enabled } = req.body;
  const doc = await getDoc();
  const s = doc.heroSlides.id(sid);
  if (!s) return res.status(404).send('Not found');
  if (img !== undefined) s.img = img;
  if (title !== undefined) s.title = title;
  if (lead !== undefined) s.lead = lead;
  if (order !== undefined) s.order = Number(order)||0;
  if (enabled !== undefined) s.enabled = !!enabled;
  await doc.save();
  res.redirect('/admin/home-cms?type=success&msg=تم%20التحديث');
});

router.delete('/admin/home-cms/hero/:sid', requireAdmin, async (req, res) => {
  const doc = await getDoc();
  const s = doc.heroSlides.id(req.params.sid);
  if (!s) return res.status(404).send('Not found');
  s.deleteOne();
  await doc.save();
  res.redirect('/admin/home-cms?type=success&msg=تم%20الحذف');
});

// ====== TESTIMONIALS CRUD ======
router.post('/admin/home-cms/testimonial', requireAdmin, async (req, res) => {
  const { name, role, img, stars=5, text, order=0, enabled=true } = req.body;
  const doc = await getDoc();
  doc.testimonials.push({
    name, role, img, stars: Math.max(1, Math.min(5, Number(stars)||5)),
    text, order: Number(order)||0, enabled: !!enabled
  });
  await doc.save();
  res.redirect('/admin/home-cms?type=success&msg=تم%20الإضافة');
});

router.patch('/admin/home-cms/testimonial/:tid', requireAdmin, async (req, res) => {
  const { tid } = req.params;
  const { name, role, img, stars, text, order, enabled } = req.body;
  const doc = await getDoc();
  const t = doc.testimonials.id(tid);
  if (!t) return res.status(404).send('Not found');
  if (name !== undefined) t.name = name;
  if (role !== undefined) t.role = role;
  if (img !== undefined)  t.img  = img;
  if (text !== undefined) t.text = text;
  if (stars !== undefined) t.stars = Math.max(1, Math.min(5, Number(stars)||5));
  if (order !== undefined) t.order = Number(order)||0;
  if (enabled !== undefined) t.enabled = !!enabled;
  await doc.save();
  res.redirect('/admin/home-cms?type=success&msg=تم%20التحديث');
});

router.delete('/admin/home-cms/testimonial/:tid', requireAdmin, async (req, res) => {
  const doc = await getDoc();
  const t = doc.testimonials.id(req.params.tid);
  if (!t) return res.status(404).send('Not found');
  t.deleteOne();
  await doc.save();
  res.redirect('/admin/home-cms?type=success&msg=تم%20الحذف');
});

module.exports = router;
