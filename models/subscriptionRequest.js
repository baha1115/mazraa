// models/subscriptionRequest.js
const mongoose = require('mongoose');

const SubscriptionRequestSchema = new mongoose.Schema({
  user:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:      { type: String, default: '' },        // اسم المالك (اختياري)
  whatsapp:  { type: String, default: '' },        // رقم واتساب للتواصل
  plan:      { type: String, enum: ['Premium','VIP'], required: true },
  notes:     { type: String, default: '' },
  status:    { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
  reviewNote:{ type: String, default: '' },        // سبب الرفض (اختياري)
  approvedAt:{ type: Date, default: null },
  rejectedAt:{ type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('SubscriptionRequest', SubscriptionRequestSchema);
