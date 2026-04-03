// src/controllers/superadminController.js
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const crypto   = require('crypto');
const nodemailer = require('nodemailer');
const prisma   = require('../config/database');
const { AppError, ValidationError } = require('../utils/errors');
const { success, paginated } = require('../utils/response');
const logger   = require('../config/logger');
const { cacheSet, cacheGet, cacheDel, cacheDelPattern } = require('../config/redis');

// ── TOKEN HELPERS ─────────────────────────────────────────────
function generateAdminTokens(adminId) {
  const accessToken = jwt.sign(
    { adminId, isSuperAdmin: true },
    process.env.SUPERADMIN_JWT_SECRET,
    { expiresIn: '4h' }
  );
  const refreshToken = jwt.sign(
    { adminId, isSuperAdmin: true, type: 'refresh' },
    process.env.SUPERADMIN_JWT_SECRET,
    { expiresIn: '7d' }
  );
  return { accessToken, refreshToken };
}

function maskSecret(value) {
  const str = String(value || '');
  if (!str) return '';
  if (str.length <= 8) return '••••••••';
  return `${str.slice(0, 4)}••••••${str.slice(-3)}`;
}

function toBooleanString(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const normalized = String(value || '').toLowerCase().trim();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return 'true';
  return 'false';
}

const emailTransportCache = new Map();

async function getEmailRuntimeConfig() {
  const keyList = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_secure', 'email_from', 'email_from_name'];
  const settings = await prisma.globalSetting.findMany({ where: { key: { in: keyList } } });
  const settingMap = settings.reduce((acc, item) => {
    acc[item.key] = item.value;
    return acc;
  }, {});
  return {
    smtpHost: settingMap.smtp_host || 'smtp.sendgrid.net',
    smtpPort: Number(settingMap.smtp_port || 587),
    smtpSecure: toBooleanString(settingMap.smtp_secure || 'false') === 'true',
    smtpUser: settingMap.smtp_user || 'apikey',
    smtpPass: settingMap.smtp_pass || process.env.SENDGRID_API_KEY,
    fromEmail: settingMap.email_from || process.env.EMAIL_FROM || 'noreply@waizai.com',
    fromName: settingMap.email_from_name || process.env.EMAIL_FROM_NAME || 'WaizAI',
  };
}

function getTransportCacheKey(cfg) {
  return [
    cfg.smtpHost,
    cfg.smtpPort,
    cfg.smtpSecure ? '1' : '0',
    cfg.smtpUser,
    String(cfg.smtpPass || '').slice(0, 8),
  ].join(':');
}

async function getReusableTransport() {
  const cfg = await getEmailRuntimeConfig();
  if (!cfg.smtpPass) throw new AppError('SMTP password/API key is not configured', 400);
  const cacheKey = getTransportCacheKey(cfg);
  if (emailTransportCache.has(cacheKey)) return { transport: emailTransportCache.get(cacheKey), cfg };

  const transport = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpSecure,
    auth: { user: cfg.smtpUser, pass: cfg.smtpPass },
    pool: true,
  });
  emailTransportCache.set(cacheKey, transport);
  if (emailTransportCache.size > 5) {
    const [firstKey] = emailTransportCache.keys();
    emailTransportCache.delete(firstKey);
  }

  return { transport, cfg };
}

function sanitizeCustomEmailHtml(input) {
  const source = String(input || '');
  if (!source.trim()) return '';
  let safeHtml = source.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  safeHtml = safeHtml.replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, '');
  safeHtml = safeHtml.replace(/javascript:/gi, '');
  return safeHtml;
}

// ── LOGIN ─────────────────────────────────────────────────────
async function superAdminLogin(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) return next(new ValidationError('Email and password are required'));

    const admin = await prisma.superAdmin.findUnique({ where: { email: email.toLowerCase() } });
    if (!admin || !admin.isActive) return next(new AppError('Invalid credentials', 401));

    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return next(new AppError('Invalid credentials', 401));

    await prisma.superAdmin.update({
      where: { id: admin.id },
      data:  { lastLoginAt: new Date() },
    });

    // Log admin action
    await prisma.adminAction.create({
      data: {
        adminId:    admin.id,
        actionType: 'login',
        ipAddress:  req.ip,
        metadata:   { userAgent: req.headers['user-agent'] || '' },
      },
    });

    const { accessToken, refreshToken } = generateAdminTokens(admin.id);

    return success(res, {
      accessToken,
      refreshToken,
      admin: { id: admin.id, name: admin.name, email: admin.email },
    });
  } catch (err) {
    next(err);
  }
}

// ── REFRESH ───────────────────────────────────────────────────
async function superAdminRefresh(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return next(new ValidationError('refreshToken is required'));

    const decoded = jwt.verify(refreshToken, process.env.SUPERADMIN_JWT_SECRET);
    if (!decoded.isSuperAdmin || decoded.type !== 'refresh') {
      return next(new AppError('Invalid refresh token', 401));
    }

    const admin = await prisma.superAdmin.findUnique({ where: { id: decoded.adminId } });
    if (!admin || !admin.isActive) return next(new AppError('Admin account inactive', 403));

    const { accessToken, refreshToken: newRefresh } = generateAdminTokens(admin.id);
    return success(res, { accessToken, refreshToken: newRefresh });
  } catch (err) {
    if (err.name === 'TokenExpiredError') return next(new AppError('Refresh token expired', 401));
    next(err);
  }
}

