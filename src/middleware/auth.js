// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const { AppError } = require('../utils/errors');

// ── CLIENT AUTH ───────────────────────────────────────────────
async function protect(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return next(new AppError('Not authenticated', 401));

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const tenant = await prisma.tenant.findUnique({
      where: { id: decoded.tenantId },
      select: { id: true, status: true, planId: true, emailVerified: true },
    });

    if (!tenant) return next(new AppError('Account not found', 401));
    if (tenant.status === 'suspended') return next(new AppError('Account suspended', 403));
    if (tenant.status === 'deleted') return next(new AppError('Account deleted', 403));

    // CRITICAL: Always attach tenantId to every request
    req.tenantId = tenant.id;
    req.tenant   = tenant;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return next(new AppError('Session expired, please login again', 401));
    if (err.name === 'JsonWebTokenError') return next(new AppError('Invalid token', 401));
    next(err);
  }
}

// ── SUPERADMIN AUTH ───────────────────────────────────────────
async function protectSuperAdmin(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return next(new AppError('Not authenticated', 401));

    const decoded = jwt.verify(token, process.env.SUPERADMIN_JWT_SECRET);
    if (!decoded.isSuperAdmin) return next(new AppError('Forbidden', 403));

    const admin = await prisma.superAdmin.findUnique({ where: { id: decoded.adminId } });
    if (!admin || !admin.isActive) return next(new AppError('Admin account inactive', 403));

    req.adminId = admin.id;
    req.admin   = admin;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return next(new AppError('Session expired', 401));
    next(new AppError('Invalid admin token', 401));
  }
}

// ── AFFILIATE AUTH ────────────────────────────────────────────
async function protectAffiliate(req, res, next) {
  try {
    const token = extractToken(req);
    if (!token) return next(new AppError('Not authenticated', 401));

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!decoded.affiliateId) return next(new AppError('Forbidden', 403));

    const affiliate = await prisma.affiliate.findUnique({ where: { id: decoded.affiliateId } });
    if (!affiliate || affiliate.status !== 'active') return next(new AppError('Affiliate account inactive', 403));

    req.affiliateId = affiliate.id;
    req.affiliate   = affiliate;
    next();
  } catch (err) {
    next(new AppError('Invalid token', 401));
  }
}

function extractToken(req) {
  if (req.headers.authorization?.startsWith('Bearer ')) {
    return req.headers.authorization.split(' ')[1];
  }
  if (req.cookies?.token) return req.cookies.token;
  return null;
}

module.exports = { protect, protectSuperAdmin, protectAffiliate };
