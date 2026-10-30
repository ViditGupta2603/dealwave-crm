import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import {
  ArrowRight,
  BarChart3,
  Bell,
  Building2,
  Check,
  CheckSquare,
  ChevronDown,
  FileSpreadsheet,
  Handshake,
  KeyRound,
  Layers,
  LayoutDashboard,
  ListChecks,
  Lock,
  Mail,
  Moon,
  Paperclip,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  UserRound,
  Users,
  Workflow,
  X,
  Download,
  Radio,
  CalendarDays,
} from 'lucide-react';
import { Logo } from '../components/Layout';

/** Fade-and-rise when a block scrolls into view. */
function Reveal({ children, delay = 0, className }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={clsx(
        'transition-all duration-700 ease-out motion-reduce:transition-none',
        shown ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100',
        className,
      )}
    >
      {children}
    </div>
  );
}

function SectionHead({ kicker, title, children, center = true, dark = false }) {
  return (
    <div className={clsx('max-w-2xl', center && 'mx-auto text-center')}>
      <p className={clsx('text-[13px] font-semibold uppercase tracking-[0.14em]', dark ? 'text-accent' : 'text-primary')}>{kicker}</p>
      <h2 className={clsx('mt-2 font-display text-[30px] font-semibold leading-[1.1] sm:text-[40px]', dark && 'text-white')}>{title}</h2>
      {children && <p className={clsx('mt-3 text-[16.5px]', dark ? 'text-sidebar-ink/80' : 'text-muted')}>{children}</p>}
    </div>
  );
}

