// src/controllers/contactController.js
const prisma  = require('../config/database');
const { AppError, ValidationError } = require('../utils/errors');
const { success, paginated } = require('../utils/response');
const { blockContact, unblockContact, muteChat, unmuteChat, getContactInfo, getProfilePicture } = require('../whatsapp/engine');
const logger  = require('../config/logger');

// ── LIST CONTACTS ─────────────────────────────────────────────
async function listContacts(req, res, next) {
  try {
    const page   = parseInt(req.query.page)  || 1;
    const limit  = parseInt(req.query.limit) || 25;
    const skip   = (page - 1) * limit;
    const search = req.query.search;
    const label  = req.query.label;

    const where = {
      tenantId: req.tenantId,
      ...(label && label !== 'all' && { label }),
    };

    if (search) {
      where.OR = [
        { name:        { contains: search, mode: 'insensitive' } },
        { phoneNumber: { contains: search } },
      ];
    }

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true, waJid: true, name: true, phoneNumber: true,
          label: true, notes: true, isBlocked: true, isMuted: true,
          aiEnabled: true, profilePicUrl: true, tags: true,
          lastMessageAt: true, messageCount: true, createdAt: true,
        },
      }),
      prisma.contact.count({ where }),
    ]);

    return paginated(res, contacts, total, page, limit);
  } catch (err) {
    next(err);
  }
}

// ── GET CONTACT ───────────────────────────────────────────────
async function getContact(req, res, next) {
  try {
    const { contactId } = req.params;

    const contact = await prisma.contact.findFirst({
      where: { id: contactId, tenantId: req.tenantId },
    });
    if (!contact) return next(new AppError('Contact not found', 404));

    return success(res, { contact });
  } catch (err) {
    next(err);
  }
}

// ── CREATE CONTACT ────────────────────────────────────────────
async function createContact(req, res, next) {
  try {
    const { name, phoneNumber, label, notes, tags } = req.body;
    if (!phoneNumber) return next(new ValidationError('Phone number is required'));

    const phone  = phoneNumber.replace(/\D/g, '');
    const waJid  = `${phone}@s.whatsapp.net`;

    const existing = await prisma.contact.findUnique({
      where: { tenantId_waJid: { tenantId: req.tenantId, waJid } },
    });
    if (existing) return next(new AppError('Contact already exists', 409));

    const contact = await prisma.contact.create({
      data: {
        tenantId: req.tenantId,
        waJid,
        phoneNumber: phone,
        name: name || null,
        label: label || 'none',
        notes: notes || null,
        tags: tags || [],
      },
    });

    return success(res, { contact }, 'Contact created', 201);
  } catch (err) {
    next(err);
  }
}

// ── UPDATE CONTACT ────────────────────────────────────────────
async function updateContact(req, res, next) {
  try {
    const { contactId } = req.params;
    const { name, label, notes, tags, customFields } = req.body;

    const contact = await prisma.contact.findFirst({ where: { id: contactId, tenantId: req.tenantId } });
    if (!contact) return next(new AppError('Contact not found', 404));

    const updated = await prisma.contact.update({
      where: { id: contactId },
      data: {
        ...(name         !== undefined && { name }),
        ...(label        !== undefined && { label }),
        ...(notes        !== undefined && { notes }),
        ...(tags         !== undefined && { tags }),
        ...(customFields !== undefined && { customFields }),
      },
    });

    return success(res, { contact: updated }, 'Contact updated');
  } catch (err) {
    next(err);
  }
}

// ── DELETE CONTACT ────────────────────────────────────────────
async function deleteContact(req, res, next) {
  try {
    const { contactId } = req.params;

    const contact = await prisma.contact.findFirst({ where: { id: contactId, tenantId: req.tenantId } });
    if (!contact) return next(new AppError('Contact not found', 404));

    await prisma.contact.delete({ where: { id: contactId } });
    return success(res, {}, 'Contact deleted');
  } catch (err) {
    next(err);
  }
}

// ── BLOCK CONTACT ─────────────────────────────────────────────
async function blockContactCtrl(req, res, next) {
  try {
    const { contactId } = req.params;

    const contact = await prisma.contact.findFirst({ where: { id: contactId, tenantId: req.tenantId } });
    if (!contact) return next(new AppError('Contact not found', 404));

    if (contact.numberId) {
      await blockContact(contact.numberId, contact.waJid).catch(() => {});
    }

    await prisma.contact.update({ where: { id: contactId }, data: { isBlocked: true, aiEnabled: false } });
    return success(res, {}, 'Contact blocked');
  } catch (err) {
    next(err);
  }
}

