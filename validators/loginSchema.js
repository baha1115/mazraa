// validators/authSchemas.js
const Joi = require('joi');

const baseEmail = Joi.string().trim().lowercase().email({ tlds: { allow: false } });

exports.signupSchema = Joi.object({
  name: Joi.string().trim().min(2).required().messages({
    'string.empty': 'الاسم مطلوب',
    'string.min': 'الاسم قصير'
  }),
  email: baseEmail.required().messages({
    'string.email': 'بريد إلكتروني غير صالح',
    'string.empty': 'البريد الإلكتروني مطلوب'
  }),
  phone: Joi.string().trim().allow('', null), // اجعله إلزامياً إن أردت
  role: Joi.string().valid('contractor', 'landowner').required().messages({
    'any.only': 'يجب اختيار: مقاول أو صاحب أرض'
  }),
  password: Joi.string().min(6).required().messages({
    'string.min': 'كلمة المرور 6 أحرف على الأقل',
    'string.empty': 'كلمة المرور مطلوبة'
  }),
  confirm: Joi.any().valid(Joi.ref('password')).required().messages({
    'any.only': 'تأكيد كلمة المرور لا يطابق كلمة المرور',
    'any.required': 'تأكيد كلمة المرور مطلوب'
  })
});

exports.loginSchema = Joi.object({
  identifier: baseEmail.required().messages({
    'string.email': 'البريد غير صالح',
    'string.empty': 'أدخل البريد الإلكتروني'
  }),
  password: Joi.string().required().messages({
    'string.empty': 'أدخل كلمة المرور'
  })
});

exports.forgotSchema = Joi.object({
  email: baseEmail.required().messages({
    'string.email': 'البريد غير صالح',
    'string.empty': 'أدخل بريدك الإلكتروني'
  })
});

exports.resetSchema = Joi.object({
  password: Joi.string().min(6).required().messages({
    'string.min': 'كلمة المرور 6 أحرف على الأقل',
    'string.empty': 'كلمة المرور مطلوبة'
  }),
  confirm: Joi.any().valid(Joi.ref('password')).required().messages({
    'any.only': 'تأكيد كلمة المرور لا يطابق كلمة المرور',
    'any.required': 'تأكيد كلمة المرور مطلوب'
  })
});
