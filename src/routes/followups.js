// src/routes/followups.js
const router = require('express').Router();
const { body, param, query } = require('express-validator');
const { protect } = require('../middleware/auth');
const { validate } = require('../utils/requestValidation');
const {
  listSequences, getSequence, createSequence,
  updateSequence, deleteSequence, toggleSequence,
  enrollContact, getEnrollments,
} = require('../controllers/followupController');

router.use(protect);

router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    validate,
  ],
  listSequences
);
router.post(
  '/',
  [
    body('name').isString().trim().notEmpty().withMessage('name is required'),
    body('description').optional().isString().isLength({ max: 5000 }).withMessage('description is too long'),
    body('triggerType').isString().trim().notEmpty().withMessage('triggerType is required'),
    body('triggerValue').optional().isString().trim().isLength({ max: 300 }).withMessage('triggerValue is too long'),
    body('delayValue').isInt({ min: 1, max: 10080 }).withMessage('delayValue must be between 1 and 10080'),
    body('delayUnit').optional().isIn(['minutes', 'hours', 'days']).withMessage('delayUnit is invalid'),
    body('message').isString().trim().notEmpty().withMessage('message is required'),
    body('stopOnReply').optional().isBoolean().withMessage('stopOnReply must be boolean'),
    body('minGapSec').optional().isInt({ min: 0, max: 3600 }).withMessage('minGapSec must be between 0 and 3600'),
    body('maxGapSec').optional().isInt({ min: 0, max: 3600 }).withMessage('maxGapSec must be between 0 and 3600'),
    validate,
  ],
  createSequence
);
router.get(
  '/enrollments',
  [
    query('sequenceId').isUUID().withMessage('sequenceId is required'),
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    validate,
  ],
  getEnrollments
);
router.get('/:sequenceId',                    [param('sequenceId').isUUID().withMessage('sequenceId must be a valid id'), validate], getSequence);
router.patch(
  '/:sequenceId',
  [
    param('sequenceId').isUUID().withMessage('sequenceId must be a valid id'),
    body('name').optional().isString().trim().notEmpty().withMessage('name cannot be empty'),
    body('description').optional().isString().isLength({ max: 5000 }).withMessage('description is too long'),
    body('triggerType').optional().isString().trim().notEmpty().withMessage('triggerType is invalid'),
    body('triggerValue').optional().isString().trim().isLength({ max: 300 }).withMessage('triggerValue is too long'),
    body('delayValue').optional().isInt({ min: 1, max: 10080 }).withMessage('delayValue must be between 1 and 10080'),
    body('delayUnit').optional().isIn(['minutes', 'hours', 'days']).withMessage('delayUnit is invalid'),
    body('message').optional().isString().trim().notEmpty().withMessage('message cannot be empty'),
    body('stopOnReply').optional().isBoolean().withMessage('stopOnReply must be boolean'),
    body('isActive').optional().isBoolean().withMessage('isActive must be boolean'),
    validate,
  ],
  updateSequence
);
router.delete('/:sequenceId',                 [param('sequenceId').isUUID().withMessage('sequenceId must be a valid id'), validate], deleteSequence);
router.post(
  '/:sequenceId/toggle',
  [
    param('sequenceId').isUUID().withMessage('sequenceId must be a valid id'),
    body('isActive').isBoolean().withMessage('isActive must be boolean'),
    validate,
  ],
  toggleSequence
);
router.post(
  '/:sequenceId/enroll',
  [
    param('sequenceId').isUUID().withMessage('sequenceId must be a valid id'),
    body('contactId').isUUID().withMessage('contactId is required'),
    validate,
  ],
  enrollContact
);

module.exports = router;
