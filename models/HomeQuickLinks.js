// models/HomeQuickLinks.js
const mongoose = require('mongoose');

const HomeQuickLinksSchema = new mongoose.Schema({
  key: { type: String, unique: true, default: 'default', index: true },
  saleImg:        { type: String, default: '/Public/assests/farm4k1.jpg' },
  rentImg:        { type: String, default: '/Public/assests/farm4k1.jpg' },
  contractorsImg: { type: String, default: '/Public/assests/farm4k1.jpg' },
  // لو حبيت مستقبلاً تضيف تفعيل/تعطيل أو عناوين على الصور:
  enabled: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('HomeQuickLinks', HomeQuickLinksSchema);
