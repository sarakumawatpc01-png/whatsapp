// src/controllers/groupController.js
const prisma  = require('../config/database');
const { AppError, ValidationError } = require('../utils/errors');
const { success, paginated } = require('../utils/response');
const logger  = require('../config/logger');
const {
  createGroup: waCreateGroup,
  getGroupInviteCode,
  joinGroupByInvite,
  updateGroupSubject,
  updateGroupDescription,
  setGroupPicture,
  addGroupParticipants,
  removeGroupParticipant,
  promoteGroupParticipant,
  demoteGroupParticipant,
  updateGroupSettings,
  leaveGroup: waLeaveGroup,
  getGroupMetadata,
  getSession,
} = require('../whatsapp/engine');

// ── LIST GROUPS ────────────────────────────────────────────────
async function listGroups(req, res, next) {
  try {
    const { numberId } = req.query;
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip  = (page - 1) * limit;

    const where = { tenantId: req.tenantId };
    if (numberId) where.numberId = numberId;

    const [groups, total] = await Promise.all([
      prisma.wAGroup.findMany({
        where,
        skip,
        take: limit,
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.wAGroup.count({ where }),
    ]);

    return paginated(res, groups, total, page, limit);
  } catch (err) {
    next(err);
  }
}

// ── GET GROUP ──────────────────────────────────────────────────
async function getGroup(req, res, next) {
  try {
    const group = await prisma.wAGroup.findFirst({
      where: { id: req.params.groupId, tenantId: req.tenantId },
    });
    if (!group) return next(new AppError('Group not found', 404));
    return success(res, { group });
  } catch (err) {
    next(err);
  }
}

// ── CREATE GROUP ───────────────────────────────────────────────
async function createGroup(req, res, next) {
  try {
    const { numberId, name, participants = [] } = req.body;
    if (!numberId || !name) return next(new ValidationError('numberId and name are required'));

    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId: req.tenantId },
    });
    if (!number) return next(new AppError('Number not found', 404));
    if (number.sessionStatus !== 'connected') {
      return next(new AppError('WhatsApp number is not connected', 400));
    }

    const result = await waCreateGroup(numberId, name, participants);

    const group = await prisma.wAGroup.create({
      data: {
        tenantId: req.tenantId,
        numberId,
        groupJid: result.gid._serialized,
        name,
        memberCount: participants.length + 1,
        membersJson: participants.map(p => ({ id: p, isAdmin: false })),
        isAdmin: true,
      },
    });

    return success(res, { group }, 'Group created', 201);
  } catch (err) {
    next(err);
  }
}

// ── UPDATE GROUP INFO ──────────────────────────────────────────
async function updateGroupInfo(req, res, next) {
  try {
    const { groupId } = req.params;
    const { name, description } = req.body;

    const group = await prisma.wAGroup.findFirst({
      where: { id: groupId, tenantId: req.tenantId },
    });
    if (!group) return next(new AppError('Group not found', 404));

    if (name) {
      await updateGroupSubject(group.numberId, group.groupJid, name);
    }
    if (description !== undefined) {
      await updateGroupDescription(group.numberId, group.groupJid, description);
    }

    const updated = await prisma.wAGroup.update({
      where: { id: groupId },
      data: {
        ...(name        !== undefined && { name }),
        ...(description !== undefined && { description }),
      },
    });

    return success(res, { group: updated }, 'Group info updated');
  } catch (err) {
    next(err);
  }
}

// ── UPDATE GROUP SETTINGS ──────────────────────────────────────
async function updateGroupSettings(req, res, next) {
  try {
    const { groupId } = req.params;
    const { messageSendPermission, infoEditPermission } = req.body;

    const group = await prisma.wAGroup.findFirst({
      where: { id: groupId, tenantId: req.tenantId },
    });
    if (!group) return next(new AppError('Group not found', 404));
    if (!group.isAdmin) return next(new AppError('You must be an admin to change group settings', 403));

    // messageSendPermission: 'all' | 'admins_only'
    // infoEditPermission:    'all' | 'admins_only'
    if (messageSendPermission) {
      await updateGroupSettings(group.numberId, group.groupJid, {
        messagesAdminsOnly: messageSendPermission === 'admins_only',
      });
    }
    if (infoEditPermission) {
      await updateGroupSettings(group.numberId, group.groupJid, {
        infoAdminsOnly: infoEditPermission === 'admins_only',
      });
    }

    const newSettings = {
      ...(group.settingsJson || {}),
      ...(messageSendPermission && { messageSendPermission }),
      ...(infoEditPermission    && { infoEditPermission }),
    };

    const updated = await prisma.wAGroup.update({
      where: { id: groupId },
      data: { settingsJson: newSettings },
    });

    return success(res, { group: updated }, 'Group settings updated');
  } catch (err) {
    next(err);
  }
}