// ── PLATFORM STATS ────────────────────────────────────────────
async function getPlatformStats(req, res, next) {
  try {
    const now        = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo    = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalUsers,
      activeUsers,
      trialUsers,
      suspendedUsers,
      totalSessions,
      activeSessions,
      todayMessages,
      monthMessages,
      totalAiCalls,
      totalRevenuePaise,
      newUsersThisWeek,
      newUsersThisMonth,
      apiUsageSummary,
    ] = await Promise.all([
      prisma.tenant.count({ where: { status: { not: 'deleted' } } }),
      prisma.tenant.count({ where: { status: 'active', lastActiveAt: { gte: weekAgo } } }),
      prisma.tenant.count({ where: { status: 'trial' } }),
      prisma.tenant.count({ where: { status: 'suspended' } }),
      prisma.tenantNumber.count(),
      prisma.tenantNumber.count({ where: { sessionStatus: 'connected' } }),
      prisma.message.count({ where: { timestamp: { gte: todayStart } } }),
      prisma.message.count({ where: { timestamp: { gte: monthStart } } }),
      prisma.apiUsage.count(),
      prisma.subscription.aggregate({
        where: { status: 'active' },
        _sum: { amount: true },
      }),
      prisma.tenant.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.tenant.count({ where: { createdAt: { gte: monthStart } } }),
      prisma.apiUsage.groupBy({
        by: ['provider'],
        _count: { id: true },
        _sum: { costUsd: true },
        orderBy: { _count: { id: 'desc' } },
      }),
    ]);

    // MRR = sum of active subscription amounts (in paise → convert to rupees)
    const mrr = Math.round((totalRevenuePaise._sum.amount || 0) / 100);

    return success(res, {
      users: {
        total: totalUsers,
        active: activeUsers,
        trial: trialUsers,
        suspended: suspendedUsers,
        newThisWeek: newUsersThisWeek,
        newThisMonth: newUsersThisMonth,
      },
      whatsapp: {
        totalSessions,
        activeSessions,
      },
      messages: {
        today: todayMessages,
        thisMonth: monthMessages,
      },
      aiCalls: {
        total: totalAiCalls,
        byProvider: apiUsageSummary,
      },
      revenue: {
        mrrRupees: mrr,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── LIST USERS ────────────────────────────────────────────────
async function listUsers(req, res, next) {
  try {
    const page   = parseInt(req.query.page)  || 1;
    const limit  = parseInt(req.query.limit) || 25;
    const skip   = (page - 1) * limit;
    const search = req.query.search;
    const status = req.query.status;
    const planId = req.query.planId;

    const where = {};
    if (status) where.status = status;
    if (planId) where.planId = planId;
    if (search) {
      where.OR = [
        { ownerName:    { contains: search, mode: 'insensitive' } },
        { businessName: { contains: search, mode: 'insensitive' } },
        { email:        { contains: search, mode: 'insensitive' } },
        { phone:        { contains: search } },
      ];
    }

    const [users, total] = await Promise.all([
      prisma.tenant.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, ownerName: true, businessName: true,
          email: true, phone: true, status: true,
          emailVerified: true, phoneVerified: true,
          messagesThisMonth: true, aiCallsThisMonth: true,
          storageUsedMb: true, lastActiveAt: true, lastLoginAt: true,
          createdAt: true, trialEndsAt: true,
          plan: { select: { name: true, displayName: true } },
          numbers: {
            select: { sessionStatus: true },
          },
          _count: { select: { messages: true, contacts: true } },
        },
      }),
      prisma.tenant.count({ where }),
    ]);

    return paginated(res, users, total, page, limit);
  } catch (err) {
    next(err);
  }
}

// ── GET USER ──────────────────────────────────────────────────
async function getUser(req, res, next) {
  try {
    const user = await prisma.tenant.findUnique({
      where: { id: req.params.userId },
      include: {
        plan: true,
        numbers: {
          select: {
            id: true, phoneNumber: true, displayName: true,
            sessionStatus: true, lastConnectedAt: true,
          },
        },
        aiConfig: {
          select: {
            aiModel: true, tone: true, language: true,
          },
        },
        subscriptions: {
          include: { plan: { select: { displayName: true } } },
          orderBy: { startDate: 'desc' },
          take: 5,
        },
        _count: {
          select: {
            messages: true, contacts: true,
            campaigns: true, followupSequences: true,
          },
        },
      },
    });

    if (!user) return next(new AppError('User not found', 404));

    // Never expose password
    const { password, ...safeUser } = user;
    return success(res, { user: safeUser });
  } catch (err) {
    next(err);
  }
}

// ── SUSPEND USER ──────────────────────────────────────────────
async function suspendUser(req, res, next) {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    const user = await prisma.tenant.findUnique({ where: { id: userId } });
    if (!user) return next(new AppError('User not found', 404));

    await prisma.tenant.update({
      where: { id: userId },
      data:  { status: 'suspended' },
    });

    await prisma.adminAction.create({
      data: {
        adminId:    req.adminId,
        actionType: 'suspend_user',
        targetType: 'tenant',
        targetId:   userId,
        metadata:   { reason: reason || '' },
        ipAddress:  req.ip,
      },
    });

    logger.info(`User ${userId} suspended by admin ${req.adminId}`);
    return success(res, {}, 'User suspended');
  } catch (err) {
    next(err);
  }
}

// ── UNSUSPEND USER ────────────────────────────────────────────
async function unsuspendUser(req, res, next) {
  try {
    const { userId } = req.params;

    const user = await prisma.tenant.findUnique({ where: { id: userId } });
    if (!user) return next(new AppError('User not found', 404));

    await prisma.tenant.update({
      where: { id: userId },
      data:  { status: 'active' },
    });

    await prisma.adminAction.create({
      data: {
        adminId:    req.adminId,
        actionType: 'unsuspend_user',
        targetType: 'tenant',
        targetId:   userId,
        ipAddress:  req.ip,
        metadata:   {},
      },
    });

    return success(res, {}, 'User unsuspended');
  } catch (err) {
    next(err);
  }
}

// ── DELETE USER ───────────────────────────────────────────────
async function deleteUser(req, res, next) {
  try {
    const { userId } = req.params;

    const user = await prisma.tenant.findUnique({ where: { id: userId } });
    if (!user) return next(new AppError('User not found', 404));

    // Soft delete — preserve data for audit, just mark as deleted
    await prisma.tenant.update({
      where: { id: userId },
      data:  { status: 'deleted', email: `deleted_${Date.now()}_${user.email}` },
    });

    await prisma.adminAction.create({
      data: {
        adminId:    req.adminId,
        actionType: 'delete_user',
        targetType: 'tenant',
        targetId:   userId,
        ipAddress:  req.ip,
        metadata:   { originalEmail: user.email },
      },
    });

    return success(res, {}, 'User deleted');
  } catch (err) {
    next(err);
  }
}

