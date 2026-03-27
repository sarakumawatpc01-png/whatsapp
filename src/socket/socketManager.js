// src/socket/socketManager.js
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const logger = require('../config/logger');

let io;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || 'http://localhost:3000',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // ── AUTH MIDDLEWARE ──────────────────────────────────────
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.tenantId = decoded.tenantId;
      socket.adminId  = decoded.adminId;
      socket.isSuperAdmin = decoded.isSuperAdmin || false;
      next();
    } catch (err) {
      return next(new Error('Invalid or expired token'));
    }
  });

  // ── CONNECTION HANDLER ───────────────────────────────────
  io.on('connection', (socket) => {
    const { tenantId, adminId, isSuperAdmin } = socket;

    if (tenantId) {
      socket.join(`tenant:${tenantId}`);
      logger.debug(`Socket connected: tenant=${tenantId} sid=${socket.id}`);
    }

    if (isSuperAdmin && adminId) {
      socket.join('superadmin');
      logger.debug(`Superadmin socket connected: adminId=${adminId}`);
    }

    // ── PING ────────────────────────────────────────────────
    socket.on('ping', () => socket.emit('pong', { ts: Date.now() }));

    // ── TYPING (manual send, human operator) ────────────────
    socket.on('typing:start', ({ chatJid }) => {
      if (tenantId) {
        socket.to(`tenant:${tenantId}`).emit('typing:start', { chatJid });
      }
    });
    socket.on('typing:stop', ({ chatJid }) => {
      if (tenantId) {
        socket.to(`tenant:${tenantId}`).emit('typing:stop', { chatJid });
      }
    });

    // ── DISCONNECT ──────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      logger.debug(`Socket disconnected: ${socket.id} reason=${reason}`);
    });

    socket.on('error', (err) => {
      logger.error(`Socket error for ${socket.id}:`, err.message);
    });
  });

  logger.info('✅ Socket.io initialized');
  return io;
}

function getSocketIO() {
  if (!io) throw new Error('Socket.io not initialized. Call initSocket() first.');
  return io;
}

/**
 * Emit an event to all sockets in a tenant's room.
 */
function emitToTenant(tenantId, event, data) {
  if (!io) return;
  io.to(`tenant:${tenantId}`).emit(event, data);
}

/**
 * Emit to the superadmin room.
 */
function emitToSuperAdmin(event, data) {
  if (!io) return;
  io.to('superadmin').emit(event, data);
}

module.exports = { initSocket, getSocketIO, emitToTenant, emitToSuperAdmin };
