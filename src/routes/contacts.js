// src/routes/contacts.js
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const {
  listContacts, getContact, createContact,
  updateContact, deleteContact,
  blockContactCtrl, unblockContactCtrl, muteChatCtrl,
  fetchProfilePic, exportContacts, importContacts,
} = require('../controllers/contactController');
const { uploadSingle } = require('../services/uploadService');

router.use(protect);

router.get('/',                       listContacts);
router.post('/',                      createContact);
router.get('/export',                 exportContacts);
router.post('/import',                uploadSingle('file'), importContacts);
router.get('/:contactId',             getContact);
router.patch('/:contactId',           updateContact);
router.delete('/:contactId',          deleteContact);
router.post('/:contactId/block',      blockContactCtrl);
router.post('/:contactId/unblock',    unblockContactCtrl);
router.post('/:contactId/mute',       muteChatCtrl);
router.post('/:contactId/profile-pic', fetchProfilePic);

module.exports = router;