// ── RESET USER PASSWORD ───────────────────────────────────────
async function resetUserPassword(req, res, next) {
  try {
    const { userId }      = req.params;
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) {
      return next(new ValidationError('newPassword must be at least 8 characters'));
    }

    const user = await prisma.tenant.findUnique({ where: { id: userId } });
    if (!user) return next(new AppError('User not found', 404));

    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.tenant.update({ where: { id: userId }, data: { password: hashed } });

    await prisma.adminAction.create({
      data: {
        adminId:    req.adminId,
        actionType: 'reset_user_password',
        targetType: 'tenant',
        targetId:   userId,
        ipAddress:  req.ip,
        metadata:   {},
      },
    });

    return success(res, {}, 'User password reset');
  } catch (err) {
    next(err);
  }
}

// ── LOGIN AS USER (Impersonation) ─────────────────────────────
async function loginAsUser(req, res, next) {
  try {
    const { userId } = req.params;

    const user = await prisma.tenant.findUnique({ where: { id: userId } });
    if (!user) return next(new AppError('User not found', 404));
    if (user.status === 'deleted') return next(new AppError('Cannot impersonate a deleted user', 403));

    // Issue a short-lived impersonation token (1 hour)
    const impersonationToken = jwt.sign(
      { tenantId: userId, impersonatedBy: req.adminId },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Mandatory audit log
    await prisma.adminAction.create({
      data: {
        adminId:    req.adminId,
        actionType: 'login_as_user',
        targetType: 'tenant',
        targetId:   userId,
        ipAddress:  req.ip,
        metadata:   { businessName: user.businessName, email: user.email },
      },
    });

    logger.warn(`⚠️ Admin ${req.adminId} impersonating tenant ${userId} (${user.email})`);

    return success(res, {
      accessToken: impersonationToken,
      user: {
        id:           user.id,
        email:        user.email,
        businessName: user.businessName,
        ownerName:    user.ownerName,
      },
    }, 'Impersonation token issued (1 hour)');
  } catch (err) {
    next(err);
  }
}

// ── GET USER ACTIVITY ─────────────────────────────────────────
async function getUserActivity(req, res, next) {
  try {
    const { userId } = req.params;
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip  = (page - 1) * limit;

    const user = await prisma.tenant.findUnique({ where: { id: userId } });
    if (!user) return next(new AppError('User not found', 404));

    const [sessions, total] = await Promise.all([
      prisma.userSession.findMany({
        where: { tenantId: userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.userSession.count({ where: { tenantId: userId } }),
    ]);

    return paginated(res, sessions, total, page, limit);
  } catch (err) {
    next(err);
  }
}

// ── SET USER AI MODEL ─────────────────────────────────────────
async function setUserAiModel(req, res, next) {
  try {
    const { userId }  = req.params;
    const { aiModel } = req.body;

    const validModels = ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'gpt-4o', 'gpt-4o-mini', 'deepseek-chat', 'sarvam-2b'];
    if (!aiModel || !validModels.includes(aiModel)) {
      return next(new ValidationError(`aiModel must be one of: ${validModels.join(', ')}`));
    }

    const user = await prisma.tenant.findUnique({ where: { id: userId } });
    if (!user) return next(new AppError('User not found', 404));

    await prisma.aiConfig.upsert({
      where:  { tenantId: userId },
      create: { tenantId: userId, aiModel },
      update: { aiModel },
    });

    // Bust the AI config cache for this tenant
    await cacheDel(`aiconfig:${userId}`);

    await prisma.adminAction.create({
      data: {
        adminId:    req.adminId,
        actionType: 'set_user_ai_model',
        targetType: 'tenant',
        targetId:   userId,
        metadata:   { aiModel },
        ipAddress:  req.ip,
      },
    });

    return success(res, {}, `AI model set to ${aiModel}`);
  } catch (err) {
    next(err);
  }
}

// ── GET AI MODEL ASSIGNMENTS ──────────────────────────────────
async function getAiModelAssignments(req, res, next) {
  try {
    const configs = await prisma.aiConfig.findMany({
      select: {
        tenantId: true,
        aiModel:  true,
        tenant:   { select: { businessName: true, email: true, status: true } },
      },
    });
    return success(res, { assignments: configs });
  } catch (err) {
    next(err);
  }
}

// ── UPDATE GLOBAL BASE PROMPT ─────────────────────────────────
async function updateGlobalBasePrompt(req, res, next) {
  try {
    const { prompt } = req.body;
    if (typeof prompt !== 'string') return next(new ValidationError('prompt string is required'));

    await prisma.globalSetting.upsert({
      where:  { key: 'global_base_prompt' },
      create: { key: 'global_base_prompt', value: prompt },
      update: { value: prompt },
    });

    // Bust the cached global prompt
    await cacheDel('global_base_prompt');

    await prisma.adminAction.create({
      data: {
        adminId:    req.adminId,
        actionType: 'update_global_base_prompt',
        ipAddress:  req.ip,
        metadata:   { length: prompt.length },
      },
    });

    return success(res, {}, 'Global base prompt updated');
  } catch (err) {
    next(err);
  }
}

// ── SET GLOBAL MIN GAP ────────────────────────────────────────
async function setGlobalMinGap(req, res, next) {
  try {
    const { minGapSeconds } = req.body;
    if (typeof minGapSeconds !== 'number' || minGapSeconds < 1) {
      return next(new ValidationError('minGapSeconds must be a positive number'));
    }

    await prisma.globalSetting.upsert({
      where:  { key: 'global_min_msg_gap' },
      create: { key: 'global_min_msg_gap', value: String(minGapSeconds) },
      update: { value: String(minGapSeconds) },
    });

    await cacheDel('global_min_msg_gap');

    return success(res, {}, `Global minimum message gap set to ${minGapSeconds}s`);
  } catch (err) {
    next(err);
  }
}

// ── LIST PLANS ────────────────────────────────────────────────
async function listPlans(req, res, next) {
  try {
    const plans = await prisma.plan.findMany({ orderBy: { price: 'asc' } });
    return success(res, { plans });
  } catch (err) {
    next(err);
  }
}

// ── CREATE PLAN ───────────────────────────────────────────────
async function createPlan(req, res, next) {
  try {
    const {
      name, displayName, price,
      maxNumbers, maxMessages, maxAiCalls, maxContacts,
      storageGb, maxCampaigns, maxFollowups,
      calendarEnabled, analyticsLevel, minMsgGapSeconds, supportLevel,
    } = req.body;

    if (!name || !displayName || price === undefined) {
      return next(new ValidationError('name, displayName and price are required'));
    }

    const existing = await prisma.plan.findUnique({ where: { name } });
    if (existing) return next(new AppError(`Plan with name "${name}" already exists`, 409));

    const plan = await prisma.plan.create({
      data: {
        name, displayName,
        price:            price,
        maxNumbers:       maxNumbers       ?? 1,
        maxMessages:      maxMessages      ?? 500,
        maxAiCalls:       maxAiCalls       ?? 100,
        maxContacts:      maxContacts      ?? 100,
        storageGb:        storageGb        ?? 0.05,
        maxCampaigns:     maxCampaigns     ?? 1,
        maxFollowups:     maxFollowups     ?? 1,
        calendarEnabled:  calendarEnabled  ?? false,
        analyticsLevel:   analyticsLevel   ?? 'basic',
        minMsgGapSeconds: minMsgGapSeconds ?? 10,
        supportLevel:     supportLevel     ?? 'ai',
      },
    });

    return success(res, { plan }, 'Plan created', 201);
  } catch (err) {
    next(err);
  }
}

// ── UPDATE PLAN ───────────────────────────────────────────────
async function updatePlan(req, res, next) {
  try {
    const { planId } = req.params;
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) return next(new AppError('Plan not found', 404));

    const allowedFields = [
      'displayName', 'price', 'maxNumbers', 'maxMessages', 'maxAiCalls',
      'maxContacts', 'storageGb', 'maxCampaigns', 'maxFollowups',
      'calendarEnabled', 'analyticsLevel', 'minMsgGapSeconds',
      'supportLevel', 'buttonsEnabled', 'listsEnabled', 'isActive',
    ];
    const data = {};
    allowedFields.forEach(f => { if (req.body[f] !== undefined) data[f] = req.body[f]; });

    const updated = await prisma.plan.update({ where: { id: planId }, data });
    return success(res, { plan: updated }, 'Plan updated');
  } catch (err) {
    next(err);
  }
}

// ── DELETE PLAN ───────────────────────────────────────────────
async function deletePlan(req, res, next) {
  try {
    const { planId } = req.params;
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) return next(new AppError('Plan not found', 404));

    // Check if any active tenants are on this plan
    const activeCount = await prisma.tenant.count({
      where: { planId, status: { in: ['active', 'trial'] } },
    });
    if (activeCount > 0) {
      return next(new AppError(`Cannot delete plan — ${activeCount} active tenant(s) are on this plan`, 409));
    }

    await prisma.plan.delete({ where: { id: planId } });
    return success(res, {}, 'Plan deleted');
  } catch (err) {
    next(err);
  }
}

// ── ASSIGN CUSTOM PACKAGE ──────────────────────────────────────
// Allows superadmin to set any combination of limits for a specific user
async function assignCustomPackage(req, res, next) {
  try {
    const { userId } = req.params;
    const {
      planId,
      buttonsEnabled, listsEnabled,
      maxMessages, maxAiCalls, maxContacts,
    } = req.body;

    const user = await prisma.tenant.findUnique({ where: { id: userId } });
    if (!user) return next(new AppError('User not found', 404));

    const updateData = {};
    if (planId          !== undefined) updateData.planId        = planId;
    if (buttonsEnabled  !== undefined) updateData.buttonsEnabled = buttonsEnabled;
    if (listsEnabled    !== undefined) updateData.listsEnabled   = listsEnabled;

    await prisma.tenant.update({ where: { id: userId }, data: updateData });

    await prisma.adminAction.create({
      data: {
        adminId:    req.adminId,
        actionType: 'change_plan',
        targetType: 'tenant',
        targetId:   userId,
        metadata:   req.body,
        ipAddress:  req.ip,
      },
    });

    return success(res, {}, 'Package updated for user');
  } catch (err) {
    next(err);
  }
}

// ── GET API KEYS ──────────────────────────────────────────────
async function getApiKeys(req, res, next) {
  try {
    const keys = await prisma.globalSetting.findMany({
      where: {
        key: {
          in: [
            'anthropic_api_key', 'openai_api_key',
            'deepseek_api_key', 'sarvam_api_key',
            'openrouter_api_key',
            'sendgrid_api_key', 'twilio_account_sid',
            'twilio_auth_token', 'twilio_phone',
            'razorpay_key_id', 'razorpay_key_secret', 'razorpay_webhook_secret',
            'google_client_id', 'google_client_secret',
            'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_secure',
            'email_from', 'email_from_name',
          ],
        },
      },
    });

    // Mask the values for display
    const masked = keys.reduce((acc, k) => {
      const val = k.value;
      acc[k.key] = val
        ? val.substring(0, 6) + '••••••' + val.substring(val.length - 4)
        : '';
      return acc;
    }, {});

    return success(res, { keys: masked });
  } catch (err) {
    next(err);
  }
}

// ── UPDATE API KEY ────────────────────────────────────────────
async function updateApiKey(req, res, next) {
  try {
    const { key, value } = req.body;
    if (!key || !value) return next(new ValidationError('key and value are required'));

    const allowedKeys = [
      'anthropic_api_key', 'openai_api_key', 'deepseek_api_key', 'sarvam_api_key',
      'openrouter_api_key',
      'sendgrid_api_key', 'twilio_account_sid', 'twilio_auth_token', 'twilio_phone',
      'razorpay_key_id', 'razorpay_key_secret', 'razorpay_webhook_secret',
      'google_client_id', 'google_client_secret',
      'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_secure',
      'email_from', 'email_from_name',
    ];
    if (!allowedKeys.includes(key)) return next(new AppError(`Unknown key: ${key}`, 400));

    await prisma.globalSetting.upsert({
      where:  { key },
      create: { key, value },
      update: { value },
    });

    // Clear the env-backed cache so the new key is picked up immediately
    await cacheDel(`setting:${key}`);

    await prisma.adminAction.create({
      data: {
        adminId:    req.adminId,
        actionType: 'update_api_key',
        metadata:   { key },
        ipAddress:  req.ip,
      },
    });

    return success(res, {}, `API key "${key}" updated`);
  } catch (err) {
    next(err);
  }
}

// ── LIST SUBSCRIPTIONS ────────────────────────────────────────
async function listSubscriptions(req, res, next) {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 25;
    const skip  = (page - 1) * limit;

    const [subs, total] = await Promise.all([
      prisma.subscription.findMany({
        skip, take: limit,
        orderBy: { startDate: 'desc' },
        include: {
          tenant: { select: { businessName: true, email: true } },
          plan:   { select: { displayName: true, price: true } },
        },
      }),
      prisma.subscription.count(),
    ]);

    return paginated(res, subs, total, page, limit);
  } catch (err) {
    next(err);
  }
}

