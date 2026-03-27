// src/services/uploadService.js
// Centralised file upload handler using multer + AWS S3 (or local fallback for dev)
const multer    = require('multer');
const multerS3  = require('multer-s3');
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const path      = require('path');
const fs        = require('fs');
const { v4: uuidv4 } = require('uuid');
const logger    = require('../config/logger');
const { AppError } = require('../utils/errors');

// ── S3 CLIENT ─────────────────────────────────────────────────
let s3Client;

function getS3() {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION || 'ap-south-1',
      credentials: {
        accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return s3Client;
}

const BUCKET = process.env.AWS_S3_BUCKET || 'waizai-storage';
const USE_S3  = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_S3_BUCKET);

// ── STORAGE STRATEGIES ────────────────────────────────────────
function buildStorage(keyPrefix) {
  if (USE_S3) {
    return multerS3({
      s3:     getS3(),
      bucket: BUCKET,
      acl:    'private',
      contentType: multerS3.AUTO_CONTENT_TYPE,
      key: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const key = `${keyPrefix}/${req.tenantId}/${uuidv4()}${ext}`;
        cb(null, key);
      },
    });
  }

  // Local fallback (development)
  const uploadDir = path.join(process.cwd(), 'uploads', keyPrefix);
  fs.mkdirSync(uploadDir, { recursive: true });

  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${req.tenantId}_${uuidv4()}${ext}`);
    },
  });
}

// ── ALLOWED MIME TYPES ────────────────────────────────────────
const DOC_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
];

const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

const MEDIA_MIME_TYPES = [
  ...IMAGE_MIME_TYPES,
  'video/mp4',
  'video/3gpp',
  'audio/mpeg',
  'audio/ogg',
  'audio/aac',
  'audio/mp4',
  'application/pdf',
];

function fileFilter(allowedTypes) {
  return (req, file, cb) => {
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError(`File type "${file.mimetype}" is not allowed`, 400), false);
    }
  };
}

// ── MULTER INSTANCES ──────────────────────────────────────────

// Single file upload for AI knowledge documents
const docUploader = multer({
  storage:    buildStorage('docs'),
  limits:     { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: fileFilter(DOC_MIME_TYPES),
});

// Single file upload for campaign media / chat attachments
const mediaUploader = multer({
  storage:    buildStorage('media'),
  limits:     { fileSize: 64 * 1024 * 1024 }, // 64 MB
  fileFilter: fileFilter(MEDIA_MIME_TYPES),
});

// Generic single-file uploader (used in contact import — CSV)
const genericUploader = multer({
  storage: buildStorage('misc'),
  limits:  { fileSize: 10 * 1024 * 1024 },
});

// ── PUBLIC HELPERS ────────────────────────────────────────────

/**
 * Middleware: accept a single file on the given field name.
 * Handles both document and media types.
 */
function uploadSingle(fieldName) {
  return (req, res, next) => {
    genericUploader.single(fieldName)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(new AppError('File too large', 400));
        }
        return next(new AppError(err.message, 400));
      }
      if (err) return next(err);
      next();
    });
  };
}

/**
 * Middleware: accept a single knowledge document.
 */
function uploadDocument(fieldName = 'document') {
  return (req, res, next) => {
    docUploader.single(fieldName)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return next(new AppError(err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 20 MB)' : err.message, 400));
      }
      if (err) return next(err);
      next();
    });
  };
}

/**
 * Middleware: accept a single media file (image/video/audio/pdf).
 */
function uploadMedia(fieldName = 'media') {
  return (req, res, next) => {
    mediaUploader.single(fieldName)(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        return next(new AppError(err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 64 MB)' : err.message, 400));
      }
      if (err) return next(err);
      next();
    });
  };
}

/**
 * Returns the public URL for an uploaded file.
 * Works for both S3 and local storage.
 */
function getFileUrl(file) {
  if (!file) return null;
  if (USE_S3) {
    // S3 location is in file.location when using multer-s3
    return file.location || `https://${BUCKET}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com/${file.key}`;
  }
  // Local: construct a URL based on BASE_URL
  const relativePath = file.path.replace(process.cwd(), '').replace(/\\/g, '/');
  return `${process.env.BASE_URL || 'http://localhost:5000'}${relativePath}`;
}

/**
 * Returns the S3 key (or local path) for a given file.
 */
function getFileKey(file) {
  if (!file) return null;
  return USE_S3 ? file.key : file.path;
}

/**
 * Deletes a file from S3 or local disk.
 */
async function deleteFile(keyOrPath) {
  if (!keyOrPath) return;

  try {
    if (USE_S3) {
      await getS3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: keyOrPath }));
    } else {
      if (fs.existsSync(keyOrPath)) fs.unlinkSync(keyOrPath);
    }
  } catch (err) {
    logger.warn(`deleteFile failed for "${keyOrPath}":`, err.message);
  }
}

module.exports = {
  uploadSingle,
  uploadDocument,
  uploadMedia,
  getFileUrl,
  getFileKey,
  deleteFile,
};
