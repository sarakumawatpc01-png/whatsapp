// src/db/seed.js
// Seeds the database with:
//   - The 4 default subscription plans
//   - The superadmin account (demo credentials from blueprint)
//   - A demo client tenant + AI config
//   - One demo affiliate account
//   - Default global settings (theme, support AI, global base prompt, min gap)
//
// Run with: node src/db/seed.js  (or via: npm run seed)

require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting WaizAI database seed...\n');

  // ── 1. PLANS ────────────────────────────────────────────────
  console.log('Creating plans...');

  const plans = [
    {
      name:             'free',
      displayName:      'Free',
      price:            0,
      maxNumbers:       1,
      maxMessages:      500,
      maxAiCalls:       100,
      maxContacts:      100,
      storageGb:        0.05,   // 50 MB
      maxCampaigns:     1,
      maxFollowups:     1,
      calendarEnabled:  false,
      analyticsLevel:   'basic',
      minMsgGapSeconds: 10,
      supportLevel:     'ai',
      buttonsEnabled:   false,
      listsEnabled:     false,
    },
    {
      name:             'starter',
      displayName:      'Starter',
      price:            49900,  // ₹499 in paise
      maxNumbers:       2,
      maxMessages:      5000,
      maxAiCalls:       2000,
      maxContacts:      1000,
      storageGb:        1,
      maxCampaigns:     5,
      maxFollowups:     5,
      calendarEnabled:  true,
      analyticsLevel:   'standard',
      minMsgGapSeconds: 5,
      supportLevel:     'email',
      buttonsEnabled:   false,
      listsEnabled:     false,
    },
    {
      name:             'pro',
      displayName:      'Pro',
      price:            99900,  // ₹999 in paise
      maxNumbers:       5,
      maxMessages:      20000,
      maxAiCalls:       10000,
      maxContacts:      10000,
      storageGb:        5,
      maxCampaigns:     25,
      maxFollowups:     25,
      calendarEnabled:  true,
      analyticsLevel:   'advanced',
      minMsgGapSeconds: 3,
      supportLevel:     'priority',
      buttonsEnabled:   false, // superadmin grants per-user
      listsEnabled:     false,
    },
    {
      name:             'business',
      displayName:      'Business',
      price:            199900, // ₹1,999 in paise
      maxNumbers:       9999,   // unlimited
      maxMessages:      999999,
      maxAiCalls:       999999,
      maxContacts:      999999,
      storageGb:        50,
      maxCampaigns:     999,
      maxFollowups:     999,
      calendarEnabled:  true,
      analyticsLevel:   'full',
      minMsgGapSeconds: 3,
      supportLevel:     'dedicated',
      buttonsEnabled:   true,
      listsEnabled:     true,
    },
  ];

  for (const planData of plans) {
    const existing = await prisma.plan.findUnique({ where: { name: planData.name } });
    if (existing) {
      await prisma.plan.update({ where: { name: planData.name }, data: planData });
      console.log(`  ✅ Updated plan: ${planData.displayName}`);
    } else {
      await prisma.plan.create({ data: planData });
      console.log(`  ✅ Created plan: ${planData.displayName}`);
    }
  }

  // ── 2. SUPERADMIN ────────────────────────────────────────────
  console.log('\nCreating superadmin...');

  const superAdminEmail    = process.env.SUPERADMIN_EMAIL    || 'pk@superadmin.com';
  const superAdminPassword = process.env.SUPERADMIN_PASSWORD || 'Admin@123';
  const superAdminName     = process.env.SUPERADMIN_NAME     || 'Priyanshu K';

  const existingAdmin = await prisma.superAdmin.findUnique({ where: { email: superAdminEmail } });
  if (!existingAdmin) {
    const hashed = await bcrypt.hash(superAdminPassword, 12);
    await prisma.superAdmin.create({
      data: { email: superAdminEmail, password: hashed, name: superAdminName, isActive: true },
    });
    console.log(`  ✅ Superadmin created: ${superAdminEmail} / ${superAdminPassword}`);
  } else {
    console.log(`  ⏭  Superadmin already exists: ${superAdminEmail}`);
  }

  // ── 3. DEMO CLIENT TENANT ─────────────────────────────────────
  console.log('\nCreating demo client...');

  const freePlan   = await prisma.plan.findUnique({ where: { name: 'free' } });
  const demoEmail  = process.env.DEMO_EMAIL    || 'pk@demo.com';
  const demoPass   = process.env.DEMO_PASSWORD || 'Demo@123';

  const existingDemo = await prisma.tenant.findUnique({ where: { email: demoEmail } });
  if (!existingDemo) {
    const hashed = await bcrypt.hash(demoPass, 12);
    const demo   = await prisma.tenant.create({
      data: {
        ownerName:     'Demo Owner',
        businessName:  'Demo Business',
        email:         demoEmail,
        phone:         '+910000000000',
        password:      hashed,
        status:        'active',
        emailVerified: true,
        phoneVerified: true,
        consentGiven:  true,
        consentAt:     new Date(),
        planId:        freePlan?.id || null,
        trialEndsAt:   new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
      },
    });

    // Create default AI config for demo tenant
    await prisma.aiConfig.create({
      data: {
        tenantId:            demo.id,
        aiModel:             'claude-sonnet-4-6',
        tone:                'friendly',
        language:            'match',
        businessDescription: 'A demo business for testing WaizAI features.',
        productsServices:    'General products and services.',
        businessHours:       {
          monday:    { open: true,  openTime: '09:00', closeTime: '18:00' },
          tuesday:   { open: true,  openTime: '09:00', closeTime: '18:00' },
          wednesday: { open: true,  openTime: '09:00', closeTime: '18:00' },
          thursday:  { open: true,  openTime: '09:00', closeTime: '18:00' },
          friday:    { open: true,  openTime: '09:00', closeTime: '18:00' },
          saturday:  { open: true,  openTime: '10:00', closeTime: '16:00' },
          sunday:    { open: false, openTime: null,    closeTime: null    },
        },
        faqs: [
          { question: 'What are your business hours?', answer: 'We are open Monday to Friday 9 AM to 6 PM, and Saturday 10 AM to 4 PM.' },
          { question: 'How can I place an order?',      answer: 'You can message us here on WhatsApp or visit our store directly.' },
        ],
        outOfHoursMsg: 'Thank you for contacting us! We are currently outside business hours. We will get back to you during our working hours. 🙏',
      },
    });

    console.log(`  ✅ Demo client created: ${demoEmail} / ${demoPass}`);
  } else {
    console.log(`  ⏭  Demo client already exists: ${demoEmail}`);
  }

  // ── 4. DEMO AFFILIATE ─────────────────────────────────────────
  console.log('\nCreating demo affiliate...');

  const affEmail = process.env.AFFILIATE_EMAIL    || 'affiliate@demo.com';
  const affPass  = process.env.AFFILIATE_PASSWORD || 'Affiliate@123';

  const existingAffiliate = await prisma.affiliate.findUnique({ where: { email: affEmail } });
  if (!existingAffiliate) {
    const hashed = await bcrypt.hash(affPass, 12);
    await prisma.affiliate.create({
      data: {
        name:           'Demo Affiliate',
        email:          affEmail,
        password:       hashed,
        phone:          '+911111111111',
        code:           'AFF-DEMO-0001',
        commissionRate: 0.20,
        status:         'active',
      },
    });
    console.log(`  ✅ Demo affiliate created: ${affEmail} / ${affPass}`);
  } else {
    console.log(`  ⏭  Demo affiliate already exists: ${affEmail}`);
  }

  // ── 5. GLOBAL SETTINGS ────────────────────────────────────────
  console.log('\nCreating global settings...');

  const globalSettings = [
    {
      key:   'global_base_prompt',
      value: 'You are a professional, helpful, and knowledgeable business assistant. Always be polite and respectful. Only provide information that is accurate and based on the business information provided to you. Never make up information. If you do not know something, say so politely and offer to escalate to a human.',
    },
    {
      key:   'global_min_msg_gap',
      value: '3',
    },
    {
      key:   'default_theme',
      value: 'dark-green',
    },
    {
      key:   'otp_provider',
      value: 'twilio',
    },
    {
      key:   'otp_sms_template',
      value: 'Your WaizAI verification code is {otp}. Valid for 10 minutes. Do not share this code with anyone.',
    },
    {
      key:   'otp_expiry_minutes',
      value: '10',
    },
    {
      key:   'otp_resend_limit',
      value: '3',
    },
    {
      key:   'support_ai_enabled',
      value: 'true',
    },
    {
      key:   'support_ai_model',
      value: 'claude-haiku-4-5-20251001',
    },
    {
      key:   'support_ai_prompt',
      value: 'You are the WaizAI platform support assistant. Help users understand how to use WaizAI features. You can answer questions about connecting WhatsApp, setting up AI responses, managing campaigns, follow-up sequences, calendar bookings, and billing. You do NOT have access to user business data. If a user has a complex issue you cannot resolve, create a support ticket by saying "I will escalate this to our team".',
    },
    {
      key:   'themes_json',
      value: JSON.stringify([
        { id: 'dark-green',  name: 'Dark Green',  primaryColor: '#25D366', accentColor: '#128C7E', bgColor: '#0f172a', font: 'Inter' },
        { id: 'dark-blue',   name: 'Dark Blue',   primaryColor: '#3B82F6', accentColor: '#1D4ED8', bgColor: '#0f172a', font: 'Inter' },
        { id: 'dark-purple', name: 'Dark Purple', primaryColor: '#8B5CF6', accentColor: '#7C3AED', bgColor: '#0f172a', font: 'Inter' },
        { id: 'dark-orange', name: 'Dark Orange', primaryColor: '#F97316', accentColor: '#EA580C', bgColor: '#0f172a', font: 'Inter' },
        { id: 'light',       name: 'Light',       primaryColor: '#25D366', accentColor: '#128C7E', bgColor: '#F8FAFC', font: 'Inter' },
      ]),
    },
  ];

  for (const setting of globalSettings) {
    await prisma.globalSetting.upsert({
      where:  { key: setting.key },
      create: setting,
      update: { value: setting.value },
    });
    console.log(`  ✅ Setting: ${setting.key}`);
  }

  // ── DONE ──────────────────────────────────────────────────────
  console.log('\n✅ Seed complete!\n');
  console.log('  Superadmin:  pk@superadmin.com  /  Admin@123');
  console.log('  Demo client: pk@demo.com         /  Demo@123');
  console.log('  Affiliate:   affiliate@demo.com  /  Affiliate@123');
  console.log('\n  Login URLs:');
  console.log('  Client:     /login');
  console.log(`  Superadmin: /${process.env.SUPERADMIN_SLUG || 'priyanshu'}/login`);
  console.log('  Affiliate:  /affiliate/login\n');
}

main()
  .catch(err => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
