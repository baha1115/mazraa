// validators/authSchemas.js  (أو loginSchema.js عندك)
const Joi = require('joi');

const baseEmail = Joi.string().trim().lowercase().email({ tlds: { allow: false } });

exports.signupSchema = Joi.object({
  name: Joi.string().trim().min(2).required(),
  email: baseEmail.required(),
  phone: Joi.string().trim().min(6).required(),   // ← أصبح مطلوبًا
  role: Joi.string().valid('contractor', 'landowner').required(),
  password: Joi.string().min(6).required(),
  confirm: Joi.any().valid(Joi.ref('password')).required()
});

exports.loginSchema = Joi.object({
  identifier: Joi.string().required(),            // ← بريد أو هاتف
  password: Joi.string().min(6).required()
});

exports.forgotSchema = Joi.object({
  email: baseEmail.required()
});

exports.resetSchema = Joi.object({
  password: Joi.string().min(6).required(),
  confirm: Joi.any().valid(Joi.ref('password')).required()
});
