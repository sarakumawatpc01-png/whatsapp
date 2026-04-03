// src/routes/groups.js
const router = require('express').Router();
const { body, param, query } = require('express-validator');
const { protect } = require('../middleware/auth');
const { validate } = require('../utils/requestValidation');
const {
  listGroups, getGroup, createGroup, updateGroupInfo,
  updateGroupSettings, addMembers, removeMember,
  promoteAdmin, demoteAdmin, getInviteLink, joinByInvite,
  leaveGroup, syncGroups,
} = require('../controllers/groupController');

router.use(protect);

router.get(
  '/',
  [
    query('numberId').optional().isUUID().withMessage('numberId must be a valid id'),
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    validate,
  ],
  listGroups
);
router.post(
  '/',
  [
    body('numberId').isUUID().withMessage('numberId is required'),
    body('name').isString().trim().notEmpty().withMessage('name is required'),
    body('participants').optional().isArray({ max: 1024 }).withMessage('participants must be an array'),
    body('participants.*').optional().isString().trim().notEmpty().withMessage('participant jid is invalid'),
    validate,
  ],
  createGroup
);
router.post('/sync', [body('numberId').isUUID().withMessage('numberId is required'), validate], syncGroups);
router.post(
  '/join',
  [
    body('numberId').isUUID().withMessage('numberId is required'),
    body('inviteCode').isString().trim().notEmpty().withMessage('inviteCode is required'),
    validate,
  ],
  joinByInvite
);
router.get('/:groupId',                       [param('groupId').isUUID().withMessage('groupId must be a valid id'), validate], getGroup);
router.patch(
  '/:groupId/info',
  [
    param('groupId').isUUID().withMessage('groupId must be a valid id'),
    body('name').optional().isString().trim().isLength({ min: 1, max: 120 }).withMessage('name is invalid'),
    body('description').optional().isString().isLength({ max: 2000 }).withMessage('description is too long'),
    validate,
  ],
  updateGroupInfo
);
router.patch(
  '/:groupId/settings',
  [
    param('groupId').isUUID().withMessage('groupId must be a valid id'),
    body('messageSendPermission').optional().isIn(['admins', 'all']).withMessage('messageSendPermission is invalid'),
    body('infoEditPermission').optional().isIn(['admins', 'all']).withMessage('infoEditPermission is invalid'),
    validate,
  ],
  updateGroupSettings
);
router.post(
  '/:groupId/members',
  [
    param('groupId').isUUID().withMessage('groupId must be a valid id'),
    body('jids').isArray({ min: 1, max: 1024 }).withMessage('jids must be a non-empty array'),
    body('jids.*').isString().trim().notEmpty().withMessage('jid is invalid'),
    validate,
  ],
  addMembers
);
router.delete(
  '/:groupId/members/:jid',
  [
    param('groupId').isUUID().withMessage('groupId must be a valid id'),
    param('jid').isString().trim().notEmpty().withMessage('jid is required'),
    validate,
  ],
  removeMember
);
router.post(
  '/:groupId/members/:jid/promote',
  [
    param('groupId').isUUID().withMessage('groupId must be a valid id'),
    param('jid').isString().trim().notEmpty().withMessage('jid is required'),
    validate,
  ],
  promoteAdmin
);
router.post(
  '/:groupId/members/:jid/demote',
  [
    param('groupId').isUUID().withMessage('groupId must be a valid id'),
    param('jid').isString().trim().notEmpty().withMessage('jid is required'),
    validate,
  ],
  demoteAdmin
);
router.get('/:groupId/invite-link',           [param('groupId').isUUID().withMessage('groupId must be a valid id'), validate], getInviteLink);
router.post(
  '/:groupId/leave',
  [
    param('groupId').isUUID().withMessage('groupId must be a valid id'),
    body('numberId').optional().isUUID().withMessage('numberId must be a valid id'),
    validate,
  ],
  leaveGroup
);

module.exports = router;
