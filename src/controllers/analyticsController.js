// src/controllers/analyticsController.js
const prisma  = require('../config/database');
const { success } = require('../utils/response');
const logger  = require('../config/logger');

// ── DASHBOARD OVERVIEW ────────────────────────────────────────
async function getDashboardStats(req, res, next) {
  try {
    const tenantId = req.tenantId;
    const now      = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      totalMessages,
      todayMessages,
      aiMessages,
      humanMessages,
      totalContacts,
      activeContacts,
      appointmentsToday,
      connectedNumbers,
      tenant,
    ] = await Promise.all([
      prisma.message.count({ where: { tenantId } }),
      prisma.message.count({ where: { tenantId, timestamp: { gte: todayStart } } }),
      prisma.message.count({ where: { tenantId, aiSent: true } }),
      prisma.message.count({ where: { tenantId, direction: 'outbound', aiSent: false } }),
      prisma.contact.count({ where: { tenantId } }),
      prisma.contact.count({ where: { tenantId, lastMessageAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } }),
      prisma.appointment.count({ where: { tenantId, startTime: { gte: todayStart, lt: new Date(todayStart.getTime() + 86400000) } } }),
      prisma.tenantNumber.count({ where: { tenantId, sessionStatus: 'connected' } }),
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { messagesThisMonth: true, aiCallsThisMonth: true } }),
    ]);

    const aiHandleRate = totalMessages > 0 ? Math.round((aiMessages / (aiMessages + humanMessages)) * 100) : 0;

    return success(res, {
      messages: {
        total: totalMessages,
        today: todayMessages,
        aiHandled: aiMessages,
        humanHandled: humanMessages,
        aiHandleRate,
        thisMonth: tenant?.messagesThisMonth || 0,
      },
      contacts: {
        total: totalContacts,
        active7Days: activeContacts,
      },
      appointments: {
        today: appointmentsToday,
      },
      aiCalls: {
        thisMonth: tenant?.aiCallsThisMonth || 0,
      },
      connectedNumbers,
    });
  } catch (err) {
    next(err);
  }
}

// ── MESSAGES BY DAY (last N days) ─────────────────────────────
async function getMessagesByDay(req, res, next) {
  try {
    const days = parseInt(req.query.days) || 30;
    const tenantId = req.tenantId;

    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const messages = await prisma.message.findMany({
      where: { tenantId, timestamp: { gte: from } },
      select: { timestamp: true, direction: true, aiSent: true },
    });

    // Group by date
    const grouped = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - (days - 1 - i) * 24 * 60 * 60 * 1000);
      const key = d.toISOString().split('T')[0];
      grouped[key] = { date: key, total: 0, inbound: 0, outbound: 0, ai: 0 };
    }

    for (const msg of messages) {
      const key = msg.timestamp.toISOString().split('T')[0];
      if (grouped[key]) {
        grouped[key].total++;
        if (msg.direction === 'inbound') grouped[key].inbound++;
        else grouped[key].outbound++;
        if (msg.aiSent) grouped[key].ai++;
      }
    }

    return success(res, { data: Object.values(grouped) });
  } catch (err) {
    next(err);
  }
}

// ── TOP CONTACTS ──────────────────────────────────────────────
async function getTopContacts(req, res, next) {
  try {
    const limit = parseInt(req.query.limit) || 10;

    const contacts = await prisma.contact.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { messageCount: 'desc' },
      take: limit,
      select: { id: true, name: true, phoneNumber: true, label: true, messageCount: true, lastMessageAt: true },
    });

    return success(res, { contacts });
  } catch (err) {
    next(err);
  }
}

// ── CAMPAIGN ANALYTICS ────────────────────────────────────────
async function getCampaignStats(req, res, next) {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { tenantId: req.tenantId },
      select: {
        id: true, name: true, status: true, sentCount: true,
        deliveredCount: true, readCount: true, replyCount: true, failedCount: true,
        startedAt: true, completedAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const totals = campaigns.reduce((acc, c) => {
      acc.sent      += c.sentCount;
      acc.delivered += c.deliveredCount;
      acc.read      += c.readCount;
      acc.replied   += c.replyCount;
      acc.failed    += c.failedCount;
      return acc;
    }, { sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 });

    return success(res, { campaigns, totals });
  } catch (err) {
    next(err);
  }
}

