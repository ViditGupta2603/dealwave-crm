import { Building2, Handshake, Target, UserRound } from 'lucide-react';

export const LEAD_SOURCES = ['Website', 'Referral', 'LinkedIn', 'Trade show', 'Google Ads', 'Cold outreach', 'Partner', 'Webinar', 'Other'];
export const LEAD_STATUS_OPTIONS = ['new', 'contacted', 'qualified', 'unqualified', 'converted'].map((v) => ({
  value: v,
  label: v[0].toUpperCase() + v.slice(1),
}));
const src = LEAD_SOURCES.map((s) => ({ value: s, label: s }));
const name2 = (r) => [r.first_name, r.last_name].filter(Boolean).join(' ');

export const ENTITIES = {
  lead: {
    key: 'lead',
    path: 'leads',
    singular: 'lead',
    plural: 'Leads',
    icon: Target,
    tab: 'leads',
    searchHint: 'Search by name, company, email or phone',
    title: name2,
    subtitle: (r) => [r.title, r.company].filter(Boolean).join(' at '),
    fields: [
      { key: 'first_name', label: 'First name', type: 'text', required: true },
      { key: 'last_name', label: 'Last name', type: 'text' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'company', label: 'Company', type: 'text' },
      { key: 'title', label: 'Job title', type: 'text' },
      { key: 'source', label: 'Source', type: 'select', options: src },
      { key: 'status', label: 'Status', type: 'select', options: LEAD_STATUS_OPTIONS },
      { key: 'score', label: 'Lead score', type: 'score' },
      { key: 'city', label: 'City', type: 'text' },
      { key: 'owner_id', label: 'Owner', type: 'owner', labelKey: 'owner_name' },
      { key: 'notes', label: 'Notes', type: 'textarea', span: 2 },
    ],
  },
  contact: {
    key: 'contact',
    path: 'contacts',
    singular: 'contact',
    plural: 'Contacts',
    icon: UserRound,
    tab: 'contacts',
    searchHint: 'Search by name, email, phone or company',
    title: name2,
    subtitle: (r) => [r.title, r.account_name].filter(Boolean).join(' at '),
    fields: [
      { key: 'first_name', label: 'First name', type: 'text', required: true },
      { key: 'last_name', label: 'Last name', type: 'text' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'title', label: 'Job title', type: 'text' },
      { key: 'account_id', label: 'Account', type: 'account', labelKey: 'account_name' },
      { key: 'city', label: 'City', type: 'text' },
      { key: 'owner_id', label: 'Owner', type: 'owner', labelKey: 'owner_name' },
    ],
  },
  account: {
    key: 'account',
    path: 'accounts',
    singular: 'account',
    plural: 'Accounts',
    icon: Building2,
    tab: 'accounts',
    searchHint: 'Search by company, industry or city',
    title: (r) => r.name,
    subtitle: (r) => [r.industry, r.city].filter(Boolean).join(' in '),
    fields: [
      { key: 'name', label: 'Company name', type: 'text', required: true, span: 2 },
      { key: 'industry', label: 'Industry', type: 'text' },
      { key: 'website', label: 'Website', type: 'text', placeholder: 'www.example.in' },
      { key: 'phone', label: 'Phone', type: 'tel' },
      { key: 'employees', label: 'Employees', type: 'number' },
      { key: 'annual_revenue', label: 'Annual revenue', type: 'money' },
      { key: 'city', label: 'City', type: 'text' },
      { key: 'state', label: 'State', type: 'text' },
      { key: 'country', label: 'Country', type: 'text' },
      { key: 'owner_id', label: 'Owner', type: 'owner', labelKey: 'owner_name' },
      { key: 'description', label: 'About', type: 'textarea', span: 2 },
    ],
  },
  deal: {
    key: 'deal',
    path: 'deals',
    singular: 'deal',
    plural: 'Deals',
    icon: Handshake,
    tab: 'deals',
    searchHint: 'Search by deal or company',
    title: (r) => r.name,
    subtitle: (r) => [r.account_name, r.stage_name].filter(Boolean).join(' - '),
    fields: [
      { key: 'name', label: 'Deal name', type: 'text', required: true, span: 2 },
      { key: 'account_id', label: 'Account', type: 'account', labelKey: 'account_name' },
      { key: 'contact_id', label: 'Contact', type: 'contact', labelKey: 'contact_name' },
      { key: 'stage_id', label: 'Stage', type: 'stage', labelKey: 'stage_name' },
      { key: 'amount', label: 'Deal value', type: 'money' },
      { key: 'expected_close', label: 'Expected close', type: 'date' },
      { key: 'owner_id', label: 'Owner', type: 'owner', labelKey: 'owner_name' },
      { key: 'next_step', label: 'Next step', type: 'text', span: 2 },
    ],
  },
};

export const ENTITY_LIST = Object.values(ENTITIES);
export const entityByPath = (p) => ENTITY_LIST.find((e) => e.path === p);

export const LOST_REASONS = [
  'Price too high',
  'Chose a competitor',
  'No budget this year',
  'Project postponed',
  'Went with in-house team',
  'No response after proposal',
  'Other',
];
