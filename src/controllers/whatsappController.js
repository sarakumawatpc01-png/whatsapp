// src/controllers/whatsappController.js
const prisma   = require('../config/database');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { AppError, ValidationError } = require('../utils/errors');
const { success } = require('../utils/response');
const { cacheGet, cacheSet, cacheDel } = require('../config/redis');
const logger   = require('../config/logger');
const {
  createSession, destroySession, getSessionStatus,
  getContactInfo, getProfilePicture, setStatus,
} = require('../whatsapp/engine');

const CONNECT_TOKEN_TTL_SECONDS = Number(process.env.WA_CONNECT_TOKEN_TTL_SECONDS || 300);

function resolveConnectTokenSecret() {
  return process.env.WA_CONNECT_TOKEN_SECRET || process.env.JWT_SECRET;
}

function buildConnectionIssue(number) {
  if (!number?.lastFailureCode && !number?.lastFailureReason) return null;
  const blockedByIp = typeof number.lastFailureCode === 'string' && number.lastFailureCode.startsWith('WA_HTTP_');
  const actionableMessage = blockedByIp
    ? 'WhatsApp blocked this server IP; switch server/IP.'
    : null;

  return {
    code: number.lastFailureCode || 'WA_UNKNOWN',
    reason: number.lastFailureReason || 'Connection failed',
    actionableMessage,
    blockedByIp,
    lastFailureAt: number.lastFailureAt || null,
  };
}

function serializeQrPayload(number, fallbackStatus = 'initializing') {
  return {
    sessionStatus: number.sessionStatus || fallbackStatus,
    qrCode: number.qrCode || null,
    issue: buildConnectionIssue(number),
  };
}

function issueConnectToken(payload) {
  const secret = resolveConnectTokenSecret();
  return jwt.sign(payload, secret, {
    expiresIn: CONNECT_TOKEN_TTL_SECONDS,
  });
}

function verifyConnectToken(token) {
  const secret = resolveConnectTokenSecret();
  return jwt.verify(token, secret);
}

function hashTokenJti(jti) {
  return crypto.createHash('sha256').update(String(jti || '')).digest('hex');
}

async function markConnectTokenUsed(jti) {
  const ttl = Math.max(CONNECT_TOKEN_TTL_SECONDS + 60, 120);
  await cacheSet(`wa_connect_token_used:${hashTokenJti(jti)}`, true, ttl);
}

async function ensureConnectTokenUnused(jti) {
  const used = await cacheGet(`wa_connect_token_used:${hashTokenJti(jti)}`);
  if (used) throw new AppError('Connect token already used', 401);
}

// ── LIST NUMBERS ──────────────────────────────────────────────
async function listNumbers(req, res, next) {
  try {
    const numbers = await prisma.tenantNumber.findMany({
      where: { tenantId: req.tenantId },
      select: {
        id: true, phoneNumber: true, displayName: true, sessionStatus: true,
        aiEnabled: true, isDefault: true, minMsgGapSec: true, maxMsgGapSec: true,
        readDelayMs: true, lastConnectedAt: true, createdAt: true,
        // Never expose qrCode in list view
      },
      orderBy: { createdAt: 'asc' },
    });
    return success(res, { numbers });
  } catch (err) {
    next(err);
  }
}

// ── ADD NUMBER ────────────────────────────────────────────────
async function addNumber(req, res, next) {
  try {
    const { displayName } = req.body;

    // Check plan limit
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      include: { plan: true, numbers: { select: { id: true } } },
    });

    const maxNumbers = tenant.plan?.maxNumbers || 1;
    if (tenant.numbers.length >= maxNumbers) {
      return next(new AppError(`Your plan allows a maximum of ${maxNumbers} WhatsApp number(s). Please upgrade.`, 403));
    }

    const number = await prisma.tenantNumber.create({
      data: {
        tenantId: req.tenantId,
        phoneNumber: 'pending',
        displayName: displayName || 'WhatsApp Number',
        sessionStatus: 'disconnected',
        isDefault: tenant.numbers.length === 0,
      },
    });

    // Trigger QR generation (async)
    createSession(number.id, req.tenantId, displayName).catch(err => {
      logger.error(`createSession error for ${number.id}:`, err.message);
    });

    return success(res, { number }, 'Number added. Scan the QR code to connect.', 201);
  } catch (err) {
    next(err);
  }
}

