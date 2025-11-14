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
currency: { type: String, enum: ['USD','SYP'], default: 'USD' }
,
  title: { type: String, required: true },
  kind: { type: String, enum: ['sale','rent'], default: 'sale' },
  area: String,
  city: String,
  size: Number,
  price: Number,
// ضمن مخطط Farm
views: { type: Number, default: 0 },
// أمّا تضيف حقل حالة أدق، أو حقول فلاغ:
isSuspended: { type: Boolean, default: false }, // مُعلّق (خارج الظهور)
suspendedReason: { type: String, default: '' },
deletedAt: { type: Date, default: null }  // حذف ناعم بعد انتهاء المهلة

,
  photos: [String],
  poolDesc: { type: String, default: '' },       // وصف المسبح
  amenitiesDesc: { type: String, default: '' },  // وصف المرافق
  buildingDesc: { type: String, default: '' },   // وصف البناء
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
// فهارس أداء للقوائم/الفرز/التصفية:
FarmSchema.index({ kind: 1, status: 1, isSuspended: 1, deletedAt: 1, createdAt: -1 });

// لو تستخدم تمييز مالك VIP داخل وثيقة المزرعة (denormalized):
FarmSchema.index({ ownerTier: 1, createdAt: -1 });

// في حال التصفية بالمدينة/المنطقة:
FarmSchema.index({ city: 1, area: 1 });

module.exports = mongoose.model('Farm', FarmSchema);
