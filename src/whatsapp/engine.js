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
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const prisma = require('../config/database');
const logger = require('../config/logger');
const { getSocketIO } = require('../socket/socketManager');
const { handleIncomingMessage } = require('./messageHandler');
const { normalizeToJid } = require('./jid');
const { getOrCreateContact } = require('./contactStore');

// Map of numberId → Baileys socket instance
const activeSessions = new Map();
const reconnectTimers = new Map();
const manualDisconnects = new Set();
// 401/403/405 are treated as blocked-restriction signals for this deployment's WA Web handshake:
// 401/403 are standard authorization/forbidden responses and 405 was observed for blocked VPS egress.
const WA_IP_RESTRICTED_STATUS_CODES = new Set([401, 403, 405]);

function isIpRestrictedStatusCode(statusCode) {
  return Number.isFinite(statusCode) && WA_IP_RESTRICTED_STATUS_CODES.has(statusCode);
}

function parseDisconnectStatusCode(lastDisconnect) {
  const code = Number(
    lastDisconnect?.error?.output?.statusCode
    || lastDisconnect?.error?.data?.status
    || lastDisconnect?.error?.status
  );
  return Number.isNaN(code) ? null : code;
}

function parseProxyList() {
  const raw = process.env.WA_EGRESS_PROXY_URLS || '';
  const list = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...new Set(list)];
}

function getProxyState(numberId) {
  const proxies = parseProxyList();
  const state = { proxies, selectedProxy: null, selectedProxyIndex: -1 };
  if (!proxies.length) return state;

  const hints = [numberId, process.env.WA_EGRESS_PROXY_DEFAULT || '', process.env.WA_EGRESS_PROXY_URL || ''];
  for (const hint of hints) {
    const idx = proxies.findIndex((url) => url === hint);
    if (idx >= 0) {
      state.selectedProxy = proxies[idx];
      state.selectedProxyIndex = idx;
      return state;
    }
  }

  state.selectedProxy = proxies[0];
  state.selectedProxyIndex = 0;
  return state;
}

async function persistProxyChoice(numberId, proxyUrl) {
  if (!proxyUrl) return;
  await prisma.tenantNumber.update({
    where: { id: numberId },
    data: { sessionFilePath: proxyUrl },
  }).catch(() => {});
}

async function rotateProxy(numberId) {
  const proxies = parseProxyList();
  if (!proxies.length) return null;
  const row = await prisma.tenantNumber.findUnique({
    where: { id: numberId },
    select: { sessionFilePath: true },
  });
  const current = row?.sessionFilePath || null;
  const currentIndex = proxies.findIndex((url) => url === current);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % proxies.length : 0;
  const nextProxy = proxies[nextIndex];
  await persistProxyChoice(numberId, nextProxy);
  return nextProxy;
}

