const prisma = require('../config/database');
const { normalizeToJid } = require('./jid');

async function getOrCreateContact(tenantId, numberId, jid) {
  const normalizedJid = normalizeToJid(jid);
  const phone = String(normalizedJid || '')
    .replace('@s.whatsapp.net', '')
    .replace('@c.us', '')
    .replace('@g.us', '');

  let contact = await prisma.contact.findUnique({ where: { tenantId_waJid: { tenantId, waJid: normalizedJid } } });
  if (!contact) {
    contact = await prisma.contact.create({
      data: { tenantId, numberId, waJid: normalizedJid, phoneNumber: phone },
    });
  }
  return contact;
}

module.exports = { getOrCreateContact };
