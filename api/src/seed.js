import { fileURLToPath } from 'url';
import path from 'path';
import { randomUUID } from 'crypto';
import { pool, withSystem } from './db.js';
import { hashPassword } from './lib/auth.js';
import { seedTenantDefaults } from './routes/auth.js';

/**
 * Demo data: two complete workspaces with users, accounts, contacts, leads, deals, tasks,
 * automations, custom fields and history. Runs only when the database has no tenants.
 * Every demo user's password is: Demo@12345
 */

const DEMO_PASSWORD = 'Demo@12345';

// Deterministic PRNG so the demo data looks the same on every fresh install.
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  'Aarav',
  'Vivaan',
  'Aditya',
  'Arjun',
  'Rohan',
  'Karan',
  'Ishaan',
  'Kabir',
  'Siddharth',
  'Rahul',
  'Amit',
  'Nikhil',
  'Manish',
  'Vikram',
  'Harsh',
  'Yash',
  'Ankit',
  'Pranav',
  'Priya',
  'Ananya',
  'Diya',
  'Isha',
  'Kavya',
  'Neha',
  'Pooja',
  'Riya',
  'Sneha',
  'Shreya',
  'Meera',
  'Nisha',
  'Aditi',
  'Swati',
  'Tanvi',
  'Divya',
  'Anjali',
  'Kritika',
  'Simran',
  'Pallavi',
  'Rashmi',
  'Vidya',
  'Deepak',
  'Suresh',
  'Mukesh',
  'Gaurav',
  'Tarun',
  'Varun',
  'Sachin',
  'Alok',
];
const LAST = [
  'Sharma',
  'Verma',
  'Gupta',
  'Patel',
  'Mehta',
  'Iyer',
  'Nair',
  'Reddy',
  'Rao',
  'Singh',
  'Kapoor',
  'Malhotra',
  'Joshi',
  'Desai',
  'Shah',
  'Kulkarni',
  'Bansal',
  'Agarwal',
  'Chopra',
  'Bhatt',
  'Chauhan',
  'Saxena',
  'Mishra',
  'Pandey',
  'Tiwari',
  'Jain',
  'Menon',
  'Pillai',
  'Bose',
  'Das',
  'Thakur',
  'Solanki',
  'Rathore',
  'Yadav',
];
const CITIES = [
  ['Indore', 'Madhya Pradesh'],
  ['Indore', 'Madhya Pradesh'],
  ['Bhopal', 'Madhya Pradesh'],
  ['Mumbai', 'Maharashtra'],
  ['Pune', 'Maharashtra'],
  ['Nagpur', 'Maharashtra'],
  ['Delhi', 'Delhi'],
  ['Gurugram', 'Haryana'],
  ['Bengaluru', 'Karnataka'],
  ['Hyderabad', 'Telangana'],
  ['Chennai', 'Tamil Nadu'],
  ['Coimbatore', 'Tamil Nadu'],
  ['Ahmedabad', 'Gujarat'],
  ['Surat', 'Gujarat'],
  ['Jaipur', 'Rajasthan'],
  ['Kolkata', 'West Bengal'],
  ['Lucknow', 'Uttar Pradesh'],
  ['Kochi', 'Kerala'],
  ['Chandigarh', 'Chandigarh'],
  ['Pithampur', 'Madhya Pradesh'],
];
const PREFIX = [
  'Shree',
  'Bharat',
  'Sunrise',
  'Apex',
  'Vertex',
  'Nova',
  'Kalpataru',
  'Tirupati',
  'Ganga',
  'Narmada',
  'Sahyadri',
  'Deccan',
  'Malwa',
  'Aravali',
  'Himalaya',
  'Coastal',
  'Pinnacle',
  'Zenith',
  'Orbit',
  'Ratan',
  'Sagar',
  'Vimal',
  'Omkar',
  'Harmony',
  'Unity',
  'Prime',
  'Ashoka',
  'Lotus',
  'Trident',
  'Konark',
  'Rajlaxmi',
  'Vardhman',
];
const TITLES = [
  'Founder',
  'Director',
  'Procurement Manager',
  'Operations Head',
  'Plant Manager',
  'CFO',
  'VP Operations',
  'Facility Manager',
  'Purchase Head',
  'Managing Director',
  'Admin Manager',
  'Head of IT',
  'General Manager',
  'Owner',
];
const SOURCES = [
  ['Website', 24],
  ['Referral', 18],
  ['LinkedIn', 14],
  ['Trade show', 10],
  ['Google Ads', 16],
  ['Cold outreach', 9],
  ['Partner', 6],
  ['Webinar', 3],
];
const LOST_REASONS = [
  'Price too high',
  'Chose a competitor',
  'No budget this year',
  'Project postponed',
  'Went with in-house team',
  'No response after proposal',
];
const NOTE_TEXT = [
  'Spoke to the decision maker. Wants a revised quote with two options.',
  'Site visit done. Shared photos and measurements with the team.',
  'Asked for references from similar customers in the region.',
  'Finance is reviewing. Expect a call back early next week.',
  'Competitor quote is about 6% lower. We need to justify the warranty terms.',
  'Introduced us to their plant head. Good sign.',
  'Wants to start after the festive season. Keep in touch monthly.',
  'Sent the case study and pricing sheet over email.',
];

