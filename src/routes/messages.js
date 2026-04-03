// src/routes/messages.js
const router = require('express').Router();
const { body, param, query } = require('express-validator');
const { protect } = require('../middleware/auth');
const { validate } = require('../utils/requestValidation');
const {
  getConversations, getMessages,
  sendText, sendMedia, sendLocationMsg, sendPollMsg,
  reactToMessage, scheduleMessage,
  toggleAIForContact, getAISuggestion,
} = require('../controllers/messageController');

router.use(protect);

// ── INBOX / CONVERSATIONS ─────────────────────────────────────
router.get(
  '/conversations',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    query('numberId').optional().isUUID().withMessage('numberId must be a valid id'),
    query('aiFilter').optional().isIn(['ai', 'human']).withMessage('aiFilter must be ai or human'),
    query('search').optional().isString().trim().isLength({ max: 120 }).withMessage('search is too long'),
    validate,
  ],
  getConversations
);

// ── PER-CONTACT MESSAGES ─────────────────────────────────────
router.get(
  '/contact/:contactId',
  [
    param('contactId').isUUID().withMessage('contactId must be a valid id'),
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    validate,
  ],
  getMessages
);

// ── SEND ──────────────────────────────────────────────────────
router.post(
  '/send/text',
  [
    body('numberId').isUUID().withMessage('numberId is required'),
    body('toJid').isString().trim().notEmpty().withMessage('toJid is required'),
    body('message').isString().trim().notEmpty().withMessage('message is required'),
    body('contactId').optional().isUUID().withMessage('contactId must be a valid id'),
    body('quotedMsgId').optional().isString().trim().notEmpty().withMessage('quotedMsgId is invalid'),
    validate,
  ],
  sendText
);
router.post(
  '/send/media',
  [
    body('numberId').isUUID().withMessage('numberId is required'),
    body('toJid').isString().trim().notEmpty().withMessage('toJid is required'),
    body('caption').optional().isString().isLength({ max: 2000 }).withMessage('caption is too long'),
    body('contactId').optional().isUUID().withMessage('contactId must be a valid id'),
    validate,
  ],
  sendMedia
);
router.post(
  '/send/location',
  [
    body('numberId').isUUID().withMessage('numberId is required'),
    body('toJid').isString().trim().notEmpty().withMessage('toJid is required'),
    body('lat').isFloat({ min: -90, max: 90 }).withMessage('lat must be valid'),
    body('lng').isFloat({ min: -180, max: 180 }).withMessage('lng must be valid'),
    body('name').optional().isString().isLength({ max: 200 }).withMessage('name is too long'),
    body('contactId').optional().isUUID().withMessage('contactId must be a valid id'),
    validate,
  ],
  sendLocationMsg
);
router.post(
  '/send/poll',
  [
    body('numberId').isUUID().withMessage('numberId is required'),
    body('toJid').isString().trim().notEmpty().withMessage('toJid is required'),
    body('question').isString().trim().notEmpty().withMessage('question is required'),
    body('options').isArray({ min: 2 }).withMessage('options must contain at least 2 choices'),
    body('options.*').isString().trim().notEmpty().withMessage('each option must be a non-empty string'),
    body('allowMultiple').optional().isBoolean().withMessage('allowMultiple must be boolean'),
    body('contactId').optional().isUUID().withMessage('contactId must be a valid id'),
    validate,
  ],
  sendPollMsg
);
router.post(
  '/send/schedule',
  [
    body('numberId').isUUID().withMessage('numberId is required'),
    body('toJid').isString().trim().notEmpty().withMessage('toJid is required'),
    body('message').isString().trim().notEmpty().withMessage('message is required'),
    body('scheduledAt').isISO8601().withMessage('scheduledAt must be a valid ISO date'),
    body('contactId').optional().isUUID().withMessage('contactId must be a valid id'),
    validate,
  ],
  scheduleMessage
);

// ── REACTIONS ─────────────────────────────────────────────────
router.post(
  '/react',
  [
    body('numberId').isUUID().withMessage('numberId is required'),
    body('msgId').isString().trim().notEmpty().withMessage('msgId is required'),
    body('emoji').isString().trim().notEmpty().withMessage('emoji is required'),
    validate,
  ],
  reactToMessage
);

// ── AI ────────────────────────────────────────────────────────
router.post(
  '/ai/toggle/:contactId',
  [
    param('contactId').isUUID().withMessage('contactId must be a valid id'),
    body('aiEnabled').isBoolean().withMessage('aiEnabled must be boolean'),
    validate,
  ],
  toggleAIForContact
);
router.post(
  '/ai/suggestion/:contactId',
  [param('contactId').isUUID().withMessage('contactId must be a valid id'), validate],
  getAISuggestion
);

module.exports = router;
