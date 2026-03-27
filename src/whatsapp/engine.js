// src/whatsapp/engine.js
// ─────────────────────────────────────────────────────────────
// WaizAI WhatsApp Engine — Abstraction over whatsapp-web.js
// ALL whatsapp-web.js calls happen ONLY in this file and its
// sub-modules. Nothing else in the codebase touches WAWebJS directly.
// ─────────────────────────────────────────────────────────────

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const prisma = require('../config/database');
const logger = require('../config/logger');
const { getSocketIO } = require('../socket/socketManager');
const { handleIncomingMessage } = require('./messageHandler');
const { cacheSet, cacheGet } = require('../config/redis');

// Map of numberId → WAWebJS Client instance
const activeSessions = new Map();

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

  const sessionDir = path.join(process.env.WA_SESSION_DIR || './sessions', tenantId, numberId);
  fs.mkdirSync(sessionDir, { recursive: true });

  logger.info(`Creating WA session for number: ${numberId} (tenant: ${tenantId})`);

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: numberId,
      dataPath: sessionDir,
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
      ],
    },
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
  });

  // ── QR CODE ───────────────────────────────────────────────
  client.on('qr', async (qr) => {
    logger.info(`QR generated for ${numberId}`);
    try {
      const qrDataUrl = await qrcode.toDataURL(qr);
      await prisma.tenantNumber.update({
        where: { id: numberId },
        data: { sessionStatus: 'qr_pending', qrCode: qrDataUrl },
      });
      // Push QR to frontend via socket
      const io = getSocketIO();
      io.to(`tenant:${tenantId}`).emit('wa:qr', { numberId, qr: qrDataUrl });
    } catch (err) {
      logger.error(`QR generation error for ${numberId}:`, err);
    }
  });

  // ── READY ─────────────────────────────────────────────────
  client.on('ready', async () => {
    logger.info(`✅ WhatsApp ready for ${numberId}`);
    const info = client.info;
    await prisma.tenantNumber.update({
      where: { id: numberId },
      data: {
        sessionStatus: 'connected',
        phoneNumber: info?.wid?.user ? `+${info.wid.user}` : undefined,
        qrCode: null,
        lastConnectedAt: new Date(),
      },
    });
    const io = getSocketIO();
    io.to(`tenant:${tenantId}`).emit('wa:ready', { numberId, phone: info?.wid?.user });
  });

  // ── INCOMING MESSAGE ──────────────────────────────────────
  client.on('message', async (msg) => {
    // Skip status messages
    if (msg.isStatus) return;
    await handleIncomingMessage(client, msg, numberId, tenantId);
  });

  // ── MESSAGE CREATE (outbound) ─────────────────────────────
  client.on('message_create', async (msg) => {
    if (!msg.fromMe) return;
    // Log outbound messages (manually sent from WA phone)
    try {
      const contact = await getOrCreateContact(tenantId, numberId, msg.to);
      await prisma.message.create({
        data: {
          tenantId, numberId, contactId: contact?.id,
          waMessageId: msg.id.id,
          fromJid: msg.from, toJid: msg.to,
          body: msg.body, type: msg.type,
          direction: 'outbound', aiSent: false,
          timestamp: new Date(msg.timestamp * 1000),
        },
      });
    } catch (_) {}
  });

  // ── DISCONNECTED ──────────────────────────────────────────
  client.on('disconnected', async (reason) => {
    logger.warn(`WA disconnected for ${numberId}: ${reason}`);
    activeSessions.delete(numberId);
    await prisma.tenantNumber.update({
      where: { id: numberId },
      data: { sessionStatus: 'disconnected' },
    });
    const io = getSocketIO();
    io.to(`tenant:${tenantId}`).emit('wa:disconnected', { numberId, reason });
  });

  // ── AUTH FAILURE ──────────────────────────────────────────
  client.on('auth_failure', async (msg) => {
    logger.error(`Auth failure for ${numberId}: ${msg}`);
    activeSessions.delete(numberId);
    await prisma.tenantNumber.update({
      where: { id: numberId },
      data: { sessionStatus: 'disconnected' },
    });
  });

  activeSessions.set(numberId, client);
  client.initialize();
  return client;
}

// ── DESTROY SESSION ───────────────────────────────────────────
async function destroySession(numberId) {
  const client = activeSessions.get(numberId);
  if (!client) return;
  try {
    await client.destroy();
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
  const client = activeSessions.get(numberId);
  if (!client) return 'disconnected';
  return client.info ? 'connected' : 'connecting';
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
