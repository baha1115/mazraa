// models/promoModel.js
const mongoose = require('mongoose');

const promoSchema = new mongoose.Schema({
  key: { type: String, unique: true }, // مثلا: 'contractors'
  enabled: { type: Boolean, default: false },
  img: { type: String, default: '/Public/assets/contractors/promo-01.jpg' },
  title: { type: String, default: 'عنوان ترويجي' },
  text: { type: String, default: 'نص ترويجي مختصر.' },
  link: { type: String, default: '/contractors' }
}, { timestamps: true });

module.exports = mongoose.model('PromoBlock', promoSchema);
