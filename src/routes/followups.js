// src/routes/followups.js
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const {
  listSequences, getSequence, createSequence,
  updateSequence, deleteSequence, toggleSequence,
  enrollContact, getEnrollments,
} = require('../controllers/followupController');

router.use(protect);

router.get('/',                               listSequences);
router.post('/',                              createSequence);
router.get('/enrollments',                    getEnrollments);
router.get('/:sequenceId',                    getSequence);
router.patch('/:sequenceId',                  updateSequence);
router.delete('/:sequenceId',                 deleteSequence);
router.post('/:sequenceId/toggle',            toggleSequence);
router.post('/:sequenceId/enroll',            enrollContact);

module.exports = router;
