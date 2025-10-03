// utils/mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,         // مثلاً: smtp.gmail.com
  port: Number(process.env.SMTP_PORT), // 587
  secure: false,                       // STARTTLS على 587
  auth: {
    user: process.env.SMTP_USER,       // إيميل المُرسِل (الشركة)
    pass: process.env.SMTP_PASS,       // App Password
  },
});

async function sendMail({ to, subject, html, text }) {
  if (!to) throw new Error('Missing "to"');
  await transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject,
    text,
    html,
  });
}

module.exports = { sendMail, transporter };
