// src/routes/calendar.js
const router = require('express').Router();
const { body, param, query } = require('express-validator');
const { protect } = require('../middleware/auth');
const { validate } = require('../utils/requestValidation');
const {
  initiateOAuth, oauthCallback, disconnectCalendar, getCalendarStatus,
  listEvents, createAppointment, updateAppointment,
  cancelAppointment, listAppointments, getAvailableSlots,
} = require('../controllers/calendarController');

// OAuth callback is public (Google redirects here)
router.get(
  '/callback',
  [
    query('code').isString().trim().notEmpty().withMessage('code is required'),
    query('state').isUUID().withMessage('state must be a valid tenant id'),
    validate,
  ],
  oauthCallback
);

router.use(protect);

router.get('/status',                       getCalendarStatus);
router.get('/auth',                         initiateOAuth);
router.delete('/disconnect',                disconnectCalendar);
router.get(
  '/events',
  [query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'), validate],
  listEvents
);
router.get(
  '/available-slots',
  [
    query('from').optional().isISO8601().withMessage('from must be a valid ISO date'),
    query('count').optional().isInt({ min: 1, max: 50 }).withMessage('count must be between 1 and 50'),
    query('duration').optional().isInt({ min: 5, max: 480 }).withMessage('duration must be between 5 and 480'),
    validate,
  ],
  getAvailableSlots
);

// ── APPOINTMENTS ──────────────────────────────────────────────
router.get(
  '/appointments',
  [
    query('from').optional().isISO8601().withMessage('from must be a valid ISO date'),
    query('to').optional().isISO8601().withMessage('to must be a valid ISO date'),
    query('status').optional().isIn(['confirmed', 'cancelled', 'completed']).withMessage('status is invalid'),
    validate,
  ],
  listAppointments
);
router.post(
  '/appointments',
  [
    body('contactId').optional().isUUID().withMessage('contactId must be a valid id'),
    body('title').isString().trim().notEmpty().withMessage('title is required'),
    body('description').optional().isString().isLength({ max: 5000 }).withMessage('description is too long'),
    body('startTime').isISO8601().withMessage('startTime must be a valid ISO date'),
    body('endTime').isISO8601().withMessage('endTime must be a valid ISO date'),
    body('addToCalendar').optional().isBoolean().withMessage('addToCalendar must be boolean'),
    body('sendReminder').optional().isBoolean().withMessage('sendReminder must be boolean'),
    validate,
  ],
  createAppointment
);
router.patch(
  '/appointments/:appointmentId',
  [
    param('appointmentId').isUUID().withMessage('appointmentId must be a valid id'),
    body('title').optional().isString().trim().notEmpty().withMessage('title cannot be empty'),
    body('description').optional().isString().isLength({ max: 5000 }).withMessage('description is too long'),
    body('startTime').optional().isISO8601().withMessage('startTime must be a valid ISO date'),
    body('endTime').optional().isISO8601().withMessage('endTime must be a valid ISO date'),
    body('status').optional().isIn(['confirmed', 'cancelled', 'completed']).withMessage('status is invalid'),
    validate,
  ],
  updateAppointment
);
router.post(
  '/appointments/:appointmentId/cancel',
  [param('appointmentId').isUUID().withMessage('appointmentId must be a valid id'), validate],
  cancelAppointment
);

module.exports = router;
