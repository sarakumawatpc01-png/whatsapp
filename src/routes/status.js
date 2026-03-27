// src/routes/status.js
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const {
  listStatusPosts, createStatusPost,
  deleteStatusPost, scheduleStatusPost,
} = require('../controllers/statusController');

router.use(protect);

router.get('/',               listStatusPosts);
router.post('/',              createStatusPost);
router.post('/schedule',      scheduleStatusPost);
router.delete('/:statusId',   deleteStatusPost);

module.exports = router;
