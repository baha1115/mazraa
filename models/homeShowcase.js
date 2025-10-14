// models/homeShowcase.js
const mongoose = require('mongoose');

const ShowcaseItemSchema = new mongoose.Schema({
  img:   { type: String, required: true },      // خلفية الكرت
  title: { type: String, default: '' },         // عنوان
  desc:  { type: String, default: '' },         // وصف
  link:  { type: String, default: '#' },        // رابط الزر
  order: { type: Number, default: 0 },          // ترتيب داخل السكشن
}, { _id:false });

const HomeShowcaseSchema = new mongoose.Schema({
  key: {                                           // مفتاح ثابت لكل سكشن
    type: String,
    enum: ['rentTop','saleTop','bestContractors'],
    required: true,
    unique: true,
    index: true
  },
  title:   { type: String, default: '' },          // عنوان السكشن (اختياري)
  enabled: { type: Boolean, default: true },       // تفعيل/تعطيل السكشن
  items:   { type: [ShowcaseItemSchema], default: [] } // حتى 3 كروت (أو أكثر إذا حبيت)
}, { timestamps: true });

module.exports = mongoose.model('HomeShowcase', HomeShowcaseSchema);
