const mongoose = require('mongoose');

const ContractorRequestSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true, index: true },

  // نسخة من البيانات المرسلة من لوحة المقاول:
  name: String,
  email: String,
  phone: String,
  region: String,
  bio: String,

  companyName: { type: String, required: true },
  services: { type: [String], default: [] },
  city: String,
  description: String,
  videoUrl: { type: String, trim: true, default: '' },
  avatar: String,
  photos: { type: [String], default: [] },

  // حالة المراجعة
  status: { type: String, enum: ['pending','approved','rejected'], default: 'pending', index: true },
  reviewNote: { type: String, default: '' },
  approvedAt: { type: Date, default: null },
  rejectedAt: { type: Date, default: null },
  subscriptionTier: { type:String, enum:['Basic','Premium','VIP'], default:'Basic' }, 
  // ⭐ التقييمات
  ratingAvg:   { type: Number, default: 0 },  // معدل التقييم (0..5)
  ratingCount: { type: Number, default: 0 },  // عدد التقييمات
  ratings: [{
    user:     { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: false },
    value:    { type: Number, min: 1, max: 5, required: true },
    ip:       { type: String, default: '' },      // لتقليل التكرار من نفس IP (اختياري)
    ua:       { type: String, default: '' },      // المتصفح (اختياري)
    createdAt:{ type: Date, default: Date.now }
  }]
}, { timestamps: true });

module.exports = mongoose.model('ContractorRequest', ContractorRequestSchema);