function buildFailureMetadata(statusCode, isLoggedOut, isManualDisconnect) {
  if (isManualDisconnect) {
    return {
      code: 'MANUAL_DISCONNECT',
      reason: 'Session disconnected by user action.',
      actionableMessage: null,
      blockedByIp: false,
      shouldAutoReconnect: false,
    };
  }

  if (isLoggedOut) {
    return {
      code: 'LOGGED_OUT',
      reason: 'Session logged out. Reconnect and scan a fresh QR code.',
      actionableMessage: null,
      blockedByIp: false,
      shouldAutoReconnect: false,
    };
  }

  if (isIpRestrictedStatusCode(statusCode)) {
    return {
      code: `WA_HTTP_${statusCode}`,
      reason: `WhatsApp Web endpoint rejected this server IP with HTTP ${statusCode}.`,
      actionableMessage: 'WhatsApp blocked this server IP; switch server/IP.',
      blockedByIp: true,
      shouldAutoReconnect: false,
    };
  }

  return {
    code: statusCode ? `WA_DISCONNECT_${statusCode}` : 'WA_DISCONNECT_UNKNOWN',
    reason: statusCode
      ? `WhatsApp connection closed (status ${statusCode}).`
      : 'WhatsApp connection closed unexpectedly.',
    actionableMessage: null,
    blockedByIp: false,
    shouldAutoReconnect: true,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getMessageContent(msg = {}) {
  return msg.message || msg;
}

function inferTypeFromBaileys(msg) {
  const content = getMessageContent(msg);
  if (content.conversation || content.extendedTextMessage) return 'text';
  if (content.imageMessage) return 'image';
  if (content.videoMessage) return 'video';
  if (content.audioMessage) return 'audio';
  if (content.documentMessage) return 'document';
  if (content.stickerMessage) return 'sticker';
  if (content.locationMessage) return 'location';
  if (content.contactMessage || content.contactsArrayMessage) return 'contact_card';
  if (content.pollCreationMessage || content.pollCreationMessageV2 || content.pollCreationMessageV3) return 'poll';
  if (content.reactionMessage) return 'reaction';
  return 'text';
}

function extractBodyFromBaileys(msg) {
  const content = getMessageContent(msg);
  return (
    content.conversation
    || content.extendedTextMessage?.text
    || content.imageMessage?.caption
    || content.videoMessage?.caption
    || content.documentMessage?.caption
    || content.locationMessage?.name
    || content.locationMessage?.address
    || content.reactionMessage?.text
    || ''
  );
}

function extractContextInfo(msg) {
  const content = getMessageContent(msg);
  return (
    content.extendedTextMessage?.contextInfo
    || content.imageMessage?.contextInfo
    || content.videoMessage?.contextInfo
    || content.documentMessage?.contextInfo
    || content.buttonsResponseMessage?.contextInfo
    || content.listResponseMessage?.contextInfo
    || null
  );
}

function mapBaileysToLegacyMessage(sock, msg) {
  const contextInfo = extractContextInfo(msg);
  const type = inferTypeFromBaileys(msg);
  const content = getMessageContent(msg);
  const remoteJid = msg?.key?.remoteJid;
  const mentionedJidList = contextInfo?.mentionedJid || [];
  const quotedStanzaID = contextInfo?.stanzaId || null;
  const notifyName = msg?.pushName || null;

  return {
    id: { id: msg?.key?.id },
    from: remoteJid,
    to: sock?.user?.id || null,
    body: extractBodyFromBaileys(msg),
    type,
    fromMe: Boolean(msg?.key?.fromMe),
    timestamp: Number(msg?.messageTimestamp || Math.floor(Date.now() / 1000)),
    hasMedia: ['image', 'video', 'audio', 'document', 'sticker'].includes(type),
    hasQuotedMsg: Boolean(contextInfo?.stanzaId),
    location: content.locationMessage
      ? {
          latitude: content.locationMessage.degreesLatitude,
          longitude: content.locationMessage.degreesLongitude,
          description: content.locationMessage.name || content.locationMessage.address || null,
        }
      : null,
    _data: {
      notifyName,
      mentionedJidList,
      quotedStanzaID,
    },
    notifyName,
    mentionedJidList,
    quotedStanzaID,
  };
}

// ── INIT ENGINE ──────────────────────────────────────────────
async function initWAEngine() {
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

  if (reconnectTimers.has(numberId)) {
    clearTimeout(reconnectTimers.get(numberId));
    reconnectTimers.delete(numberId);
  }

  const sessionDir = path.join(process.env.WA_SESSION_DIR || './whatsapp-auth-state', tenantId, numberId);
  fs.mkdirSync(sessionDir, { recursive: true });

  logger.info(`Creating WA session for number: ${numberId} (tenant: ${tenantId})`);

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const proxyState = getProxyState(numberId);
  const socketConfig = {
    auth: state,
    logger: pino({ level: process.env.BAILEYS_LOG_LEVEL || 'error' }),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
  };
  if (proxyState.selectedProxy) {
    socketConfig.fetchAgent = new HttpsProxyAgent(proxyState.selectedProxy);
  }
  const sock = makeWASocket(socketConfig);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, qr, lastDisconnect } = update;

    if (qr) {
      logger.info(`QR generated for ${numberId}`);
      try {
        const qrDataUrl = await qrcode.toDataURL(qr);
        await prisma.tenantNumber.update({
          where: { id: numberId },
          data: {
            sessionStatus: 'qr_pending',
            qrCode: qrDataUrl,
            lastFailureCode: null,
            lastFailureReason: null,
            lastFailureAt: null,
          },
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
      if (proxyState.selectedProxy) {
        await persistProxyChoice(numberId, proxyState.selectedProxy);
      }
      await prisma.tenantNumber.update({
        where: { id: numberId },
        data: {
          sessionStatus: 'connected',
          phoneNumber: user ? `+${user}` : undefined,
          qrCode: null,
          lastFailureCode: null,
          lastFailureReason: null,
          lastFailureAt: null,
          lastConnectedAt: new Date(),
        },
      });
      const io = getSocketIO();
      io.to(`tenant:${tenantId}`).emit('wa:ready', { numberId, phone: user });
    }

    if (connection === 'close') {
      const statusCode = parseDisconnectStatusCode(lastDisconnect);
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const isManualDisconnect = manualDisconnects.has(numberId);
      const failure = buildFailureMetadata(statusCode, isLoggedOut, isManualDisconnect);
      logger.warn(`WA disconnected for ${numberId}: ${statusCode || 'unknown'}`);

      activeSessions.delete(numberId);
      await prisma.tenantNumber.update({
        where: { id: numberId },
        data: {
          sessionStatus: 'disconnected',
          lastFailureCode: failure.code,
          lastFailureReason: failure.reason,
          lastFailureAt: new Date(),
        },
      }).catch(() => {});
      const io = getSocketIO();
      io.to(`tenant:${tenantId}`).emit('wa:disconnected', {
        numberId,
        reason: failure.reason,
        reasonCode: failure.code,
        statusCode: statusCode || 'closed',
        actionableMessage: failure.actionableMessage,
        blockedByIp: failure.blockedByIp,
      });

      if (isManualDisconnect) {
        manualDisconnects.delete(numberId);
        return;
      }

      if (failure.shouldAutoReconnect) {
        if (reconnectTimers.has(numberId)) clearTimeout(reconnectTimers.get(numberId));
        const timer = setTimeout(() => {
          reconnectTimers.delete(numberId);
          createSession(numberId, tenantId, phoneLabel).catch(err => {
            logger.error(`Auto-reconnect failed for ${numberId}:`, err.message);
          });
        }, Number(process.env.WA_RECONNECT_DELAY_MS || 3000));
        reconnectTimers.set(numberId, timer);
      } else if (failure.blockedByIp && proxyState.proxies.length > 1) {
        const timer = setTimeout(async () => {
          reconnectTimers.delete(numberId);
          const nextProxy = await rotateProxy(numberId).catch(() => null);
          logger.warn(`WA blocked for ${numberId}; rotating egress proxy to ${nextProxy || 'next'}`);
          createSession(numberId, tenantId, phoneLabel).catch(err => {
            logger.error(`Proxy-rotated reconnect failed for ${numberId}:`, err.message);
          });
        }, Number(process.env.WA_RECONNECT_DELAY_MS || 3000));
        reconnectTimers.set(numberId, timer);
      }
    }
  });

  // Step 3: incoming listener migration
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const raw of messages || []) {
      const remoteJid = raw?.key?.remoteJid;
      if (!remoteJid || remoteJid === 'status@broadcast') continue;
      if (raw?.key?.fromMe) continue;
      if (!raw?.message) continue;

      const mapped = mapBaileysToLegacyMessage(sock, raw);
      await handleIncomingMessage(sock, mapped, numberId, tenantId);
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

  const jid = normalizeToJid(toJid);
  let quoted;

  if (quotedMsgId) {
    const quotedDb = await prisma.message.findFirst({
      where: {
        numberId,
        OR: [{ waMessageId: quotedMsgId }, { id: quotedMsgId }],
      },
      select: { waMessageId: true, fromJid: true, toJid: true, direction: true },
    }).catch(() => null);

    if (quotedDb?.waMessageId) {
      const quotedJid = normalizeToJid(quotedDb.direction === 'inbound' ? quotedDb.fromJid : quotedDb.toJid);
      quoted = {
        key: {
          remoteJid: quotedJid,
          id: quotedDb.waMessageId,
          fromMe: quotedDb.direction === 'outbound',
        },
      };
    }
  }

  const result = await client.sendMessage(jid, { text: String(text || '') }, { ...(quoted ? { quoted } : {}) });
  return {
    id: { id: result?.key?.id || null },
    from: client.user?.id || null,
    to: jid,
    raw: result,
  };
}

// ── SEND MEDIA ─────────────────────────────────────────────────
async function sendMediaMessage(numberId, toJid, mediaData, caption = '') {
  const client = getSession(numberId);
  if (!client) throw new Error(`No active session for numberId: ${numberId}`);

  const jid = normalizeToJid(toJid);
  const buffer = Buffer.from(mediaData.base64, 'base64');
  const mimetype = mediaData.mimetype || '';
  const filename = mediaData.filename || 'file';

  let payload;
  if (mimetype.startsWith('image/')) {
    payload = { image: buffer, caption, mimetype };
  } else if (mimetype.startsWith('video/')) {
    payload = { video: buffer, caption, mimetype };
  } else if (mimetype.startsWith('audio/')) {
    payload = { audio: buffer, mimetype, ptt: false };
  } else {
    payload = { document: buffer, fileName: filename, mimetype, caption };
  }

  const result = await client.sendMessage(jid, payload);
  return {
    id: { id: result?.key?.id || null },
    from: client.user?.id || null,
    to: jid,
    raw: result,
  };
}

// ── SEND LOCATION ─────────────────────────────────────────────
async function sendLocation(numberId, toJid, lat, lng, name = '') {
  const client = getSession(numberId);
  if (!client) throw new Error(`No active session for numberId: ${numberId}`);

  const jid = normalizeToJid(toJid);
  const result = await client.sendMessage(jid, {
    location: {
      degreesLatitude: Number(lat),
      degreesLongitude: Number(lng),
      name: name || undefined,
    },
  });

  return {
    id: { id: result?.key?.id || null },
    from: client.user?.id || null,
    to: jid,
    raw: result,
  };
}

// ── SEND CONTACT CARD ─────────────────────────────────────────
async function sendContactCard(numberId, toJid, contactPhone, contactName) {
  const client = getSession(numberId);
  if (!client) throw new Error(`No active session for numberId: ${numberId}`);

  const jid = normalizeToJid(toJid);
  const phone = String(contactPhone || '').replace(/\D/g, '');
  const displayName = contactName || phone;

  const vcard = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${displayName}`,
    `TEL;type=CELL;type=VOICE;waid=${phone}:${phone}`,
    'END:VCARD',
  ].join('\n');

  const result = await client.sendMessage(jid, {
    contacts: {
      displayName,
      contacts: [{ vcard }],
    },
  });

  return {
    id: { id: result?.key?.id || null },
    from: client.user?.id || null,
    to: jid,
    raw: result,
  };
}

// ── SEND REACTION ─────────────────────────────────────────────
async function sendReaction(numberId, msgId, emoji) {
  const client = getSession(numberId);
  if (!client) throw new Error(`No active session for numberId: ${numberId}`);

  const target = await prisma.message.findFirst({
    where: {
      numberId,
      OR: [{ waMessageId: msgId }, { id: msgId }],
    },
    select: { waMessageId: true, fromJid: true, toJid: true, direction: true },
  });
  if (!target?.waMessageId) throw new Error('Message not found');

  const remoteJid = normalizeToJid(target.direction === 'inbound' ? target.fromJid : target.toJid);

  await client.sendMessage(remoteJid, {
    react: {
      text: emoji,
      key: {
        remoteJid,
        id: target.waMessageId,
        fromMe: target.direction === 'outbound',
      },
    },
  });
}

// ── SEND POLL ─────────────────────────────────────────────────
async function sendPoll(numberId, toJid, question, options, allowMultiple = false) {
  const client = getSession(numberId);
  if (!client) throw new Error(`No active session for numberId: ${numberId}`);

  const jid = normalizeToJid(toJid);
  const result = await client.sendMessage(jid, {
    poll: {
      name: question,
      values: options,
      selectableCount: allowMultiple ? Math.max(options.length, 1) : 1,
    },
  });

  return {
    id: { id: result?.key?.id || null },
    from: client.user?.id || null,
    to: jid,
    raw: result,
  };
}

// ── SEND TYPING INDICATOR ─────────────────────────────────────
async function sendTyping(numberId, chatId, duration = 3000) {
  const client = getSession(numberId);
  if (!client) return;

  try {
    const jid = normalizeToJid(chatId);
    await client.presenceSubscribe(jid).catch(() => {});
    await client.sendPresenceUpdate('composing', jid);
    await sleep(duration);
    await client.sendPresenceUpdate('paused', jid);
  } catch (err) {
    logger.debug(`Typing indicator error (non-fatal): ${err.message}`);
  }
}

// ── SEND STATUS POST ──────────────────────────────────────────
async function sendStatusPost(numberId, body = '', mediaUrl = null) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');

  if (!mediaUrl) {
    return client.sendMessage('status@broadcast', { text: body || '' });
  }

  const response = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: 15000 });
  const mime = response.headers['content-type'] || 'application/octet-stream';
  const buffer = Buffer.from(response.data);

  if (mime.startsWith('image/')) {
    return client.sendMessage('status@broadcast', { image: buffer, caption: body || '', mimetype: mime });
  }
  if (mime.startsWith('video/')) {
    return client.sendMessage('status@broadcast', { video: buffer, caption: body || '', mimetype: mime });
  }
  return client.sendMessage('status@broadcast', { document: buffer, fileName: 'status-file', mimetype: mime, caption: body || '' });
}

// ── GET PROFILE PICTURE ───────────────────────────────────────
async function getProfilePicture(numberId, contactJid) {
  const client = getSession(numberId);
  if (!client) return null;
  try {
    return await client.profilePictureUrl(normalizeToJid(contactJid), 'image');
  } catch (_) {
    return null;
  }
}

// ── BLOCK / UNBLOCK ───────────────────────────────────────────
async function blockContact(numberId, contactJid) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  await client.updateBlockStatus(normalizeToJid(contactJid), 'block');
}

async function unblockContact(numberId, contactJid) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  await client.updateBlockStatus(normalizeToJid(contactJid), 'unblock');
}

// ── MUTE / UNMUTE ─────────────────────────────────────────────
async function muteChat() {
  throw new Error('Mute chat is not currently supported with Baileys in this build');
}

async function unmuteChat() {
  throw new Error('Unmute chat is not currently supported with Baileys in this build');
}

// ── GROUPS ────────────────────────────────────────────────────
async function createGroup(numberId, name, participantJids) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');

  const participants = (participantJids || []).map(normalizeToJid).filter(Boolean);
  const result = await client.groupCreate(name, participants);
  return { gid: { _serialized: result.id }, ...result };
}

async function getGroups(numberId) {
  const client = getSession(numberId);
  if (!client) return [];

  const groups = await client.groupFetchAllParticipating();
  return Object.values(groups || {}).map(g => ({
    id: { _serialized: g.id },
    name: g.subject,
    isGroup: true,
    participants: g.participants,
  }));
}

async function getGroupInviteCode(numberId, groupJid) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  return client.groupInviteCode(normalizeToJid(groupJid));
}

async function joinGroupByInvite(numberId, inviteCode) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  return client.groupAcceptInvite(inviteCode);
}

async function addGroupParticipants(numberId, groupJid, participantJids) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  return client.groupParticipantsUpdate(normalizeToJid(groupJid), participantJids.map(normalizeToJid), 'add');
}

async function removeGroupParticipant(numberId, groupJid, participantJid) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  return client.groupParticipantsUpdate(normalizeToJid(groupJid), [normalizeToJid(participantJid)], 'remove');
}

async function promoteParticipant(numberId, groupJid, participantJid) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  return client.groupParticipantsUpdate(normalizeToJid(groupJid), [normalizeToJid(participantJid)], 'promote');
}

async function demoteParticipant(numberId, groupJid, participantJid) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  return client.groupParticipantsUpdate(normalizeToJid(groupJid), [normalizeToJid(participantJid)], 'demote');
}

async function updateGroupSubject(numberId, groupJid, subject) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  await client.groupUpdateSubject(normalizeToJid(groupJid), subject);
}

async function updateGroupDescription(numberId, groupJid, description) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  await client.groupUpdateDescription(normalizeToJid(groupJid), description);
}

async function updateGroupSettings(numberId, groupJid, settings = {}) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');

  if (Object.prototype.hasOwnProperty.call(settings, 'messagesAdminsOnly')) {
    await client.groupSettingUpdate(
      normalizeToJid(groupJid),
      settings.messagesAdminsOnly ? 'announcement' : 'not_announcement'
    );
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'infoAdminsOnly')) {
    await client.groupSettingUpdate(
      normalizeToJid(groupJid),
      settings.infoAdminsOnly ? 'locked' : 'unlocked'
    );
  }
}

async function setGroupPicture() {
  throw new Error('Setting group picture is not currently supported with Baileys in this build');
}

async function leaveGroup(numberId, groupJid) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  return client.groupLeave(normalizeToJid(groupJid));
}

async function getGroupMetadata(numberId, groupJid) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  return client.groupMetadata(normalizeToJid(groupJid));
}

// ── STATUS ────────────────────────────────────────────────────
async function setStatus(numberId, statusText) {
  const client = getSession(numberId);
  if (!client) throw new Error('No active session');
  await client.updateProfileStatus(statusText);
}

// ── CONTACT INFO ──────────────────────────────────────────────
async function getContactInfo(numberId, contactJid) {
  const client = getSession(numberId);
  if (!client) return null;

  const jid = normalizeToJid(contactJid);
  try {
    const [onWa] = await client.onWhatsApp(jid);
    const status = await client.fetchStatus(jid).catch(() => null);
    return {
      name: onWa?.notify || null,
      number: jid.replace('@s.whatsapp.net', ''),
      about: status?.status || null,
      isBusiness: Boolean(onWa?.isBusiness),
    };
  } catch (_) {
    return null;
  }
}

// ── SESSION STATUS ────────────────────────────────────────────
function getSessionStatus(numberId) {
  const sock = activeSessions.get(numberId);
  if (!sock) return 'disconnected';
  return sock.user ? 'connected' : 'connecting';
}

module.exports = {
  initWAEngine,
  createSession,
  destroySession,
  getSession,
  sendTextMessage,
  sendMediaMessage,
  sendLocation,
  sendContactCard,
  sendReaction,
  sendPoll,
  sendTyping,
  sendStatusPost,
  getProfilePicture,
  blockContact,
  unblockContact,
  muteChat,
  unmuteChat,
  setStatus,
  getContactInfo,
  createGroup,
  getGroups,
  getGroupInviteCode,
  joinGroupByInvite,
  addGroupParticipants,
  removeGroupParticipant,
  promoteParticipant,
  demoteParticipant,
  updateGroupSubject,
  updateGroupDescription,
  updateGroupSettings,
  setGroupPicture,
  leaveGroup,
  getGroupMetadata,
  // Backward-compat aliases used by controllers
  promoteGroupParticipant: promoteParticipant,
  demoteGroupParticipant: demoteParticipant,
  getSessionStatus,
  isIpRestrictedStatusCode,
  normalizeToJid,
};
