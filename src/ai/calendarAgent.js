// src/ai/calendarAgent.js
// Detects booking intent in messages and creates Google Calendar events

const { google } = require('googleapis');
const prisma = require('../config/database');
const logger = require('../config/logger');
const Anthropic = require('@anthropic-ai/sdk');

const BOOKING_KEYWORDS = [
  'appointment', 'book', 'schedule', 'visit', 'come', 'meeting',
  'appointment', 'booking', 'milna', 'aana', 'visit karna', 'book karo',
];

/**
 * Check if message has booking intent.
 */
function hasBookingIntent(text) {
  const lower = text.toLowerCase();
  return BOOKING_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Extract appointment details from conversation using AI.
 */
async function extractAppointmentDetails(conversationHistory, latestMessage) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `From this WhatsApp conversation, extract appointment details. Return ONLY valid JSON.
  
Conversation:
${conversationHistory.map(m => `${m.direction === 'inbound' ? 'Customer' : 'Business'}: ${m.body}`).join('\n')}
Latest message: "${latestMessage}"

Extract:
{
  "hasBookingIntent": boolean,
  "requestedDate": "YYYY-MM-DD or null",
  "requestedTime": "HH:MM or null",
  "serviceName": "string or null",
  "duration": 60
}

Return ONLY the JSON object.`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0]?.text || '{}';
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (err) {
    logger.error('Calendar extraction error:', err);
    return { hasBookingIntent: false };
  }
}

/**
 * Check calendar availability for a given time slot.
 */
async function checkAvailability(tenantId, startTime, endTime) {
  const token = await getCalendarToken(tenantId);
  if (!token) return null;

  const auth = getOAuthClient(token);
  const calendar = google.calendar({ version: 'v3', auth });

  try {
    const resp = await calendar.freebusy.query({
      requestBody: {
        timeMin: startTime.toISOString(),
        timeMax: endTime.toISOString(),
        items: [{ id: 'primary' }],
      },
    });

    const busy = resp.data.calendars?.primary?.busy || [];
    return busy.length === 0; // true = available
  } catch (err) {
    logger.error('Calendar availability check error:', err);
    return null;
  }
}

/**
 * Get next N available slots starting from a date.
 */
async function getNextAvailableSlots(tenantId, fromDate, count = 3, durationMinutes = 60) {
  const token = await getCalendarToken(tenantId);
  if (!token) return [];

  const auth = getOAuthClient(token);
  const calendar = google.calendar({ version: 'v3', auth });

  const slots = [];
  let current = new Date(fromDate);
  current.setHours(10, 0, 0, 0); // Start checking from 10 AM

  const maxDays = 14;
  let daysChecked = 0;

  while (slots.length < count && daysChecked < maxDays) {
    const daySlots = [10, 11, 12, 14, 15, 16, 17]; // Hours to check

    for (const hour of daySlots) {
      if (slots.length >= count) break;
      current.setHours(hour, 0, 0, 0);
      const end = new Date(current.getTime() + durationMinutes * 60 * 1000);

      const available = await checkAvailability(tenantId, current, end);
      if (available) {
        slots.push(new Date(current));
      }
    }

    current.setDate(current.getDate() + 1);
    daysChecked++;
  }

  return slots;
}

/**
 * Create a Google Calendar event.
 */
async function createCalendarEvent(tenantId, { title, description, startTime, endTime, contactName, contactPhone }) {
  const token = await getCalendarToken(tenantId);
  if (!token) throw new Error('Calendar not connected');

  const auth = getOAuthClient(token);
  const calendar = google.calendar({ version: 'v3', auth });

  const event = {
    summary: title || `Appointment with ${contactName || contactPhone}`,
    description: description || `WhatsApp appointment booked via WaizAI\nContact: ${contactName || ''} (${contactPhone || ''})`,
    start: { dateTime: startTime.toISOString(), timeZone: 'Asia/Kolkata' },
    end:   { dateTime: endTime.toISOString(),   timeZone: 'Asia/Kolkata' },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 60 },
        { method: 'popup', minutes: 15 },
      ],
    },
  };

  const response = await calendar.events.insert({ calendarId: 'primary', requestBody: event });
  return response.data;
}

/**
 * Update a calendar event.
 */
async function updateCalendarEvent(tenantId, eventId, updates) {
  const token = await getCalendarToken(tenantId);
  if (!token) throw new Error('Calendar not connected');

  const auth = getOAuthClient(token);
  const calendar = google.calendar({ version: 'v3', auth });

  const response = await calendar.events.patch({
    calendarId: 'primary',
    eventId,
    requestBody: updates,
  });
  return response.data;
}

/**
 * Delete a calendar event.
 */
async function deleteCalendarEvent(tenantId, eventId) {
  const token = await getCalendarToken(tenantId);
  if (!token) throw new Error('Calendar not connected');

  const auth = getOAuthClient(token);
  const calendar = google.calendar({ version: 'v3', auth });
  await calendar.events.delete({ calendarId: 'primary', eventId });
}

/**
 * List upcoming calendar events.
 */
async function listCalendarEvents(tenantId, limit = 20) {
  const token = await getCalendarToken(tenantId);
  if (!token) return [];

  const auth = getOAuthClient(token);
  const calendar = google.calendar({ version: 'v3', auth });

  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: new Date().toISOString(),
    maxResults: limit,
    singleEvents: true,
    orderBy: 'startTime',
  });

  return response.data.items || [];
}

// ── OAUTH HELPERS ─────────────────────────────────────────────
function getOAuthClient(token) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  oauth2Client.setCredentials({
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    expiry_date: new Date(token.expiresAt).getTime(),
  });
  // Auto-refresh token
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await prisma.calendarToken.update({
        where: { tenantId: token.tenantId },
        data: { accessToken: tokens.access_token, expiresAt: new Date(tokens.expiry_date || Date.now() + 3600000) },
      });
    }
  });
  return oauth2Client;
}

async function getCalendarToken(tenantId) {
  return await prisma.calendarToken.findUnique({ where: { tenantId } });
}

module.exports = {
  hasBookingIntent, extractAppointmentDetails, checkAvailability,
  getNextAvailableSlots, createCalendarEvent, updateCalendarEvent,
  deleteCalendarEvent, listCalendarEvents,
};
