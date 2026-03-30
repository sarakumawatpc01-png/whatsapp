// src/services/settingsService.js
const prisma = require('../config/database');
const { cacheGet, cacheSet } = require('../config/redis');

/**
 * Fetch a global setting from the database with optional env fallback and Redis caching.
 * @param {string} key - GlobalSetting key to fetch.
 * @param {object} options - Optional behavior overrides.
 * @param {string} [options.fallbackEnvKey] - Environment variable name to use when DB value is missing.
 * @param {number} [options.cacheTtlSeconds=300] - Cache TTL in seconds for non-null values.
 * @returns {Promise<string|null>} The resolved setting value or null if not found.
 */
async function getSetting(key, { fallbackEnvKey, cacheTtlSeconds = 300 } = {}) {
  const cacheKey = `setting:${key}`;
  const cached = await cacheGet(cacheKey);
  if (cached !== null) return cached;

  const setting = await prisma.globalSetting.findUnique({ where: { key } });
  let value = setting?.value;

  if ((value === null || value === undefined) && fallbackEnvKey) {
    value = process.env[fallbackEnvKey] || null;
  }

  if (value === undefined) {
    value = null;
  }

  if (value !== null && value !== undefined) {
    await cacheSet(cacheKey, value, cacheTtlSeconds);
  }
  return value;
}

module.exports = { getSetting };