// ── ISSUE CREDIT ──────────────────────────────────────────────
async function issueCredit(req, res, next) {
  try {
    const { userId }  = req.params;
    const { days, reason } = req.body;
    if (!days || days < 1) return next(new ValidationError('days must be a positive integer'));

    const user = await prisma.tenant.findUnique({ where: { id: userId } });
    if (!user) return next(new AppError('User not found', 404));

    // Extend the active subscription by `days`
    const activeSub = await prisma.subscription.findFirst({
      where: { tenantId: userId, status: 'active' },
      orderBy: { startDate: 'desc' },
    });

    if (activeSub?.endDate) {
      const newEnd = new Date(activeSub.endDate.getTime() + days * 24 * 60 * 60 * 1000);
      await prisma.subscription.update({
        where: { id: activeSub.id },
        data:  { endDate: newEnd },
      });
    } else if (user.trialEndsAt) {
      const newTrial = new Date(user.trialEndsAt.getTime() + days * 24 * 60 * 60 * 1000);
      await prisma.tenant.update({
        where: { id: userId },
        data:  { trialEndsAt: newTrial },
      });
    }

    await prisma.adminAction.create({
      data: {
        adminId:    req.adminId,
        actionType: 'issue_credit',
        targetType: 'tenant',
        targetId:   userId,
        metadata:   { days, reason: reason || '' },
        ipAddress:  req.ip,
      },
    });

    return success(res, {}, `${days} day(s) of credit issued to user`);
  } catch (err) {
    next(err);
  }
}

