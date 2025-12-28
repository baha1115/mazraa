// models/HeroSlide.js
const mongoose = require('mongoose');

const HeroSlideSchema = new mongoose.Schema({
  img:  { type: String, required: true, trim: true },  // رابط الصورة
  title: { type: String, default: '' },                 // يدعم HTML بسيط (أنت تستخدم <%- %> في العرض)
  lead:  { type: String, default: '' },                 // سطر ثانٍ
  order: { type: Number, default: 0 },                  // ترتيب العرض
  enabled: { type: Boolean, default: true },  
  btn1Text: { type: String, default: '', trim: true },
  btn1Link: { type: String, default: '', trim: true },
  btn2Text: { type: String, default: '', trim: true },
  btn2Link: { type: String, default: '', trim: true },          // تفعيل/تعطيل الشريحة
}, { timestamps: true });

module.exports = mongoose.model('HeroSlide', HeroSlideSchema);
