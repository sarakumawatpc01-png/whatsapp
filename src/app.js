// src/app.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

const prisma = require('./config/database');
const { initSocket } = require('./socket/socketManager');
const { initRedis, getRedis } = require('./config/redis');
const { initWAEngine } = require('./whatsapp/engine');
const { startJobProcessors } = require('./jobs/processors');
const { apiLimiter } = require('./middleware/rateLimiter');
const logger = require('./config/logger');
const errorHandler = require('./middleware/errorHandler');

// ── ROUTES ────────────────────────────────────────────────────
const authRoutes        = require('./routes/auth');
const tenantRoutes      = require('./routes/tenant');
const whatsappRoutes    = require('./routes/whatsapp');
const messageRoutes     = require('./routes/messages');
const contactRoutes     = require('./routes/contacts');
const campaignRoutes    = require('./routes/campaigns');
const followupRoutes    = require('./routes/followups');
const aiRoutes          = require('./routes/ai');
const calendarRoutes    = require('./routes/calendar');
const analyticsRoutes   = require('./routes/analytics');
const groupRoutes       = require('./routes/groups');
const channelRoutes     = require('./routes/channels');
const statusRoutes      = require('./routes/status');
const billingRoutes     = require('./routes/billing');
const superadminRoutes  = require('./routes/superadmin');
const affiliateRoutes   = require('./routes/affiliate');
const webhookRoutes     = require('./routes/webhooks');

const app = express();
const server = http.createServer(app);

function parseAllowedOrigins() {
  const explicitOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

  if (explicitOrigins.length) return explicitOrigins;
  if (process.env.FRONTEND_URL) return [process.env.FRONTEND_URL];
  return ['http://localhost:3000'];
}

const allowedOrigins = parseAllowedOrigins();

function corsOriginValidator(origin, callback) {
  if (!origin) return callback(null, true); // non-browser clients
  if (allowedOrigins.includes(origin)) return callback(null, true);
  return callback(new Error('Origin not allowed by CORS'));
}

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: corsOriginValidator,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));
app.use(cookieParser());
app.use(apiLimiter);

// Webhooks need raw body
app.use('/api/webhooks', express.raw({ type: 'application/json', limit: '2mb' }));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.URLENCODED_BODY_LIMIT || '1mb' }));
app.use(morgan('combined', { stream: { write: msg => logger.info(msg.trim()) } }));

// ── ROUTES ────────────────────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/tenant',        tenantRoutes);
app.use('/api/whatsapp',      whatsappRoutes);
app.use('/api/messages',      messageRoutes);
app.use('/api/contacts',      contactRoutes);
app.use('/api/campaigns',     campaignRoutes);
app.use('/api/followups',     followupRoutes);
app.use('/api/ai',            aiRoutes);
app.use('/api/calendar',      calendarRoutes);
app.use('/api/analytics',     analyticsRoutes);
app.use('/api/groups',        groupRoutes);
app.use('/api/channels',      channelRoutes);
app.use('/api/status',        statusRoutes);
app.use('/api/billing',       billingRoutes);
app.use('/api/superadmin',    superadminRoutes);
app.use('/api/affiliate',     affiliateRoutes);
app.use('/api/webhooks',      webhookRoutes);

// Health check
app.get('/health', async (req, res) => {
  const checks = { db: false, redis: false };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = true;
  } catch (_) {}

  try {
    const redis = getRedis();
    const pong = await redis.ping();
    checks.redis = pong === 'PONG';
  } catch (_) {
    checks.redis = false;
  }

  const healthy = checks.db && checks.redis;
  return res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

// ── ERROR HANDLER ─────────────────────────────────────────────
app.use(errorHandler);

// ── BOOT ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

async function boot() {
  try {
    // Init Redis
    await initRedis();
    logger.info('✅ Redis connected');

    // Init Socket.io
    initSocket(server);
    logger.info('✅ Socket.io initialized');

    // Start Bull job processors
    startJobProcessors();
    logger.info('✅ Job processors started');

    // Start WhatsApp engine (reconnect all active sessions)
    await initWAEngine();
    logger.info('✅ WhatsApp engine initialized');

    server.listen(PORT, () => {
      logger.info(`🚀 WaizAI Backend running on port ${PORT}`);
      logger.info(`🌍 Environment: ${process.env.NODE_ENV}`);
    });
  } catch (err) {
    logger.error('❌ Boot failed:', err);
    process.exit(1);
  }
}

async function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully...`);

  await new Promise(resolve => {
    server.close(() => resolve());
  });

  try {
    await prisma.$disconnect();
  } catch (err) {
    logger.error('Error while disconnecting database:', err.message);
  }

  try {
    const redis = getRedis();
    if (redis?.isOpen) {
      await redis.quit();
    }
  } catch (err) {
    logger.error('Error while disconnecting redis:', err.message);
  }

  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
});

boot();

module.exports = { app, server };
