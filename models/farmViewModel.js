// models/farmViewModel.js
const mongoose = require('mongoose');

const farmViewSchema = new mongoose.Schema({
  farm: { type: mongoose.Schema.Types.ObjectId, ref: 'Farm', required: true, index: true },
  key:  { type: String, required: true, index: true }, // user:ID | anon:UUID | ip:...|ua:...
  day:  { type: String, required: true, index: true }   // YYYY-MM-DD
}, { timestamps: true });

// تمنع تكرار المشاهدة لنفس المفتاح في نفس اليوم
farmViewSchema.index({ farm: 1, key: 1, day: 1 }, { unique: true });

module.exports = mongoose.model('FarmView', farmViewSchema);

