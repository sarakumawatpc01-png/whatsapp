// src/controllers/aiController.js
const prisma  = require('../config/database');
const path    = require('path');
const ExcelJS = require('exceljs');
const { AppError, ValidationError } = require('../utils/errors');
const { success } = require('../utils/response');
const { cacheDel } = require('../config/redis');
const { generateAIReply } = require('../ai/modelRouter');
const { buildSystemPrompt } = require('../ai/promptBuilder');
const logger  = require('../config/logger');

// ── GET AI CONFIG ─────────────────────────────────────────────
async function getAiConfig(req, res, next) {
  try {
    let config = await prisma.aiConfig.findUnique({ where: { tenantId: req.tenantId } });
    if (!config) {
      config = await prisma.aiConfig.create({ data: { tenantId: req.tenantId } });
    }

    // IMPORTANT: Never expose aiModel to the client — superadmin only
    const { aiModel, ...safeConfig } = config;
    return success(res, { config: safeConfig });
  } catch (err) {
    next(err);
  }
}

// ── UPDATE AI CONFIG ──────────────────────────────────────────
async function updateAiConfig(req, res, next) {
  try {
    // Explicitly whitelist updatable fields — never allow aiModel from client
    const allowedFields = [
      'tone', 'language', 'businessDescription', 'productsServices', 'priceRange',
      'popularItems', 'currentOffers', 'brands', 'usp', 'warrantyPolicy',
      'deliveryInfo', 'paymentMethods', 'customInstructions', 'avoidTopics',
      'escalationTriggers', 'outOfHoursMsg', 'maxResponseChars', 'responseDelaySec',
      'autoReact', 'replyInGroups', 'sendTypingIndicator', 'mentionUsersInReply',
      'businessHours', 'faqs',
    ];

    const data = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        data[field] = req.body[field];
      }
    }

    if (!Object.keys(data).length) {
      return next(new ValidationError('No valid fields provided to update'));
    }

    const config = await prisma.aiConfig.upsert({
      where: { tenantId: req.tenantId },
      create: { tenantId: req.tenantId, ...data },
      update: data,
    });

    // Invalidate cache
    await cacheDel(`aiconfig:${req.tenantId}`);

    const { aiModel, ...safeConfig } = config;
    return success(res, { config: safeConfig }, 'AI configuration saved');
  } catch (err) {
    next(err);
  }
}

// ── TEST AI REPLY ─────────────────────────────────────────────
async function testAIReply(req, res, next) {
  try {
    const { message } = req.body;
    if (!message) return next(new ValidationError('message is required'));

    const config = await prisma.aiConfig.findUnique({ where: { tenantId: req.tenantId } });
    if (!config) return next(new AppError('Please configure your AI agent first', 400));

    const systemPrompt = buildSystemPrompt(config, null);
    const { text } = await generateAIReply({
      systemPrompt,
      history: [],
      userMessage: message,
      tenantId: req.tenantId,
      maxChars: config.maxResponseChars || 300,
    });

    return success(res, { reply: text }, 'Test reply generated');
  } catch (err) {
    next(err);
  }
}

