// src/controllers/calendarController.js
const { google }  = require('googleapis');
const prisma      = require('../config/database');
const { AppError, ValidationError } = require('../utils/errors');
const { success } = require('../utils/response');
const {
  createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, listCalendarEvents,
  getNextAvailableSlots,
} = require('../ai/calendarAgent');
const logger = require('../config/logger');

// ── OAUTH INITIATE ────────────────────────────────────────────
async function initiateOAuth(req, res, next) {
  try {
    const oauth2Client = getOAuthClient();

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
      state: req.tenantId, // Pass tenantId through OAuth flow
    });

    return success(res, { authUrl: url });
  } catch (err) {
    next(err);
  }
}

// ── OAUTH CALLBACK ────────────────────────────────────────────
async function oauthCallback(req, res, next) {
  try {
    const { code, state } = req.query;
    const tenantId = typeof state === 'string' ? state : null;

    if (!code || !tenantId) {
      return res.redirect(`${process.env.FRONTEND_URL}/dashboard/calendar?error=oauth_failed`);
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, status: true },
    });
    if (!tenant || tenant.status === 'deleted') {
      return res.redirect(`${process.env.FRONTEND_URL}/dashboard/calendar?error=oauth_failed`);
    }

    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);

    // Get user email from Google
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;

    // Store token per tenant (isolated)
    await prisma.calendarToken.upsert({
      where: { tenantId },
      create: {
        tenantId,
        accessToken:  tokens.access_token,
        refreshToken: tokens.refresh_token || '',
        expiresAt:    new Date(tokens.expiry_date || Date.now() + 3600000),
        email,
      },
      update: {
        accessToken:  tokens.access_token,
        refreshToken: tokens.refresh_token || undefined,
        expiresAt:    new Date(tokens.expiry_date || Date.now() + 3600000),
        email,
      },
    });

    logger.info(`Google Calendar connected for tenant ${tenantId} (${email})`);
    return res.redirect(`${process.env.FRONTEND_URL}/dashboard/calendar?connected=true`);
  } catch (err) {
    logger.error('Calendar OAuth callback error:', err);
    return res.redirect(`${process.env.FRONTEND_URL}/dashboard/calendar?error=oauth_failed`);
  }
}

// ── DISCONNECT CALENDAR ───────────────────────────────────────
async function disconnectCalendar(req, res, next) {
  try {
    await prisma.calendarToken.delete({ where: { tenantId: req.tenantId } }).catch(() => {});
    return success(res, {}, 'Google Calendar disconnected');
  } catch (err) {
    next(err);
  }
}

// ── GET CALENDAR STATUS ────────────────────────────────────────
async function getCalendarStatus(req, res, next) {
  try {
    const token = await prisma.calendarToken.findUnique({
      where: { tenantId: req.tenantId },
      select: { email: true, expiresAt: true, createdAt: true },
    });
    return success(res, { connected: Boolean(token), calendar: token || null });
  } catch (err) {
    next(err);
  }
}

// ── LIST EVENTS ───────────────────────────────────────────────
async function listEvents(req, res, next) {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const events = await listCalendarEvents(req.tenantId, limit);
    return success(res, { events });
  } catch (err) {
    if (err.message === 'Calendar not connected') {
      return next(new AppError('Google Calendar is not connected. Please connect it first.', 400));
    }
    next(err);
  }
}

// ── CREATE APPOINTMENT ────────────────────────────────────────
async function createAppointment(req, res, next) {
  try {
    const {
      contactId, title, description, startTime, endTime,
      addToCalendar, sendReminder,
    } = req.body;

    if (!title || !startTime || !endTime) {
      return next(new ValidationError('title, startTime, and endTime are required'));
    }

    const start = new Date(startTime);
    const end   = new Date(endTime);
    if (end <= start) return next(new ValidationError('endTime must be after startTime'));

    let safeContactId = null;
    let contact = null;
    if (contactId) {
      contact = await prisma.contact.findFirst({ where: { id: contactId, tenantId: req.tenantId } });
      if (!contact) return next(new AppError('Contact not found', 404));
      safeContactId = contact.id;
    }

    let calendarEventId = null;
    if (addToCalendar !== false) {
      try {
        const event = await createCalendarEvent(req.tenantId, {
          title,
          description,
          startTime: start,
          endTime:   end,
          contactName:  contact?.name,
          contactPhone: contact?.phoneNumber,
        });
        calendarEventId = event.id;
      } catch (calErr) {
        logger.warn(`Calendar event creation failed (non-fatal): ${calErr.message}`);
      }
    }

    const appointment = await prisma.appointment.create({
      data: {
        tenantId:       req.tenantId,
        contactId:      safeContactId,
        title,
        description:    description || null,
        startTime:      start,
        endTime:        end,
        calendarEventId,
        status:         'confirmed',
        createdViaAi:   false,
      },
    });

    // Schedule WhatsApp reminder if requested
    if (sendReminder && contact?.waJid) {
      const { reminderQueue } = require('../jobs/processors');
      const number = await prisma.tenantNumber.findFirst({
        where: { tenantId: req.tenantId, sessionStatus: 'connected' },
      });
      if (number) {
        const timeStr = start.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        const reminderMsg = `🔔 Appointment Reminder: "${title}" on ${timeStr}. See you soon! 🙏`;
        const delay = Math.max(start.getTime() - Date.now() - 60 * 60 * 1000, 5000);
        await reminderQueue.add(
          { tenantId: req.tenantId, numberId: number.id, toJid: contact.waJid, message: reminderMsg, appointmentId: appointment.id },
          { delay, attempts: 2, removeOnComplete: true }
        );
      }
    }

    return success(res, { appointment }, 'Appointment created', 201);
  } catch (err) {
    next(err);
  }
}

