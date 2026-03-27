// src/routes/groups.js
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const {
  listGroups, getGroup, createGroup, updateGroupInfo,
  updateGroupSettings, addMembers, removeMember,
  promoteAdmin, demoteAdmin, getInviteLink, joinByInvite,
  leaveGroup, syncGroups,
} = require('../controllers/groupController');

router.use(protect);

router.get('/',                               listGroups);
router.post('/',                              createGroup);
router.post('/sync',                          syncGroups);
router.post('/join',                          joinByInvite);
router.get('/:groupId',                       getGroup);
router.patch('/:groupId/info',                updateGroupInfo);
router.patch('/:groupId/settings',            updateGroupSettings);
router.post('/:groupId/members',              addMembers);
router.delete('/:groupId/members/:jid',       removeMember);
router.post('/:groupId/members/:jid/promote', promoteAdmin);
router.post('/:groupId/members/:jid/demote',  demoteAdmin);
router.get('/:groupId/invite-link',           getInviteLink);
router.post('/:groupId/leave',                leaveGroup);

module.exports = router;
