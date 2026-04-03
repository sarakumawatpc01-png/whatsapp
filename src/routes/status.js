// src/routes/status.js
const router = require('express').Router();
const { body, param, query } = require('express-validator');
const { protect } = require('../middleware/auth');
const { validate } = require('../utils/requestValidation');
const {
  listStatusPosts, createStatusPost,
  deleteStatusPost, scheduleStatusPost,
} = require('../controllers/statusController');

router.use(protect);

router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    validate,
  ],
  listStatusPosts
);
router.post(
  '/',
  [
    body('numberId').isUUID().withMessage('numberId is required'),
    body('body').optional().isString().isLength({ min: 1, max: 700 }).withMessage('body must be 1-700 chars'),
    body('mediaUrl').optional().isString().trim().notEmpty().withMessage('mediaUrl is invalid'),
    body('mediaType').optional().isString().trim().isLength({ max: 100 }).withMessage('mediaType is invalid'),
    validate,
  ],
  createStatusPost
);
router.post(
  '/schedule',
  [
    body('numberId').isUUID().withMessage('numberId is required'),
    body('scheduledAt').isISO8601().withMessage('scheduledAt must be a valid ISO date'),
    body('body').optional().isString().isLength({ min: 1, max: 700 }).withMessage('body must be 1-700 chars'),
    body('mediaUrl').optional().isString().trim().notEmpty().withMessage('mediaUrl is invalid'),
    body('mediaType').optional().isString().trim().isLength({ max: 100 }).withMessage('mediaType is invalid'),
    validate,
  ],
  scheduleStatusPost
);
router.delete('/:statusId',   [param('statusId').isUUID().withMessage('statusId must be a valid id'), validate], deleteStatusPost);

module.exports = router;