// ── UNBLOCK CONTACT ───────────────────────────────────────────
async function unblockContactCtrl(req, res, next) {
  try {
    const { contactId } = req.params;

    const contact = await prisma.contact.findFirst({ where: { id: contactId, tenantId: req.tenantId } });
    if (!contact) return next(new AppError('Contact not found', 404));

    if (contact.numberId) {
      await unblockContact(contact.numberId, contact.waJid).catch(() => {});
    }

    await prisma.contact.update({ where: { id: contactId }, data: { isBlocked: false } });
    return success(res, {}, 'Contact unblocked');
  } catch (err) {
    next(err);
  }
}

// ── MUTE / UNMUTE ─────────────────────────────────────────────
async function muteChatCtrl(req, res, next) {
  try {
    const { contactId } = req.params;
    const { mute } = req.body;

    const contact = await prisma.contact.findFirst({ where: { id: contactId, tenantId: req.tenantId } });
    if (!contact) return next(new AppError('Contact not found', 404));

    if (contact.numberId) {
      if (mute) {
        const unmuteDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
        await muteChat(contact.numberId, contact.waJid, unmuteDate).catch(() => {});
      } else {
        await unmuteChat(contact.numberId, contact.waJid).catch(() => {});
      }
    }

    await prisma.contact.update({ where: { id: contactId }, data: { isMuted: Boolean(mute) } });
    return success(res, {}, `Contact ${mute ? 'muted' : 'unmuted'}`);
  } catch (err) {
    next(err);
  }
}

// ── FETCH WA PROFILE PIC ──────────────────────────────────────
async function fetchProfilePic(req, res, next) {
  try {
    const { contactId } = req.params;

    const contact = await prisma.contact.findFirst({
      where: { id: contactId, tenantId: req.tenantId },
      include: { number: true },
    });
    if (!contact) return next(new AppError('Contact not found', 404));
    if (!contact.numberId) return next(new AppError('No number linked to this contact', 400));

    const picUrl = await getProfilePicture(contact.numberId, contact.waJid);

    if (picUrl) {
      await prisma.contact.update({ where: { id: contactId }, data: { profilePicUrl: picUrl } });
    }

    return success(res, { profilePicUrl: picUrl || null });
  } catch (err) {
    next(err);
  }
}

// ── EXPORT CONTACTS CSV ───────────────────────────────────────
async function exportContacts(req, res, next) {
  try {
    const contacts = await prisma.contact.findMany({
      where: { tenantId: req.tenantId },
      select: { name: true, phoneNumber: true, label: true, notes: true, lastMessageAt: true },
    });

    const header = 'Name,Phone,Label,Notes,LastMessage';
    const rows = contacts.map(c => [
      `"${(c.name || '').replace(/"/g, '""')}"`,
      c.phoneNumber,
      c.label,
      `"${(c.notes || '').replace(/"/g, '""')}"`,
      c.lastMessageAt ? c.lastMessageAt.toISOString() : '',
    ].join(','));

    const csv = [header, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
    return res.send(csv);
  } catch (err) {
    next(err);
  }
}

// ── IMPORT CONTACTS CSV ───────────────────────────────────────
async function importContacts(req, res, next) {
  try {
    if (!req.file) return next(new ValidationError('CSV file is required'));

    const csv  = req.file.buffer.toString('utf8');
    const rows = csv.split('\n').slice(1); // skip header
    let imported = 0;
    let skipped  = 0;

    for (const row of rows) {
      const cols = row.split(',');
      const name  = cols[0]?.replace(/"/g, '').trim();
      const phone = cols[1]?.replace(/\D/g, '').trim();
      if (!phone) { skipped++; continue; }

      const waJid = `${phone}@s.whatsapp.net`;

      await prisma.contact.upsert({
        where: { tenantId_waJid: { tenantId: req.tenantId, waJid } },
        create: {
          tenantId: req.tenantId,
          waJid,
          phoneNumber: phone,
          name: name || null,
          label: cols[2]?.trim() || 'none',
          notes: cols[3]?.replace(/"/g, '').trim() || null,
        },
        update: {
          ...(name && { name }),
        },
      }).then(() => imported++).catch(() => { skipped++; });
    }

    return success(res, { imported, skipped }, `Import complete: ${imported} contacts added/updated`);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listContacts, getContact, createContact, updateContact, deleteContact,
  blockContactCtrl, unblockContactCtrl, muteChatCtrl, fetchProfilePic,
  exportContacts, importContacts,
};