const TENANTS = [
  {
    name: 'Sundaram Solar Pvt Ltd',
    slug: 'sundaram-solar',
    seed: 7,
    users: [
      { name: 'Rajesh Sundaram', email: 'owner@sundaram.demo', role: 'owner', title: 'Founder & MD' },
      { name: 'Meera Iyer', email: 'meera@sundaram.demo', role: 'admin', title: 'Head of Operations' },
      { name: 'Arjun Kapoor', email: 'arjun@sundaram.demo', role: 'manager', title: 'Sales Manager, North & West' },
      { name: 'Priya Nair', email: 'priya@sundaram.demo', role: 'manager', title: 'Sales Manager, South' },
      { name: 'Rohan Deshmukh', email: 'rohan@sundaram.demo', role: 'member', title: 'Senior Sales Executive' },
      { name: 'Sneha Kulkarni', email: 'sneha@sundaram.demo', role: 'member', title: 'Sales Executive' },
      { name: 'Karan Malhotra', email: 'karan@sundaram.demo', role: 'member', title: 'Sales Executive' },
      { name: 'Ananya Bose', email: 'ananya@sundaram.demo', role: 'member', title: 'Inside Sales' },
    ],
    industries: {
      Manufacturing: ['Engineering Works', 'Auto Components', 'Steel Industries', 'Polymers', 'Ceramics'],
      'Food Processing': ['Foods', 'Dairy', 'Agro Industries', 'Cold Storage'],
      Healthcare: ['Hospitals', 'Diagnostics', 'Pharma'],
      Hospitality: ['Hotels & Resorts', 'Banquets'],
      Education: ['Institute of Technology', 'Public School', 'University'],
      'Real Estate': ['Developers', 'Realty', 'Housing'],
      Retail: ['Mart', 'Supermarkets', 'Retail Ventures'],
      Textiles: ['Textiles', 'Spinning Mills', 'Garments'],
    },
    dealTypes: [
      { name: 'Rooftop solar 150 kW', min: 5500000, max: 7800000 },
      { name: 'Rooftop solar 500 kW', min: 19000000, max: 26000000 },
      { name: 'Solar EPC 1 MW', min: 38000000, max: 52000000 },
      { name: 'Carport solar 300 kW', min: 13000000, max: 18500000 },
      { name: 'Battery storage 200 kWh', min: 8000000, max: 14000000 },
      { name: 'O&M contract renewal', min: 300000, max: 1400000 },
      { name: 'Solar water heating', min: 700000, max: 2600000 },
      { name: 'Net-metering upgrade', min: 250000, max: 900000 },
    ],
    counts: { accounts: 46, contacts: 128, leads: 168, deals: 96, activities: 340 },
    fields: [
      {
        entity: 'lead',
        key: 'budget_range',
        label: 'Budget range',
        type: 'select',
        options: ['Under ₹10L', '₹10L-50L', '₹50L-2Cr', 'Above ₹2Cr'],
      },
      {
        entity: 'lead',
        key: 'preferred_language',
        label: 'Preferred language',
        type: 'select',
        options: ['English', 'Hindi', 'Marathi', 'Gujarati', 'Tamil'],
      },
      { entity: 'account', key: 'gst_number', label: 'GST number', type: 'text' },
      {
        entity: 'deal',
        key: 'payment_terms',
        label: 'Payment terms',
        type: 'select',
        options: ['100% advance', '50-50', '30 days credit', 'Milestone based'],
      },
      { entity: 'deal', key: 'roof_area_sqft', label: 'Roof area (sq ft)', type: 'number' },
    ],
  },
  {
    name: 'Nimbus Logistics',
    slug: 'nimbus-logistics',
    seed: 21,
    users: [
      { name: 'Aditya Rao', email: 'owner@nimbus.demo', role: 'owner', title: 'CEO' },
      { name: 'Kavya Menon', email: 'kavya@nimbus.demo', role: 'admin', title: 'Revenue Operations' },
      { name: 'Nikhil Shah', email: 'nikhil@nimbus.demo', role: 'manager', title: 'Head of Sales' },
      { name: 'Isha Verma', email: 'isha@nimbus.demo', role: 'member', title: 'Account Executive' },
      { name: 'Yash Patel', email: 'yash@nimbus.demo', role: 'member', title: 'Account Executive' },
    ],
    industries: {
      'E-commerce': ['Commerce', 'Bazaar', 'Direct'],
      FMCG: ['Consumer Products', 'Foods', 'Beverages'],
      Pharma: ['Pharma', 'Lifesciences'],
      Automotive: ['Motors', 'Auto Parts'],
      Retail: ['Retail', 'Stores'],
    },
    dealTypes: [
      { name: 'Fleet tracking, 200 vehicles', min: 900000, max: 2400000 },
      { name: 'Warehouse automation pilot', min: 3500000, max: 9000000 },
      { name: 'Last-mile delivery contract', min: 2000000, max: 6500000 },
      { name: 'Cold-chain monitoring', min: 1200000, max: 3800000 },
      { name: 'Route optimisation licence', min: 400000, max: 1500000 },
      { name: 'Annual freight forwarding', min: 5000000, max: 15000000 },
    ],
    counts: { accounts: 18, contacts: 44, leads: 58, deals: 34, activities: 110 },
    fields: [
      { entity: 'lead', key: 'fleet_size', label: 'Fleet size', type: 'number' },
      { entity: 'account', key: 'gst_number', label: 'GST number', type: 'text' },
      { entity: 'deal', key: 'contract_term', label: 'Contract term', type: 'select', options: ['1 year', '2 years', '3 years'] },
    ],
  },
];

