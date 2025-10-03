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
  subscriptionTier: { type:String, enum:['Basic','Premium','VIP'], default:'Basic' }
}, { timestamps: true });

module.exports = mongoose.model('ContractorRequest', ContractorRequestSchema);
