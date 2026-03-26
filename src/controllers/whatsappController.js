// src/controllers/whatsappController.js
const prisma   = require('../config/database');
const { AppError, ValidationError } = require('../utils/errors');
const { success } = require('../utils/response');
const { cacheSet, cacheDel } = require('../config/redis');
const logger   = require('../config/logger');
const {
  createSession, destroySession, getSessionStatus,
  getContactInfo, getProfilePicture, setStatus,
} = require('../whatsapp/engine');

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
      select: { id: true, sessionStatus: true, qrCode: true },
    });

    if (!number) return next(new AppError('Number not found', 404));

    // If already connected, no QR needed
    if (number.sessionStatus === 'connected') {
      return success(res, { sessionStatus: 'connected', qrCode: null }, 'Already connected');
    }

    // If no QR yet, trigger a new session
    if (!number.qrCode) {
      createSession(number.id, req.tenantId, null).catch(() => {});
      return success(res, { sessionStatus: 'initializing', qrCode: null }, 'Generating QR code...');
    }

    return success(res, { sessionStatus: number.sessionStatus, qrCode: number.qrCode });
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
      data: { sessionStatus: 'disconnected', qrCode: null },
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
    });
    if (!number) return next(new AppError('Number not found', 404));

    const liveStatus = getSessionStatus(numberId);
    return success(res, { sessionStatus: liveStatus });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listNumbers, addNumber, getQRCode, disconnectNumber, reconnectNumber,
  deleteNumber, updateNumberSettings, getStatus,
};