// ── LIST PAYMENTS ─────────────────────────────────────────────
async function listPayments(req, res, next) {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 25;
    const skip  = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      prisma.subscription.findMany({
        where:   { razorpayPaymentId: { not: null } },
        skip, take: limit,
        orderBy: { startDate: 'desc' },
        include: {
          tenant: { select: { businessName: true, email: true } },
          plan:   { select: { displayName: true } },
        },
      }),
      prisma.subscription.count({ where: { razorpayPaymentId: { not: null } } }),
    ]);

    return paginated(res, payments, total, page, limit);
  } catch (err) {
    next(err);
  }
}

// ── LIST AFFILIATES ───────────────────────────────────────────
async function listAffiliates(req, res, next) {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 25;
    const skip  = (page - 1) * limit;

    const [affiliates, total] = await Promise.all([
      prisma.affiliate.findMany({
        skip, take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, email: true, phone: true, code: true,
          commissionRate: true, status: true,
          totalEarned: true, totalPaid: true, pendingPayout: true,
          lastLoginAt: true, createdAt: true,
          _count: { select: { referrals: true } },
        },
      }),
      prisma.affiliate.count(),
    ]);

    return paginated(res, affiliates, total, page, limit);
  } catch (err) {
    next(err);
  }
}

// ── CREATE AFFILIATE ──────────────────────────────────────────
async function createAffiliate(req, res, next) {
  try {
    const { name, email, phone, commissionRate, customCode } = req.body;
    if (!name || !email) return next(new ValidationError('name and email are required'));

    const existing = await prisma.affiliate.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) return next(new AppError('Email already registered as affiliate', 409));

    // Generate a unique code
    const code = customCode
      ? customCode.toUpperCase()
      : `AFF-${name.split(' ')[0].toUpperCase().slice(0, 6)}-${Math.floor(1000 + Math.random() * 9000)}`;

    const existingCode = await prisma.affiliate.findUnique({ where: { code } });
    if (existingCode) return next(new AppError('Affiliate code already in use. Try a different custom code.', 409));

    // Default password — affiliate must change on first login
    const tempPassword = `Aff@${Math.floor(10000 + Math.random() * 90000)}`;
    const hashed       = await bcrypt.hash(tempPassword, 12);

    const affiliate = await prisma.affiliate.create({
      data: {
        name,
        email:          email.toLowerCase(),
        password:       hashed,
        phone:          phone || null,
        code,
        commissionRate: commissionRate ?? 0.20,
        status:         'active',
      },
    });

    const { password: _, ...safeAffiliate } = affiliate;
    return success(res, { affiliate: safeAffiliate, tempPassword }, 'Affiliate created', 201);
  } catch (err) {
    next(err);
  }
}

// ── UPDATE AFFILIATE ──────────────────────────────────────────
async function updateAffiliate(req, res, next) {
  try {
    const { affiliateId } = req.params;
    const { name, phone, commissionRate } = req.body;

    const affiliate = await prisma.affiliate.findUnique({ where: { id: affiliateId } });
    if (!affiliate) return next(new AppError('Affiliate not found', 404));

    const updated = await prisma.affiliate.update({
      where: { id: affiliateId },
      data: {
        ...(name           !== undefined && { name }),
        ...(phone          !== undefined && { phone }),
        ...(commissionRate !== undefined && { commissionRate }),
      },
    });

    const { password: _, ...safe } = updated;
    return success(res, { affiliate: safe }, 'Affiliate updated');
  } catch (err) {
    next(err);
  }
}

// ── BLOCK AFFILIATE ───────────────────────────────────────────
async function blockAffiliate(req, res, next) {
  try {
    const { affiliateId } = req.params;
    const { reason }      = req.body;

    const affiliate = await prisma.affiliate.findUnique({ where: { id: affiliateId } });
    if (!affiliate) return next(new AppError('Affiliate not found', 404));

    await prisma.affiliate.update({
      where: { id: affiliateId },
      data:  { status: 'suspended' },
    });

    await prisma.adminAction.create({
      data: {
        adminId:    req.adminId,
        actionType: 'block_affiliate',
        targetType: 'affiliate',
        targetId:   affiliateId,
        metadata:   { reason: reason || '' },
        ipAddress:  req.ip,
      },
    });

    return success(res, {}, 'Affiliate blocked');
  } catch (err) {
    next(err);
  }
}

