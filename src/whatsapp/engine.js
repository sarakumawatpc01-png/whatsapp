// src/whatsapp/engine.js
// ─────────────────────────────────────────────────────────────
// WaizAI WhatsApp Engine — Abstraction over Baileys
// ─────────────────────────────────────────────────────────────

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const prisma = require('../config/database');
const logger = require('../config/logger');
const { getSocketIO } = require('../socket/socketManager');

// Map of numberId → Baileys socket instance
const activeSessions = new Map();
const reconnectTimers = new Map();
const manualDisconnects = new Set();

// ── INIT ENGINE ──────────────────────────────────────────────
async function initWAEngine() {
  // On server start, reconnect all numbers that were previously connected
  const numbers = await prisma.tenantNumber.findMany({
    where: { sessionStatus: { in: ['connected', 'connecting'] } },
    include: { tenant: { select: { status: true } } },
  });

  logger.info(`Restoring ${numbers.length} WhatsApp sessions...`);

  for (const num of numbers) {
    if (num.tenant.status === 'active') {
      createSession(num.id, num.tenantId, num.phoneNumber);
    }
  }
}

// ── CREATE SESSION ────────────────────────────────────────────
async function createSession(numberId, tenantId, phoneLabel) {
  if (activeSessions.has(numberId)) {
    logger.warn(`Session already exists for numberId: ${numberId}`);
    return activeSessions.get(numberId);
  }

  const sessionDir = path.join(process.env.WA_SESSION_DIR || './whatsapp-auth-state', tenantId, numberId);
  fs.mkdirSync(sessionDir, { recursive: true });

  logger.info(`Creating WA session for number: ${numberId} (tenant: ${tenantId})`);

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: process.env.BAILEYS_LOG_LEVEL || 'error' }),
    printQRInTerminal: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      logger.info(`QR generated for ${numberId}`);
      try {
        const qrDataUrl = await qrcode.toDataURL(qr);
        await prisma.tenantNumber.update({
          where: { id: numberId },
          data: { sessionStatus: 'qr_pending', qrCode: qrDataUrl },
        });
        const io = getSocketIO();
        io.to(`tenant:${tenantId}`).emit('wa:qr', { numberId, qr: qrDataUrl });
      } catch (err) {
        logger.error(`QR generation error for ${numberId}:`, err);
      }
    }

    if (connection === 'open') {
      logger.info(`✅ WhatsApp ready for ${numberId}`);
      const user = sock.user?.id ? sock.user.id.split(':')[0] : null;
      await prisma.tenantNumber.update({
        where: { id: numberId },
        data: {
          sessionStatus: 'connected',
          phoneNumber: user ? `+${user}` : undefined,
          qrCode: null,
          lastConnectedAt: new Date(),
        },
      });
      const io = getSocketIO();
      io.to(`tenant:${tenantId}`).emit('wa:ready', { numberId, phone: user });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      logger.warn(`WA disconnected for ${numberId}: ${statusCode || 'unknown'}`);

      activeSessions.delete(numberId);
      await prisma.tenantNumber.update({
        where: { id: numberId },
        data: { sessionStatus: 'disconnected' },
      });
      const io = getSocketIO();
      io.to(`tenant:${tenantId}`).emit('wa:disconnected', { numberId, reason: statusCode || 'closed' });

      if (manualDisconnects.has(numberId)) {
        manualDisconnects.delete(numberId);
        return;
      }

      if (!isLoggedOut) {
        if (reconnectTimers.has(numberId)) clearTimeout(reconnectTimers.get(numberId));
        const timer = setTimeout(() => {
          reconnectTimers.delete(numberId);
          createSession(numberId, tenantId, phoneLabel).catch(err => {
            logger.error(`Auto-reconnect failed for ${numberId}:`, err.message);
          });
        }, Number(process.env.WA_RECONNECT_DELAY_MS || 3000));
        reconnectTimers.set(numberId, timer);
      }
    }
  });

  activeSessions.set(numberId, sock);
  return sock;
}

