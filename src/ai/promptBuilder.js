// src/ai/promptBuilder.js
// Builds a complete, tenant-scoped system prompt from the client's
// business data. This is what keeps clients' data 100% isolated.

const prisma = require('../config/database');
const logger = require('../config/logger');

/**
 * Build a full system prompt using ONLY that tenant's data.
 * @param {Object} aiConfig - From DB (tenantId-scoped)
 * @param {Object} contact  - The contact being replied to
 */
function buildSystemPrompt(aiConfig, contact) {
  const lines = [];

  // ── Identity ──────────────────────────────────────────────
  lines.push(`You are a professional AI assistant for "${aiConfig.businessDescription ? '' : 'a business'}".`);

  if (aiConfig.businessDescription) {
    lines.push(`BUSINESS INFO:\n${aiConfig.businessDescription}`);
  }

  // ── Products & Services ───────────────────────────────────
  if (aiConfig.productsServices) {
    lines.push(`\nPRODUCTS / SERVICES:\n${aiConfig.productsServices}`);
  }

  if (aiConfig.priceRange) {
    lines.push(`\nPRICING INFO:\n${aiConfig.priceRange}`);
  }

  if (aiConfig.popularItems) {
    lines.push(`\nMOST POPULAR ITEMS:\n${aiConfig.popularItems}`);
  }

  if (aiConfig.currentOffers) {
    lines.push(`\nCURRENT OFFERS / DISCOUNTS:\n${aiConfig.currentOffers}`);
  }

  if (aiConfig.brands) {
    lines.push(`\nBRANDS WE CARRY:\n${aiConfig.brands}`);
  }

  if (aiConfig.usp) {
    lines.push(`\nWHY CHOOSE US:\n${aiConfig.usp}`);
  }

  // ── Policies ──────────────────────────────────────────────
  if (aiConfig.warrantyPolicy) {
    lines.push(`\nWARRANTY / RETURN POLICY:\n${aiConfig.warrantyPolicy}`);
  }

  if (aiConfig.deliveryInfo) {
    lines.push(`\nDELIVERY / SHIPPING INFO:\n${aiConfig.deliveryInfo}`);
  }

  if (aiConfig.paymentMethods?.length) {
    lines.push(`\nPAYMENT METHODS ACCEPTED: ${aiConfig.paymentMethods.join(', ')}`);
  }

  // ── FAQs ─────────────────────────────────────────────────
  if (aiConfig.faqs && Array.isArray(aiConfig.faqs) && aiConfig.faqs.length > 0) {
    lines.push(`\nFREQUENTLY ASKED QUESTIONS:`);
    aiConfig.faqs.forEach((faq, i) => {
      lines.push(`Q${i + 1}: ${faq.question}\nA${i + 1}: ${faq.answer}`);
    });
  }

  // ── Behaviour Instructions ────────────────────────────────
  lines.push(`\nBEHAVIOUR RULES:`);
  lines.push(`- Tone: ${aiConfig.tone || 'friendly and professional'}`);
  lines.push(`- Language: ${getLanguageInstruction(aiConfig.language)}`);
  lines.push(`- Keep replies concise — maximum ${aiConfig.maxResponseChars || 200} characters unless detail is truly needed`);
  lines.push(`- NEVER invent facts. If you don't know something, say you'll check and get back to them`);
  lines.push(`- NEVER mention you are an AI unless directly asked`);
  lines.push(`- Address the customer warmly`);

  if (contact?.name) {
    lines.push(`- The customer's name is: ${contact.name}. Use their name naturally`);
  }

  if (aiConfig.customInstructions) {
    lines.push(`\nCUSTOM INSTRUCTIONS (follow strictly):\n${aiConfig.customInstructions}`);
  }

  if (aiConfig.avoidTopics) {
    lines.push(`\nTOPICS TO AVOID:\n${aiConfig.avoidTopics}`);
  }

  // ── Business Hours context ────────────────────────────────
  const hoursText = formatBusinessHours(aiConfig.businessHours);
  if (hoursText) {
    lines.push(`\nBUSINESS HOURS:\n${hoursText}`);
  }

  return lines.join('\n');
}

function getLanguageInstruction(lang) {
  const map = {
    'match': 'Match the customer\'s language automatically',
    'hindi': 'Always reply in Hindi',
    'english': 'Always reply in English',
    'hinglish': 'Use a natural mix of Hindi and English (Hinglish)',
    'marathi': 'Always reply in Marathi',
    'bengali': 'Always reply in Bengali',
    'tamil': 'Always reply in Tamil',
    'telugu': 'Always reply in Telugu',
    'gujarati': 'Always reply in Gujarati',
    'kannada': 'Always reply in Kannada',
    'punjabi': 'Always reply in Punjabi',
  };
  return map[lang] || 'Match the customer\'s language';
}

function formatBusinessHours(hoursJson) {
  if (!hoursJson || Object.keys(hoursJson).length === 0) return '';
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  return days.map(d => {
    const cfg = hoursJson[d];
    if (!cfg || !cfg.enabled) return `${capitalize(d)}: Closed`;
    return `${capitalize(d)}: ${cfg.open} – ${cfg.close}`;
  }).join('\n');
}

function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }

/**
 * Build conversation history array for the AI API call.
 * @param {Array} messages - Array of {body, direction} from DB
 */
function buildConversationHistory(messages) {
  return messages
    .filter(m => m.body)
    .map(m => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: m.body,
    }));
}

module.exports = { buildSystemPrompt, buildConversationHistory };
