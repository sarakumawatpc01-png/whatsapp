// src/utils/emailService.js
const nodemailer = require('nodemailer');
const logger = require('../config/logger');

let transporter;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY },
    });
  }
  return transporter;
}

async function sendEmail({ to, subject, html, text }) {
  try {
    await getTransporter().sendMail({
      from: `"${process.env.EMAIL_FROM_NAME || 'WaizAI'}" <${process.env.EMAIL_FROM || 'noreply@waizai.com'}>`,
      to, subject, html, text,
    });
    logger.info(`Email sent to ${to}: ${subject}`);
  } catch (err) {
    logger.error(`Email send error to ${to}:`, err.message);
    throw err;
  }
}

async function sendOTPEmail(to, otp, name = 'User') {
  await sendEmail({
    to,
    subject: 'Your WaizAI Verification Code',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#00C45A">WaizAI Verification</h2>
        <p>Hi ${name},</p>
        <p>Your verification code is:</p>
        <div style="font-size:36px;font-weight:bold;color:#0a0e14;background:#f5f5f5;padding:20px;text-align:center;border-radius:8px;letter-spacing:8px">${otp}</div>
        <p style="color:#666">This code expires in <strong>10 minutes</strong>.</p>
        <p style="color:#999;font-size:12px">If you didn't request this, ignore this email.</p>
      </div>`,
  });
}

async function sendWelcomeEmail(to, name, businessName) {
  await sendEmail({
    to,
    subject: `Welcome to WaizAI, ${businessName}! 🎉`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#00C45A">Welcome to WaizAI!</h2>
        <p>Hi ${name},</p>
        <p>Your account for <strong>${businessName}</strong> is ready.</p>
        <p>Next steps:</p>
        <ol>
          <li>Scan the WhatsApp QR code in your dashboard</li>
          <li>Fill in your business profile</li>
          <li>Your AI agent will be live instantly!</li>
        </ol>
        <a href="${process.env.FRONTEND_URL}/dashboard" style="background:#00C45A;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Open Dashboard</a>
      </div>`,
  });
}

async function sendPasswordResetEmail(to, name, resetToken) {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
  await sendEmail({
    to,
    subject: 'Reset your WaizAI password',
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto">
        <h2>Password Reset</h2>
        <p>Hi ${name},</p>
        <p>Click the button below to reset your password. This link expires in 1 hour.</p>
        <a href="${resetUrl}" style="background:#00C45A;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block">Reset Password</a>
        <p style="color:#999;font-size:12px">If you didn't request this, ignore this email.</p>
      </div>`,
  });
}

module.exports = { sendEmail, sendOTPEmail, sendWelcomeEmail, sendPasswordResetEmail };