// ── ADD MEMBERS ────────────────────────────────────────────────
async function addMembers(req, res, next) {
  try {
    const { groupId } = req.params;
    const { jids } = req.body; // array of WhatsApp JIDs

    if (!Array.isArray(jids) || jids.length === 0) {
      return next(new ValidationError('jids array is required'));
    }

    const group = await prisma.wAGroup.findFirst({
      where: { id: groupId, tenantId: req.tenantId },
    });
    if (!group) return next(new AppError('Group not found', 404));
    if (!group.isAdmin) return next(new AppError('You must be an admin to add members', 403));

    await addGroupParticipants(group.numberId, group.groupJid, jids);

    const currentMembers = Array.isArray(group.membersJson) ? group.membersJson : [];
    const newMembers = jids.map(jid => ({ id: jid, isAdmin: false }));
    const updatedMembers = [...currentMembers, ...newMembers];

    await prisma.wAGroup.update({
      where: { id: groupId },
      data: { membersJson: updatedMembers, memberCount: updatedMembers.length },
    });

    return success(res, {}, `${jids.length} member(s) added`);
  } catch (err) {
    next(err);
  }
}

// ── REMOVE MEMBER ──────────────────────────────────────────────
async function removeMember(req, res, next) {
  try {
    const { groupId, jid } = req.params;

    const group = await prisma.wAGroup.findFirst({
      where: { id: groupId, tenantId: req.tenantId },
    });
    if (!group) return next(new AppError('Group not found', 404));
    if (!group.isAdmin) return next(new AppError('You must be an admin to remove members', 403));

    await removeGroupParticipant(group.numberId, group.groupJid, jid);

    const updatedMembers = (Array.isArray(group.membersJson) ? group.membersJson : [])
      .filter(m => m.id !== jid);

    await prisma.wAGroup.update({
      where: { id: groupId },
      data: { membersJson: updatedMembers, memberCount: updatedMembers.length },
    });

    return success(res, {}, 'Member removed');
  } catch (err) {
    next(err);
  }
}

// ── PROMOTE ADMIN ──────────────────────────────────────────────
async function promoteAdmin(req, res, next) {
  try {
    const { groupId, jid } = req.params;

    const group = await prisma.wAGroup.findFirst({
      where: { id: groupId, tenantId: req.tenantId },
    });
    if (!group) return next(new AppError('Group not found', 404));
    if (!group.isAdmin) return next(new AppError('You must be an admin to promote members', 403));

    await promoteGroupParticipant(group.numberId, group.groupJid, jid);

    const updatedMembers = (Array.isArray(group.membersJson) ? group.membersJson : [])
      .map(m => m.id === jid ? { ...m, isAdmin: true } : m);

    await prisma.wAGroup.update({ where: { id: groupId }, data: { membersJson: updatedMembers } });

    return success(res, {}, 'Member promoted to admin');
  } catch (err) {
    next(err);
  }
}

// ── DEMOTE ADMIN ───────────────────────────────────────────────
async function demoteAdmin(req, res, next) {
  try {
    const { groupId, jid } = req.params;

    const group = await prisma.wAGroup.findFirst({
      where: { id: groupId, tenantId: req.tenantId },
    });
    if (!group) return next(new AppError('Group not found', 404));
    if (!group.isAdmin) return next(new AppError('You must be an admin to demote members', 403));

    await demoteGroupParticipant(group.numberId, group.groupJid, jid);

    const updatedMembers = (Array.isArray(group.membersJson) ? group.membersJson : [])
      .map(m => m.id === jid ? { ...m, isAdmin: false } : m);

    await prisma.wAGroup.update({ where: { id: groupId }, data: { membersJson: updatedMembers } });

    return success(res, {}, 'Admin demoted');
  } catch (err) {
    next(err);
  }
}

