// models/PromoBanner.js
const mongoose = require('mongoose');

const BannerItemSchema = new mongoose.Schema({
  img:   { type: String, required: true },
  title: { type: String, default: '' },
  text:  { type: String, default: '' },
  link:  { type: String, default: '' },
  btn:   { type: String, default: 'التفاصيل' },
  order: { type: Number, default: 0 }
}, { _id: true });

const PromoBannerSchema = new mongoose.Schema({
  key:      { type: String, unique: true, index: true }, // مثال: 'home-banners'
  enabled:  { type: Boolean, default: true },
  items:    { type: [BannerItemSchema], default: [] },
  updatedBy:{ type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }
}, { timestamps: true });

module.exports = mongoose.model('PromoBanner', PromoBannerSchema);
