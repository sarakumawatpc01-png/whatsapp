// src/routes/whatsapp.js
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const {
  listNumbers, addNumber, getQRCode,
  disconnectNumber, reconnectNumber, deleteNumber,
  updateNumberSettings, getStatus,
} = require('../controllers/whatsappController');

router.use(protect);

router.get('/',                         listNumbers);
router.post('/',                        addNumber);
router.get('/:numberId/qr',             getQRCode);
router.get('/:numberId/status',         getStatus);
router.post('/:numberId/disconnect',    disconnectNumber);
router.post('/:numberId/reconnect',     reconnectNumber);
router.patch('/:numberId/settings',     updateNumberSettings);
router.delete('/:numberId',             deleteNumber);

module.exports = router;
