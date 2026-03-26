// src/app.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');

const { initSocket } = require('./socket/socketManager');
const { initRedis } = require('./config/redis');
const { initWAEngine } = require('./whatsapp/engine');
const { startJobProcessors } = require('./jobs/processors');
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

// ── MIDDLEWARE ────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));

// Webhooks need raw body
app.use('/api/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
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
app.get('/health', (req, res) => res.json({
  status: 'ok',
  timestamp: new Date().toISOString(),
  version: process.env.npm_package_version || '1.0.0',
}));

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

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  server.close(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection:', reason);
});

boot();

module.exports = { app, server };
