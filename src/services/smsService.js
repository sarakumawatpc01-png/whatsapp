// src/services/smsService.js
// Sends SMS OTPs via Twilio (primary) or MSG91 (fallback).
// Provider is selected from the global_setting "otp_provider" or the env.
const twilio = require('twilio');
const axios  = require('axios');
const prisma = require('../config/database');
const logger = require('../config/logger');

// ── PROVIDER SELECTION ────────────────────────────────────────
async function getProvider() {
  try {
    const setting = await prisma.globalSetting.findUnique({ where: { key: 'otp_provider' } });
    return setting?.value || process.env.OTP_PROVIDER || 'twilio';
  } catch {
    return process.env.OTP_PROVIDER || 'twilio';
  }
}

async function getOTPTemplate() {
  try {
    const setting = await prisma.globalSetting.findUnique({ where: { key: 'otp_sms_template' } });
    return setting?.value || 'Your WaizAI verification code is {otp}. Valid for 10 minutes. Do not share this code.';
  } catch {
    return 'Your WaizAI verification code is {otp}. Valid for 10 minutes. Do not share this code.';
  }
}

// ── MAIN SEND FUNCTION ────────────────────────────────────────
/**
 * Sends an OTP SMS to a phone number.
 * @param {string} toPhone  - E.164 format e.g. "+919876543210"
 * @param {string} otpCode  - The 6-digit OTP
 * @returns {Promise<boolean>} true on success, false on failure
 */
async function sendOTPSMS(toPhone, otpCode) {
  const provider = await getProvider();
  const template = await getOTPTemplate();
  const message  = template.replace('{otp}', otpCode);

  try {
    if (provider === 'msg91') {
      return await sendViaMSG91(toPhone, message);
    }
    return await sendViaTwilio(toPhone, message);
  } catch (err) {
    logger.error(`sendOTPSMS failed (provider: ${provider}):`, err.message);
    return false;
  }
}

// ── TWILIO ────────────────────────────────────────────────────
async function sendViaTwilio(toPhone, message) {
  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from  = process.env.TWILIO_PHONE_NUMBER;

  if (!sid || !token || !from) {
    logger.warn('Twilio credentials not configured — skipping SMS send');
    return false;
  }

  const client = twilio(sid, token);

  await client.messages.create({
    body: message,
    from,
    to:   toPhone,
  });

  logger.info(`OTP SMS sent via Twilio to ${toPhone.slice(0, 5)}****`);
  return true;
}

// ── MSG91 ─────────────────────────────────────────────────────
async function sendViaMSG91(toPhone, message) {
  const authKey  = process.env.MSG91_AUTH_KEY;
  const senderId = process.env.MSG91_SENDER_ID || 'WAIZAI';

  if (!authKey) {
    logger.warn('MSG91 credentials not configured — skipping SMS send');
    return false;
  }

  // Remove the leading '+' and country code for MSG91 (expects plain number)
  const mobile = toPhone.replace(/^\+/, '');

  const response = await axios.post(
    'https://api.msg91.com/api/v5/flow/',
    {
      template_id: process.env.MSG91_TEMPLATE_ID,
      short_url:   '0',
      mobiles:     mobile,
      OTP:         message.match(/\d{6}/)?.[0] || '',
    },
    {
      headers: {
        authkey:       authKey,
        'Content-Type': 'application/json',
      },
    }
  );

  if (response.data?.type === 'success') {
    logger.info(`OTP SMS sent via MSG91 to ${toPhone.slice(0, 5)}****`);
    return true;
  }

  logger.warn(`MSG91 response non-success:`, response.data);
  return false;
}

// ── GENERIC SEND ──────────────────────────────────────────────
/**
 * Sends any custom SMS (not just OTP) via Twilio.
 * Used for appointment reminders, etc.
 */
async function sendSMS(toPhone, message) {
  return sendViaTwilio(toPhone, message);
}

module.exports = { sendOTPSMS, sendSMS };
