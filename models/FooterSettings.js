// models/FooterSettings.js
const mongoose = require('mongoose');

const FooterSettingsSchema = new mongoose.Schema({
  key:      { type: String, unique: true, default: 'default' },
  email:    { type: String, default: '' },
  phone:    { type: String, default: '' },        // مثال: +963 900 000 000
  whatsapp: { type: String, default: '' },        // رقم فقط أو يبدأ + (سنعقّمه في الواجهة)
  address:  { type: String, default: '' },

  facebook:  { type: String, default: '' },
  twitter:   { type: String, default: '' },
  youtube:   { type: String, default: '' },
  instagram: { type: String, default: '' },
  tiktok:    { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('FooterSettings', FooterSettingsSchema);
