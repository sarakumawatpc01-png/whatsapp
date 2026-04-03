// src/routes/whatsapp.js
const router = require('express').Router();
const { body, param } = require('express-validator');
const { protect } = require('../middleware/auth');
const { validate } = require('../utils/requestValidation');
const {
  listNumbers, addNumber, getQRCode,
  disconnectNumber, reconnectNumber, deleteNumber,
  updateNumberSettings, getStatus,
  createConnectToken, resolveNumberFromConnectToken,
  getQRCodeByConnectToken, getStatusByConnectToken,
} = require('../controllers/whatsappController');

router.get(
  '/connect/:connectToken/qr',
  [param('connectToken').isString().notEmpty().withMessage('connectToken is required'), validate, resolveNumberFromConnectToken],
  getQRCodeByConnectToken
);
router.get(
  '/connect/:connectToken/status',
  [param('connectToken').isString().notEmpty().withMessage('connectToken is required'), validate, resolveNumberFromConnectToken],
  getStatusByConnectToken
);

router.use(protect);

router.get('/',                         listNumbers);
router.post(
  '/',
  [
    body('displayName').optional().isString().trim().isLength({ max: 120 }).withMessage('displayName is too long'),
    body('label').optional().isString().trim().isLength({ max: 120 }).withMessage('label is too long'),
    validate,
  ],
  addNumber
);
router.get('/:numberId/qr',             [param('numberId').isUUID().withMessage('numberId must be a valid id'), validate], getQRCode);
router.get('/:numberId/status',         [param('numberId').isUUID().withMessage('numberId must be a valid id'), validate], getStatus);
router.post('/:numberId/disconnect',    [param('numberId').isUUID().withMessage('numberId must be a valid id'), validate], disconnectNumber);
router.post('/:numberId/reconnect',     [param('numberId').isUUID().withMessage('numberId must be a valid id'), validate], reconnectNumber);
router.post('/:numberId/connect-token', [param('numberId').isUUID().withMessage('numberId must be a valid id'), validate], createConnectToken);
router.patch(
  '/:numberId/settings',
  [
    param('numberId').isUUID().withMessage('numberId must be a valid id'),
    body('displayName').optional().isString().trim().isLength({ max: 120 }).withMessage('displayName is too long'),
    body('aiEnabled').optional().isBoolean().withMessage('aiEnabled must be boolean'),
    body('minMsgGapSec').optional().isInt({ min: 0, max: 3600 }).withMessage('minMsgGapSec must be between 0 and 3600'),
    body('maxMsgGapSec').optional().isInt({ min: 0, max: 3600 }).withMessage('maxMsgGapSec must be between 0 and 3600'),
    body('readDelayMs').optional().isInt({ min: 0, max: 120000 }).withMessage('readDelayMs must be between 0 and 120000'),
    body('isDefault').optional().isBoolean().withMessage('isDefault must be boolean'),
    validate,
  ],
  updateNumberSettings
);
router.delete('/:numberId',             [param('numberId').isUUID().withMessage('numberId must be a valid id'), validate], deleteNumber);

module.exports = router;
