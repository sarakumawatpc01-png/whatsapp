// src/controllers/affiliateController.js
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const prisma  = require('../config/database');
const { AppError, ValidationError } = require('../utils/errors');
const { success, paginated } = require('../utils/response');
const logger  = require('../config/logger');

// ── TOKEN HELPER ───────────────────────────────────────────────
function generateAffiliateTokens(affiliateId) {
  const accessToken = jwt.sign(
    { affiliateId },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
  const refreshToken = jwt.sign(
    { affiliateId, type: 'refresh' },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
  return { accessToken, refreshToken };
}

// ── LOGIN ──────────────────────────────────────────────────────
async function affiliateLogin(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return next(new ValidationError('Email and password are required'));

    const affiliate = await prisma.affiliate.findUnique({ where: { email: email.toLowerCase() } });
    if (!affiliate) return next(new AppError('Invalid credentials', 401));
    if (affiliate.status !== 'active') return next(new AppError('Your affiliate account has been suspended', 403));

    const valid = await bcrypt.compare(password, affiliate.password);
    if (!valid) return next(new AppError('Invalid credentials', 401));

    await prisma.affiliate.update({
      where: { id: affiliate.id },
      data:  { lastLoginAt: new Date() },
    });

    const { accessToken, refreshToken } = generateAffiliateTokens(affiliate.id);

    return success(res, {
      accessToken,
      refreshToken,
      affiliate: {
        id:    affiliate.id,
        name:  affiliate.name,
        email: affiliate.email,
        code:  affiliate.code,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── REFRESH ────────────────────────────────────────────────────
async function affiliateRefresh(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return next(new ValidationError('refreshToken is required'));

    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    if (!decoded.affiliateId || decoded.type !== 'refresh') {
      return next(new AppError('Invalid refresh token', 401));
    }

    const affiliate = await prisma.affiliate.findUnique({ where: { id: decoded.affiliateId } });
    if (!affiliate || affiliate.status !== 'active') {
      return next(new AppError('Affiliate account inactive', 403));
    }

    const { accessToken, refreshToken: newRefresh } = generateAffiliateTokens(affiliate.id);
    return success(res, { accessToken, refreshToken: newRefresh });
  } catch (err) {
    if (err.name === 'TokenExpiredError') return next(new AppError('Refresh token expired', 401));
    next(err);
  }
}

// ── DASHBOARD ──────────────────────────────────────────────────
async function getDashboard(req, res, next) {
  try {
    const affiliate = await prisma.affiliate.findUnique({
      where: { id: req.affiliateId },
      select: {
        id: true, name: true, email: true, code: true,
        commissionRate: true, status: true,
        totalEarned: true, totalPaid: true, pendingPayout: true,
        lastLoginAt: true, createdAt: true,
      },
    });

    if (!affiliate) return next(new AppError('Affiliate not found', 404));

    // Referral summary counts
    const [totalReferred, activeReferred, trialReferred] = await Promise.all([
      prisma.affiliateReferral.count({ where: { affiliateId: req.affiliateId } }),
      prisma.affiliateReferral.count({ where: { affiliateId: req.affiliateId, isActive: true } }),
      prisma.affiliateReferral.count({
        where: {
          affiliateId: req.affiliateId,
          tenant: { status: 'trial' },
        },
      }),
    ]);

    // Unique referral link
    const referralLink = `${process.env.FRONTEND_URL || 'https://waizai.com'}/register?ref=${affiliate.code}`;

    return success(res, {
      affiliate,
      referralLink,
      stats: {
        totalReferred,
        activeReferred,
        trialReferred,
        churned: totalReferred - activeReferred - trialReferred,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── LIST REFERRALS ─────────────────────────────────────────────
async function getReferrals(req, res, next) {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip  = (page - 1) * limit;

    const [referrals, total] = await Promise.all([
      prisma.affiliateReferral.findMany({
        where: { affiliateId: req.affiliateId },
        skip, take: limit,
        orderBy: { signedUpAt: 'desc' },
        include: {
          tenant: {
            select: {
              // Partial privacy: show plan + status but mask personal details
              status: true,
              plan: { select: { displayName: true } },
              createdAt: true,
            },
          },
        },
      }),
      prisma.affiliateReferral.count({ where: { affiliateId: req.affiliateId } }),
    ]);

    // Mask business name — show first 3 chars + asterisks for privacy
    const safeReferrals = referrals.map(r => ({
      id:               r.id,
      signedUpAt:       r.signedUpAt,
      plan:             r.plan || (r.tenant?.plan?.displayName ?? 'Free'),
      planPrice:        r.planPrice,
      isActive:         r.isActive,
      commissionAmount: r.commissionAmount,
      isPaid:           r.isPaid,
      status:           r.tenant?.status || 'unknown',
    }));

    return paginated(res, safeReferrals, total, page, limit);
  } catch (err) {
    next(err);
  }
}

// ── EARNINGS ──────────────────────────────────────────────────
async function getEarnings(req, res, next) {
  try {
    const affiliate = await prisma.affiliate.findUnique({
      where: { id: req.affiliateId },
      select: {
        totalEarned: true,
        totalPaid: true,
        pendingPayout: true,
        commissionRate: true,
      },
    });

    if (!affiliate) return next(new AppError('Affiliate not found', 404));

    // Per-month earnings breakdown (last 6 months)
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const referrals = await prisma.affiliateReferral.findMany({
      where: {
        affiliateId: req.affiliateId,
        lastCalculatedAt: { gte: sixMonthsAgo },
      },
      select: { commissionAmount: true, lastCalculatedAt: true, plan: true },
    });

    // Group by month
    const byMonth = {};
    referrals.forEach(r => {
      if (!r.lastCalculatedAt) return;
      const key = r.lastCalculatedAt.toISOString().substring(0, 7); // "YYYY-MM"
      byMonth[key] = (byMonth[key] || 0) + r.commissionAmount;
    });

    return success(res, {
      summary: {
        totalEarnedRupees:  Math.round(affiliate.totalEarned   / 100),
        totalPaidRupees:    Math.round(affiliate.totalPaid     / 100),
        pendingPayoutRupees: Math.round(affiliate.pendingPayout / 100),
        commissionRate:     `${Math.round(affiliate.commissionRate * 100)}%`,
      },
      monthlyBreakdown: Object.entries(byMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, amountPaise]) => ({
          month,
          earningsRupees: Math.round(amountPaise / 100),
        })),
    });
  } catch (err) {
    next(err);
  }
}

// ── REQUEST PAYOUT ─────────────────────────────────────────────
async function requestPayout(req, res, next) {
  try {
    const { method, details } = req.body; // method: 'bank' | 'upi', details: string

    const affiliate = await prisma.affiliate.findUnique({
      where: { id: req.affiliateId },
      select: { pendingPayout: true, status: true },
    });

    if (!affiliate) return next(new AppError('Affiliate not found', 404));
    if (affiliate.status !== 'active') return next(new AppError('Account is suspended', 403));

    const minimumPayoutPaise = 50000; // ₹500 minimum
    if (affiliate.pendingPayout < minimumPayoutPaise) {
      return next(new AppError(`Minimum payout is ₹${minimumPayoutPaise / 100}. Your pending amount is ₹${affiliate.pendingPayout / 100}.`, 400));
    }

    // Check no pending request already exists
    const existing = await prisma.affiliatePayout.findFirst({
      where: { affiliateId: req.affiliateId, status: 'pending' },
    });
    if (existing) return next(new AppError('You already have a pending payout request', 409));

    const payout = await prisma.affiliatePayout.create({
      data: {
        affiliateId: req.affiliateId,
        amount:      affiliate.pendingPayout,
        method:      method || null,
        note:        details || null,
        status:      'pending',
      },
    });

    return success(res, { payout }, `Payout request of ₹${affiliate.pendingPayout / 100} submitted`, 201);
  } catch (err) {
    next(err);
  }
}

// ── PAYOUT HISTORY ─────────────────────────────────────────────
async function getPayoutHistory(req, res, next) {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip  = (page - 1) * limit;

    const [payouts, total] = await Promise.all([
      prisma.affiliatePayout.findMany({
        where: { affiliateId: req.affiliateId },
        skip, take: limit,
        orderBy: { requestedAt: 'desc' },
      }),
      prisma.affiliatePayout.count({ where: { affiliateId: req.affiliateId } }),
    ]);

    return paginated(res, payouts, total, page, limit);
  } catch (err) {
    next(err);
  }
}

// ── MARKETING MATERIALS ────────────────────────────────────────
async function getMarketingMaterials(req, res, next) {
  try {
    const affiliate = await prisma.affiliate.findUnique({
      where: { id: req.affiliateId },
      select: { code: true },
    });

    if (!affiliate) return next(new AppError('Affiliate not found', 404));

    const baseUrl      = process.env.FRONTEND_URL || 'https://waizai.com';
    const referralLink = `${baseUrl}/register?ref=${affiliate.code}`;

    const materials = {
      referralLink,
      whatsappTemplate: `Hey! I've been using WaizAI to automate my WhatsApp business replies with AI. Super easy to set up — just scan a QR code! Try it free: ${referralLink}`,
      emailSubject:     'Automate your WhatsApp business with AI — Try WaizAI free',
      emailBody:        `Hi,\n\nI wanted to share a tool that's been helping my business. WaizAI lets you set up an AI assistant for your WhatsApp Business number in 10 minutes.\n\n✅ AI auto-replies to customers\n✅ Campaigns & follow-ups\n✅ Calendar booking via chat\n✅ No WhatsApp API needed — just scan a QR code\n\nStart your free trial: ${referralLink}\n\nBest,`,
      banners: [
        { size: '728x90', url: `${baseUrl}/assets/affiliates/banner-leaderboard.png` },
        { size: '300x250', url: `${baseUrl}/assets/affiliates/banner-medium-rectangle.png` },
        { size: '160x600', url: `${baseUrl}/assets/affiliates/banner-wide-skyscraper.png` },
      ],
    };

    return success(res, { materials });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  affiliateLogin, affiliateRefresh,
  getDashboard, getReferrals, getEarnings,
  requestPayout, getPayoutHistory, getMarketingMaterials,
};