// ── LIST KNOWLEDGE DOCS ───────────────────────────────────────
async function listKnowledgeDocs(req, res, next) {
  try {
    const docs = await prisma.knowledgeDoc.findMany({
      where: { tenantId: req.tenantId },
      select: {
        id: true, originalName: true, mimeType: true, sizeBytes: true,
        isIndexed: true, indexedAt: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, { docs });
  } catch (err) {
    next(err);
  }
}

// ── UPLOAD KNOWLEDGE DOC ──────────────────────────────────────
async function uploadKnowledgeDoc(req, res, next) {
  try {
    if (!req.file) return next(new ValidationError('File is required'));

    // Check storage quota
    const tenant = await prisma.tenant.findUnique({
      where: { id: req.tenantId },
      include: { plan: true },
    });
    const maxStorageMb  = (tenant.plan?.storageGb || 0.05) * 1024;
    const fileSizeMb    = req.file.size / (1024 * 1024);
    if (tenant.storageUsedMb + fileSizeMb > maxStorageMb) {
      return next(new AppError('Storage quota exceeded. Please upgrade your plan or delete old files.', 403));
    }

    // In production: upload to S3. Here we save metadata and extract text.
    const filename     = `${req.tenantId}/${Date.now()}-${req.file.originalname}`;
    const extractedText = await extractText(req.file);

    const doc = await prisma.knowledgeDoc.create({
      data: {
        tenantId:     req.tenantId,
        filename,
        originalName: req.file.originalname,
        s3Key:        filename,
        s3Url:        `/uploads/${filename}`,
        mimeType:     req.file.mimetype,
        sizeBytes:    req.file.size,
        extractedText,
        isIndexed:    Boolean(extractedText),
        indexedAt:    extractedText ? new Date() : null,
      },
    });

    // Update storage used
    await prisma.tenant.update({
      where: { id: req.tenantId },
      data: { storageUsedMb: { increment: fileSizeMb } },
    });

    // Invalidate AI config cache (knowledge base changed)
    await cacheDel(`aiconfig:${req.tenantId}`);

    return success(res, {
      doc: {
        id: doc.id,
        originalName: doc.originalName,
        mimeType: doc.mimeType,
        sizeBytes: doc.sizeBytes,
        isIndexed: doc.isIndexed,
      },
    }, 'Document uploaded and indexed', 201);
  } catch (err) {
    next(err);
  }
}

// ── DELETE KNOWLEDGE DOC ──────────────────────────────────────
async function deleteKnowledgeDoc(req, res, next) {
  try {
    const { docId } = req.params;

    const doc = await prisma.knowledgeDoc.findFirst({ where: { id: docId, tenantId: req.tenantId } });
    if (!doc) return next(new AppError('Document not found', 404));

    await prisma.knowledgeDoc.delete({ where: { id: docId } });

    // Update storage
    const fileSizeMb = doc.sizeBytes / (1024 * 1024);
    await prisma.tenant.update({
      where: { id: req.tenantId },
      data: { storageUsedMb: { decrement: fileSizeMb } },
    });

    await cacheDel(`aiconfig:${req.tenantId}`);

    return success(res, {}, 'Document deleted');
  } catch (err) {
    next(err);
  }
}

// ── GET KNOWLEDGE BASE CONTEXT (for AI prompt injection) ──────
async function getKnowledgeContext(tenantId) {
  const docs = await prisma.knowledgeDoc.findMany({
    where: { tenantId, isIndexed: true, extractedText: { not: null } },
    select: { extractedText: true, originalName: true },
    orderBy: { indexedAt: 'desc' },
  });

  if (!docs.length) return '';

  return docs.map(d => `--- Document: ${d.originalName} ---\n${d.extractedText}`).join('\n\n');
}

// ── TEXT EXTRACTOR HELPER ─────────────────────────────────────
async function extractText(file) {
  try {
    const mime = file.mimetype;

    if (mime === 'application/pdf') {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(file.buffer);
      return data.text?.slice(0, 50000) || null; // limit to 50k chars
    }

    if (mime === 'text/plain' || mime === 'text/csv') {
      return file.buffer.toString('utf8').slice(0, 50000);
    }

    if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      // Basic DOCX text extraction
      const JSZip = require('jszip');
      const zip   = await JSZip.loadAsync(file.buffer);
      const doc   = zip.files['word/document.xml'];
      if (!doc) return null;
      const xml  = await doc.async('string');
      const text = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      return text.slice(0, 50000);
    }

    if (mime.includes('spreadsheet') || mime.includes('excel')) {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer);

      const parts = [];
      workbook.eachSheet((sheet) => {
        sheet.eachRow((row) => {
          const values = row.values
            .filter((v) => v !== null && v !== undefined && v !== '')
            .map((v) => (typeof v === 'object' && v.text ? v.text : String(v)));
          if (values.length) parts.push(values.join(' '));
        });
      });

      return parts.join('\n').slice(0, 50000);
    }

    return null; // Unsupported format — store without indexing
  } catch (err) {
    logger.error('Text extraction error:', err.message);
    return null;
  }
}

module.exports = {
  getAiConfig, updateAiConfig, testAIReply,
  listKnowledgeDocs, uploadKnowledgeDoc, deleteKnowledgeDoc,
  getKnowledgeContext,
};