async function ins(c, table, row) {
  const keys = Object.keys(row);
  await c.query(
    `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')})`,
    keys.map((k) => (k === 'custom_data' || k === 'changes' || k === 'log' ? JSON.stringify(row[k]) : row[k])),
  );
}

const DAY = 86400000;

async function seedTenant(c, t, passwordHash) {
  const rnd = mulberry32(t.seed);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const between = (lo, hi) => lo + rnd() * (hi - lo);
  const int = (lo, hi) => Math.floor(between(lo, hi + 1));
  const weighted = (items) => {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = rnd() * total;
    for (const [v, w] of items) {
      if ((r -= w) <= 0) return v;
    }
    return items[0][0];
  };
  const now = Date.now();
  const ago = (days) => new Date(now - days * DAY);
  const slugDomain = (s) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 24);

  const tenantId = randomUUID();
  await ins(c, 'tenants', { id: tenantId, name: t.name, slug: t.slug, plan: 'pro', currency: 'INR', created_at: ago(400) });

  // Users
  const users = t.users.map((u, i) => ({ ...u, id: randomUUID(), created_at: ago(380 - i * 20) }));
  for (const u of users) {
    await ins(c, 'users', {
      id: u.id,
      tenant_id: tenantId,
      email: u.email,
      name: u.name,
      password_hash: passwordHash,
      role: u.role,
      title: u.title,
      active: true,
      email_verified_at: u.created_at,
      last_login_at: ago(rnd() * 3),
      created_at: u.created_at,
      updated_at: u.created_at,
    });
  }
  const sellers = users.filter((u) => u.role === 'member' || u.role === 'manager');
  const owner = users[0];

  await seedTenantDefaults(c, tenantId, owner.id);
  const stages = (await c.query('SELECT * FROM pipeline_stages WHERE tenant_id=$1 ORDER BY position', [tenantId])).rows;
  const openStages = stages.filter((s) => !s.is_won && !s.is_lost);
  const wonStage = stages.find((s) => s.is_won);
  const lostStage = stages.find((s) => s.is_lost);

  // Custom fields
  const fieldPos = {};
  for (const f of t.fields) {
    fieldPos[f.entity] = (fieldPos[f.entity] ?? -1) + 1;
    await ins(c, 'field_definitions', {
      tenant_id: tenantId,
      entity: f.entity,
      key: f.key,
      label: f.label,
      type: f.type,
      options: JSON.stringify(f.options ?? []),
      required: !!f.required,
      position: fieldPos[f.entity],
    });
  }
  const customFor = (entity) => {
    const out = {};
    for (const f of t.fields.filter((x) => x.entity === entity)) {
      if (rnd() < 0.3) continue;
      if (f.type === 'select') out[f.key] = pick(f.options);
      else if (f.type === 'number') out[f.key] = f.key === 'fleet_size' ? int(12, 400) : int(4000, 90000);
      else if (f.key === 'gst_number')
        out[f.key] =
          `${int(10, 37)}${String.fromCharCode(65 + int(0, 25))}${String.fromCharCode(65 + int(0, 25))}${String.fromCharCode(65 + int(0, 25))}${String.fromCharCode(65 + int(0, 25))}${String.fromCharCode(65 + int(0, 25))}${int(1000, 9999)}A1Z${int(1, 9)}`;
      else out[f.key] = 'n/a';
    }
    return out;
  };

  // Accounts
  const accounts = [];
  const industryNames = Object.keys(t.industries);
  const usedNames = new Set();
  for (let i = 0; i < t.counts.accounts; i++) {
    const industry = pick(industryNames);
    let name = '';
    do {
      name = `${pick(PREFIX)} ${pick(t.industries[industry])}`;
    } while (usedNames.has(name));
    usedNames.add(name);
    const [city, state] = pick(CITIES);
    const created = ago(between(10, 360));
    const a = {
      id: randomUUID(),
      tenant_id: tenantId,
      name,
      industry,
      website: `www.${slugDomain(name)}.in`,
      phone: `+91 ${int(70000, 99999)} ${int(10000, 99999)}`,
      employees: Math.round(between(25, 1800) / 5) * 5,
      annual_revenue: Math.round(between(2, 900)) * 1000000,
      city,
      state,
      country: 'India',
      description:
        rnd() < 0.5
          ? `${industry} business in ${city}. ${pick(['Runs two shifts.', 'Expanding to a second plant.', 'High daytime power consumption.', 'Family-owned, decisions are quick.', 'Has a large unused rooftop.'])}`
          : null,
      owner_id: pick(sellers).id,
      custom_data: customFor('account'),
      created_at: created,
      updated_at: created,
    };
    accounts.push(a);
    await ins(c, 'accounts', a);
  }

  // Contacts (each account gets at least one)
  const contacts = [];
  const addContact = async (acc) => {
    const first = pick(FIRST),
      last = pick(LAST);
    const created = new Date(new Date(acc.created_at).getTime() + rnd() * 20 * DAY);
    const ct = {
      id: randomUUID(),
      tenant_id: tenantId,
      account_id: acc.id,
      first_name: first,
      last_name: last,
      email: `${first}.${last}`.toLowerCase() + '@' + slugDomain(acc.name) + '.in',
      phone: `+91 ${int(70000, 99999)} ${int(10000, 99999)}`,
      title: pick(TITLES),
      city: acc.city,
      owner_id: acc.owner_id,
      custom_data: {},
      created_at: created > new Date() ? ago(1) : created,
      updated_at: created > new Date() ? ago(1) : created,
    };
    contacts.push(ct);
    await ins(c, 'contacts', ct);
  };
  for (const acc of accounts) await addContact(acc);
  while (contacts.length < t.counts.contacts) await addContact(pick(accounts));

  // Leads
  const leads = [];
  const statusWeights = [
    ['new', 30],
    ['contacted', 26],
    ['qualified', 22],
    ['unqualified', 8],
    ['converted', 14],
  ];
  for (let i = 0; i < t.counts.leads; i++) {
    const first = pick(FIRST),
      last = pick(LAST);
    const status = weighted(statusWeights);
    const [city] = pick(CITIES);
    const company = rnd() < 0.85 ? `${pick(PREFIX)} ${pick(t.industries[pick(industryNames)])}` : null;
    const created = ago(Math.pow(rnd(), 1.5) * 130);
    const score =
      status === 'qualified'
        ? int(65, 95)
        : status === 'converted'
          ? int(75, 98)
          : status === 'unqualified'
            ? int(5, 30)
            : status === 'contacted'
              ? int(35, 70)
              : int(15, 60);
    const l = {
      id: randomUUID(),
      tenant_id: tenantId,
      first_name: first,
      last_name: last,
      email:
        `${first}.${last}${int(1, 99)}`.toLowerCase() +
        '@' +
        (company ? slugDomain(company) + '.in' : pick(['gmail.com', 'outlook.com', 'yahoo.in'])),
      phone: `+91 ${int(70000, 99999)} ${int(10000, 99999)}`,
      company,
      title: pick(TITLES),
      source: weighted(SOURCES),
      status,
      score,
      city,
      notes: rnd() < 0.35 ? pick(NOTE_TEXT) : null,
      owner_id: rnd() < 0.06 ? null : pick(sellers).id,
      converted_at: status === 'converted' ? new Date(created.getTime() + int(2, 20) * DAY) : null,
      custom_data: customFor('lead'),
      created_at: created,
      updated_at: new Date(Math.min(now, created.getTime() + int(0, 15) * DAY)),
    };
    if (l.converted_at && l.converted_at.getTime() > now) l.converted_at = ago(1);
    leads.push(l);
    await ins(c, 'leads', l);
  }

  // Deals
  const deals = [];
  const dealStageWeights = [
    [openStages[0], 15],
    [openStages[1], 17],
    [openStages[2], 15],
    [openStages[3], 11],
    [wonStage, 28],
    [lostStage, 14],
  ];
  for (let i = 0; i < t.counts.deals; i++) {
    const stage = weighted(dealStageWeights);
    const dt = pick(t.dealTypes);
    const acc = pick(accounts);
    const contact = contacts.find((x) => x.account_id === acc.id) ?? pick(contacts);
    const amount = Math.round(between(dt.min, dt.max) / 5000) * 5000;
    let created,
      closed = null,
      expected = null;
    if (stage.is_won) {
      closed = ago(Math.pow(rnd(), 1.4) * 320);
      created = new Date(closed.getTime() - int(18, 110) * DAY);
    } else if (stage.is_lost) {
      closed = ago(Math.pow(rnd(), 1.2) * 240);
      created = new Date(closed.getTime() - int(10, 90) * DAY);
    } else {
      created = ago(int(2, 95));
      expected = new Date(now + int(-6, 110) * DAY).toISOString().slice(0, 10);
    }
    const d = {
      id: randomUUID(),
      tenant_id: tenantId,
      name: `${dt.name} - ${acc.name}`,
      account_id: acc.id,
      contact_id: contact.id,
      stage_id: stage.id,
      amount,
      status: stage.is_won ? 'won' : stage.is_lost ? 'lost' : 'open',
      expected_close: expected,
      next_step:
        !stage.is_won && !stage.is_lost
          ? pick([
              'Send revised quote',
              'Schedule site visit',
              'Share technical proposal',
              'Follow up with finance',
              'Get sign-off from director',
              'Negotiate payment terms',
              'Book demo with plant team',
            ])
          : null,
      lost_reason: stage.is_lost ? pick(LOST_REASONS) : null,
      owner_id: pick(sellers).id,
      closed_at: closed,
      custom_data: customFor('deal'),
      created_at: created,
      updated_at: closed ?? new Date(Math.min(now, created.getTime() + int(0, 30) * DAY)),
    };
    deals.push(d);
    await ins(c, 'deals', d);
  }

  // Activities (mix of history, open tasks and overdue tasks)
  const kinds = [
    ['task', 38],
    ['call', 26],
    ['meeting', 14],
    ['email', 14],
    ['note', 8],
  ];
  const SUBJECTS = {
    task: [
      'Send revised quotation',
      'Prepare technical proposal',
      'Follow up on pending approval',
      'Share site survey report',
      'Collect KYC documents',
      'Confirm meeting agenda',
    ],
    call: ['Intro call', 'Pricing discussion', 'Follow-up call', 'Check on decision timeline', 'Call to resolve doubts on warranty'],
    meeting: ['Site visit', 'Proposal walkthrough', 'Negotiation meeting', 'Kick-off with plant team', 'Quarterly review'],
    email: ['Sent brochure and case studies', 'Shared quotation v2', 'Sent meeting summary', 'Replied to technical queries'],
    note: [
      'Met the director at the trade show',
      'Customer prefers WhatsApp updates',
      'Budget approval expected next quarter',
      'Competitor has visited the site',
    ],
  };
  for (let i = 0; i < t.counts.activities; i++) {
    const type = weighted(kinds);
    const relType = weighted([
      ['deal', 45],
      ['lead', 30],
      ['contact', 15],
      ['account', 10],
    ]);
    const pool = relType === 'deal' ? deals : relType === 'lead' ? leads : relType === 'contact' ? contacts : accounts;
    const rel = pick(pool);
    const created = ago(Math.pow(rnd(), 1.3) * 100);
    let due = null,
      completed = null;
    if (type === 'task') {
      const open = rnd() < 0.42;
      if (open) {
        due = new Date(now + int(-6, 9) * DAY + int(0, 8) * 3600000);
      } else {
        due = new Date(created.getTime() + int(1, 7) * DAY);
        completed = new Date(Math.min(now, due.getTime() - int(0, 2) * DAY));
      }
    } else if (type === 'meeting' && rnd() < 0.25) {
      due = new Date(now + int(1, 12) * DAY + int(0, 8) * 3600000);
    } else {
      completed = created;
    }
    const subj = pick(SUBJECTS[type]);
    await ins(c, 'activities', {
      tenant_id: tenantId,
      type,
      subject: subj,
      notes: rnd() < 0.5 ? pick(NOTE_TEXT) : null,
      priority: weighted([
        ['normal', 60],
        ['high', 25],
        ['low', 15],
      ]),
      due_at: due,
      completed_at: completed,
      related_type: relType,
      related_id: rel.id,
      owner_id: rnd() < 0.2 ? pick([users[0], users[1]]).id : (rel.owner_id ?? pick(sellers).id),
      created_at: created,
      updated_at: completed ?? created,
    });
  }

  // Automations (the "follow up" rule is created by seedTenantDefaults)
  const rules = [
    {
      name: 'Round-robin website leads',
      description: 'Gives every website enquiry to the least-loaded seller and tells them.',
      entity: 'lead',
      event: 'created',
      conditions: [{ field: 'source', op: 'eq', value: 'Website' }],
      actions: [{ type: 'assign_round_robin' }],
    },
    {
      name: 'Celebrate closed deals',
      description: 'Logs a note and notifies the owner when a deal is won.',
      entity: 'deal',
      event: 'stage_changed',
      conditions: [{ field: 'status', op: 'eq', value: 'won' }],
      actions: [
        { type: 'notify', title: 'Deal won: {{name}}', body: 'Great work. Please share the handover checklist with operations.' },
        { type: 'add_note', body: 'Deal marked as won. Start onboarding and raise the first invoice.' },
      ],
    },
    {
      name: 'Big deal alert',
      description: 'Emails the owner when a deal above ₹50 lakh is created.',
      entity: 'deal',
      event: 'created',
      conditions: [{ field: 'amount', op: 'gte', value: 5000000 }],
      actions: [
        { type: 'notify', title: 'High-value deal created', body: '{{name}} is worth ₹{{amount}}' },
        {
          type: 'send_email',
          to: 'owner',
          subject: 'High-value deal: {{name}}',
          body: 'Hi {{owner_name}}, {{name}} (₹{{amount}}) needs a proposal review within 48 hours.',
        },
      ],
    },
    {
      name: 'Nudge stale qualified leads',
      description: 'Adds a task when a lead moves to qualified.',
      entity: 'lead',
      event: 'updated',
      conditions: [{ field: 'status', op: 'changed_to', value: 'qualified' }],
      actions: [{ type: 'create_task', subject: 'Send proposal to {{name}}', due_in_days: 2, priority: 'high' }],
    },
  ];
  const ruleIds = [];
  const first = (await c.query('SELECT id FROM workflow_rules WHERE tenant_id=$1', [tenantId])).rows[0].id;
  ruleIds.push(first);
  for (const r of rules) {
    const id = randomUUID();
    ruleIds.push(id);
    await ins(c, 'workflow_rules', {
      id,
      tenant_id: tenantId,
      ...r,
      conditions: JSON.stringify(r.conditions),
      actions: JSON.stringify(r.actions),
      active: true,
      created_by: owner.id,
      created_at: ago(60),
    });
  }
  for (const rid of ruleIds) {
    const runs = int(6, 30);
    await c.query('UPDATE workflow_rules SET run_count=$2, last_run_at=$3 WHERE id=$1', [rid, runs, ago(rnd() * 4)]);
  }
  const allRules = [
    { id: first, entity: 'lead', actions: [{ type: 'create_task' }] },
    ...rules.map((r, i) => ({ id: ruleIds[i + 1], entity: r.entity, actions: r.actions })),
  ];
  const describe = (type, rec) => {
    const nm = rec.first_name ? `${rec.first_name} ${rec.last_name ?? ''}`.trim() : rec.name;
    switch (type) {
      case 'create_task':
        return `Created task "Call ${nm} and introduce us"`;
      case 'assign_round_robin':
        return `Assigned to ${pick(sellers).name}`;
      case 'notify':
        return 'Sent an in-app notification';
      case 'add_note':
        return 'Added a note';
      case 'send_email':
        return `Email to owner (simulated: SMTP is not configured)`;
      default:
        return type;
    }
  };
  for (let i = 0; i < 16; i++) {
    const rule = allRules[i % allRules.length];
    const rec = rule.entity === 'deal' ? pick(deals) : pick(leads);
    const failed = i === 9;
    await ins(c, 'workflow_runs', {
      tenant_id: tenantId,
      rule_id: rule.id,
      entity: rule.entity,
      record_id: rec.id,
      status: failed ? 'failed' : 'success',
      log: rule.actions.map((a) => ({
        action: a.type,
        ok: !failed,
        message: failed ? 'Webhook timed out after 5s' : describe(a.type, rec),
      })),
      created_at: ago(rnd() * 6),
    });
  }

  // Audit trail for the activity feed
  const recentLeads = [...leads].sort((a, b) => b.created_at - a.created_at).slice(0, 14);
  for (const l of recentLeads)
    await ins(c, 'audit_logs', {
      tenant_id: tenantId,
      user_id: l.owner_id ?? owner.id,
      action: 'created',
      entity: 'lead',
      entity_id: l.id,
      label: `${l.first_name} ${l.last_name}${l.company ? ` (${l.company})` : ''}`,
      created_at: l.created_at,
    });
  const recentDeals = [...deals].sort((a, b) => (b.closed_at ?? b.created_at) - (a.closed_at ?? a.created_at)).slice(0, 22);
  for (const d of recentDeals) {
    const st = stages.find((s) => s.id === d.stage_id);
    await ins(c, 'audit_logs', {
      tenant_id: tenantId,
      user_id: d.owner_id,
      action: d.closed_at ? 'updated' : 'created',
      entity: 'deal',
      entity_id: d.id,
      label: d.name,
      changes: d.closed_at ? { stage_id: { from: openStages[3].id, to: st.id } } : null,
      created_at: d.closed_at ?? d.created_at,
    });
  }

  // Notifications
  for (const u of users) {
    const items = [
      { title: 'Task overdue', body: 'Send revised quotation', link: '/tasks', read: false },
      { title: 'New lead assigned to you', body: `${pick(FIRST)} ${pick(LAST)}`, link: '/leads', read: false },
      { title: 'Deal won', body: pick(deals.filter((d) => d.status === 'won')).name, link: '/deals', read: true },
    ];
    for (const n of items)
      await ins(c, 'notifications', {
        tenant_id: tenantId,
        user_id: u.id,
        title: n.title,
        body: n.body,
        link: n.link,
        read_at: n.read ? ago(1) : null,
        created_at: ago(rnd() * 3),
      });
  }

  return {
    tenant: t.name,
    users: users.length,
    accounts: accounts.length,
    contacts: contacts.length,
    leads: leads.length,
    deals: deals.length,
  };
}