// ── LIST PAYOUT REQUESTS ──────────────────────────────────────
async function listPayoutRequests(req, res, next) {
  try {
    const page   = parseInt(req.query.page)  || 1;
    const limit  = parseInt(req.query.limit) || 25;
    const skip   = (page - 1) * limit;
    const status = req.query.status || 'pending';

    const [payouts, total] = await Promise.all([
      prisma.affiliatePayout.findMany({
        where:   { status },
        skip, take: limit,
        orderBy: { requestedAt: 'desc' },
        include: { affiliate: { select: { name: true, email: true, code: true } } },
      }),
      prisma.affiliatePayout.count({ where: { status } }),
    ]);

    return paginated(res, payouts, total, page, limit);
  } catch (err) {
    next(err);
  }
}

// ── PROCESS PAYOUT ────────────────────────────────────────────
async function processPayout(req, res, next) {
  try {
    const { payoutId }  = req.params;
    const { reference, note } = req.body;

    const payout = await prisma.affiliatePayout.findUnique({
      where: { id: payoutId },
      include: { affiliate: true },
    });
    if (!payout) return next(new AppError('Payout request not found', 404));
    if (payout.status === 'paid') return next(new AppError('Payout already processed', 409));

    await prisma.affiliatePayout.update({
      where: { id: payoutId },
      data: {
        status:      'paid',
        reference:   reference || null,
        note:        note || null,
        processedAt: new Date(),
      },
    });

    // Deduct from affiliate's pending balance and add to total paid
    await prisma.affiliate.update({
      where: { id: payout.affiliateId },
      data: {
        pendingPayout: { decrement: payout.amount },
        totalPaid:     { increment: payout.amount },
      },
    });

    await prisma.adminAction.create({
      data: {
        adminId:    req.adminId,
        actionType: 'payout_approved',
        targetType: 'affiliate',
        targetId:   payout.affiliateId,
        metadata:   { amount: payout.amount, reference: reference || '' },
        ipAddress:  req.ip,
      },
    });

    return success(res, {}, 'Payout marked as paid');
  } catch (err) {
    next(err);
  }
}

// ── OTP SETTINGS ──────────────────────────────────────────────
async function getOtpSettings(req, res, next) {
  try {
    const keys = ['otp_provider', 'otp_sms_template', 'otp_expiry_minutes',
                  'otp_resend_limit', 'otp_whitelist_phones'];
    const settings = await prisma.globalSetting.findMany({ where: { key: { in: keys } } });
    const result = settings.reduce((acc, s) => { acc[s.key] = s.value; return acc; }, {});
    return success(res, { settings: result });
  } catch (err) {
    next(err);
  }
}

async function updateOtpSettings(req, res, next) {
  try {
    const allowed = ['otp_provider', 'otp_sms_template', 'otp_expiry_minutes',
                     'otp_resend_limit', 'otp_whitelist_phones'];
    const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
    if (updates.length === 0) return next(new ValidationError('No valid settings provided'));

    await Promise.all(
      updates.map(([key, value]) =>
        prisma.globalSetting.upsert({
          where: { key }, create: { key, value: String(value) }, update: { value: String(value) },
        })
      )
    );

    return success(res, {}, 'OTP settings updated');
  } catch (err) {
    next(err);
  }
}

// ── STORAGE STATS ─────────────────────────────────────────────
async function getStorageStats(req, res, next) {
  try {
    const tenants = await prisma.tenant.findMany({
      where: { status: { not: 'deleted' } },
      select: {
        id: true, businessName: true, email: true,
        storageUsedMb: true,
        plan: { select: { storageGb: true } },
      },
      orderBy: { storageUsedMb: 'desc' },
    });

    const totalUsedMb = tenants.reduce((sum, t) => sum + (t.storageUsedMb || 0), 0);
    const docCount    = await prisma.knowledgeDoc.count();

    return success(res, {
      totalUsedMb: Math.round(totalUsedMb * 100) / 100,
      totalUsedGb: Math.round(totalUsedMb / 1024 * 100) / 100,
      documentCount: docCount,
      perTenant: tenants.map(t => ({
        id:           t.id,
        businessName: t.businessName,
        email:        t.email,
        storageUsedMb: t.storageUsedMb,
        limitGb:      t.plan?.storageGb || 0.05,
      })),
    });
  } catch (err) {
    next(err);
  }
}

async function cleanupStorage(req, res, next) {
  try {
    const { olderThanDays = 90 } = req.body;
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    const deleted = await prisma.knowledgeDoc.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    return success(res, { deleted: deleted.count }, `Cleaned up ${deleted.count} old document(s)`);
  } catch (err) {
    next(err);
  }
}

// ── THEMES ────────────────────────────────────────────────────
async function listThemes(req, res, next) {
  try {
    const themeSetting = await prisma.globalSetting.findUnique({ where: { key: 'themes_json' } });
    const themes = themeSetting ? JSON.parse(themeSetting.value) : getDefaultThemes();
    return success(res, { themes });
  } catch (err) {
    next(err);
  }
}

async function createTheme(req, res, next) {
  try {
    const { id, name, primaryColor, accentColor, bgColor, font } = req.body;
    if (!id || !name || !primaryColor) {
      return next(new ValidationError('id, name and primaryColor are required'));
    }

    const themeSetting = await prisma.globalSetting.findUnique({ where: { key: 'themes_json' } });
    const themes = themeSetting ? JSON.parse(themeSetting.value) : getDefaultThemes();

    if (themes.find(t => t.id === id)) {
      return next(new AppError(`Theme with id "${id}" already exists`, 409));
    }

    themes.push({ id, name, primaryColor, accentColor: accentColor || primaryColor, bgColor: bgColor || '#0f172a', font: font || 'Inter' });

    await prisma.globalSetting.upsert({
      where: { key: 'themes_json' },
      create: { key: 'themes_json', value: JSON.stringify(themes) },
      update: { value: JSON.stringify(themes) },
    });

    return success(res, { themes }, 'Theme created', 201);
  } catch (err) {
    next(err);
  }
}

