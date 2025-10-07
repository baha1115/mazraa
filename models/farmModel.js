// models/farmModel.js
const mongoose = require('mongoose');
const OwnerInfoSchema = new mongoose.Schema({
  first: String,
  last: String,
  whatsapp: String,
}, {_id:false});
const FarmSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // أو اتركه كما عندك
   ownerInfo: OwnerInfoSchema,

  title: { type: String, required: true },
  kind: { type: String, enum: ['sale','rent'], default: 'sale' },
  area: String,
  city: String,
  size: Number,
  price: Number,
// ضمن مخطط Farm
views: { type: Number, default: 0 },


  photos: [String],

  description: String,  // استخدم هذا الحقل للنص
  location: {
    lat: Number,
    lng: Number,
    address: String
  },
 videoUrl: { type: String, default: '' },
  status: { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
  approvedAt: { type: Date, default: null },

  // جديد: وقت الرفض ليُستخدم مع TTL
  rejectedAt: { type: Date, default: null },

  reviewNote: { type: String, default: '' }
}, { timestamps: true });

// فهرس TTL: يحذف الوثائق بعد 7 أيام من قيمة rejectedAt.
// ملاحظة: TTL يعمل فقط عندما تكون rejectedAt != null
FarmSchema.index({ rejectedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

module.exports = mongoose.model('Farm', FarmSchema);