// ── DESTROY SESSION ───────────────────────────────────────────
async function destroySession(numberId) {
  const sock = activeSessions.get(numberId);
  if (!sock) return;
  manualDisconnects.add(numberId);
  if (reconnectTimers.has(numberId)) {
    clearTimeout(reconnectTimers.get(numberId));
    reconnectTimers.delete(numberId);
  }
  try {
    sock.end(new Error('Manual disconnect'));
  } catch (err) {
    logger.error(`Error destroying session ${numberId}:`, err);
  }
  activeSessions.delete(numberId);
}

// ── GET SESSION ───────────────────────────────────────────────
function getSession(numberId) {
  return activeSessions.get(numberId) || null;
}

// ── SEND TEXT MESSAGE ─────────────────────────────────────────
async function sendTextMessage(numberId, toJid, text, quotedMsgId = null) {
  const client = getSession(numberId);
  if (!client) throw new Error(`No active session for numberId: ${numberId}`);

  const options = {};
  if (quotedMsgId) {
    try {
      const quotedMsg = await client.getMessageById(quotedMsgId);
      if (quotedMsg) options.quotedMessageId = quotedMsg.id._serialized;
    } catch (_) {}
  }

  const result = await client.sendMessage(toJid, text, options);
  return result;
}

// ── SEND MEDIA ─────────────────────────────────────────────────
async function sendMediaMessage(numberId, toJid, mediaData, caption = '') {
  const client = getSession(numberId);
  if (!client) throw new Error(`No active session for numberId: ${numberId}`);

  const media = new MessageMedia(mediaData.mimetype, mediaData.base64, mediaData.filename);
  const result = await client.sendMessage(toJid, media, { caption });
  return result;
}

// ── SEND LOCATION ─────────────────────────────────────────────
async function sendLocation(numberId, toJid, lat, lng, name = '') {
  const client = getSession(numberId);
  if (!client) throw new Error(`No active session for numberId: ${numberId}`);
  const { Location } = require('whatsapp-web.js');
  const result = await client.sendMessage(toJid, new Location(lat, lng, name));
  return result;
}

// ── SEND CONTACT CARD ─────────────────────────────────────────
async function sendContactCard(numberId, toJid, contactPhone, contactName) {
  const client = getSession(numberId);
  if (!client) throw new Error(`No active session for numberId: ${numberId}`);
  const { Contact: WAContact } = require('whatsapp-web.js');
  const contacts = await client.getContacts();
  const contact = contacts.find(c => c.number === contactPhone.replace(/\D/g, ''));
  if (!contact) throw new Error('Contact not found in WhatsApp');
  const result = await client.sendMessage(toJid, contact);
  return result;
}

// ── SEND REACTION ─────────────────────────────────────────────
async function sendReaction(numberId, msgId, emoji) {
  const client = getSession(numberId);
  if (!client) throw new Error(`No active session for numberId: ${numberId}`);
  const msg = await client.getMessageById(msgId);
  if (!msg) throw new Error('Message not found');
  await msg.react(emoji);
}

// ── SEND POLL ─────────────────────────────────────────────────
async function sendPoll(numberId, toJid, question, options, allowMultiple = false) {
  const client = getSession(numberId);
  if (!client) throw new Error(`No active session for numberId: ${numberId}`);
  const { Poll } = require('whatsapp-web.js');
  const result = await client.sendMessage(toJid, new Poll(question, options, { allowMultipleAnswers: allowMultiple }));
  return result;
}

// ── SEND TYPING INDICATOR ─────────────────────────────────────
async function sendTyping(numberId, chatId, duration = 3000) {
  const client = getSession(numberId);
  if (!client) return;
  try {
    const chat = await client.getChatById(chatId);
    await chat.sendStateTyping();
    await new Promise(r => setTimeout(r, duration));
    await chat.clearState();
  } catch (err) {
    logger.debug(`Typing indicator error (non-fatal): ${err.message}`);
  }
}

// ── GET PROFILE PICTURE ───────────────────────────────────────
async function getProfilePicture(numberId, contactJid) {
  const client = getSession(numberId);
  if (!client) return null;
  try {
    return await client.getProfilePicUrl(contactJid);
  } catch (_) { return null; }
}

