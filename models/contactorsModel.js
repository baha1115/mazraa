// models/contactorsModel.js
const mongoose = require('mongoose');

const ContractorSchema = new mongoose.Schema({
  // مهم جداً: ربط بجدول/مجموعة المستخدمين
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  // بيانات الملف الشخصي
  name:        { type: String, trim: true },
  email:       { type: String, trim: true },
  phone:       { type: String, trim: true },
  region:      { type: String, trim: true },
  bio:         { type: String, trim: true },

  // بيانات المؤسسة (بديل بطاقة المقاول)
  companyName: { type: String, trim: true },
  services:    { type: [String], default: [] },
  city:        { type: String, trim: true },
  description: { type: String, trim: true },
  // ... داخل ContractorSchema
  videoUrl: { type: String, trim: true, default: '' },

  // الصور
  avatar:      { type: String, default: '' },       // Base64 أو URL
  photos:      { type: [String], default: [] },     // Base64 أو URL

  // حالة المراجعة
  status:      { type: String, enum: ['pending','approved','rejected'], default: 'pending', index: true },
  reviewNote:  { type: String, default: '' },
  approvedAt:  { type: Date, default: null },
  rejectedAt:  { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Contractor', ContractorSchema);
