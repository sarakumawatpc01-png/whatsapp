// src/controllers/followupController.js
const prisma   = require('../config/database');
const { AppError, ValidationError } = require('../utils/errors');
const { success, paginated } = require('../utils/response');
const { enrollFollowups, cancelFollowupsForContact } = require('../services/followupService');

// ── LIST SEQUENCES ────────────────────────────────────────────
async function listSequences(req, res, next) {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip  = (page - 1) * limit;

    const [sequences, total] = await Promise.all([
      prisma.followupSequence.findMany({
        where: { tenantId: req.tenantId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: { _count: { select: { enrollments: true } } },
      }),
      prisma.followupSequence.count({ where: { tenantId: req.tenantId } }),
    ]);

    return paginated(res, sequences, total, page, limit);
  } catch (err) {
    next(err);
  }
}

// ── GET SEQUENCE ──────────────────────────────────────────────
async function getSequence(req, res, next) {
  try {
    const sequence = await prisma.followupSequence.findFirst({
      where: { id: req.params.sequenceId, tenantId: req.tenantId },
    });
    if (!sequence) return next(new AppError('Follow-up sequence not found', 404));
    return success(res, { sequence });
  } catch (err) {
    next(err);
  }
}

// ── CREATE SEQUENCE ───────────────────────────────────────────
async function createSequence(req, res, next) {
  try {
    const { name, description, triggerType, triggerValue, delayValue, delayUnit, message, stopOnReply, minGapSec, maxGapSec } = req.body;

    if (!name || !triggerType || !delayValue || !message) {
      return next(new ValidationError('name, triggerType, delayValue, and message are required'));
    }

    // Check plan limit
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      include: {
        plan: true,
        followupSequences: { where: { isActive: true }, select: { id: true } },
      },
    });
    const maxFollowups = tenant.plan?.maxFollowups || 1;
    if (tenant.followupSequences.length >= maxFollowups) {
      return next(new AppError(`Your plan allows a maximum of ${maxFollowups} active follow-up sequence(s). Please upgrade.`, 403));
    }

    const sequence = await prisma.followupSequence.create({
      data: {
        tenantId: req.tenantId,
        name,
        description: description || null,
        triggerType,
        triggerValue: triggerValue || null,
        delayValue: parseInt(delayValue, 10),
        delayUnit: delayUnit || 'hours',
        message,
        stopOnReply: stopOnReply !== false,
        isActive: true,
      },
    });

    return success(res, { sequence }, 'Follow-up sequence created', 201);
  } catch (err) {
    next(err);
  }
}

// ── UPDATE SEQUENCE ───────────────────────────────────────────
async function updateSequence(req, res, next) {
  try {
    const { sequenceId } = req.params;
    const sequence = await prisma.followupSequence.findFirst({ where: { id: sequenceId, tenantId: req.tenantId } });
    if (!sequence) return next(new AppError('Sequence not found', 404));

    const { name, description, triggerType, triggerValue, delayValue, delayUnit, message, stopOnReply, isActive } = req.body;

    const updated = await prisma.followupSequence.update({
      where: { id: sequenceId },
      data: {
        ...(name         !== undefined && { name }),
        ...(description  !== undefined && { description }),
        ...(triggerType  !== undefined && { triggerType }),
        ...(triggerValue !== undefined && { triggerValue }),
        ...(delayValue   !== undefined && { delayValue: parseInt(delayValue, 10) }),
        ...(delayUnit    !== undefined && { delayUnit }),
        ...(message      !== undefined && { message }),
        ...(stopOnReply  !== undefined && { stopOnReply }),
        ...(isActive     !== undefined && { isActive }),
      },
    });

    return success(res, { sequence: updated }, 'Sequence updated');
  } catch (err) {
    next(err);
  }
}

// ── DELETE SEQUENCE ───────────────────────────────────────────
async function deleteSequence(req, res, next) {
  try {
    const { sequenceId } = req.params;
    const sequence = await prisma.followupSequence.findFirst({ where: { id: sequenceId, tenantId: req.tenantId } });
    if (!sequence) return next(new AppError('Sequence not found', 404));

    await prisma.followupSequence.delete({ where: { id: sequenceId } });
    return success(res, {}, 'Sequence deleted');
  } catch (err) {
    next(err);
  }
}

// ── TOGGLE SEQUENCE ───────────────────────────────────────────
async function toggleSequence(req, res, next) {
  try {
    const { sequenceId } = req.params;
    const { isActive } = req.body;

    const sequence = await prisma.followupSequence.findFirst({ where: { id: sequenceId, tenantId: req.tenantId } });
    if (!sequence) return next(new AppError('Sequence not found', 404));

    await prisma.followupSequence.update({ where: { id: sequenceId }, data: { isActive: Boolean(isActive) } });
    return success(res, {}, `Sequence ${isActive ? 'activated' : 'deactivated'}`);
  } catch (err) {
    next(err);
  }
}

// ── ENROLL CONTACT MANUALLY ────────────────────────────────────
async function enrollContact(req, res, next) {
  try {
    const { sequenceId } = req.params;
    const { contactId } = req.body;
    if (!contactId) return next(new ValidationError('contactId is required'));

    const [sequence, contact] = await Promise.all([
      prisma.followupSequence.findFirst({ where: { id: sequenceId, tenantId: req.tenantId } }),
      prisma.contact.findFirst({ where: { id: contactId, tenantId: req.tenantId } }),
    ]);

    if (!sequence) return next(new AppError('Sequence not found', 404));
    if (!contact)  return next(new AppError('Contact not found', 404));

    await enrollFollowups(contactId, req.tenantId, sequence.triggerType, sequence.triggerValue);
    return success(res, {}, 'Contact enrolled in sequence');
  } catch (err) {
    next(err);
  }
}

// ── GET ENROLLMENTS FOR A SEQUENCE ────────────────────────────
async function getEnrollments(req, res, next) {
  try {
    const sequenceId = req.params.sequenceId || req.query.sequenceId;
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip  = (page - 1) * limit;

    const sequence = await prisma.followupSequence.findFirst({ where: { id: sequenceId, tenantId: req.tenantId } });
    if (!sequence) return next(new AppError('Sequence not found', 404));

    const [enrollments, total] = await Promise.all([
      prisma.followupEnrollment.findMany({
        where: { sequenceId, tenantId: req.tenantId },
        include: { contact: { select: { id: true, name: true, phoneNumber: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.followupEnrollment.count({ where: { sequenceId, tenantId: req.tenantId } }),
    ]);

    return paginated(res, enrollments, total, page, limit);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listSequences, getSequence, createSequence, updateSequence, deleteSequence,
  toggleSequence, enrollContact, getEnrollments,
};