// ── UPDATE APPOINTMENT ────────────────────────────────────────
async function updateAppointment(req, res, next) {
  try {
    const { appointmentId } = req.params;
    const { title, description, startTime, endTime, status } = req.body;

    const appt = await prisma.appointment.findFirst({ where: { id: appointmentId, tenantId: req.tenantId } });
    if (!appt) return next(new AppError('Appointment not found', 404));

    const updated = await prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        ...(title       !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(startTime   !== undefined && { startTime: new Date(startTime) }),
        ...(endTime     !== undefined && { endTime: new Date(endTime) }),
        ...(status      !== undefined && { status }),
      },
    });

    // Update Google Calendar event if exists
    if (appt.calendarEventId) {
      const updates = {};
      if (startTime) updates.start = { dateTime: new Date(startTime).toISOString(), timeZone: 'Asia/Kolkata' };
      if (endTime)   updates.end   = { dateTime: new Date(endTime).toISOString(),   timeZone: 'Asia/Kolkata' };
      if (title)     updates.summary = title;
      if (Object.keys(updates).length) {
        await updateCalendarEvent(req.tenantId, appt.calendarEventId, updates).catch(() => {});
      }
    }

    return success(res, { appointment: updated }, 'Appointment updated');
  } catch (err) {
    next(err);
  }
}

// ── CANCEL APPOINTMENT ────────────────────────────────────────
async function cancelAppointment(req, res, next) {
  try {
    const { appointmentId } = req.params;

    const appt = await prisma.appointment.findFirst({ where: { id: appointmentId, tenantId: req.tenantId } });
    if (!appt) return next(new AppError('Appointment not found', 404));

    await prisma.appointment.update({ where: { id: appointmentId }, data: { status: 'cancelled' } });

    if (appt.calendarEventId) {
      await deleteCalendarEvent(req.tenantId, appt.calendarEventId).catch(() => {});
    }

    return success(res, {}, 'Appointment cancelled');
  } catch (err) {
    next(err);
  }
}

// ── LIST APPOINTMENTS ─────────────────────────────────────────
async function listAppointments(req, res, next) {
  try {
    const { from, to, status } = req.query;

    const where = {
      tenantId: req.tenantId,
      ...(status && { status }),
      ...(from && { startTime: { gte: new Date(from) } }),
      ...(to   && { startTime: { lte: new Date(to) } }),
    };

    const appointments = await prisma.appointment.findMany({
      where,
      include: { contact: { select: { id: true, name: true, phoneNumber: true } } },
      orderBy: { startTime: 'asc' },
    });

    return success(res, { appointments });
  } catch (err) {
    next(err);
  }
}

// ── GET AVAILABLE SLOTS ───────────────────────────────────────
async function getAvailableSlots(req, res, next) {
  try {
    const { from, count, duration } = req.query;
    const fromDate = from ? new Date(from) : new Date();
    const slots = await getNextAvailableSlots(
      req.tenantId,
      fromDate,
      parseInt(count) || 3,
      parseInt(duration) || 60
    );
    return success(res, { slots: slots.map(s => s.toISOString()) });
  } catch (err) {
    next(err);
  }
}

// ── HELPER ────────────────────────────────────────────────────
function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

module.exports = {
  initiateOAuth, oauthCallback, disconnectCalendar, getCalendarStatus,
  listEvents, createAppointment, updateAppointment, cancelAppointment,
  listAppointments, getAvailableSlots,
};
