// src/routes/messages.js
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const {
  getConversations, getMessages,
  sendText, sendMedia, sendLocationMsg, sendPollMsg,
  reactToMessage, scheduleMessage,
  toggleAIForContact, getAISuggestion,
} = require('../controllers/messageController');

router.use(protect);

// ── INBOX / CONVERSATIONS ─────────────────────────────────────
router.get('/conversations',                        getConversations);

// ── PER-CONTACT MESSAGES ─────────────────────────────────────
router.get('/contact/:contactId',                   getMessages);

// ── SEND ──────────────────────────────────────────────────────
router.post('/send/text',                           sendText);
router.post('/send/media',                          sendMedia);
router.post('/send/location',                       sendLocationMsg);
router.post('/send/poll',                           sendPollMsg);
router.post('/send/schedule',                       scheduleMessage);

// ── REACTIONS ─────────────────────────────────────────────────
router.post('/react',                               reactToMessage);

// ── AI ────────────────────────────────────────────────────────
router.post('/ai/toggle/:contactId',                toggleAIForContact);
router.post('/ai/suggestion/:contactId',            getAISuggestion);

module.exports = router;
