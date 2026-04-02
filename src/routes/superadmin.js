const router = require('express').Router();
const { body } = require('express-validator');
const { protectSuperAdmin } = require('../middleware/auth');
const { adminAuthLimiter, adminApiLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../utils/requestValidation');
const {
  superAdminLogin, superAdminRefresh,
  // Dashboard
  getPlatformStats,
  // Users
  listUsers, getUser, suspendUser, unsuspendUser, deleteUser,
  resetUserPassword, loginAsUser, getUserActivity,
  // Plans
  listPlans, createPlan, updatePlan, deletePlan,
  // API Keys
  getApiKeys, updateApiKey,
  // AI Model Assignment
  setUserAiModel, getAiModelAssignments, updateGlobalBasePrompt,
  setGlobalMinGap,
  // Billing/Subscriptions
  listSubscriptions, issueCredit, listPayments,
  // Affiliates
  listAffiliates, createAffiliate, updateAffiliate,
  listPayoutRequests, processPayout, blockAffiliate,
  // OTP settings
  getOtpSettings, updateOtpSettings,
  // Storage
  getStorageStats, cleanupStorage,
  // Themes
  listThemes, createTheme, setDefaultTheme, assignTheme,
  // Activity Monitor
  getActivityMonitor,
  // Support AI
  getSupportAiConfig, updateSupportAiConfig,
  // Support Tickets
  listSupportTickets, resolveSupportTicket,
  // Custom Package
  assignCustomPackage,
} = require('../controllers/superadminController');

// ── PUBLIC: Superadmin login ───────────────────────────────────
router.post(
  `/${process.env.SUPERADMIN_SLUG || 'priyanshu'}/login`,
  adminAuthLimiter,
  [
    body('email').isEmail().withMessage('Valid email is required').normalizeEmail(),
    body('password').isString().notEmpty().withMessage('Password is required'),
    validate,
  ],
  superAdminLogin
);
router.post('/refresh', [body('refreshToken').isString().notEmpty().withMessage('refreshToken is required'), validate], superAdminRefresh);

// ── All routes below require superadmin JWT ────────────────────
router.use(protectSuperAdmin, adminApiLimiter);

// ── DASHBOARD ────────────────────────────────────────────────
router.get('/stats',                        getPlatformStats);
router.get('/activity-monitor',             getActivityMonitor);

// ── USER MANAGEMENT ──────────────────────────────────────────
router.get('/users',                        listUsers);
router.get('/users/:userId',                getUser);
router.post('/users/:userId/suspend',       suspendUser);
router.post('/users/:userId/unsuspend',     unsuspendUser);
router.delete('/users/:userId',             deleteUser);
router.post('/users/:userId/reset-password', resetUserPassword);
router.post('/users/:userId/login-as',      loginAsUser);
router.get('/users/:userId/activity',       getUserActivity);
router.post('/users/:userId/ai-model',      setUserAiModel);
router.post('/users/:userId/buttons-lists', assignCustomPackage); // reuse for per-user feature toggle

// ── PLANS ────────────────────────────────────────────────────
router.get('/plans',                        listPlans);
router.post('/plans',                       createPlan);
router.patch('/plans/:planId',              updatePlan);
router.delete('/plans/:planId',             deletePlan);
router.post('/users/:userId/plan',          assignCustomPackage);

// ── API KEYS ─────────────────────────────────────────────────
router.get('/api-keys',                     getApiKeys);
router.patch('/api-keys',                   updateApiKey);

// ── AI GLOBAL SETTINGS ───────────────────────────────────────
router.get('/ai-models',                    getAiModelAssignments);
router.patch('/ai-base-prompt',             updateGlobalBasePrompt);
router.patch('/global-min-gap',             setGlobalMinGap);

// ── BILLING ──────────────────────────────────────────────────
router.get('/subscriptions',                listSubscriptions);
router.get('/payments',                     listPayments);
router.post('/users/:userId/credit',        issueCredit);

// ── AFFILIATES ───────────────────────────────────────────────
router.get('/affiliates',                   listAffiliates);
router.post('/affiliates',                  createAffiliate);
router.patch('/affiliates/:affiliateId',    updateAffiliate);
router.post('/affiliates/:affiliateId/block', blockAffiliate);
router.get('/payouts',                      listPayoutRequests);
router.post('/payouts/:payoutId/process',   processPayout);

// ── OTP SETTINGS ─────────────────────────────────────────────
router.get('/otp-settings',                 getOtpSettings);
router.patch('/otp-settings',               updateOtpSettings);

// ── STORAGE ──────────────────────────────────────────────────
router.get('/storage',                      getStorageStats);
router.post('/storage/cleanup',             cleanupStorage);

// ── THEMES ───────────────────────────────────────────────────
router.get('/themes',                       listThemes);
router.post('/themes',                      createTheme);
router.post('/themes/default',              setDefaultTheme);
router.post('/users/:userId/theme',         assignTheme);

// ── SUPPORT AI ───────────────────────────────────────────────
router.get('/support-ai',                   getSupportAiConfig);
router.patch('/support-ai',                 updateSupportAiConfig);

// ── SUPPORT TICKETS ───────────────────────────────────────────
router.get('/support-tickets',              listSupportTickets);
router.post('/support-tickets/:ticketId/resolve', resolveSupportTicket);

module.exports = router;