async function setDefaultTheme(req, res, next) {
  try {
    const { themeId } = req.body;
    if (!themeId) return next(new ValidationError('themeId is required'));

    await prisma.globalSetting.upsert({
      where: { key: 'default_theme' },
      create: { key: 'default_theme', value: themeId },
      update: { value: themeId },
    });

    return success(res, {}, `Default theme set to "${themeId}"`);
  } catch (err) {
    next(err);
  }
}

async function assignTheme(req, res, next) {
  try {
    const { userId }  = req.params;
    const { themeId } = req.body;
    if (!themeId) return next(new ValidationError('themeId is required'));

    const user = await prisma.tenant.findUnique({ where: { id: userId } });
    if (!user) return next(new AppError('User not found', 404));

    await prisma.tenant.update({ where: { id: userId }, data: { themeId } });
    return success(res, {}, `Theme "${themeId}" assigned to user`);
  } catch (err) {
    next(err);
  }
}

// ── ACTIVITY MONITOR ──────────────────────────────────────────
async function getActivityMonitor(req, res, next) {
  try {
    const now    = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const dayAgo  = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      messagesLastHour,
      messagesLastDay,
      aiCallsLastHour,
      disconnectedSessions,
      churnRiskUsers,
      newUsersToday,
    ] = await Promise.all([
      prisma.message.count({ where: { timestamp: { gte: hourAgo } } }),
      prisma.message.count({ where: { timestamp: { gte: dayAgo } } }),
      prisma.apiUsage.count({ where: { timestamp: { gte: hourAgo } } }),
      prisma.tenantNumber.count({
        where: { sessionStatus: 'disconnected', updatedAt: { gte: dayAgo } },
      }),
      prisma.tenant.count({
        where: {
          status: 'active',
          OR: [
            { lastActiveAt: null },
            { lastActiveAt: { lt: monthAgo } },
          ],
        },
      }),
      prisma.tenant.count({
        where: { createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) } },
      }),
    ]);

    return success(res, {
      realtime: {
        messagesLastHour,
        aiCallsLastHour,
      },
      daily: {
        messagesLastDay,
        newUsersToday,
        disconnectedSessions,
      },
      churnRisk: {
        usersInactive30Days: churnRiskUsers,
      },
    });
  } catch (err) {
    next(err);
  }
}

// ── SUPPORT AI CONFIG ─────────────────────────────────────────
async function getSupportAiConfig(req, res, next) {
  try {
    const keys = ['support_ai_prompt', 'support_ai_model', 'support_ai_enabled'];
    const settings = await prisma.globalSetting.findMany({ where: { key: { in: keys } } });
    const result = settings.reduce((acc, s) => { acc[s.key] = s.value; return acc; }, {});
    return success(res, { config: result });
  } catch (err) {
    next(err);
  }
}

async function updateSupportAiConfig(req, res, next) {
  try {
    const allowed = ['support_ai_prompt', 'support_ai_model', 'support_ai_enabled'];
    const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
    if (updates.length === 0) return next(new ValidationError('No valid config keys provided'));

    await Promise.all(
      updates.map(([key, value]) =>
        prisma.globalSetting.upsert({
          where: { key }, create: { key, value: String(value) }, update: { value: String(value) },
        })
      )
    );

    await cacheDel('support_ai_config');
    return success(res, {}, 'Support AI config updated');
  } catch (err) {
    next(err);
  }
}

// ── SUPPORT TICKETS ───────────────────────────────────────────
async function listSupportTickets(req, res, next) {
  try {
    const page   = parseInt(req.query.page)  || 1;
    const limit  = parseInt(req.query.limit) || 25;
    const skip   = (page - 1) * limit;
    const status = req.query.status;

    const where = status ? { status } : {};
    const [tickets, total] = await Promise.all([
      prisma.supportTicket.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: { tenant: { select: { businessName: true, email: true } } },
      }),
      prisma.supportTicket.count({ where }),
    ]);

    return paginated(res, tickets, total, page, limit);
  } catch (err) {
    next(err);
  }
}

async function resolveSupportTicket(req, res, next) {
  try {
    const { ticketId } = req.params;

    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) return next(new AppError('Ticket not found', 404));

    await prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: 'resolved', resolvedAt: new Date() },
    });

    return success(res, {}, 'Ticket resolved');
  } catch (err) {
    next(err);
  }
}

// ── ADMIN ACTION LOGS ───────────────────────────────────────────
async function listAdminActions(req, res, next) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const skip = (page - 1) * limit;

    const [actions, total] = await Promise.all([
      prisma.adminAction.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          admin: { select: { id: true, email: true, name: true } },
        },
      }),
      prisma.adminAction.count(),
    ]);

    return paginated(res, actions, total, page, limit);
  } catch (err) {
    next(err);
  }
}

// ── USER LOGIN SESSIONS ─────────────────────────────────────────
async function listUserSessions(req, res, next) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const skip = (page - 1) * limit;

    const [sessions, total] = await Promise.all([
      prisma.userSession.findMany({
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          tenant: { select: { id: true, businessName: true, email: true, status: true } },
        },
      }),
      prisma.userSession.count(),
    ]);

    return paginated(res, sessions, total, page, limit);
  } catch (err) {
    next(err);
  }
}

// ── TOKEN/API USAGE ─────────────────────────────────────────────
async function listTokenUsage(req, res, next) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 25;
    const skip = (page - 1) * limit;

    const [usage, total, summary] = await Promise.all([
      prisma.apiUsage.findMany({
        skip,
        take: limit,
        orderBy: { timestamp: 'desc' },
        include: {
          tenant: { select: { id: true, businessName: true, email: true } },
        },
      }),
      prisma.apiUsage.count(),
      prisma.apiUsage.groupBy({
        by: ['provider'],
        _sum: { inputTokens: true, outputTokens: true, costUsd: true },
        _count: { id: true },
        orderBy: { _sum: { costUsd: 'desc' } },
      }),
    ]);

    return paginated(res, { data: usage, summaryByProvider: summary }, total, page, limit);
  } catch (err) {
    next(err);
  }
}

