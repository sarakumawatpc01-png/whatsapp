// src/controllers/statusController.js
// WhatsApp Status (Story) posting from the dashboard
const prisma  = require('../config/database');
const { AppError, ValidationError } = require('../utils/errors');
const { success, paginated } = require('../utils/response');
const logger  = require('../config/logger');
const { getSession } = require('../whatsapp/engine');

// ── LIST STATUS POSTS ──────────────────────────────────────────
async function listStatusPosts(req, res, next) {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip  = (page - 1) * limit;

    const [posts, total] = await Promise.all([
      prisma.statusPost.findMany({
        where: { tenantId: req.tenantId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.statusPost.count({ where: { tenantId: req.tenantId } }),
    ]);

    return paginated(res, posts, total, page, limit);
  } catch (err) {
    next(err);
  }
}

// ── CREATE STATUS POST ─────────────────────────────────────────
async function createStatusPost(req, res, next) {
  try {
    const { numberId, body, mediaUrl, mediaType } = req.body;
    if (!numberId) return next(new ValidationError('numberId is required'));
    if (!body && !mediaUrl) return next(new ValidationError('body or mediaUrl is required'));
    if (body && body.length > 700) return next(new ValidationError('Status text cannot exceed 700 characters'));

    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId: req.tenantId },
    });
    if (!number) return next(new AppError('Number not found', 404));
    if (number.sessionStatus !== 'connected') {
      return next(new AppError('WhatsApp number is not connected', 400));
    }

    const session = getSession(numberId);
    if (!session) return next(new AppError('Session not active', 400));

    // Post to WhatsApp Status
    if (mediaUrl) {
      const { MessageMedia } = require('whatsapp-web.js');
      const media = await MessageMedia.fromUrl(mediaUrl).catch(err => {
        throw new AppError(`Failed to load media: ${err.message}`, 400);
      });
      await session.setStatus(body || '');
      await session.sendMessage('status@broadcast', media, { caption: body || '' });
    } else {
      await session.setStatus(body);
    }

    // Save to DB for history
    const post = await prisma.statusPost.create({
      data: {
        tenantId:    req.tenantId,
        body:        body || '',
        mediaUrl:    mediaUrl || null,
        mediaType:   mediaType || null,
        status:      'published',
        publishedAt: new Date(),
      },
    });

    return success(res, { post }, 'Status posted', 201);
  } catch (err) {
    next(err);
  }
}

// ── SCHEDULE STATUS POST ───────────────────────────────────────
async function scheduleStatusPost(req, res, next) {
  try {
    const { numberId, body, mediaUrl, mediaType, scheduledAt } = req.body;
    if (!numberId) return next(new ValidationError('numberId is required'));
    if (!scheduledAt) return next(new ValidationError('scheduledAt is required'));
    if (!body && !mediaUrl) return next(new ValidationError('body or mediaUrl is required'));
    if (body && body.length > 700) return next(new ValidationError('Status text cannot exceed 700 characters'));

    const schedDate = new Date(scheduledAt);
    if (isNaN(schedDate.getTime()) || schedDate <= new Date()) {
      return next(new ValidationError('scheduledAt must be a valid future date'));
    }

    const number = await prisma.tenantNumber.findFirst({
      where: { id: numberId, tenantId: req.tenantId },
    });
    if (!number) return next(new AppError('Number not found', 404));

    const post = await prisma.statusPost.create({
      data: {
        tenantId:    req.tenantId,
        body:        body || '',
        mediaUrl:    mediaUrl || null,
        mediaType:   mediaType || null,
        status:      'scheduled',
        scheduledAt: schedDate,
      },
    });

    // TODO: Enqueue a Bull job to publish this at scheduledAt
    // scheduledQueue.add({ type: 'status', postId: post.id, numberId }, { delay: schedDate - Date.now() });

    return success(res, { post }, 'Status scheduled', 201);
  } catch (err) {
    next(err);
  }
}

// ── DELETE STATUS POST ─────────────────────────────────────────
async function deleteStatusPost(req, res, next) {
  try {
    const post = await prisma.statusPost.findFirst({
      where: { id: req.params.statusId, tenantId: req.tenantId },
    });
    if (!post) return next(new AppError('Status post not found', 404));

    await prisma.statusPost.delete({ where: { id: post.id } });
    return success(res, {}, 'Status post deleted');
  } catch (err) {
    next(err);
  }
}

module.exports = { listStatusPosts, createStatusPost, scheduleStatusPost, deleteStatusPost };
