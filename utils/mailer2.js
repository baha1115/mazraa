// utils/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: false, // 587 = STARTTLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  }
});

// اختياري: تأكيد الإعداد عند تشغيل السيرفر
async function verifyTransporter() {
  try {
    await transporter.verify();
    console.log('✅ SMTP ready');
  } catch (err) {
    console.error('❌ SMTP verify error:', err.message);
  }
}

async function sendMail({ to, subject, html, text }) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  return transporter.sendMail({ from, to, subject, text, html });
}

module.exports = { sendMail, verifyTransporter };