// ---------------------------------------------------------------------------------------------
// Phase 2 sample data: email templates, email history and sample files, so those screens are never empty.
// ---------------------------------------------------------------------------------------------

/** Builds a small but valid one-page PDF (plain ASCII) so sample attachments really open in a PDF viewer. */
export function makePdf(title, lines) {
  const esc = (t) => t.replace(/[\\()]/g, (m) => '\\' + m).replace(/[^\x20-\x7e]/g, '?');
  let y = 780;
  const ops = [`BT /F1 18 Tf 56 ${y} Td (${esc(title)}) Tj ET`];
  y -= 34;
  for (const l of lines) {
    ops.push(`BT /F1 11 Tf 56 ${y} Td (${esc(l)}) Tj ET`);
    y -= 18;
  }
  const stream = ops.join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => {
    offs.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const TEMPLATES = [
  {
    name: 'Introduction',
    subject: 'Nice to meet you, {{name}}',
    body: 'Hi {{name}},\n\nThank you for your interest. I am {{owner_name}} and I will be your point of contact.\n\nCould we speak for 15 minutes this week to understand what you need?\n\nRegards,\n{{owner_name}}',
  },
  {
    name: 'Quotation follow-up',
    subject: 'Following up on our quotation for {{company}}',
    body: 'Hi {{name}},\n\nI wanted to check if you had a chance to go through the quotation we shared. I am happy to walk you through any line item.\n\nWould Thursday work for a quick call?\n\nRegards,\n{{owner_name}}',
  },
  {
    name: 'Meeting confirmation',
    subject: 'Confirming our meeting',
    body: 'Hi {{name}},\n\nThis is to confirm our meeting. Please let me know if the time needs to change.\n\nLooking forward to it.\n\n{{owner_name}}',
  },
  {
    name: 'Pending decision reminder',
    subject: 'Any questions on the proposal?',
    body: 'Hi {{name}},\n\nJust a gentle reminder about the proposal. If there is anything holding up the decision, tell me and I will help sort it out.\n\nThanks,\n{{owner_name}}',
  },
  {
    name: 'Thank you for choosing us',
    subject: 'Welcome aboard, {{company}}',
    body: 'Hi {{name}},\n\nThank you for choosing us. Our team will contact you shortly with the next steps and timelines.\n\nWarm regards,\n{{owner_name}}',
  },
];

const MAIL_SUBJECTS = [
  'Nice to meet you',
  'Following up on our quotation',
  'Confirming our meeting',
  'Technical proposal attached',
  'Site visit scheduled',
  'Revised pricing as discussed',
  'Any questions on the proposal?',
  'Next steps',
];
const MAIL_BODIES = [
  'Hi,\n\nThank you for taking the time to speak with us. Sharing a quick summary of what we discussed.\n\nRegards',
  'Hi,\n\nFollowing up on the quotation. Happy to walk you through it on a short call.\n\nRegards',
  'Hi,\n\nConfirming the meeting. Let me know if you need to reschedule.\n\nThanks',
];

export async function seedExtras(c, tenantId, seedNo) {
  const rnd = mulberry32(seedNo * 101 + 5);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const ago = (days) => new Date(Date.now() - days * DAY);
  const q = async (sql, p = []) => (await c.query(sql, p)).rows;

  const users = await q(`SELECT id,name,email,role FROM users WHERE tenant_id=$1 ORDER BY created_at`, [tenantId]);
  const manager = users.find((u) => u.role === 'manager') ?? users[0];
  const tenantName = (await q('SELECT name FROM tenants WHERE id=$1', [tenantId]))[0].name;

  for (const t of TEMPLATES)
    await ins(c, 'email_templates', {
      tenant_id: tenantId,
      name: t.name,
      subject: t.subject,
      body: t.body,
      created_by: manager.id,
      created_at: ago(120),
    });

  // ---- sample files ----
  const deals = await q(
    `SELECT d.id, d.name, d.amount, d.owner_id, a.name AS account FROM deals d LEFT JOIN accounts a ON a.id=d.account_id WHERE d.tenant_id=$1 ORDER BY d.created_at DESC LIMIT 60`,
    [tenantId],
  );
  const leads = await q(
    `SELECT id, first_name, last_name, company, owner_id, email FROM leads WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 40`,
    [tenantId],
  );
  const accounts = await q(`SELECT id, name, owner_id FROM accounts WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [tenantId]);
  const inr = (n) => 'Rs. ' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n));
  let files = 0;
  const attach = async (entity, r, filename, mime, data, days) => {
    await ins(c, 'attachments', {
      tenant_id: tenantId,
      entity,
      entity_id: r.id,
      filename,
      mime_type: mime,
      size_bytes: data.length,
      data,
      uploaded_by: r.owner_id ?? manager.id,
      created_at: ago(days),
    });
    files++;
  };
  for (let i = 0; i < deals.length && i < 40; i += 4) {
    const d = deals[i];
    const base = (d.account || d.name)
      .replace(/[^A-Za-z0-9 ]/g, '')
      .slice(0, 30)
      .trim();
    await attach(
      'deal',
      d,
      `Quotation - ${base}.pdf`,
      'application/pdf',
      makePdf(`Quotation: ${d.name}`, [
        `Prepared for: ${d.account ?? 'Customer'}`,
        `Prepared by: ${tenantName}`,
        '',
        `Quoted value: ${inr(d.amount)} (excluding GST)`,
        'Validity: 30 days from the date of issue',
        'Payment terms: as discussed',
        '',
        'This is a sample document created for the demo workspace.',
      ]),
      3 + (i % 20),
    );
    if (i % 8 === 0) {
      await attach(
        'deal',
        d,
        `Technical proposal v2 - ${base}.pdf`,
        'application/pdf',
        makePdf(`Technical proposal: ${d.name}`, [
          `Customer: ${d.account ?? 'Customer'}`,
          '',
          'Scope of work',
          ' 1. Site survey and design',
          ' 2. Supply and installation',
          ' 3. Commissioning and handover',
          ' 4. Warranty and maintenance',
          '',
          'Sample document for the demo workspace.',
        ]),
        6 + (i % 15),
      );
    }
  }
  for (let i = 0; i < leads.length && i < 24; i += 6) {
    const l = leads[i];
    const name = `${l.first_name} ${l.last_name ?? ''}`.trim();
    await attach(
      'lead',
      l,
      'Requirement notes.txt',
      'text/plain',
      Buffer.from(
        `Requirement notes for ${name}${l.company ? ' (' + l.company + ')' : ''}\n\n- Wants a quotation within a week\n- Decision maker: owner\n- Budget approved: to be confirmed\n- Prefers a call after 4 pm\n`,
      ),
      2 + i,
    );
  }
  for (let i = 0; i < accounts.length && i < 12; i += 4) {
    const a = accounts[i];
    await attach(
      'account',
      a,
      'Company profile.pdf',
      'application/pdf',
      makePdf(`Company profile: ${a.name}`, [
        'Registered office and plant details',
        'Authorised signatory: Managing Director',
        'Annual power consumption: shared during survey',
        '',
        'Sample document for the demo workspace.',
      ]),
      20 + i,
    );
    await attach(
      'account',
      a,
      'Site details.csv',
      'text/csv',
      Buffer.from('site,city,area_sqft,status\nMain plant,Pune,42000,surveyed\nWarehouse,Nashik,18000,pending\n'),
      14 + i,
    );
  }

  // ---- email history ----
  const contacts = await q(
    `SELECT id, first_name, last_name, email, owner_id FROM contacts WHERE tenant_id=$1 AND email IS NOT NULL ORDER BY created_at DESC LIMIT 30`,
    [tenantId],
  );
  const targets = [
    ...leads
      .filter((l) => l.email)
      .slice(0, 14)
      .map((r) => ({ type: 'lead', r })),
    ...contacts.slice(0, 10).map((r) => ({ type: 'contact', r })),
    ...deals.slice(0, 6).map((r) => ({ type: 'deal', r })),
  ];
  let emails = 0;
  for (let i = 0; i < targets.length; i++) {
    const { type, r } = targets[i];
    const sender = users.find((u) => u.id === r.owner_id) ?? pick(users);
    const to =
      type === 'deal'
        ? `purchase@${String(r.account ?? 'customer')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '')}.in`
        : r.email;
    const failed = i % 11 === 7;
    const source = i % 4 === 3 ? 'automation' : 'manual';
    await ins(c, 'email_log', {
      tenant_id: tenantId,
      user_id: source === 'automation' ? null : sender.id,
      to_email: to,
      subject: pick(MAIL_SUBJECTS),
      body: pick(MAIL_BODIES),
      status: failed ? 'failed' : i % 9 === 4 ? 'simulated' : 'sent',
      error: failed ? 'Mailbox unavailable (550 5.1.1 user unknown)' : null,
      source,
      related_type: type,
      related_id: r.id,
      created_at: ago(rnd() * 25),
    });
    emails++;
  }
  for (const u of users.filter((x) => x.role !== 'owner').slice(0, 2)) {
    await ins(c, 'email_log', {
      tenant_id: tenantId,
      user_id: manager.id,
      to_email: u.email,
      subject: `${manager.name} invited you to ${tenantName} on Dealwave CRM`,
      body: '(content hidden: contains a private link)',
      status: 'sent',
      source: 'invite',
      created_at: ago(30 + rnd() * 20),
    });
    emails++;
  }
  return { templates: TEMPLATES.length, files, emails };
}

/** Sample payment history so the Plan page is never empty. These are demo rows: no money moved. */
export async function seedPayments(c, tenantId, slug) {
  const days = [48, 18];
  let n = 0;
  for (const d of days) {
    const paid = new Date(Date.now() - d * DAY);
    await ins(c, 'payments', {
      tenant_id: tenantId,
      plan: 'pro',
      amount_paise: 299900,
      currency: 'INR',
      status: 'paid',
      razorpay_order_id: `order_DEMO_${slug}_${d}`,
      razorpay_payment_id: `pay_DEMO_${slug}_${d}`,
      created_at: paid,
      paid_at: new Date(paid.getTime() + 90_000),
    });
    n++;
  }
  await c.query(`UPDATE tenants SET plan_paid_until = $2 WHERE id=$1`, [tenantId, new Date(Date.now() - 18 * DAY + 30 * DAY)]);
  return n;
}

async function backfillPayments() {
  for (const t of TENANTS) {
    await withSystem(async (c) => {
      const row = (await c.query(`SELECT id FROM tenants WHERE slug=$1`, [t.slug])).rows[0];
      if (!row) return;
      if ((await c.query('SELECT count(*)::int AS n FROM payments WHERE tenant_id=$1', [row.id])).rows[0].n > 0) return;
      console.log('[seed] payments', t.slug, await seedPayments(c, row.id, t.slug));
    });
  }
}

/** Adds the Phase 2 sample data to demo workspaces that were created before it existed (idempotent). */
async function backfillExtras() {
  await backfillPayments();
  for (const t of TENANTS) {
    await withSystem(async (c) => {
      const row = (await c.query(`SELECT id FROM tenants WHERE slug=$1`, [t.slug])).rows[0];
      if (!row) return;
      const has = (await c.query('SELECT count(*)::int AS n FROM email_templates WHERE tenant_id=$1', [row.id])).rows[0].n;
      if (has > 0) return;
      console.log('[seed] extras', t.slug, JSON.stringify(await seedExtras(c, row.id, t.seed)));
    });
  }
}

export async function seedDemo() {
  const already = await withSystem(async (c) => (await c.query('SELECT count(*)::int AS n FROM tenants')).rows[0].n);
  if (already > 0) {
    console.log('[seed] database already has data, checking for missing sample data');
    await backfillExtras();
    return;
  }
  const hash = await hashPassword(DEMO_PASSWORD);
  for (const t of TENANTS) {
    const summary = await withSystem((c) => seedTenant(c, t, hash));
    console.log('[seed]', JSON.stringify(summary));
  }
  await backfillExtras();
  console.log(`[seed] done. Demo logins: owner@sundaram.demo / owner@nimbus.demo (password ${DEMO_PASSWORD})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  seedDemo()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
