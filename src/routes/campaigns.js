// src/routes/campaigns.js
const router = require('express').Router();
const { body, param, query } = require('express-validator');
const { protect } = require('../middleware/auth');
const { validate } = require('../utils/requestValidation');
const {
  listCampaigns, getCampaign, createCampaign,
  updateCampaign, deleteCampaign,
  startCampaignCtrl, pauseCampaignCtrl, stopCampaign,
} = require('../controllers/campaignController');

router.use(protect);

router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    validate,
  ],
  listCampaigns
);
router.post(
  '/',
  [
    body('name').isString().trim().notEmpty().withMessage('name is required'),
    body('description').optional().isString().isLength({ max: 5000 }).withMessage('description is too long'),
    body('message').isString().trim().notEmpty().withMessage('message is required'),
    body('mediaUrl').optional().isString().trim().notEmpty().withMessage('mediaUrl is invalid'),
    body('mediaType').optional().isString().trim().isLength({ max: 100 }).withMessage('mediaType is invalid'),
    body('targetType').optional().isIn(['all', 'labels', 'custom']).withMessage('targetType is invalid'),
    body('targetLabels').optional().isArray({ max: 100 }).withMessage('targetLabels must be an array'),
    body('targetLabels.*').optional().isString().trim().isLength({ max: 50 }).withMessage('target label is too long'),
    body('targetJids').optional().isArray({ max: 10000 }).withMessage('targetJids must be an array'),
    body('targetJids.*').optional().isString().trim().notEmpty().withMessage('target jid is invalid'),
    body('scheduledAt').optional({ values: 'falsy' }).isISO8601().withMessage('scheduledAt must be a valid ISO date'),
    validate,
  ],
  createCampaign
);
router.get('/:campaignId',                  [param('campaignId').isUUID().withMessage('campaignId must be a valid id'), validate], getCampaign);
router.patch(
  '/:campaignId',
  [
    param('campaignId').isUUID().withMessage('campaignId must be a valid id'),
    body('name').optional().isString().trim().notEmpty().withMessage('name cannot be empty'),
    body('description').optional().isString().isLength({ max: 5000 }).withMessage('description is too long'),
    body('message').optional().isString().trim().notEmpty().withMessage('message cannot be empty'),
    body('targetType').optional().isIn(['all', 'labels', 'custom']).withMessage('targetType is invalid'),
    body('targetLabels').optional().isArray({ max: 100 }).withMessage('targetLabels must be an array'),
    body('targetLabels.*').optional().isString().trim().isLength({ max: 50 }).withMessage('target label is too long'),
    body('targetJids').optional().isArray({ max: 10000 }).withMessage('targetJids must be an array'),
    body('targetJids.*').optional().isString().trim().notEmpty().withMessage('target jid is invalid'),
    body('scheduledAt').optional({ values: 'falsy' }).isISO8601().withMessage('scheduledAt must be a valid ISO date'),
    validate,
  ],
  updateCampaign
);
router.delete('/:campaignId',               [param('campaignId').isUUID().withMessage('campaignId must be a valid id'), validate], deleteCampaign);
router.post('/:campaignId/start',           [param('campaignId').isUUID().withMessage('campaignId must be a valid id'), validate], startCampaignCtrl);
router.post('/:campaignId/pause',           [param('campaignId').isUUID().withMessage('campaignId must be a valid id'), validate], pauseCampaignCtrl);
router.post('/:campaignId/stop',            [param('campaignId').isUUID().withMessage('campaignId must be a valid id'), validate], stopCampaign);

module.exports = router;
