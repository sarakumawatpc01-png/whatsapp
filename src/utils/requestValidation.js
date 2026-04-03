const { validationResult } = require('express-validator');
const { ValidationError } = require('./errors');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validate(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const first = errors.array({ onlyFirstError: true })[0];
    return next(new ValidationError(first?.msg || 'Invalid request payload'));
  }
  next();
}

module.exports = { validate, isNonEmptyString };
