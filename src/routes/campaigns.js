// src/routes/campaigns.js
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const {
  listCampaigns, getCampaign, createCampaign,
  updateCampaign, deleteCampaign,
  startCampaignCtrl, pauseCampaignCtrl, stopCampaign,
} = require('../controllers/campaignController');

router.use(protect);

router.get('/',                             listCampaigns);
router.post('/',                            createCampaign);
router.get('/:campaignId',                  getCampaign);
router.patch('/:campaignId',                updateCampaign);
router.delete('/:campaignId',               deleteCampaign);
router.post('/:campaignId/start',           startCampaignCtrl);
router.post('/:campaignId/pause',           pauseCampaignCtrl);
router.post('/:campaignId/stop',            stopCampaign);

module.exports = router;
