// src/routes/calendar.js
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const {
  initiateOAuth, oauthCallback, disconnectCalendar, getCalendarStatus,
  listEvents, createAppointment, updateAppointment,
  cancelAppointment, listAppointments, getAvailableSlots,
} = require('../controllers/calendarController');

// OAuth callback is public (Google redirects here)
router.get('/callback', oauthCallback);

router.use(protect);

router.get('/status',                       getCalendarStatus);
router.get('/auth',                         initiateOAuth);
router.delete('/disconnect',                disconnectCalendar);
router.get('/events',                       listEvents);
router.get('/available-slots',              getAvailableSlots);

// ── APPOINTMENTS ──────────────────────────────────────────────
router.get('/appointments',                 listAppointments);
router.post('/appointments',                createAppointment);
router.patch('/appointments/:appointmentId', updateAppointment);
router.post('/appointments/:appointmentId/cancel', cancelAppointment);

module.exports = router;
