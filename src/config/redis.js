// src/config/redis.js
const { createClient } = require('redis');
const logger = require('./logger');

let client;

async function initRedis() {
  client = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
  client.on('error', err => logger.error('Redis error:', err));
  client.on('reconnecting', () => logger.warn('Redis reconnecting...'));
  await client.connect();
  return client;
}

function getRedis() {
  if (!client) throw new Error('Redis not initialized. Call initRedis() first.');
  return client;
}

// Cache helpers
async function cacheGet(key) {
  const val = await getRedis().get(key);
  return val ? JSON.parse(val) : null;
}

async function cacheSet(key, value, ttlSeconds = 300) {
  await getRedis().setEx(key, ttlSeconds, JSON.stringify(value));
}

async function cacheDel(key) {
  await getRedis().del(key);
}

async function cacheDelPattern(pattern) {
  const keys = await getRedis().keys(pattern);
  if (keys.length) await getRedis().del(keys);
}

module.exports = { initRedis, getRedis, cacheGet, cacheSet, cacheDel, cacheDelPattern };
