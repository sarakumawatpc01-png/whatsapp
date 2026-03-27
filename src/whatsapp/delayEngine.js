// src/whatsapp/delayEngine.js
// Anti-ban delay + typing simulation before every AI reply

const prisma = require('../config/database');
const logger = require('../config/logger');
const { generateAIReply } = require('../ai/modelRouter');
const { buildSystemPrompt } = require('../ai/promptBuilder');
const { sendTextMessage, sendTyping } = require('./engine');

/**
 * Main function: generate AI reply with human-like timing
 * 1. Check business hours → maybe send out-of-hours msg
 * 2. Generate AI reply
 * 3. Wait a random delay (within the number's configured range)
 * 4. Send typing indicator
 * 5. Send the message
 */
async function sendWithDelay(numberId, toJid, incomingText, history, contact, tenantId, aiConfig, incomingMsgId) {
  try {
    const number = await prisma.tenantNumber.findUnique({ where: { id: numberId } });
    if (!number) return;

    const minGap = Math.max(number.minMsgGapSec, 3); // never below 3s
    const maxGap = Math.max(number.maxMsgGapSec, minGap + 2);

    // ── Check business hours ──────────────────────────────────
    const isOpen = isWithinBusinessHours(aiConfig.businessHours);

    let replyText;

    if (!isOpen && aiConfig.outOfHoursMsg) {
      replyText = aiConfig.outOfHoursMsg;
    } else {
      // ── Build system prompt (tenant-scoped) ───────────────
      const systemPrompt = buildSystemPrompt(aiConfig, contact);

      // ── Generate AI reply ─────────────────────────────────
      const { text, provider, model, inputTokens, outputTokens, costUsd } = await generateAIReply({
        systemPrompt,
        history,
        userMessage: incomingText,
        tenantId,
        maxChars: aiConfig.maxResponseChars || 500,
      });
      replyText = text;

      // ── Track API usage ────────────────────────────────────
      await prisma.apiUsage.create({
        data: { tenantId, provider, model, inputTokens, outputTokens, costUsd, endpoint: 'chat' },
      });

      // ── Increment AI call counter ──────────────────────────
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { aiCallsThisMonth: { increment: 1 } },
      });
    }

    if (!replyText?.trim()) return;

    // ── Random delay (human-like) ─────────────────────────────
    const readDelay = number.readDelayMs || 800;
    const typingDuration = Math.min(replyText.length * 40, 4000); // ~40ms per char, max 4s
    const gapDelay = randomBetween(minGap * 1000, maxGap * 1000);

    // Read receipt pause
    await sleep(readDelay);

    // Typing indicator
    if (aiConfig.sendTypingIndicator) {
      await sendTyping(numberId, toJid, typingDuration);
    }

    // Additional gap after typing
    await sleep(gapDelay - typingDuration > 0 ? gapDelay - typingDuration : 500);

    // ── Send message ──────────────────────────────────────────
    const sentMsg = await sendTextMessage(numberId, toJid, replyText);

    // ── Save outbound message to DB ───────────────────────────
    await prisma.message.create({
      data: {
        tenantId, numberId,
        contactId: contact.id,
        waMessageId: sentMsg?.id?.id,
        fromJid: sentMsg?.from || `outbound`,
        toJid,
        body: replyText,
        type: 'text',
        direction: 'outbound',
        aiSent: true,
        quotedMsgId: incomingMsgId,
        timestamp: new Date(),
      },
    });

    // ── Increment message counter ─────────────────────────────
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { messagesThisMonth: { increment: 1 } },
    });

    // ── Auto-react to incoming message ────────────────────────
    if (aiConfig.autoReact && incomingMsgId) {
      await sleep(500);
      try {
        const { sendReaction } = require('./engine');
        const reactions = ['👍', '✅', '😊', '🙏'];
        const emoji = reactions[Math.floor(Math.random() * reactions.length)];
        await sendReaction(numberId, incomingMsgId, emoji);
      } catch (_) {}
    }

    logger.info(`AI reply sent to ${toJid} (tenant: ${tenantId}), delay: ${gapDelay}ms`);

  } catch (err) {
    logger.error(`delayEngine error for ${toJid}:`, err);
  }
}

function isWithinBusinessHours(hoursJson) {
  if (!hoursJson || Object.keys(hoursJson).length === 0) return true; // no config = always open

  const now = new Date();
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayName = days[now.getDay()];
  const todayConfig = hoursJson[dayName];

  if (!todayConfig || !todayConfig.enabled) return false;

  const [openH, openM] = todayConfig.open.split(':').map(Number);
  const [closeH, closeM] = todayConfig.close.split(':').map(Number);

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const openMinutes   = openH * 60 + openM;
  const closeMinutes  = closeH * 60 + closeM;

  return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { sendWithDelay, isWithinBusinessHours };
