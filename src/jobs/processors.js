// src/jobs/processors.js
// Bull queue processors for campaigns and follow-ups.

const Bull    = require('bull');
const prisma  = require('../config/database');
const logger  = require('../config/logger');
const { sendTextMessage, sendMediaMessage, getSession } = require('../whatsapp/engine');
const { getDueEnrollments, markEnrollmentSent, markEnrollmentFailed } = require('../services/followupService');
const { campaignQueue } = require('../services/campaignService');
const { cacheGet, cacheSet } = require('../config/redis');

// ── FOLLOWUP QUEUE ────────────────────────────────────────────
const followupQueue = new Bull('followup-messages', {
  redis: { url: process.env.REDIS_URL || 'redis://localhost:6379' },
});

// ── SCHEDULED MESSAGE QUEUE ───────────────────────────────────
const scheduledQueue = new Bull('scheduled-messages', {
  redis: { url: process.env.REDIS_URL || 'redis://localhost:6379' },
});

// ── APPOINTMENT REMINDER QUEUE ────────────────────────────────
const reminderQueue = new Bull('appointment-reminders', {
  redis: { url: process.env.REDIS_URL || 'redis://localhost:6379' },
});

/**
 * Start all queue processors.
 * Called once at app boot.
 */
function startJobProcessors() {
  // ── CAMPAIGN MESSAGE PROCESSOR ───────────────────────────
  campaignQueue.process(3, async (job) => {
    const { campaignId, tenantId, numberId, toJid, contactId, message, mediaUrl, mediaType } = job.data;

    try {
      // Verify campaign is still running (might have been paused/stopped)
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { status: true },
      });
      if (!campaign || campaign.status === 'paused' || campaign.status === 'completed') {
        logger.debug(`Campaign ${campaignId} is ${campaign?.status}, skipping job`);
        return;
      }

      // Send message
      if (mediaUrl && mediaType) {
        // Media message — in production, fetch from S3 and convert to base64
        await sendTextMessage(numberId, toJid, message); // fallback to text for now
      } else {
        await sendTextMessage(numberId, toJid, message);
      }

      // Update campaign counters
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { sentCount: { increment: 1 } },
      });

      // Log message
      await prisma.message.create({
        data: {
          tenantId, numberId, contactId,
          fromJid: 'campaign',
          toJid,
          body: message,
          type: 'text',
          direction: 'outbound',
          aiSent: false,
          timestamp: new Date(),
        },
      });

      logger.debug(`Campaign ${campaignId}: sent to ${toJid}`);
    } catch (err) {
      logger.error(`Campaign job error (${campaignId} → ${toJid}):`, err.message);

      // Increment failed count
      await prisma.campaign.update({
        where: { id: campaignId },
        data: { failedCount: { increment: 1 } },
      }).catch(() => {});

      throw err; // Let Bull retry
    }
  });

  // When all campaign jobs are done, mark campaign as completed
  campaignQueue.on('drained', async () => {
    // Check for any running campaigns that have sent all their messages
    const running = await prisma.campaign.findMany({
      where: { status: 'running' },
      select: { id: true },
    });
    for (const c of running) {
      const counts = await prisma.campaign.findUnique({
        where: { id: c.id },
        select: { sentCount: true, failedCount: true },
      });
      // Simple heuristic: if queue is empty and campaign is running, mark done
      const waitingCount = await campaignQueue.getWaitingCount();
      const activeCount  = await campaignQueue.getActiveCount();
      if (waitingCount === 0 && activeCount === 0) {
        await prisma.campaign.update({
          where: { id: c.id },
          data: { status: 'completed', completedAt: new Date() },
        }).catch(() => {});
      }
    }
  });

  campaignQueue.on('failed', (job, err) => {
    logger.error(`Campaign queue job failed: jobId=${job.id}`, err.message);
  });

  // ── FOLLOWUP MESSAGE PROCESSOR ──────────────────────────
  followupQueue.process(2, async (job) => {
    const { enrollmentId, tenantId, numberId, toJid, message, contactId, sequenceId } = job.data;

    try {
      // Check enrollment is still pending
      const enrollment = await prisma.followupEnrollment.findUnique({
        where: { id: enrollmentId },
        select: { status: true },
      });
      if (!enrollment || enrollment.status !== 'pending') {
        logger.debug(`Followup enrollment ${enrollmentId} is ${enrollment?.status}, skipping`);
        return;
      }

      await sendTextMessage(numberId, toJid, message);
      await markEnrollmentSent(enrollmentId);

      // Update sequence sent counter
      await prisma.followupSequence.update({
        where: { id: sequenceId },
        data: { sentCount: { increment: 1 } },
      });

      // Log message
      await prisma.message.create({
        data: {
          tenantId, numberId, contactId,
          fromJid: 'followup',
          toJid,
          body: message,
          type: 'text',
          direction: 'outbound',
          aiSent: false,
          timestamp: new Date(),
        },
      });

      logger.debug(`Followup sent to ${toJid} (enrollment: ${enrollmentId})`);
    } catch (err) {
      logger.error(`Followup job error (${enrollmentId}):`, err.message);
      await markEnrollmentFailed(enrollmentId);
      throw err;
    }
  });

  followupQueue.on('failed', (job, err) => {
    logger.error(`Followup queue job failed: jobId=${job.id}`, err.message);
  });

  // ── SCHEDULED MESSAGE PROCESSOR ─────────────────────────
  scheduledQueue.process(2, async (job) => {
    const { tenantId, numberId, toJid, message, contactId } = job.data;

    try {
      await sendTextMessage(numberId, toJid, message);

      await prisma.message.create({
        data: {
          tenantId, numberId, contactId,
          fromJid: 'scheduled',
          toJid,
          body: message,
          type: 'text',
          direction: 'outbound',
          aiSent: false,
          timestamp: new Date(),
        },
      });

      logger.debug(`Scheduled message sent to ${toJid}`);
    } catch (err) {
      logger.error(`Scheduled message job error:`, err.message);
      throw err;
    }
  });

  // ── APPOINTMENT REMINDER PROCESSOR ──────────────────────
  reminderQueue.process(1, async (job) => {
    const { tenantId, numberId, toJid, message, appointmentId } = job.data;

    try {
      await sendTextMessage(numberId, toJid, message);

      await prisma.appointment.update({
        where: { id: appointmentId },
        data: { reminderSent: true },
      });

      logger.debug(`Appointment reminder sent to ${toJid} for appointment ${appointmentId}`);
    } catch (err) {
      logger.error(`Reminder job error (appt: ${appointmentId}):`, err.message);
      throw err;
    }
  });

  // ── CRON: Process due follow-ups every minute ────────────
  setInterval(processDueFollowups, 60 * 1000);

  // ── CRON: Check for appointment reminders every 5 min ───
  setInterval(processAppointmentReminders, 5 * 60 * 1000);

  logger.info('✅ Job processors started');
}