// ── GET QR CODE ───────────────────────────────────────────────
async function getQRCode(req, res, next) {
  try {
    const { numberId } = req.params;

    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId: req.tenantId },
      select: {
        id: true, tenantId: true, sessionStatus: true, qrCode: true,
        lastFailureCode: true, lastFailureReason: true, lastFailureAt: true,
      },
    });

    if (!number) return next(new AppError('Number not found', 404));

    // If already connected, no QR needed
    if (number.sessionStatus === 'connected') {
      return success(res, serializeQrPayload({ ...number, qrCode: null }, 'connected'), 'Already connected');
    }

    // If no QR yet, trigger a new session
    if (!number.qrCode) {
      createSession(number.id, req.tenantId, null).catch(() => {});
      return success(
        res,
        serializeQrPayload({ ...number, sessionStatus: number.sessionStatus || 'initializing', qrCode: null }, 'initializing'),
        'Generating QR code...'
      );
    }

    return success(res, serializeQrPayload(number, 'initializing'));
  } catch (err) {
    next(err);
  }
}

// ── DISCONNECT NUMBER ─────────────────────────────────────────
async function disconnectNumber(req, res, next) {
  try {
    const { numberId } = req.params;

    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId: req.tenantId },
    });
    if (!number) return next(new AppError('Number not found', 404));

    await destroySession(numberId);
    await prisma.tenantNumber.update({
      where: { id: numberId },
      data: {
        sessionStatus: 'disconnected',
        qrCode: null,
        lastFailureCode: 'MANUAL_DISCONNECT',
        lastFailureReason: 'Session disconnected by user action.',
        lastFailureAt: new Date(),
      },
    });

    return success(res, {}, 'Number disconnected');
  } catch (err) {
    next(err);
  }
}

// ── RECONNECT NUMBER ──────────────────────────────────────────
async function reconnectNumber(req, res, next) {
  try {
    const { numberId } = req.params;

    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId: req.tenantId },
    });
    if (!number) return next(new AppError('Number not found', 404));

    await destroySession(numberId).catch(() => {});
    createSession(number.id, req.tenantId, number.displayName).catch(err => {
      logger.error(`reconnect session error for ${number.id}:`, err.message);
    });

    return success(res, {}, 'Reconnecting... Scan QR code when it appears.');
  } catch (err) {
    next(err);
  }
}

// ── DELETE NUMBER ─────────────────────────────────────────────
async function deleteNumber(req, res, next) {
  try {
    const { numberId } = req.params;

    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId: req.tenantId },
    });
    if (!number) return next(new AppError('Number not found', 404));

    await destroySession(numberId).catch(() => {});
    await prisma.tenantNumber.delete({ where: { id: numberId } });

    return success(res, {}, 'Number removed');
  } catch (err) {
    next(err);
  }
}

// ── UPDATE NUMBER SETTINGS ────────────────────────────────────
async function updateNumberSettings(req, res, next) {
  try {
    const { numberId } = req.params;
    const { displayName, aiEnabled, minMsgGapSec, maxMsgGapSec, readDelayMs, isDefault } = req.body;

    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId: req.tenantId },
    });
    if (!number) return next(new AppError('Number not found', 404));

    // Validate delay settings against plan minimums
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      include: { plan: true },
    });
    const planMinGap = tenant.plan?.minMsgGapSeconds || 3;

    if (minMsgGapSec !== undefined && minMsgGapSec < planMinGap) {
      return next(new AppError(`Minimum message gap cannot be less than ${planMinGap} seconds for your plan`, 400));
    }
    if (minMsgGapSec !== undefined && maxMsgGapSec !== undefined && maxMsgGapSec < minMsgGapSec) {
      return next(new AppError('Maximum gap must be greater than or equal to minimum gap', 400));
    }

    const updated = await prisma.tenantNumber.update({
      where: { id: numberId },
      data: {
        ...(displayName !== undefined && { displayName }),
        ...(aiEnabled  !== undefined && { aiEnabled }),
        ...(minMsgGapSec !== undefined && { minMsgGapSec }),
        ...(maxMsgGapSec !== undefined && { maxMsgGapSec }),
        ...(readDelayMs  !== undefined && { readDelayMs }),
      },
    });

    if (isDefault) {
      await prisma.tenantNumber.updateMany({
        where: { tenantId: req.tenantId, id: { not: numberId } },
        data: { isDefault: false },
      });
      await prisma.tenantNumber.update({ where: { id: numberId }, data: { isDefault: true } });
    }

    // Invalidate AI config cache
    await cacheDel(`aiconfig:${req.tenantId}`);

    return success(res, { number: updated }, 'Settings updated');
  } catch (err) {
    next(err);
  }
}

