// src/routes/channels.js
const router = require('express').Router();
const { body, param } = require('express-validator');
const { protect } = require('../middleware/auth');
const { validate } = require('../utils/requestValidation');
const {
  listChannels, getChannel, createChannel,
  updateChannel, postUpdate, getChannelAnalytics,
} = require('../controllers/channelController');

router.use(protect);

router.get('/',                               listChannels);
router.post(
  '/',
  [
    body('name').optional().isString().trim().isLength({ max: 120 }).withMessage('name is too long'),
    body('description').optional().isString().isLength({ max: 5000 }).withMessage('description is too long'),
    validate,
  ],
  createChannel
);
router.get('/:channelId',                     [param('channelId').isUUID().withMessage('channelId must be a valid id'), validate], getChannel);
router.patch(
  '/:channelId',
  [
    param('channelId').isUUID().withMessage('channelId must be a valid id'),
    body('name').optional().isString().trim().isLength({ max: 120 }).withMessage('name is too long'),
    body('description').optional().isString().isLength({ max: 5000 }).withMessage('description is too long'),
    validate,
  ],
  updateChannel
);
router.post(
  '/:channelId/post',
  [
    param('channelId').isUUID().withMessage('channelId must be a valid id'),
    body('message').optional().isString().trim().isLength({ max: 4000 }).withMessage('message is too long'),
    validate,
  ],
  postUpdate
);
router.get('/:channelId/analytics',           [param('channelId').isUUID().withMessage('channelId must be a valid id'), validate], getChannelAnalytics);

module.exports = router;
