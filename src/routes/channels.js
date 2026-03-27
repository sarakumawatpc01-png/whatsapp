// src/routes/channels.js
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const {
  listChannels, getChannel, createChannel,
  updateChannel, postUpdate, getChannelAnalytics,
} = require('../controllers/channelController');

router.use(protect);

router.get('/',                               listChannels);
router.post('/',                              createChannel);
router.get('/:channelId',                     getChannel);
router.patch('/:channelId',                   updateChannel);
router.post('/:channelId/post',               postUpdate);
router.get('/:channelId/analytics',           getChannelAnalytics);

module.exports = router;
