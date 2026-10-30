export const PLANS = {
  free: {
    id: 'free',
    name: 'Starter',
    priceMonthly: 0,
    tagline: 'For a small team trying things out',
    limits: { users: 3, records: 1000, workflows: 2 },
    features: ['Up to 3 users', '1,000 records', '2 automations', 'Custom fields', 'CSV import & export'],
  },
  pro: {
    id: 'pro',
    name: 'Growth',
    priceMonthly: 2999,
    tagline: 'For sales teams that run on the pipeline',
    limits: { users: 25, records: 100000, workflows: 25 },
    features: ['Up to 25 users', '1,00,000 records', '25 automations', 'Webhooks & email actions', 'Audit log', 'Priority support'],
  },
  enterprise: {
    id: 'enterprise',
    name: 'Scale',
    priceMonthly: 9999,
    tagline: 'For large teams with custom needs',
    limits: { users: null, records: null, workflows: null },
    features: ['Unlimited users', 'Unlimited records', 'Unlimited automations', 'Dedicated onboarding', 'SLA'],
  },
};
