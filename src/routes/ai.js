// src/routes/ai.js
const router = require('express').Router();
const { body, param } = require('express-validator');
const { protect } = require('../middleware/auth');
const { validate } = require('../utils/requestValidation');
const {
  getAiConfig, updateAiConfig, testAIReply,
  listKnowledgeDocs, uploadKnowledgeDoc, deleteKnowledgeDoc,
} = require('../controllers/aiController');
const { uploadSingle } = require('../services/uploadService');

router.use(protect);

router.get('/config',                       getAiConfig);
router.patch('/config',                     [body().isObject().withMessage('Request body must be an object'), validate], updateAiConfig);
router.post(
  '/test',
  [body('message').isString().trim().notEmpty().withMessage('message is required'), validate],
  testAIReply
);

// ── KNOWLEDGE BASE ────────────────────────────────────────────
router.get('/docs',                         listKnowledgeDocs);
router.post('/docs',                        uploadSingle('document'), uploadKnowledgeDoc);
router.delete('/docs/:docId',               [param('docId').isUUID().withMessage('docId must be a valid id'), validate], deleteKnowledgeDoc);

module.exports = router;