// ── GET INVITE LINK ────────────────────────────────────────────
async function getInviteLink(req, res, next) {
  try {
    const group = await prisma.wAGroup.findFirst({
      where: { id: req.params.groupId, tenantId: req.tenantId },
    });
    if (!group) return next(new AppError('Group not found', 404));
    if (!group.isAdmin) return next(new AppError('You must be an admin to get the invite link', 403));

    const code = await getGroupInviteCode(group.numberId, group.groupJid);
    const inviteLink = `https://chat.whatsapp.com/${code}`;

    await prisma.wAGroup.update({ where: { id: group.id }, data: { inviteCode: code } });

    return success(res, { inviteLink, code });
  } catch (err) {
    next(err);
  }
}

// ── JOIN BY INVITE ─────────────────────────────────────────────
async function joinByInvite(req, res, next) {
  try {
    const { numberId, inviteCode } = req.body;
    if (!numberId || !inviteCode) {
      return next(new ValidationError('numberId and inviteCode are required'));
    }

    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId: req.tenantId },
    });
    if (!number) return next(new AppError('Number not found', 404));

    const result = await joinGroupByInvite(numberId, inviteCode);

    return success(res, { groupJid: result }, 'Joined group successfully');
  } catch (err) {
    next(err);
  }
}

// ── LEAVE GROUP ────────────────────────────────────────────────
async function leaveGroup(req, res, next) {
  try {
    const group = await prisma.wAGroup.findFirst({
      where: { id: req.params.groupId, tenantId: req.tenantId },
    });
    if (!group) return next(new AppError('Group not found', 404));

    await waLeaveGroup(group.numberId, group.groupJid);
    await prisma.wAGroup.delete({ where: { id: group.id } });

    return success(res, {}, 'Left group');
  } catch (err) {
    next(err);
  }
}

// ── SYNC GROUPS ────────────────────────────────────────────────
// Fetches all groups from WhatsApp and syncs them to the database
async function syncGroups(req, res, next) {
  try {
    const { numberId } = req.body;
    if (!numberId) return next(new ValidationError('numberId is required'));

    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId: req.tenantId },
    });
    if (!number) return next(new AppError('Number not found', 404));
    if (number.sessionStatus !== 'connected') {
      return next(new AppError('WhatsApp number is not connected', 400));
    }

    const session = getSession(numberId);
    if (!session) return next(new AppError('Session not active', 400));

    const chats = await session.getChats();
    const groupChats = chats.filter(c => c.isGroup);

    let synced = 0;
    for (const chat of groupChats) {
      try {
        await prisma.wAGroup.upsert({
          where: { numberId_groupJid: { numberId, groupJid: chat.id._serialized } },
          create: {
            tenantId: req.tenantId,
            numberId,
            groupJid: chat.id._serialized,
            name: chat.name,
            description: chat.description || null,
            memberCount: chat.participants?.length || 0,
            membersJson: (chat.participants || []).map(p => ({
              id: p.id._serialized,
              isAdmin: p.isAdmin || p.isSuperAdmin,
            })),
            isAdmin: chat.isAdmin || chat.isSuperAdmin,
          },
          update: {
            name: chat.name,
            description: chat.description || null,
            memberCount: chat.participants?.length || 0,
            membersJson: (chat.participants || []).map(p => ({
              id: p.id._serialized,
              isAdmin: p.isAdmin || p.isSuperAdmin,
            })),
            isAdmin: chat.isAdmin || chat.isSuperAdmin,
          },
        });
        synced++;
      } catch (e) {
        logger.warn(`Failed to sync group ${chat.id._serialized}:`, e.message);
      }
    }

    return success(res, { synced }, `Synced ${synced} groups`);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listGroups, getGroup, createGroup, updateGroupInfo,
  updateGroupSettings, addMembers, removeMember,
  promoteAdmin, demoteAdmin, getInviteLink,
  joinByInvite, leaveGroup, syncGroups,
};
