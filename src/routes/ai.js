// src/routes/ai.js
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const {
  getAiConfig, updateAiConfig, testAIReply,
  listKnowledgeDocs, uploadKnowledgeDoc, deleteKnowledgeDoc,
} = require('../controllers/aiController');
const { uploadSingle } = require('../services/uploadService');

router.use(protect);

router.get('/config',                       getAiConfig);
router.patch('/config',                     updateAiConfig);
router.post('/test',                        testAIReply);

// ── KNOWLEDGE BASE ────────────────────────────────────────────
router.get('/docs',                         listKnowledgeDocs);
router.post('/docs',                        uploadSingle('document'), uploadKnowledgeDoc);
router.delete('/docs/:docId',               deleteKnowledgeDoc);

module.exports = router;
