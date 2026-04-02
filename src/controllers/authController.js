// src/controllers/authController.js
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const { v4: uuidv4 } = require('uuid');
const prisma  = require('../config/database');
const { AppError, ValidationError } = require('../utils/errors');
const { success } = require('../utils/response');
const { sendOTPEmail, sendWelcomeEmail, sendPasswordResetEmail } = require('../utils/emailService');
const { cacheSet, cacheGet, cacheDel } = require('../config/redis');
const logger  = require('../config/logger');

// ── HELPERS ────────────────────────────────────────────────────
function generateTokens(tenantId) {
  const accessToken = jwt.sign({ tenantId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  });
  const refreshToken = jwt.sign({ tenantId }, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  });
  return { accessToken, refreshToken };
}

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ── REGISTER ───────────────────────────────────────────────────
async function register(req, res, next) {
  try {
    const { ownerName, businessName, email, phone, password, affiliateCode } = req.body;

    if (!ownerName || !businessName || !email || !phone || !password) {
      return next(new ValidationError('All fields are required'));
    }
    if (password.length < 8) {
      return next(new ValidationError('Password must be at least 8 characters'));
    }

    // Check for duplicates
    const existing = await prisma.tenant.findFirst({
      where: { OR: [{ email: email.toLowerCase() }, { phone }] },
    });
    if (existing) {
      return next(new AppError(existing.email === email.toLowerCase() ? 'Email already registered' : 'Phone number already registered', 409));
    }

    const hashed = await bcrypt.hash(password, 12);

    // Resolve affiliate if code provided
    let affiliateId = null;
    if (affiliateCode) {
      const aff = await prisma.affiliate.findUnique({ where: { code: affiliateCode.toUpperCase() } });
      if (aff && aff.status === 'active') affiliateId = aff.id;
    }

    const tenant = await prisma.tenant.create({
      data: {
        ownerName,
        businessName,
        email: email.toLowerCase(),
        phone,
        password: hashed,
        status: 'active',
        referredByAffiliateId: affiliateId,
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });

    // Create default AI config
    await prisma.aiConfig.create({ data: { tenantId: tenant.id } });

    // Send email OTP
    const otp = generateOTP();
    await prisma.otp.create({
      data: {
        tenantId: tenant.id,
        identifier: email.toLowerCase(),
        type: 'email',
        purpose: 'registration',
        code: otp,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    await sendOTPEmail(email, otp, ownerName);

    // Track affiliate referral
    if (affiliateId) {
      await prisma.affiliateReferral.upsert({
        where: { affiliateId_tenantId: { affiliateId, tenantId: tenant.id } },
        create: { affiliateId, tenantId: tenant.id },
        update: {},
      }).catch(() => {});
    }

    logger.info(`New tenant registered: ${email} (${businessName})`);
    return success(res, { tenantId: tenant.id, email: tenant.email }, 'Registration successful. Please verify your email.', 201);
  } catch (err) {
    next(err);
  }
}

// ── VERIFY EMAIL OTP ───────────────────────────────────────────
async function verifyEmailOTP(req, res, next) {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return next(new ValidationError('Email and OTP are required'));

    const record = await prisma.otp.findFirst({
      where: {
        identifier: email.toLowerCase(),
        type: 'email',
        purpose: 'registration',
        verified: false,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) return next(new AppError('OTP not found or expired', 400));
    if (record.attempts >= 5) return next(new AppError('Too many attempts. Request a new OTP.', 429));

    if (record.code !== otp) {
      await prisma.otp.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
      return next(new AppError('Invalid OTP', 400));
    }

    await prisma.otp.update({ where: { id: record.id }, data: { verified: true } });

    const tenant = await prisma.tenant.update({
      where: { email: email.toLowerCase() },
      data: { emailVerified: true },
    });

    // Welcome email
    await sendWelcomeEmail(email, tenant.ownerName, tenant.businessName).catch(() => {});

    return success(res, {}, 'Email verified successfully');
  } catch (err) {
    next(err);
  }
}

// ── RESEND EMAIL OTP ───────────────────────────────────────────
async function resendEmailOTP(req, res, next) {
  try {
    const { email } = req.body;
    if (!email) return next(new ValidationError('Email is required'));

    const tenant = await prisma.tenant.findUnique({ where: { email: email.toLowerCase() } });
    if (!tenant) return next(new AppError('Account not found', 404));
    if (tenant.emailVerified) return next(new AppError('Email already verified', 400));

    const otp = generateOTP();
    await prisma.otp.create({
      data: {
        tenantId: tenant.id,
        identifier: email.toLowerCase(),
        type: 'email',
        purpose: 'registration',
        code: otp,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
    await sendOTPEmail(email, otp, tenant.ownerName);

    return success(res, {}, 'OTP sent');
  } catch (err) {
    next(err);
  }
}

// ── LOGIN ─────────────────────────────────────────────────────
async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return next(new ValidationError('Email and password are required'));

    const tenant = await prisma.tenant.findUnique({ where: { email: email.toLowerCase() } });
    if (!tenant) return next(new AppError('Invalid credentials', 401));
    if (tenant.status === 'suspended') return next(new AppError('Account suspended. Contact support.', 403));
    if (tenant.status === 'deleted') return next(new AppError('Account not found', 404));

    const isMatch = await bcrypt.compare(password, tenant.password);
    if (!isMatch) return next(new AppError('Invalid credentials', 401));

    const { accessToken, refreshToken } = generateTokens(tenant.id);

    // Store refresh token
    await prisma.refreshToken.create({
      data: {
        tenantId: tenant.id,
        token: refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    // Update last login
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { lastLoginAt: new Date(), lastActiveAt: new Date() },
    });

    // Log session
    await prisma.userSession.create({
      data: {
        tenantId: tenant.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] || '',
      },
    }).catch(() => {});

    logger.info(`Tenant login: ${email}`);

    return success(res, {
      accessToken,
      tenant: {
        id: tenant.id,
        ownerName: tenant.ownerName,
        businessName: tenant.businessName,
        email: tenant.email,
        phone: tenant.phone,
        emailVerified: tenant.emailVerified,
        status: tenant.status,
        themeId: tenant.themeId,
        planId: tenant.planId,
        trialEndsAt: tenant.trialEndsAt,
      },
    }, 'Login successful');
  } catch (err) {
    next(err);
  }
}

// ── REFRESH TOKEN ─────────────────────────────────────────────
async function refreshToken(req, res, next) {
  try {
    const token = req.body?.refreshToken;
    if (!token) return next(new AppError('Refresh token required', 401));

    const record = await prisma.refreshToken.findUnique({ where: { token } });
    if (!record || record.expiresAt < new Date()) {
      return next(new AppError('Refresh token expired or invalid', 401));
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
    } catch (e) {
      return next(new AppError('Invalid refresh token', 401));
    }

    // Rotate refresh token
    await prisma.refreshToken.delete({ where: { id: record.id } });

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(decoded.tenantId);

    await prisma.refreshToken.create({
      data: {
        tenantId: decoded.tenantId,
        token: newRefreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return success(res, { accessToken }, 'Token refreshed');
  } catch (err) {
    next(err);
  }
}

// ── LOGOUT ────────────────────────────────────────────────────
async function logout(req, res, next) {
  try {
    const token = req.body?.refreshToken;
    if (token) {
      await prisma.refreshToken.deleteMany({ where: { token } }).catch(() => {});
    }
    return success(res, {}, 'Logged out successfully');
  } catch (err) {
    next(err);
  }
}

// ── FORGOT PASSWORD ────────────────────────────────────────────
async function forgotPassword(req, res, next) {
  try {
    const { email } = req.body;
    if (!email) return next(new ValidationError('Email is required'));

    const tenant = await prisma.tenant.findUnique({ where: { email: email.toLowerCase() } });
    // Always return success to avoid email enumeration
    if (!tenant) return success(res, {}, 'If this email exists, a reset link has been sent');

    const resetToken = crypto.randomBytes(32).toString('hex');
    await cacheSet(`pwreset:${resetToken}`, tenant.id, 3600); // 1 hour

    await sendPasswordResetEmail(email, tenant.ownerName, resetToken);
    return success(res, {}, 'If this email exists, a reset link has been sent');
  } catch (err) {
    next(err);
  }
}

// ── RESET PASSWORD ─────────────────────────────────────────────
async function resetPassword(req, res, next) {
  try {
    const { token, password } = req.body;
    if (!token || !password) return next(new ValidationError('Token and new password are required'));
    if (password.length < 8) return next(new ValidationError('Password must be at least 8 characters'));

    const tenantId = await cacheGet(`pwreset:${token}`);
    if (!tenantId) return next(new AppError('Reset link expired or invalid', 400));

    const hashed = await bcrypt.hash(password, 12);
    await prisma.tenant.update({ where: { id: tenantId }, data: { password: hashed } });
    await cacheDel(`pwreset:${token}`);

    // Revoke all refresh tokens
    await prisma.refreshToken.deleteMany({ where: { tenantId } });

    return success(res, {}, 'Password reset successfully. Please login with your new password.');
  } catch (err) {
    next(err);
  }
}

// ── CHANGE PASSWORD ────────────────────────────────────────────
async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return next(new ValidationError('Both passwords are required'));
    if (newPassword.length < 8) return next(new ValidationError('New password must be at least 8 characters'));

    const tenant = await prisma.tenant.findUnique({ where: { id: req.tenantId } });
    const isMatch = await bcrypt.compare(currentPassword, tenant.password);
    if (!isMatch) return next(new AppError('Current password is incorrect', 400));

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.tenant.update({ where: { id: req.tenantId }, data: { password: hashed } });

    return success(res, {}, 'Password changed successfully');
  } catch (err) {
    next(err);
  }
}

// ── GET ME ────────────────────────────────────────────────────
async function getMe(req, res, next) {
  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      select: {
        id: true, ownerName: true, businessName: true, email: true, phone: true,
        emailVerified: true, phoneVerified: true, status: true, planId: true,
        themeId: true, trialEndsAt: true, messagesThisMonth: true, aiCallsThisMonth: true,
        buttonsEnabled: true, listsEnabled: true, storageUsedMb: true,
        createdAt: true, lastLoginAt: true,
        plan: { select: { displayName: true, maxMessages: true, maxAiCalls: true, maxNumbers: true, maxContacts: true } },
      },
    });
    if (!tenant) return next(new AppError('Account not found', 404));
    return success(res, { tenant });
  } catch (err) {
    next(err);
  }
}

// ── GIVE CONSENT ──────────────────────────────────────────────
async function giveConsent(req, res, next) {
  try {
    await prisma.tenant.update({
      where: { id: req.tenantId },
      data: { consentGiven: true, consentAt: new Date() },
    });
    return success(res, {}, 'Consent recorded');
  } catch (err) {
    next(err);
  }
}

module.exports = {
  register, verifyEmailOTP, resendEmailOTP, login, refreshToken,
  logout, forgotPassword, resetPassword, changePassword, getMe, giveConsent,
};
