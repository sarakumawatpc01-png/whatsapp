// src/services/settingsService.js
const prisma = require('../config/database');
const { cacheGet, cacheSet } = require('../config/redis');

async function getSetting(key, { fallbackEnvKey, cacheTtlSeconds = 300 } = {}) {
  const cacheKey = `setting:${key}`;
  const cached = await cacheGet(cacheKey);
  if (cached !== null) return cached;

  const setting = await prisma.globalSetting.findUnique({ where: { key } });
  let value = setting?.value ?? null;

  if (!value && fallbackEnvKey) {
    value = process.env[fallbackEnvKey] || null;
  }

  await cacheSet(cacheKey, value, cacheTtlSeconds);
  return value;
}

module.exports = { getSetting };