// ── FOLLOWUP ANALYTICS ────────────────────────────────────────
async function getFollowupStats(req, res, next) {
  try {
    const sequences = await prisma.followupSequence.findMany({
      where: { tenantId: req.tenantId },
      select: {
        id: true, name: true, isActive: true, sentCount: true, replyCount: true,
        _count: { select: { enrollments: true } },
      },
    });

    return success(res, { sequences });
  } catch (err) {
    next(err);
  }
}

// ── API USAGE (visible to user - no model details) ────────────
async function getApiUsage(req, res, next) {
  try {
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const usage = await prisma.apiUsage.groupBy({
      by: ['provider'],
      where: { tenantId: req.tenantId, timestamp: { gte: from } },
      _sum: { inputTokens: true, outputTokens: true, costUsd: true },
      _count: { id: true },
    });

    const totalCost   = usage.reduce((a, u) => a + (u._sum.costUsd || 0), 0);
    const totalCalls  = usage.reduce((a, u) => a + u._count.id, 0);

    // Do NOT expose provider/model breakdown to client
    return success(res, {
      totalCallsThisMonth:  totalCalls,
      estimatedCostUsd:     parseFloat(totalCost.toFixed(4)),
    });
  } catch (err) {
    next(err);
  }
}

// ── RESPONSE TIME ANALYTICS ────────────────────────────────────
async function getResponseTimes(req, res, next) {
  try {
    // Simplified: compare inbound vs next outbound timestamps
    const recent = await prisma.message.findMany({
      where: { tenantId: req.tenantId, direction: 'inbound', timestamp: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      orderBy: { timestamp: 'desc' },
      take: 200,
      select: { contactId: true, timestamp: true },
    });

    // For each inbound, find next outbound from same contact
    const responseTimes = [];
    for (const msg of recent) {
      const nextOut = await prisma.message.findFirst({
        where: {
          tenantId: req.tenantId,
          contactId: msg.contactId,
          direction: 'outbound',
          timestamp: { gt: msg.timestamp },
        },
        orderBy: { timestamp: 'asc' },
        select: { timestamp: true, aiSent: true },
      });
      if (nextOut) {
        const diffMs = nextOut.timestamp.getTime() - msg.timestamp.getTime();
        responseTimes.push({ diffSec: diffMs / 1000, aiSent: nextOut.aiSent });
      }
    }

    if (!responseTimes.length) return success(res, { avgAiSec: 0, avgHumanSec: 0, fastest: 0, slowest: 0 });

    const aiTimes    = responseTimes.filter(r => r.aiSent).map(r => r.diffSec);
    const humanTimes = responseTimes.filter(r => !r.aiSent).map(r => r.diffSec);
    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const all = responseTimes.map(r => r.diffSec);

    return success(res, {
      avgAiSec:    parseFloat(avg(aiTimes).toFixed(1)),
      avgHumanSec: parseFloat(avg(humanTimes).toFixed(1)),
      fastest:     parseFloat(Math.min(...all).toFixed(1)),
      slowest:     parseFloat(Math.max(...all).toFixed(1)),
    });
  } catch (err) {
    next(err);
  }
}

// ── CONTACT LABEL BREAKDOWN ────────────────────────────────────
async function getLabelBreakdown(req, res, next) {
  try {
    const groups = await prisma.contact.groupBy({
      by: ['label'],
      where: { tenantId: req.tenantId },
      _count: { id: true },
    });
    return success(res, { labels: groups.map(g => ({ label: g.label, count: g._count.id })) });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getDashboardStats, getMessagesByDay, getTopContacts,
  getCampaignStats, getFollowupStats, getApiUsage,
  getResponseTimes, getLabelBreakdown,
};
