// src/ai/modelRouter.js
// Routes AI calls to the correct provider based on tenant's assigned model.
// All API keys come from environment (superadmin-managed). Tenants never see them.

const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const axios = require('axios');
const prisma = require('../config/database');
const logger = require('../config/logger');
const { buildConversationHistory } = require('./promptBuilder');
const { getSetting } = require('../services/settingsService');

/**
 * Main entry point for AI reply generation.
 * Returns { text, provider, model, inputTokens, outputTokens, costUsd }
 */
async function generateAIReply({ systemPrompt, history, userMessage, tenantId, maxChars = 500 }) {
  // Get tenant's assigned model
  const model = await getTenantModel(tenantId);
  const provider = getProvider(model);

  logger.debug(`AI call: tenant=${tenantId} model=${model} provider=${provider}`);

  const messages = [
    ...buildConversationHistory(history),
    { role: 'user', content: userMessage },
  ];

  // Limit history to last 12 exchanges to control token cost
  const trimmedMessages = messages.slice(-24);

  try {
    switch (provider) {
      case 'anthropic': return await callClaude(systemPrompt, trimmedMessages, model, maxChars);
      case 'openai':    return await callOpenAI(systemPrompt, trimmedMessages, model, maxChars);
      case 'deepseek':  return await callDeepSeek(systemPrompt, trimmedMessages, model, maxChars);
      case 'sarvam':    return await callSarvam(systemPrompt, trimmedMessages, model, maxChars);
      case 'openrouter': return await callOpenRouter(systemPrompt, trimmedMessages, model, maxChars);
      default:          return await callClaude(systemPrompt, trimmedMessages, 'claude-sonnet-4-6', maxChars);
    }
  } catch (err) {
    logger.error(`AI call failed (${provider}/${model}):`, err.message);
    // Fallback to Claude if primary fails
    if (provider !== 'anthropic') {
      logger.warn(`Falling back to Claude for tenant ${tenantId}`);
      return await callClaude(systemPrompt, trimmedMessages, 'claude-sonnet-4-6', maxChars);
    }
    throw err;
  }
}

// ── CLAUDE (Anthropic) ────────────────────────────────────────
async function callClaude(systemPrompt, messages, model, maxChars) {
  const apiKey = await getSetting('anthropic_api_key', { fallbackEnvKey: 'ANTHROPIC_API_KEY' });
  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: model || 'claude-sonnet-4-6',
    max_tokens: Math.min(Math.ceil(maxChars / 3.5), 1024),
    system: systemPrompt,
    messages,
  });

  const text = response.content[0]?.text || '';
  const inputTokens  = response.usage?.input_tokens  || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  // Claude pricing: $3/1M input, $15/1M output (Sonnet)
  const costUsd = (inputTokens / 1_000_000 * 3) + (outputTokens / 1_000_000 * 15);

  return { text: truncate(text, maxChars), provider: 'anthropic', model, inputTokens, outputTokens, costUsd };
}

// ── GPT-4o (OpenAI) ───────────────────────────────────────────
async function callOpenAI(systemPrompt, messages, model, maxChars) {
  const apiKey = await getSetting('openai_api_key', { fallbackEnvKey: 'OPENAI_API_KEY' });
  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model: model || 'gpt-4o',
    max_tokens: Math.min(Math.ceil(maxChars / 3.5), 1024),
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
  });

  const text = response.choices[0]?.message?.content || '';
  const inputTokens  = response.usage?.prompt_tokens     || 0;
  const outputTokens = response.usage?.completion_tokens || 0;
  // GPT-4o pricing: $5/1M input, $15/1M output
  const costUsd = (inputTokens / 1_000_000 * 5) + (outputTokens / 1_000_000 * 15);

  return { text: truncate(text, maxChars), provider: 'openai', model, inputTokens, outputTokens, costUsd };
}

