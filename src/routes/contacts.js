// src/routes/contacts.js
const router = require('express').Router();
const { body, param, query } = require('express-validator');
const { protect } = require('../middleware/auth');
const { validate } = require('../utils/requestValidation');
const {
  listContacts, getContact, createContact,
  updateContact, deleteContact,
  blockContactCtrl, unblockContactCtrl, muteChatCtrl,
  fetchProfilePic, exportContacts, importContacts,
} = require('../controllers/contactController');
const { uploadSingle } = require('../services/uploadService');

router.use(protect);

router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    query('search').optional().isString().trim().isLength({ max: 120 }).withMessage('search is too long'),
    query('label').optional().isString().trim().isLength({ max: 50 }).withMessage('label is too long'),
    validate,
  ],
  listContacts
);
router.post(
  '/',
  [
    body('phoneNumber').isString().trim().isLength({ min: 7, max: 20 }).withMessage('phoneNumber is required'),
    body('name').optional().isString().trim().isLength({ max: 120 }).withMessage('name is too long'),
    body('label').optional().isString().trim().isLength({ max: 50 }).withMessage('label is too long'),
    body('notes').optional().isString().isLength({ max: 5000 }).withMessage('notes is too long'),
    body('tags').optional().isArray({ max: 50 }).withMessage('tags must be an array with max 50 entries'),
    body('tags.*').optional().isString().trim().isLength({ max: 50 }).withMessage('tag is too long'),
    validate,
  ],
  createContact
);
router.get('/export',                 exportContacts);
router.post('/import',                uploadSingle('file'), importContacts);
router.get('/:contactId',             [param('contactId').isUUID().withMessage('contactId must be a valid id'), validate], getContact);
router.patch(
  '/:contactId',
  [
    param('contactId').isUUID().withMessage('contactId must be a valid id'),
    body('name').optional().isString().trim().isLength({ max: 120 }).withMessage('name is too long'),
    body('label').optional().isString().trim().isLength({ max: 50 }).withMessage('label is too long'),
    body('notes').optional().isString().isLength({ max: 5000 }).withMessage('notes is too long'),
    body('tags').optional().isArray({ max: 50 }).withMessage('tags must be an array with max 50 entries'),
    body('tags.*').optional().isString().trim().isLength({ max: 50 }).withMessage('tag is too long'),
    body('customFields').optional().isObject().withMessage('customFields must be an object'),
    validate,
  ],
  updateContact
);
router.delete('/:contactId',          [param('contactId').isUUID().withMessage('contactId must be a valid id'), validate], deleteContact);
router.post('/:contactId/block',      [param('contactId').isUUID().withMessage('contactId must be a valid id'), validate], blockContactCtrl);
router.post('/:contactId/unblock',    [param('contactId').isUUID().withMessage('contactId must be a valid id'), validate], unblockContactCtrl);
router.post(
  '/:contactId/mute',
  [
    param('contactId').isUUID().withMessage('contactId must be a valid id'),
    body('mute').isBoolean().withMessage('mute must be boolean'),
    validate,
  ],
  muteChatCtrl
);
router.post('/:contactId/profile-pic', [param('contactId').isUUID().withMessage('contactId must be a valid id'), validate], fetchProfilePic);

module.exports = router;
