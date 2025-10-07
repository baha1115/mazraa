// models/User.js
const { Schema, model } = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new Schema({
  name:   { type: String, required: true, trim: true, minlength: 2 },
  email:  { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone:  { type: String, trim: true },

  // انتبه لأسماء الأدوار لتتوافق مع بقية المشروع لديك
  role:   { type: String, required: true, enum: ['contractor', 'landowner', 'owner', 'admin'] },

  // 🔹 الحقول الناقصة (المشكلة):
  subscriptionTier: { type: String, enum: ['Basic','Premium','VIP'], default: 'Basic' },
  plan:             { type: String, enum: ['Basic','Premium','VIP'], default: 'Basic' }, // اختياري للتوافق
 // ⭐ جديد:
  subscriptionUntil: { type: Date, default: null },

  password: { type: String, required: true, minlength: 6 },
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
}, { timestamps: true });

userSchema.pre('save', async function(next){
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

userSchema.methods.comparePassword = function(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = model('User', userSchema);
