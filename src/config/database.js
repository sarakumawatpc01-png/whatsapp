// src/config/database.js
const { PrismaClient } = require('@prisma/client');
const logger = require('./logger');

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development'
    ? [{ emit: 'event', level: 'query' }, 'error', 'warn']
    : ['error'],
});

if (process.env.NODE_ENV === 'development') {
  prisma.$on('query', (e) => {
    if (e.duration > 500) {
      logger.warn(`Slow query (${e.duration}ms): ${e.query}`);
    }
  });
}

prisma.$connect()
  .then(() => logger.info('✅ Database connected'))
  .catch(err => {
    logger.error('❌ Database connection failed:', err);
    process.exit(1);
  });

module.exports = prisma;