// ── BLOCK / UNBLOCK ────────────────────────────────────────────
async function blockContact(numberId, contactJid) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  const contact = await client.getContactById(contactJid);
  await contact.block();
}

async function unblockContact(numberId, contactJid) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  const contact = await client.getContactById(contactJid);
  await contact.unblock();
}

// ── MUTE / UNMUTE ─────────────────────────────────────────────
async function muteChat(numberId, chatJid, unmuteDate) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  const chat = await client.getChatById(chatJid);
  await chat.mute(unmuteDate);
}

async function unmuteChat(numberId, chatJid) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  const chat = await client.getChatById(chatJid);
  await chat.unmute();
}

// ── GROUPS ────────────────────────────────────────────────────
async function createGroup(numberId, name, participantJids) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  return await client.createGroup(name, participantJids);
}

async function getGroups(numberId) {
  const client = getSession(numberId);
  if (!client) return [];
  const chats = await client.getChats();
  return chats.filter(c => c.isGroup);
}

async function getGroupInviteCode(numberId, groupJid) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  const group = await client.getChatById(groupJid);
  return await group.getInviteCode();
}

async function joinGroupByInvite(numberId, inviteCode) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  return await client.acceptInvite(inviteCode);
}

async function addGroupParticipants(numberId, groupJid, participantJids) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  const group = await client.getChatById(groupJid);
  return await group.addParticipants(participantJids);
}

async function removeGroupParticipant(numberId, groupJid, participantJid) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  const group = await client.getChatById(groupJid);
  return await group.removeParticipants([participantJid]);
}

async function promoteParticipant(numberId, groupJid, participantJid) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  const group = await client.getChatById(groupJid);
  return await group.promoteParticipants([participantJid]);
}

async function demoteParticipant(numberId, groupJid, participantJid) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  const group = await client.getChatById(groupJid);
  return await group.demoteParticipants([participantJid]);
}

async function updateGroupSubject(numberId, groupJid, subject) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  const group = await client.getChatById(groupJid);
  await group.setSubject(subject);
}

async function updateGroupDescription(numberId, groupJid, description) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  const group = await client.getChatById(groupJid);
  await group.setDescription(description);
}

// ── STATUS ────────────────────────────────────────────────────
async function setStatus(numberId, statusText) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  await client.setStatus(statusText);
}

// ── CONTACT INFO ──────────────────────────────────────────────
async function getContactInfo(numberId, contactJid) {
  const client = getSession(numberId);
  if (!client) return null;
  try {
    const contact = await client.getContactById(contactJid);
    return {
      name: contact.pushname || contact.name,
      number: contact.number,
      about: contact.about,
      isBusiness: contact.isBusiness,
    };
  } catch (_) { return null; }
}

// ── SESSION STATUS ────────────────────────────────────────────
function getSessionStatus(numberId) {
  const sock = activeSessions.get(numberId);
  if (!sock) return 'disconnected';
  return sock.user ? 'connected' : 'connecting';
}

// ── HELPER: get or create contact ─────────────────────────────
async function getOrCreateContact(tenantId, numberId, jid) {
  const phone = jid.replace('@s.whatsapp.net', '').replace('@c.us', '');
  let contact = await prisma.contact.findUnique({ where: { tenantId_waJid: { tenantId, waJid: jid } } });
  if (!contact) {
    contact = await prisma.contact.create({
      data: { tenantId, numberId, waJid: jid, phoneNumber: phone },
    });
  }
  return contact;
}

module.exports = {
  initWAEngine, createSession, destroySession, getSession,
  sendTextMessage, sendMediaMessage, sendLocation, sendContactCard,
  sendReaction, sendPoll, sendTyping,
  getProfilePicture, blockContact, unblockContact,
  muteChat, unmuteChat, setStatus, getContactInfo,
  createGroup, getGroups, getGroupInviteCode, joinGroupByInvite,
  addGroupParticipants, removeGroupParticipant,
  promoteParticipant, demoteParticipant,
  updateGroupSubject, updateGroupDescription,
  getSessionStatus, getOrCreateContact,
};