// ---------- Hero visual: a static mock of the real dashboard ----------
function HeroMock() {
  const stages = [
    { name: 'Prospecting', value: '₹19.6 Cr', color: '#7C8DB5', w: 22 },
    { name: 'Qualified', value: '₹19.9 Cr', color: '#3E7CB1', w: 24 },
    { name: 'Proposal', value: '₹32.1 Cr', color: '#0F6B5C', w: 38 },
    { name: 'Negotiation', value: '₹12.3 Cr', color: '#E08A00', w: 16 },
  ];
  const bars = [46, 64, 56, 26, 60, 78];
  return (
    <div className="relative">
      <div
        className="absolute -inset-6 -z-10 rounded-[32px] bg-gradient-to-br from-accent/25 via-transparent to-primary/25 blur-2xl"
        aria-hidden
      />
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-pop">
        <div className="flex items-center gap-1.5 border-b border-line bg-sunken/70 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ec6a5e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#f4bf4f]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#61c554]" />
          <span className="ml-3 text-[12px] text-muted">dealwave / dashboard</span>
        </div>
        <div className="p-5">
          <p className="font-display text-[19px] font-semibold">Good morning, Rajesh</p>
          <p className="text-[13px] text-muted">
            The team has <b className="text-ink">₹84 Cr</b> open across 59 deals.
          </p>
          <div className="mt-4 flex" aria-hidden>
            {stages.map((s, i) => (
              <div key={s.name} style={{ width: `${s.w}%` }} className="min-w-0">
                <div
                  className="h-11 pl-3 pr-2"
                  style={{
                    background: s.color,
                    marginLeft: i ? -1 : 0,
                    clipPath:
                      i === 0
                        ? 'polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%)'
                        : i === stages.length - 1
                          ? 'polygon(0 0, 12px 50%, 0 100%, 100% 100%, 100% 0)'
                          : 'polygon(0 0, calc(100% - 12px) 0, 100% 50%, calc(100% - 12px) 100%, 0 100%, 12px 50%)',
                    borderRadius: i === 0 ? '8px 0 0 8px' : i === stages.length - 1 ? '0 8px 8px 0' : 0,
                  }}
                >
                  <p
                    className={clsx(
                      'flex h-full items-center truncate font-display text-[12.5px] font-semibold text-white',
                      i ? 'pl-3' : '',
                    )}
                  >
                    {s.value}
                  </p>
                </div>
                <p className="mt-1.5 truncate pl-1 text-[11px] text-muted">{s.name}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-3 gap-3">
            {[
              ['Won this month', '₹3.86 Cr'],
              ['Win rate', '56%'],
              ['New leads', '69'],
            ].map(([l, v]) => (
              <div key={l} className="rounded-control border border-line p-3">
                <p className="text-[11px] text-muted">{l}</p>
                <p className="mt-0.5 font-display text-[18px] font-semibold num">{v}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex h-24 items-end gap-2.5 rounded-control bg-sunken/60 px-4 pb-3 pt-4" aria-hidden>
            {bars.map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-t"
                style={{ height: `${h}%`, background: i === bars.length - 1 ? '#F2A900' : '#0F6B5C' }}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="absolute -bottom-5 -left-4 hidden animate-popIn items-center gap-2.5 rounded-panel border border-line bg-surface px-3.5 py-2.5 shadow-pop sm:flex">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-success-soft text-success">
          <Check className="h-4 w-4" />
        </span>
        <span className="text-[13px]">
          <b>Deal won</b>
          <br />
          <span className="text-muted">Rooftop solar, ₹2.59 Cr</span>
        </span>
      </div>
    </div>
  );
}

// ---------- Story: one lead's journey ----------
const STORY = [
  {
    icon: Target,
    tag: 'Lead',
    title: 'Ramesh fills a form on your website',
    text: 'Someone who might become a customer. Dealwave saves his name, phone and what he wants. Nothing gets lost in a WhatsApp chat.',
  },
  {
    icon: Workflow,
    tag: 'Automation',
    title: 'The system gives him to the right seller',
    text: 'A rule you set once picks the least busy salesperson and creates a follow-up task for tomorrow. No one has to remember.',
  },
  {
    icon: CheckSquare,
    tag: 'Task',
    title: 'Priya sees "Call Ramesh" on her list',
    text: 'She calls, notes what he said, and updates the lead. Late tasks turn red so nothing slips.',
  },
  {
    icon: Handshake,
    tag: 'Deal',
    title: 'Ramesh is serious, so it becomes a deal',
    text: '"500 kW rooftop solar, ₹2.5 Cr." The card moves across the board: Proposal, Negotiation, then Won.',
  },
  {
    icon: BarChart3,
    tag: 'Report',
    title: 'The boss sees the result without asking',
    text: 'This month: ₹3.86 Cr won, best seller, and why deals were lost. All on one screen.',
  },
];

function Story() {
  const [active, setActive] = useState(0);
  const s = STORY[active];
  return (
    <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_1.1fr] lg:items-center">
      <ol className="space-y-2">
        {STORY.map((x, i) => (
          <li key={x.tag}>
            <button
              onClick={() => setActive(i)}
              aria-current={active === i}
              className={clsx(
                'flex w-full items-center gap-3.5 rounded-panel border px-4 py-3.5 text-left transition-colors',
                active === i ? 'border-primary bg-primary-soft' : 'border-line bg-surface hover:border-primary/50',
              )}
            >
              <span
                className={clsx(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-[15px] font-semibold',
                  active === i ? 'bg-primary text-primary-ink' : 'bg-sunken text-muted',
                )}
              >
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium text-primary">{x.tag}</span>
                <span className="block font-medium leading-snug">{x.title}</span>
              </span>
            </button>
          </li>
        ))}
      </ol>
      <div className="relative overflow-hidden rounded-2xl bg-sidebar p-8 text-sidebar-ink sm:p-10" key={active}>
        <div className="animate-fade">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-[#2a1c00]">
            <s.icon className="h-7 w-7" />
          </span>
          <p className="mt-5 text-[13px] font-semibold uppercase tracking-[0.14em] text-accent">{s.tag}</p>
          <h3 className="mt-1.5 font-display text-[26px] font-semibold leading-tight text-white">{s.title}</h3>
          <p className="mt-3 text-[16px] leading-relaxed text-sidebar-ink/85">{s.text}</p>
        </div>
        <svg
          className="pointer-events-none absolute -bottom-10 -right-10 opacity-20"
          width="260"
          height="200"
          viewBox="0 0 260 200"
          fill="none"
          aria-hidden
        >
          <path d="M0 150C60 150 70 60 130 60s70 90 130 90" stroke="#F2A900" strokeWidth="18" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

// ---------- Jargon decoder ----------
const WORDS = [
  { icon: Target, word: 'Lead', plain: 'Someone who might buy from you, but has not yet.', eg: 'Ramesh filled your website form.' },
  { icon: UserRound, word: 'Contact', plain: 'A real person whose details you keep.', eg: 'Ramesh Shah, +91 98xxx, purchase head.' },
  { icon: Building2, word: 'Account', plain: 'The company that person works for.', eg: 'Ashoka Spinning Mills.' },
  {
    icon: Handshake,
    word: 'Deal',
    plain: 'A possible sale with an amount and a stage.',
    eg: '500 kW rooftop solar, ₹2.5 Cr, in negotiation.',
  },
  { icon: ListChecks, word: 'Task', plain: 'A to-do with a deadline.', eg: 'Send the revised quotation by Friday.' },
  {
    icon: Workflow,
    word: 'Automation',
    plain: 'A rule that does boring work for you: "if this happens, do that".',
    eg: 'New lead arrives, so assign a seller and set a follow-up.',
  },
];

// ---------- Feature grid ----------
const FEATURES = [
  {
    icon: LayoutDashboard,
    title: 'A dashboard that answers "how are we doing?"',
    text: "Open deal value by stage, wins this month, new leads, top sellers and today's tasks, at a glance.",
  },
  {
    icon: Handshake,
    title: 'Drag-and-drop deals board',
    text: 'Move a deal to the next stage like a sticky note. If it is lost, Dealwave asks why, so you learn from it.',
  },
  {
    icon: Workflow,
    title: 'Automations without coding',
    text: 'Build rules by choosing from lists. Create tasks, assign sellers, notify people, send emails, call webhooks.',
  },
  {
    icon: BarChart3,
    title: 'Reports a boss will actually read',
    text: 'Won vs lost by month, forecast, win rate per seller, best lead sources and top reasons for losing deals.',
  },
  {
    icon: Layers,
    title: 'Fits your business, not the other way',
    text: 'Add your own fields (GST number, budget, contract term) and rename or reorder your sales stages.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Bring your Excel along',
    text: 'Import hundreds of leads from a CSV in one go, and export them whenever you like.',
  },
  {
    icon: Users,
    title: 'Roles that make sense',
    text: 'A new salesperson sees only their own leads. Managers see the whole team. Admins manage the setup.',
  },
  {
    icon: Search,
    title: 'Find anything in a second',
    text: 'Press Ctrl+K and type a name, company or phone. Every record also keeps a full history of who changed what.',
  },
  {
    icon: Target,
    title: 'Leads on a board too',
    text: 'Switch the Leads page to a board and drag each lead from New to Contacted to Qualified as you work it.',
  },
  {
    icon: Paperclip,
    title: 'Keep the paperwork with the customer',
    text: 'Attach quotations, site photos and signed forms to any lead, deal or company. Everyone on the team can find them.',
  },
  {
    icon: Mail,
    title: 'Email from the record',
    text: "Write an email with a saved template, and it shows up on the customer's history automatically.",
  },
  {
    icon: Download,
    title: 'Reports in Excel and PDF',
    text: 'Download the sales report as a spreadsheet for your accountant or a PDF for the boss, in one click.',
  },
  {
    icon: Radio,
    title: 'Everyone sees changes instantly',
    text: 'When a teammate moves a deal or an automation creates a task, your screen updates by itself. No refreshing, no "who has the latest version?".',
  },
  {
    icon: Sparkles,
    title: 'Ask in plain English',
    text: 'Type "deals above 50 lakh closing this month" or "hot leads from website" and get the list. It shows how it understood you.',
  },
  {
    icon: Target,
    title: 'A lead score that explains itself',
    text: 'Every lead gets a score, and every point has a reason you can read. Fully automatic, and nothing leaves your account.',
  },
  {
    icon: FileSpreadsheet,
    title: 'Summaries and email drafts',
    text: 'One click gives a short briefing on a deal, or a first draft of the follow-up email. Optionally written by an AI model if you connect one.',
  },
  {
    icon: KeyRound,
    title: 'Two-step sign-in',
    text: 'Protect accounts with a code from an authenticator app, with backup codes in case a phone is lost.',
  },
  {
    icon: CalendarDays,
    title: 'Tasks in your calendar',
    text: 'Add a task to your calendar in one click, or subscribe so Google, Apple or Outlook calendar always shows what is due.',
  },
  {
    icon: Moon,
    title: 'Comfortable on the eyes',
    text: 'A true-black (AMOLED) dark theme by default, with a light theme one click away. Works on laptop and phone screens.',
  },
];

// ---------- Tenants explainer ----------
function TenantCards() {
  return (
    <div className="mt-10 grid items-stretch gap-4 md:grid-cols-[1fr_auto_1fr]">
      {[
        { name: 'Sundaram Solar', rows: ['168 leads', '96 deals', '8 users'], tone: 'bg-primary-soft text-primary' },
        { name: 'Nimbus Logistics', rows: ['58 leads', '34 deals', '5 users'], tone: 'bg-warn-soft text-warn' },
      ].flatMap((t, i) => {
        const card = (
          <div key={t.name} className="rounded-panel border border-line bg-surface p-5">
            <div className="flex items-center gap-2.5">
              <span className={clsx('flex h-9 w-9 items-center justify-center rounded-lg', t.tone)}>
                <Building2 className="h-[18px] w-[18px]" />
              </span>
              <p className="font-display text-[18px] font-semibold">{t.name}</p>
            </div>
            <ul className="mt-4 space-y-1.5 text-[14px] text-muted">
              {t.rows.map((r) => (
                <li key={r} className="flex items-center gap-2">
                  <Lock className="h-3.5 w-3.5" />
                  {r}, only visible to them
                </li>
              ))}
            </ul>
          </div>
        );
        return i === 0
          ? [
              card,
              <div key="wall" className="flex flex-row items-center justify-center gap-2 py-2 text-muted md:flex-col">
                <span className="hidden h-full w-px bg-line md:block" />
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-bg">
                  <X className="h-4 w-4 text-danger" />
                </span>
                <span className="text-[12px] font-medium uppercase tracking-wider">Never mixed</span>
                <span className="hidden h-full w-px bg-line md:block" />
              </div>,
            ]
          : [card];
      })}
    </div>
  );
}

// ---------- FAQ ----------
const FAQ = [
  {
    q: 'Do I need to be technical to use Dealwave?',
    a: 'No. If you can use WhatsApp and Excel, you can use Dealwave. Everything is forms, lists and drag-and-drop.',
  },
  {
    q: 'What does "multi-tenant" mean?',
    a: 'One Dealwave installation can serve many companies. Each company is a "tenant" with its own private data, like separate flats in one building. Nobody can open another company\'s flat.',
  },
  {
    q: 'Is my data really separated between companies?',
    a: "Yes, and not only by the app. The database itself enforces it with row level security, so a bug in the app cannot leak another company's rows.",
  },
  {
    q: 'Can I try it without signing up?',
    a: 'Yes. Use the demo workspace button. It is filled with sample leads, deals and tasks, and you can click anything.',
  },
  {
    q: 'Can I move my existing data in?',
    a: 'Yes. Save your sheet as a CSV file and import it into Leads. Rows with problems are listed so you can fix them.',
  },
  {
    q: 'How do I pay for a paid plan?',
    a: 'The owner of a workspace pays once a month through Razorpay (UPI, cards, netbanking). It is a one-time payment for one month, not an automatic subscription. If the person running your Dealwave has not connected Razorpay yet, plan changes are instant and free.',
  },
  {
    q: 'Does it use AI?',
    a: 'Lead scores, plain-English search, summaries and email drafts all work on built-in rules, with no AI service and no data leaving your account. If the person running Dealwave adds an AI key, summaries and drafts are written by an AI model instead, and each workspace can switch that off.',
  },
];

function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <div className="mx-auto mt-10 max-w-3xl divide-y divide-line rounded-panel border border-line bg-surface">
      {FAQ.map((f, i) => (
        <div key={f.q}>
          <button
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
            className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
          >
            <span className="font-medium">{f.q}</span>
            <ChevronDown className={clsx('h-5 w-5 shrink-0 text-muted transition-transform', open === i && 'rotate-180')} />
          </button>
          {open === i && <p className="animate-fade px-5 pb-4 text-muted">{f.a}</p>}
        </div>
      ))}
    </div>
  );
}

const PLANS = [
  {
    name: 'Starter',
    price: 'Free',
    note: 'For a small team trying things out',
    items: ['Up to 3 users', '1,000 records', '2 automations', 'Custom fields', 'CSV import and export'],
    hot: false,
  },
  {
    name: 'Growth',
    price: '₹2,999',
    note: 'For sales teams that run on the pipeline',
    items: ['Up to 25 users', '1,00,000 records', '25 automations', 'Webhook and email actions', 'Audit log'],
    hot: true,
  },
  {
    name: 'Scale',
    price: '₹9,999',
    note: 'For large teams with custom needs',
    items: ['Unlimited users', 'Unlimited records', 'Unlimited automations', 'Everything in Growth'],
    hot: false,
  },
];

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 8);
    h();
    window.addEventListener('scroll', h, { passive: true });
    return () => window.removeEventListener('scroll', h);
  }, []);
  const go = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="overflow-x-clip bg-bg text-ink">
      {/* Nav */}
      <header
        className={clsx('sticky top-0 z-30 transition-colors', scrolled ? 'border-b border-line bg-bg/90 backdrop-blur' : 'bg-transparent')}
      >
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-5">
          <Logo light={false} />
          <nav className="hidden items-center gap-7 text-[14.5px] md:flex" aria-label="Sections">
            {[
              ['story', 'How it works'],
              ['features', 'Features'],
              ['safe', 'Data safety'],
              ['pricing', 'Plans'],
              ['faq', 'FAQ'],
            ].map(([id, l]) => (
              <button key={id} onClick={() => go(id)} className="text-muted transition-colors hover:text-ink">
                {l}
              </button>
            ))}
            <Link to="/docs" className="text-muted transition-colors hover:text-ink">
              Project pages
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/login" className="hidden rounded-control px-3.5 py-2 text-[14.5px] font-medium hover:bg-sunken sm:block">
              Sign in
            </Link>
            <Link
              to="/register"
              className="rounded-control bg-primary px-4 py-2 text-[14.5px] font-medium text-primary-ink hover:brightness-110"
            >
              Start free
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative">
        <div className="mx-auto grid max-w-[1200px] items-center gap-14 px-5 pb-24 pt-10 lg:grid-cols-[1.02fr_1fr] lg:pt-16">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[13px] font-medium">
              <Sparkles className="h-3.5 w-3.5 text-accent" />A CRM for small sales teams
            </p>
            <h1 className="mt-5 font-display text-[44px] font-semibold leading-[1.03] sm:text-[62px]">
              Every lead. Every follow-up.{' '}
              <span className="relative whitespace-nowrap text-primary">
                One place.
                <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 300 12" fill="none" aria-hidden preserveAspectRatio="none">
                  <path d="M2 8C60 2 120 2 180 6s90 2 118-3" stroke="#F2A900" strokeWidth="4" strokeLinecap="round" />
                </svg>
              </span>
            </h1>
            <p className="mt-6 max-w-xl text-[18px] leading-relaxed text-muted">
              Dealwave keeps track of the people who might buy from you, reminds your team what to do next, and shows the boss how much
              business is coming. No more lost WhatsApp chats and forgotten Excel sheets.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/login"
                className="inline-flex items-center gap-2 rounded-control bg-accent px-5 py-3 text-[15.5px] font-semibold text-[#2a1c00] hover:brightness-105"
              >
                Explore the live demo <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/register"
                className="rounded-control border border-line bg-surface px-5 py-3 text-[15.5px] font-medium hover:bg-sunken"
              >
                Create a free workspace
              </Link>
            </div>
            <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-muted">
              {['No card needed', 'Demo filled with sample data', 'Works on phone and laptop'].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-success" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="px-1 lg:px-0">
            <HeroMock />
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="bg-sidebar py-20 text-sidebar-ink">
        <div className="mx-auto max-w-[1200px] px-5">
          <Reveal>
            <SectionHead dark kicker="The problem" title="Sales usually runs on memory and chat groups">
              It works until the team grows. Then it breaks in the same three ways.
            </SectionHead>
          </Reveal>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {[
              ['A follow-up is forgotten', 'The customer was ready to buy, but nobody called back. That sale went to a competitor.'],
              ['A salesperson leaves', 'Their contacts, notes and promises were in their phone. They leave with the customers.'],
              ['The boss cannot see the future', '"How much will we sell this month?" Nobody knows without calling five people.'],
            ].map(([t, d], i) => (
              <Reveal key={t} delay={i * 90}>
                <div className="h-full rounded-panel border border-white/10 bg-white/5 p-6">
                  <span className="font-display text-[34px] font-semibold text-accent">0{i + 1}</span>
                  <h3 className="mt-2 font-display text-[19px] font-semibold text-white">{t}</h3>
                  <p className="mt-2 text-sidebar-ink/80">{d}</p>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal>
            <p className="mx-auto mt-10 max-w-2xl text-center font-display text-[22px] font-semibold text-white">
              A CRM is one shared notebook for all of this, that nobody can lose and everybody can see.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Story */}
      <section id="story" className="scroll-mt-16 py-24">
        <div className="mx-auto max-w-[1200px] px-5">
          <Reveal>
            <SectionHead kicker="How it works" title="Follow one customer from first hello to signed deal">
              Click each step. This is the whole product in five moments.
            </SectionHead>
          </Reveal>
          <Reveal>
            <Story />
          </Reveal>
        </div>
      </section>

      {/* Jargon */}
      <section className="bg-sunken/60 py-24">
        <div className="mx-auto max-w-[1200px] px-5">
          <Reveal>
            <SectionHead kicker="In plain words" title="Six words you will see, and what they mean" />
          </Reveal>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {WORDS.map((w, i) => (
              <Reveal key={w.word} delay={(i % 3) * 80}>
                <div className="h-full rounded-panel border border-line bg-surface p-5">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
                      <w.icon className="h-5 w-5" />
                    </span>
                    <h3 className="font-display text-[20px] font-semibold">{w.word}</h3>
                  </div>
                  <p className="mt-3 font-medium">{w.plain}</p>
                  <p className="mt-1.5 text-[14px] text-muted">For example: {w.eg}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Automation */}
      <section className="py-24">
        <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-5 lg:grid-cols-2">
          <Reveal>
            <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-primary">Automations</p>
            <h2 className="mt-2 font-display text-[30px] font-semibold leading-[1.1] sm:text-[40px]">
              Set a rule once. Let it work every day.
            </h2>
            <p className="mt-4 text-[16.5px] text-muted">
              An automation is simply "if this happens, then do that". You build it by picking from dropdown lists, with no coding. Dealwave
              records every time a rule runs, so you can see what it did.
            </p>
            <ul className="mt-6 space-y-3">
              {[
                'Hand each new website lead to the least busy seller',
                'Create a call-back task one day after a lead arrives',
                'Tell the manager when a deal above ₹10 lakh reaches Negotiation',
                'Send a signed webhook to your other software',
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-success" />
                  {t}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={120}>
            <div className="rounded-2xl border border-line bg-surface p-5 shadow-pop sm:p-7">
              <p className="text-[12.5px] font-semibold uppercase tracking-wider text-muted">Example rule</p>
              {[
                ['When', 'A lead is created', 'bg-sunken'],
                ['Only if', 'Source is "Website"', 'bg-sunken'],
                ['Then', 'Assign to the least busy seller', 'bg-primary-soft text-primary'],
                ['And then', 'Create task: "Call within 1 day"', 'bg-primary-soft text-primary'],
                ['And then', 'Notify the sales manager', 'bg-primary-soft text-primary'],
              ].map(([k, v, c], i) => (
                <div key={i} className="mt-3 flex items-center gap-3">
                  <span className="w-16 shrink-0 text-[13px] font-medium text-muted">{k}</span>
                  <span className={clsx('flex-1 rounded-control px-3.5 py-2.5 font-medium', c)}>{v}</span>
                </div>
              ))}
              <p className="mt-5 flex items-center gap-2 rounded-control bg-success-soft px-3.5 py-2.5 text-[13.5px] text-success">
                <Check className="h-4 w-4" />
                Ran 214 times. Last run 3 minutes ago.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="scroll-mt-16 bg-sunken/60 py-24">
        <div className="mx-auto max-w-[1200px] px-5">
          <Reveal>
            <SectionHead kicker="What you get" title="Everything a sales team needs, nothing it does not" />
          </Reveal>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 80}>
                <div className="h-full rounded-panel border border-line bg-surface p-5 transition-shadow hover:shadow-pop">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-ink">
                    <f.icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 font-display text-[18px] font-semibold leading-snug">{f.title}</h3>
                  <p className="mt-1.5 text-[14.5px] text-muted">{f.text}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* Multi-tenant / safety */}
      <section id="safe" className="scroll-mt-16 py-24">
        <div className="mx-auto max-w-[1000px] px-5">
          <Reveal>
            <SectionHead kicker="Data safety" title="Many companies, one app, zero mixing">
              Think of Dealwave as an apartment building. Each company lives in its own locked flat. Nobody can walk into another one.
            </SectionHead>
          </Reveal>
          <Reveal>
            <TenantCards />
          </Reveal>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              [
                ShieldCheck,
                'The database enforces it',
                "Separation is built into the database itself, so even a mistake in the app cannot show another company's data.",
              ],
              [
                KeyRound,
                'Safer sign-in',
                'Short-lived sessions. If a stolen sign-in token is reused, every session of that user is shut down.',
              ],
              [Bell, 'Everything is logged', 'Every change keeps a history of who did what and when.'],
            ].map(([Icon, t, d], i) => {
              const I = Icon;
              return (
                <Reveal key={t} delay={i * 90}>
                  <div className="h-full rounded-panel border border-line bg-surface p-5">
                    <I className="h-6 w-6 text-primary" />
                    <h3 className="mt-3 font-display text-[17px] font-semibold">{t}</h3>
                    <p className="mt-1.5 text-[14.5px] text-muted">{d}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </section>

      {/* Who */}
      <section className="bg-sidebar py-20 text-sidebar-ink">
        <div className="mx-auto max-w-[1200px] px-5">
          <Reveal>
            <SectionHead dark kicker="Who it is for" title="Anyone who sells to other people">
              If you have leads and follow-ups, you need a CRM.
            </SectionHead>
          </Reveal>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            {[
              'Solar and energy installers',
              'Real estate agents',
              'Coaching institutes',
              'Software agencies',
              'Logistics and transport',
              'Insurance and finance agents',
              'Interior designers',
              'Manufacturers and distributors',
            ].map((t) => (
              <span key={t} className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-[14.5px] text-white">
                {t}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-16 py-24">
        <div className="mx-auto max-w-[1100px] px-5">
          <Reveal>
            <SectionHead kicker="Plans" title="Start free. Grow when your team does." />
          </Reveal>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {PLANS.map((p, i) => (
              <Reveal key={p.name} delay={i * 90}>
                <div
                  className={clsx(
                    'flex h-full flex-col rounded-panel border bg-surface p-6',
                    p.hot ? 'border-primary ring-1 ring-primary' : 'border-line',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <h3 className="font-display text-[22px] font-semibold">{p.name}</h3>
                    {p.hot && (
                      <span className="rounded-full bg-accent px-2.5 py-0.5 text-[12px] font-semibold text-[#2a1c00]">Popular</span>
                    )}
                  </div>
                  <p className="mt-1 text-[14px] text-muted">{p.note}</p>
                  <p className="mt-4 font-display text-[36px] font-semibold num">
                    {p.price}
                    <span className="text-[14px] font-normal text-muted">{p.price === 'Free' ? '' : ' per month'}</span>
                  </p>
                  <ul className="mt-4 flex-1 space-y-2">
                    {p.items.map((t) => (
                      <li key={t} className="flex gap-2.5 text-[14.5px]">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                        {t}
                      </li>
                    ))}
                  </ul>
                  <Link
                    to="/register"
                    className={clsx(
                      'mt-6 rounded-control px-4 py-2.5 text-center font-medium',
                      p.hot ? 'bg-primary text-primary-ink hover:brightness-110' : 'border border-line hover:bg-sunken',
                    )}
                  >
                    Start with {p.name}
                  </Link>
                </div>
              </Reveal>
            ))}
          </div>
          <p className="mt-5 text-center text-[13px] text-muted">
            Pay by UPI, card or netbanking through Razorpay once the server owner connects an account. Until then, switching plans is
            instant and free.
          </p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-16 bg-sunken/60 py-24">
        <div className="mx-auto max-w-[1200px] px-5">
          <Reveal>
            <SectionHead kicker="Questions" title="Things people ask first" />
          </Reveal>
          <Reveal>
            <Faq />
          </Reveal>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24">
        <div className="mx-auto max-w-[1000px] px-5">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl bg-sidebar px-6 py-14 text-center sm:px-14">
              <svg
                className="pointer-events-none absolute inset-x-0 bottom-0 opacity-30"
                viewBox="0 0 800 140"
                fill="none"
                aria-hidden
                preserveAspectRatio="none"
              >
                <path
                  d="M0 110C140 110 160 30 300 30s160 80 300 80 140-60 200-60"
                  stroke="#F2A900"
                  strokeWidth="18"
                  strokeLinecap="round"
                />
              </svg>
              <h2 className="relative font-display text-[32px] font-semibold leading-tight text-white sm:text-[44px]">
                See it with real-looking data in 10 seconds
              </h2>
              <p className="relative mx-auto mt-3 max-w-xl text-[17px] text-sidebar-ink/85">
                One click opens a demo workspace full of leads, deals and tasks. Click around freely.
              </p>
              <div className="relative mt-8 flex flex-wrap justify-center gap-3">
                <Link
                  to="/login"
                  className="inline-flex items-center gap-2 rounded-control bg-accent px-6 py-3 text-[16px] font-semibold text-[#2a1c00] hover:brightness-105"
                >
                  Open the demo <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  to="/register"
                  className="rounded-control border border-white/25 px-6 py-3 text-[16px] font-medium text-white hover:bg-white/10"
                >
                  Create a free workspace
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <footer className="border-t border-line py-8">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-5 text-[13.5px] text-muted">
          <Logo light={false} size={22} />
          <p>Dealwave CRM. Built with React, Node.js, PostgreSQL and Redis.</p>
          <div className="flex gap-5">
            <Link to="/docs" className="hover:text-ink">
              Project pages
            </Link>
            <Link to="/login" className="hover:text-ink">
              Sign in
            </Link>
            <Link to="/register" className="hover:text-ink">
              Create workspace
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
