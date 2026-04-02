const winston = require('winston');
const path = require('path');

const { combine, timestamp, printf, colorize, errors } = winston.format;

const REDACTED = '[REDACTED]';
const SECRET_PATTERNS = [
  /(authorization\s*[:=]\s*bearer\s+)[^\s]+/ig,
  /(refresh[-_ ]?token\s*[:=]\s*)[^\s,}]+/ig,
  /(access[-_ ]?token\s*[:=]\s*)[^\s,}]+/ig,
  /(jwt[_-]?secret\s*[:=]\s*)[^\s,}]+/ig,
  /(password\s*[:=]\s*)[^\s,}]+/ig,
  /(api[_-]?key\s*[:=]\s*)[^\s,}]+/ig,
  /(secret\s*[:=]\s*)[^\s,}]+/ig,
];

function sanitizeLogText(input) {
  if (!input) return input;
  let text = typeof input === 'string' ? input : JSON.stringify(input);
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, `$1${REDACTED}`);
  }
  return text;
}

const logFormat = printf(({ level, message, timestamp, stack }) => {
  const safeMessage = sanitizeLogText(stack || message);
  return `${timestamp} [${level.toUpperCase()}]: ${safeMessage}`;
});

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), errors({ stack: true }), logFormat),
  transports: [
    new winston.transports.Console({ format: combine(colorize(), logFormat) }),
    new winston.transports.File({ filename: path.join('logs', 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: path.join('logs', 'combined.log') }),
  ],
});

module.exports = logger;