// ── DeepSeek ─────────────────────────────────────────────────
async function callDeepSeek(systemPrompt, messages, model, maxChars) {
  const apiKey = await getSetting('deepseek_api_key', { fallbackEnvKey: 'DEEPSEEK_API_KEY' });
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://api.deepseek.com',
  });

  const response = await client.chat.completions.create({
    model: model || 'deepseek-chat',
    max_tokens: Math.min(Math.ceil(maxChars / 3.5), 1024),
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages,
    ],
  });

  const text = response.choices[0]?.message?.content || '';
  const inputTokens  = response.usage?.prompt_tokens     || 0;
  const outputTokens = response.usage?.completion_tokens || 0;
  // DeepSeek pricing: ~$0.14/1M input, $0.28/1M output
  const costUsd = (inputTokens / 1_000_000 * 0.14) + (outputTokens / 1_000_000 * 0.28);

  return { text: truncate(text, maxChars), provider: 'deepseek', model, inputTokens, outputTokens, costUsd };
}

// ── Sarvam AI (Indian language specialist) ────────────────────
async function callSarvam(systemPrompt, messages, model, maxChars) {
  const apiKey = await getSetting('sarvam_api_key', { fallbackEnvKey: 'SARVAM_API_KEY' });

  const response = await axios.post(
    'https://api.sarvam.ai/v1/chat/completions',
    {
      model: model || 'sarvam-2b',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      max_tokens: Math.min(Math.ceil(maxChars / 3.5), 512),
    },
    {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );

  const text = response.data?.choices?.[0]?.message?.content || '';
  const inputTokens  = response.data?.usage?.prompt_tokens     || 0;
  const outputTokens = response.data?.usage?.completion_tokens || 0;
  const costUsd = (inputTokens / 1_000_000 * 0.5) + (outputTokens / 1_000_000 * 1.5); // estimate

  return { text: truncate(text, maxChars), provider: 'sarvam', model, inputTokens, outputTokens, costUsd };
}

// ── OpenRouter ────────────────────────────────────────────────
async function callOpenRouter(systemPrompt, messages, model, maxChars) {
  const apiKey = await getSetting('openrouter_api_key', { fallbackEnvKey: 'OPENROUTER_API_KEY' });
  if (!apiKey) throw new Error('OpenRouter API key is not configured');

  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model: model || 'openai/gpt-4o-mini',
      max_tokens: Math.min(Math.ceil(maxChars / 3.5), 1024),
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 20000,
    }
  );

  const text = response.data?.choices?.[0]?.message?.content || '';
  const inputTokens = response.data?.usage?.prompt_tokens || 0;
  const outputTokens = response.data?.usage?.completion_tokens || 0;
  const costUsd = Number(response.data?.usage?.cost || 0);

  return { text: truncate(text, maxChars), provider: 'openrouter', model, inputTokens, outputTokens, costUsd };
}

// ── HELPERS ───────────────────────────────────────────────────
function getProvider(model) {
  if (!model) return 'anthropic';
  if (model.startsWith('claude'))    return 'anthropic';
  if (model.startsWith('gpt'))       return 'openai';
  if (model.startsWith('deepseek'))  return 'deepseek';
  if (model.startsWith('sarvam'))    return 'sarvam';
  if (model.startsWith('openrouter/') || model.includes('/')) return 'openrouter';
  return 'anthropic';
}

async function getTenantModel(tenantId) {
  const aiConfig = await prisma.aiConfig.findUnique({
    where: { tenantId },
    select: { aiModel: true },
  });
  return aiConfig?.aiModel || process.env.DEFAULT_AI_MODEL || 'claude-sonnet-4-6';
}

function truncate(text, maxChars) {
  if (text.length <= maxChars) return text;
  // Try to cut at sentence boundary
  const truncated = text.slice(0, maxChars);
  const lastSentence = truncated.lastIndexOf('. ');
  return lastSentence > maxChars * 0.7
    ? truncated.slice(0, lastSentence + 1)
    : truncated + '...';
}

module.exports = { generateAIReply };
