const logger = require('../config/logger');

function errorHandler(err, req, res, next) {
  let statusCode = err.statusCode || 500;
  let message    = err.message   || 'Internal Server Error';

  // Prisma errors
  if (err.code === 'P2002') {
    statusCode = 409;
    const field = err.meta?.target?.[0] || 'field';
    message = `${field} already exists`;
  }
  if (err.code === 'P2025') {
    statusCode = 404;
    message = 'Record not found';
  }

  // JWT errors handled in middleware
  if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  }

  const routeKey = `${req.method} ${req.path}`;

  if (process.env.NODE_ENV === 'development') {
    logger.error(`[${statusCode}] ${routeKey}: ${message}`, err.stack);
  } else if (statusCode >= 500) {
    logger.error(`[500] ${routeKey}:`, err);
    message = 'Internal Server Error';
  } else {
    logger.warn(`[${statusCode}] ${routeKey}: ${message}`);
  }

  res.status(statusCode).json({
    success: false,
    error: message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
}

module.exports = errorHandler;