/**
 * Poll DB for due follow-up enrollments and enqueue them.
 */
async function processDueFollowups() {
  try {
    const due = await getDueEnrollments(100);
    if (!due.length) return;

    logger.debug(`Processing ${due.length} due follow-up enrollments`);

    for (const enrollment of due) {
      const { sequence, contact } = enrollment;
      const numberId = contact.numberId || (await getDefaultNumberId(enrollment.tenantId));
      if (!numberId) continue;

      const message = personalise(sequence.message, contact);

      await followupQueue.add(
        {
          enrollmentId: enrollment.id,
          tenantId:     enrollment.tenantId,
          numberId,
          toJid:        contact.waJid,
          contactId:    contact.id,
          message,
          sequenceId:   sequence.id,
        },
        { attempts: 3, backoff: { type: 'exponential', delay: 10000 }, removeOnComplete: true }
      );
    }
  } catch (err) {
    logger.error('processDueFollowups error:', err.message);
  }
}

/**
 * Check for appointments that need reminders (1 hour before).
 */
async function processAppointmentReminders() {
  try {
    const inOneHour = new Date(Date.now() + 60 * 60 * 1000 + 5 * 60 * 1000); // 1h5m
    const inOneHourStart = new Date(Date.now() + 60 * 60 * 1000 - 5 * 60 * 1000); // 55min

    const appointments = await prisma.appointment.findMany({
      where: {
        status: 'confirmed',
        reminderSent: false,
        startTime: { gte: inOneHourStart, lte: inOneHour },
      },
      include: {
        contact: { include: { number: true } },
        tenant:  { include: { numbers: { where: { sessionStatus: 'connected' }, take: 1 } } },
      },
    });

    for (const appt of appointments) {
      const numberId = appt.contact?.number?.id || appt.tenant?.numbers?.[0]?.id;
      if (!numberId || !appt.contact?.waJid) continue;

      const timeStr = appt.startTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', weekday: 'short', month: 'short', day: 'numeric' });
      const message = `🔔 Reminder: You have an appointment scheduled for ${timeStr}. See you soon! 🙏`;

      await reminderQueue.add(
        {
          tenantId:      appt.tenantId,
          numberId,
          toJid:         appt.contact.waJid,
          message,
          appointmentId: appt.id,
        },
        { attempts: 2, removeOnComplete: true }
      );
    }
  } catch (err) {
    logger.error('processAppointmentReminders error:', err.message);
  }
}

async function getDefaultNumberId(tenantId) {
  const num = await prisma.tenantNumber.findFirst({
    where: { tenantId, sessionStatus: 'connected' },
    select: { id: true },
  });
  return num?.id || null;
}

function personalise(template, contact) {
  return template
    .replace(/\{name\}/gi, contact.name || 'Valued Customer')
    .replace(/\{date\}/gi, new Date().toLocaleDateString('en-IN'));
}

module.exports = { startJobProcessors, followupQueue, scheduledQueue, reminderQueue };