// ── EMAIL SETTINGS ──────────────────────────────────────────────
async function getEmailSettings(req, res, next) {
  try {
    const keys = [
      'smtp_host',
      'smtp_port',
      'smtp_user',
      'smtp_pass',
      'smtp_secure',
      'email_from',
      'email_from_name',
      'sendgrid_api_key',
    ];
    const settings = await prisma.globalSetting.findMany({ where: { key: { in: keys } } });
    const map = settings.reduce((acc, item) => {
      acc[item.key] = item.value;
      return acc;
    }, {});

    return success(res, {
      settings: {
        smtp_host: map.smtp_host || '',
        smtp_port: map.smtp_port || '587',
        smtp_user: map.smtp_user ? maskSecret(map.smtp_user) : '',
        smtp_pass: map.smtp_pass ? 'Configured' : '',
        smtp_secure: toBooleanString(map.smtp_secure || 'false'),
        email_from: map.email_from || process.env.EMAIL_FROM || '',
        email_from_name: map.email_from_name || process.env.EMAIL_FROM_NAME || '',
        sendgrid_api_key: map.sendgrid_api_key ? 'Configured' : '',
      },
    });
  } catch (err) {
    next(err);
  }
}

async function updateEmailSettings(req, res, next) {
  try {
    const allowed = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_secure', 'email_from', 'email_from_name'];
    const updates = Object.entries(req.body || {}).filter(([k]) => allowed.includes(k));
    if (!updates.length) return next(new ValidationError('No valid email settings provided'));

    await Promise.all(updates.map(([key, value]) => prisma.globalSetting.upsert({
      where: { key },
      create: { key, value: String(value ?? '') },
      update: { value: String(value ?? '') },
    })));

    await Promise.all(updates.map(([key]) => cacheDel(`setting:${key}`)));
    await prisma.adminAction.create({
      data: {
        adminId: req.adminId,
        actionType: 'update_email_settings',
        metadata: { keys: updates.map(([k]) => k) },
        ipAddress: req.ip,
      },
    });

    return success(res, {}, 'Email settings updated');
  } catch (err) {
    next(err);
  }
}

// ── TEST / CUSTOM EMAIL ─────────────────────────────────────────
async function testEmailSettings(req, res, next) {
  try {
    const { to } = req.body || {};
    if (!to) return next(new ValidationError('to is required'));
    const { transport, cfg } = await getReusableTransport();

    await transport.sendMail({
      from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
      to,
      subject: 'WaizAI Superadmin test email',
      text: 'This is a test email from WaizAI superadmin panel.',
      html: '<p>This is a test email from <strong>WaizAI superadmin panel</strong>.</p>',
    });

    await prisma.adminAction.create({
      data: {
        adminId: req.adminId,
        actionType: 'test_email_settings',
        metadata: { to },
        ipAddress: req.ip,
      },
    });

    return success(res, {}, 'Test email sent successfully');
  } catch (err) {
    next(err);
  }
}

async function sendCustomEmail(req, res, next) {
  try {
    const { to, subject, html, text } = req.body || {};
    if (!to || !subject || (!html && !text)) {
      return next(new ValidationError('to, subject and one of html/text are required'));
    }
    const { transport, cfg } = await getReusableTransport();
    const sanitizedHtml = html ? sanitizeCustomEmailHtml(html) : undefined;
    const normalizedText = text ? String(text).slice(0, 20000) : undefined;
    if (!sanitizedHtml && !normalizedText) {
      return next(new ValidationError('Email body is empty after sanitization'));
    }

    await transport.sendMail({
      from: `"${cfg.fromName}" <${cfg.fromEmail}>`,
      to,
      subject,
      html: sanitizedHtml,
      text: normalizedText,
    });

    await prisma.adminAction.create({
      data: {
        adminId: req.adminId,
        actionType: 'send_custom_email',
        metadata: { to, subjectLength: String(subject).length },
        ipAddress: req.ip,
      },
    });

    return success(res, {}, 'Custom email sent');
  } catch (err) {
    next(err);
  }
}

// ── HELPERS ────────────────────────────────────────────────────
function getDefaultThemes() {
  return [
    { id: 'dark-green',  name: 'Dark Green',  primaryColor: '#25D366', accentColor: '#128C7E', bgColor: '#0f172a', font: 'Inter' },
    { id: 'dark-blue',   name: 'Dark Blue',   primaryColor: '#3B82F6', accentColor: '#1D4ED8', bgColor: '#0f172a', font: 'Inter' },
    { id: 'dark-purple', name: 'Dark Purple', primaryColor: '#8B5CF6', accentColor: '#7C3AED', bgColor: '#0f172a', font: 'Inter' },
    { id: 'dark-orange', name: 'Dark Orange', primaryColor: '#F97316', accentColor: '#EA580C', bgColor: '#0f172a', font: 'Inter' },
    { id: 'light',       name: 'Light',       primaryColor: '#25D366', accentColor: '#128C7E', bgColor: '#F8FAFC', font: 'Inter' },
  ];
}

module.exports = {
  superAdminLogin, superAdminRefresh,
  getPlatformStats,
  listUsers, getUser, suspendUser, unsuspendUser, deleteUser,
  resetUserPassword, loginAsUser, getUserActivity,
  setUserAiModel, getAiModelAssignments,
  updateGlobalBasePrompt, setGlobalMinGap,
  listPlans, createPlan, updatePlan, deletePlan,
  assignCustomPackage,
  getApiKeys, updateApiKey,
  listSubscriptions, issueCredit, listPayments,
  listAffiliates, createAffiliate, updateAffiliate,
  blockAffiliate, listPayoutRequests, processPayout,
  getOtpSettings, updateOtpSettings,
  getStorageStats, cleanupStorage,
  listThemes, createTheme, setDefaultTheme, assignTheme,
  getActivityMonitor,
  getSupportAiConfig, updateSupportAiConfig,
  listSupportTickets, resolveSupportTicket,
  listAdminActions, listUserSessions, listTokenUsage,
  getEmailSettings, updateEmailSettings, testEmailSettings, sendCustomEmail,
};