// ── GET STATUS ─────────────────────────────────────────────────
async function getStatus(req, res, next) {
  try {
    const { numberId } = req.params;

    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId: req.tenantId },
      select: {
        id: true,
        sessionStatus: true,
        lastFailureCode: true,
        lastFailureReason: true,
        lastFailureAt: true,
      },
    });
    if (!number) return next(new AppError('Number not found', 404));

    const liveStatus = getSessionStatus(numberId);
    return success(res, {
      sessionStatus: liveStatus || number.sessionStatus,
      issue: buildConnectionIssue(number),
    });
  } catch (err) {
    next(err);
  }
}

async function createConnectToken(req, res, next) {
  try {
    const { numberId } = req.params;
    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId: req.tenantId },
      select: { id: true, tenantId: true },
    });
    if (!number) return next(new AppError('Number not found', 404));

    const jti = crypto.randomUUID();
    const token = issueConnectToken({
      tenantId: number.tenantId,
      numberId: number.id,
      jti,
      scope: 'wa_connect',
    });

    return success(res, {
      token,
      expiresInSeconds: CONNECT_TOKEN_TTL_SECONDS,
      numberId: number.id,
    }, 'Connect token generated');
  } catch (err) {
    next(err);
  }
}

async function resolveNumberFromConnectToken(req, res, next) {
  try {
    const token = req.params.connectToken || req.query.connectToken || req.query.token;
    if (!token || typeof token !== 'string') {
      return next(new AppError('Connect token is required', 401));
    }

    const decoded = verifyConnectToken(token);
    if (decoded.scope !== 'wa_connect') return next(new AppError('Invalid connect token scope', 401));
    if (!decoded.tenantId || !decoded.numberId || !decoded.jti) return next(new AppError('Invalid connect token payload', 401));

    await ensureConnectTokenUnused(decoded.jti);
    req.connectToken = {
      tenantId: decoded.tenantId,
      numberId: decoded.numberId,
      jti: decoded.jti,
    };
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return next(new AppError('Connect token expired', 401));
    if (err.name === 'JsonWebTokenError') return next(new AppError('Invalid connect token', 401));
    return next(err);
  }
}

async function getQRCodeByConnectToken(req, res, next) {
  try {
    const { tenantId, numberId, jti } = req.connectToken;
    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId },
      select: {
        id: true, tenantId: true, sessionStatus: true, qrCode: true,
        lastFailureCode: true, lastFailureReason: true, lastFailureAt: true,
      },
    });
    if (!number) return next(new AppError('Number not found', 404));

    if (number.sessionStatus === 'connected') {
      await markConnectTokenUsed(jti);
      return success(res, serializeQrPayload({ ...number, qrCode: null }, 'connected'), 'Already connected');
    }

    if (!number.qrCode) {
      createSession(number.id, tenantId, null).catch(() => {});
      return success(
        res,
        serializeQrPayload({ ...number, sessionStatus: number.sessionStatus || 'initializing', qrCode: null }, 'initializing'),
        'Generating QR code...'
      );
    }

    await markConnectTokenUsed(jti);
    return success(res, serializeQrPayload(number, 'initializing'));
  } catch (err) {
    next(err);
  }
}

async function getStatusByConnectToken(req, res, next) {
  try {
    const { tenantId, numberId, jti } = req.connectToken;
    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId },
      select: {
        id: true,
        sessionStatus: true,
        lastFailureCode: true,
        lastFailureReason: true,
        lastFailureAt: true,
      },
    });
    if (!number) return next(new AppError('Number not found', 404));

    const liveStatus = getSessionStatus(numberId);
    await markConnectTokenUsed(jti);
    return success(res, {
      sessionStatus: liveStatus || number.sessionStatus,
      issue: buildConnectionIssue(number),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listNumbers, addNumber, getQRCode, disconnectNumber, reconnectNumber,
  deleteNumber, updateNumberSettings, getStatus,
  createConnectToken, resolveNumberFromConnectToken,
  getQRCodeByConnectToken, getStatusByConnectToken,
};
