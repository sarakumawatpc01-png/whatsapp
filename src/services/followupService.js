// src/services/followupService.js
// Manages enrollment and cancellation of follow-up sequences for contacts.

const prisma = require('../config/database');
const logger  = require('../config/logger');

/**
 * Enroll a contact in all active follow-up sequences that match the trigger.
 * @param {string} contactId
 * @param {string} tenantId
 * @param {string} triggerType  - 'new_contact' | 'no_reply' | 'keyword' | 'label_change'
 * @param {string} [triggerValue] - keyword / label name (only for keyword / label_change triggers)
 */
async function enrollFollowups(contactId, tenantId, triggerType, triggerValue = null) {
  try {
    const sequences = await prisma.followupSequence.findMany({
      where: {
        tenantId,
        isActive: true,
        triggerType,
        ...(triggerValue ? { triggerValue } : {}),
      },
    });

    for (const seq of sequences) {
      // Skip if already enrolled and not cancelled
      const existing = await prisma.followupEnrollment.findUnique({
        where: { sequenceId_contactId: { sequenceId: seq.id, contactId } },
      });
      if (existing && existing.status === 'pending') continue;

      const delayMs = calcDelayMs(seq.delayValue, seq.delayUnit);
      const scheduledAt = new Date(Date.now() + delayMs);

      await prisma.followupEnrollment.upsert({
        where: { sequenceId_contactId: { sequenceId: seq.id, contactId } },
        create: {
          sequenceId: seq.id,
          contactId,
          tenantId,
          status: 'pending',
          scheduledAt,
        },
        update: {
          status: 'pending',
          scheduledAt,
          sentAt: null,
        },
      });

      logger.debug(`Enrolled contact ${contactId} in followup seq ${seq.id} (scheduledAt: ${scheduledAt.toISOString()})`);
    }
  } catch (err) {
    logger.error(`enrollFollowups error (contact: ${contactId}):`, err);
  }
}

/**
 * Cancel all pending follow-up enrollments for a contact.
 * Called when the contact sends any message (they replied — stop chasing them).
 */
async function cancelFollowupsForContact(contactId, tenantId) {
  try {
    const result = await prisma.followupEnrollment.updateMany({
      where: { contactId, tenantId, status: 'pending' },
      data:  { status: 'cancelled' },
    });
    if (result.count > 0) {
      logger.debug(`Cancelled ${result.count} pending follow-ups for contact ${contactId}`);
    }
  } catch (err) {
    logger.error(`cancelFollowupsForContact error (contact: ${contactId}):`, err);
  }
}

/**
 * Get all due enrollments (scheduledAt <= now and status === 'pending').
 * Used by the Bull job processor.
 */
async function getDueEnrollments(limit = 50) {
  return prisma.followupEnrollment.findMany({
    where: {
      status: 'pending',
      scheduledAt: { lte: new Date() },
    },
    include: {
      sequence: true,
      contact:  { include: { number: true } },
    },
    orderBy: { scheduledAt: 'asc' },
    take: limit,
  });
}

/**
 * Mark an enrollment as sent.
 */
async function markEnrollmentSent(enrollmentId) {
  await prisma.followupEnrollment.update({
    where: { id: enrollmentId },
    data:  { status: 'sent', sentAt: new Date() },
  });
}

/**
 * Mark an enrollment as failed (e.g., session not available).
 */
async function markEnrollmentFailed(enrollmentId) {
  await prisma.followupEnrollment.update({
    where: { id: enrollmentId },
    data:  { status: 'cancelled' },
  });
}

// ── HELPERS ───────────────────────────────────────────────────
function calcDelayMs(value, unit) {
  const v = parseInt(value, 10) || 1;
  switch (unit) {
    case 'minutes': return v * 60 * 1000;
    case 'hours':   return v * 60 * 60 * 1000;
    case 'days':    return v * 24 * 60 * 60 * 1000;
    default:        return v * 60 * 60 * 1000; // default hours
  }
}

module.exports = {
  enrollFollowups,
  cancelFollowupsForContact,
  getDueEnrollments,
  markEnrollmentSent,
  markEnrollmentFailed,
};
