import { Link, Navigate, NavLink, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowLeft, Brain, Building2, FileText, Layers, ListChecks, Palette, ShieldCheck } from 'lucide-react';
import { Logo } from '../components/Layout';
import { useAuth } from '../lib/auth';

/**
 * Project documents shown as normal pages: PRD, Architecture, Rules, Phases, Design and Memory.
 * Open to everyone (no sign-in needed), so anybody can read how Dealwave is planned and built.
 * The text is plain data below. Block types: p, ul, table, code, colors, diagram.
 */

const COLORS = [
  ['Background', '#000000', '#F5F6F3'],
  ['Surface (cards)', '#0C0D0D', '#FFFFFF'],
  ['Primary (buttons, links)', '#3FBEA5', '#0F6B5C'],
  ['Accent', '#F2A900', '#F2A900'],
  ['Text', '#ECF0EE', '#14201E'],
  ['Quiet text', '#96A19D', '#6B7A76'],
  ['Border', '#282C2B', '#E1E5E0'],
  ['Success', '#54C884', '#228B54'],
  ['Warning', '#F0B03C', '#B06A00'],
  ['Error', '#F06E6E', '#D64545'],
];

const FOLDERS = `dealwave-crm/
  api/
    migrations/        SQL files (001 to 004): tables, RLS, new features
    src/
      routes/          auth, team, records, settings, workflows, reports, emails, files
      lib/             helpers: tokens, mail, Google login, 2FA, scoring, realtime
      workflow/        automation rule engine
      server.js        starts the API
      worker.js        starts the background worker
      seed.js          demo data
      migrate.js       runs the SQL migrations
    test/              automated test suites
  web/
    src/
      pages/           Dashboard, Records, Deals, Tasks, Reports, Automations, Settings, Auth, Docs
      components/      layout, UI kit, record drawer and form
      lib/             API client, auth, theme, realtime
  docker-compose.yml        local stack
  docker-compose.prod.yml   production stack
  Caddyfile                 HTTPS proxy`;

const PAGES = [
  {
    slug: 'prd',
    title: 'PRD',
    sub: 'Product Requirement Document',
    blurb: 'What we build, who it is for, and the features that solve their problems.',
    icon: FileText,
    intro: 'Dealwave CRM helps a small sales team track every lead until it becomes a paying customer, while keeping each company’s data private.',
    sections: [
      {
        h: '1. What to build',
        blocks: [
          {
            ul: [
              '**Product:** a web CRM (Customer Relationship Management) tool for small sales teams.',
              '**Goals:** keep leads, contacts, accounts, deals and tasks in one place; show simple reports; automate repeated work; keep every company’s data separate and safe.',
              '**Core purpose:** move a lead through a clear pipeline to a won deal, with no lost follow-ups.',
            ],
          },
        ],
      },
      {
        h: '2. Targeted users',
        blocks: [
          {
            table: {
              head: ['User', 'What they need'],
              rows: [
                ['Owner / Admin', 'Set up the workspace, invite the team, control plan, security and settings'],
                ['Manager', 'See the whole team’s deals and reports, assign leads'],
                ['Member (sales person)', 'Add leads, update deals, finish tasks, see only the records they should see'],
                ['Small business with no tech skills', 'Simple screens, plain words, and a one-click demo to try the product'],
              ],
            },
          },
        ],
      },
      {
        h: '3. Features',
        blocks: [
          {
            ul: [
              '**Records:** leads, contacts, accounts, deals (pipeline board), tasks, calendar.',
              '**Reports:** dashboard cards and charts, Excel and PDF export.',
              '**Automations:** when a record is created or changes stage, create a task, send an email, assign by round robin, or call a signed webhook.',
              '**Team:** four roles (owner, admin, manager, member) and invites.',
              '**Security:** login with refresh tokens, two-step sign-in (2FA), forgot password, email verification, Continue with Google.',
              '**Extras:** file attachments (up to 5 MB), email templates and email log, live updates, Ask Dealwave (summaries and email drafts), plans page with optional Razorpay payments.',
              '**Look:** AMOLED black dark theme by default, with a light theme option.',
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'architecture',
    title: 'Architecture',
    sub: 'High-level design and structure of the application',
    blurb: 'How the parts fit together, the folder structure and the tech stack.',
    icon: Building2,
    intro: 'A React website talks to an Express API. The API stores data in PostgreSQL, and a separate worker runs background jobs through Redis.',
    sections: [
      {
        h: '1. Architecture',
        blocks: [
          { diagram: 'arch' },
          {
            ul: [
              '**Web:** React app, served by nginx in Docker.',
              '**API:** Node.js with Express. It handles login, records, reports, files and emails.',
              '**Database:** PostgreSQL. Row-Level Security (RLS) makes sure one company can never read another company’s rows.',
              '**Redis:** stores queues and sends live-update events between API containers.',
              '**Worker:** a separate Node.js process (BullMQ). It runs automations and sends overdue-task alerts every 30 minutes.',
              '**Live updates:** the API pushes changes to the browser with Server-Sent Events.',
              '**Production:** Caddy sits in front and gives automatic HTTPS.',
            ],
          },
        ],
      },
      { h: '2. Folder and file structure', blocks: [{ code: FOLDERS }] },
      {
        h: '3. Tech stack',
        blocks: [
          {
            table: {
              head: ['Area', 'Technology'],
              rows: [
                ['Language', 'JavaScript (ES modules)'],
                ['Backend', 'Node.js 22, Express 5, Zod (input checks), Helmet, Pino (logs)'],
                ['Database', 'PostgreSQL 16 with Row-Level Security'],
                ['Queue and cache', 'Redis, BullMQ'],
                ['Auth', 'JWT, httpOnly refresh cookie, bcryptjs, TOTP 2FA, Google OAuth 2.0 (PKCE)'],
                ['Frontend', 'React 18, Vite, Tailwind CSS, React Router, TanStack Query, Recharts'],
                ['Email and files', 'Nodemailer, ExcelJS, PDFKit'],
                ['Deploy', 'Docker, Docker Compose, nginx, Caddy'],
              ],
            },
          },
        ],
      },
    ],
  },
  {
    slug: 'rules',
    title: 'Rules',
    sub: 'Project rules, standards and guidelines',
    blurb: 'What to use, what to avoid, libraries, errors, AI limits and general rules.',
    icon: ShieldCheck,
    intro: 'These rules keep Dealwave safe, simple and easy to maintain.',
    sections: [
      {
        h: '1. What to use',
        blocks: [
          {
            ul: [
              'Plain JavaScript with ES modules on Node.js 22.',
              'PostgreSQL for all data, with Row-Level Security on every table that holds company data.',
              'SQL with parameters ($1, $2) only. Check every input with Zod.',
              'Secrets only in environment variables, never in code.',
              'Database changes only through new numbered SQL migration files.',
              'React function components, Tailwind CSS with colour variables, one API client for all calls.',
            ],
          },
        ],
      },
      {
        h: '2. What to avoid',
        blocks: [
          {
            ul: [
              '**TypeScript:** removed on purpose to keep the project simple.',
              '**String-built SQL:** it opens the door to SQL injection.',
              '**Connecting as a database superuser at runtime:** superusers bypass RLS, so the app uses a low-privilege role.',
              '**Saving tokens or secrets in plain text:** reset and verify tokens are stored as a hash, 2FA secrets are encrypted.',
              '**Keeping the access token in localStorage:** it stays in memory only.',
              '**Committing .env files or real keys.**',
              '**Files above 5 MB** (they live in the database).',
            ],
          },
        ],
      },
      {
        h: '3. Libraries and dependencies',
        blocks: [
          {
            table: {
              head: ['Library', 'Purpose'],
              rows: [
                ['express, helmet, cors', 'API server and safe HTTP headers'],
                ['pg', 'PostgreSQL client'],
                ['ioredis, bullmq', 'Redis connection and background jobs'],
                ['jsonwebtoken, bcryptjs', 'Login tokens and password hashing'],
                ['zod', 'Input validation'],
                ['nodemailer', 'Sending email'],
                ['exceljs, pdfkit, papaparse', 'Excel, PDF and CSV'],
                ['qrcode', 'QR code for 2FA setup'],
                ['pino', 'Logging'],
                ['react, react-router-dom, @tanstack/react-query', 'Web app, pages, data fetching'],
                ['tailwindcss, recharts, lucide-react', 'Styling, charts, icons'],
              ],
            },
          },
          { p: 'Use the versions in package.json. Add a new library only when the work cannot be done simply without it.' },
        ],
      },
      {
        h: '4. Error handling',
        blocks: [
          {
            ul: [
              'The API always answers with a clear JSON error and the right status code.',
              'Show short, friendly messages to people. Keep technical details in the logs only.',
              'Log every error with Pino. Never log passwords, tokens or reset links.',
              'Forgot password gives the same answer for known and unknown emails, so nobody can find out who has an account.',
              'If sending an email fails, the request still works and the failure is logged.',
              'Too many tries gets a rate-limit message (“Too many attempts”).',
            ],
          },
        ],
      },
      {
        h: '5. Boundaries of AI',
        blocks: [
          {
            ul: [
              'Ask Dealwave works with built-in rules by default. No AI service is needed.',
              'Only if an ANTHROPIC_API_KEY is set, the text of the record being asked about is sent to the AI service to write a summary or an email draft.',
              'A workspace admin can switch AI off for the whole workspace in Settings.',
              'Lead scoring never uses AI.',
              'AI output is a suggestion for a person to read. It must not be trusted as a fact.',
            ],
          },
        ],
      },
      {
        h: '6. General rules',
        blocks: [
          {
            ul: [
              '**Code style:** 2 spaces, single quotes, semicolons, one formatter for the whole project.',
              '**Naming:** camelCase for variables and functions, snake_case for database columns, clear file names.',
              '**Commit messages:** short, in the present tense, saying what changed.',
              '**Security and privacy:** check the role on every route, keep tenant isolation in the database, use httpOnly cookies, hash or encrypt anything secret.',
              '**Performance:** index the columns used in filters, page long lists, keep files small.',
              '**Documentation:** comments explain why, not what. Keep the README and run guide up to date.',
              '**Testing:** every new route gets tests, and all tests must pass before a release.',
              '**Project specific:** demo logins are for showcase only and are hidden in production.',
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'phases',
    title: 'Phases',
    sub: 'Breakdown of the project into manageable phases',
    blurb: 'Six phases from login to deployment, and where each one stands.',
    icon: ListChecks,
    intro: 'The project is split into six phases. Phases 1 to 5 are done. Phase 6 is half done: the Docker setup is ready, but the app is not live on a server yet.',
    sections: [
      {
        h: 'Phase 1: Login and authentication',
        status: 'Done',
        blocks: [
          {
            ul: [
              'Register a workspace, log in and log out',
              'Password reset (forgot password), email verification',
              'Two-step sign-in (2FA) and Continue with Google',
              'Roles, invites and access checks on every route',
            ],
          },
        ],
      },
      { h: 'Phase 2: Dashboard', status: 'Done', blocks: [{ ul: ['Dashboard layout and navigation', 'Overview cards and numbers', 'Charts for pipeline and reports'] }] },
      {
        h: 'Phase 3: CRUD operations',
        status: 'Done',
        blocks: [
          {
            ul: [
              'Create, read, update and delete for leads, contacts, accounts, deals and tasks',
              'Form validation',
              'List view and detail drawer',
              'Search, filter and sort',
            ],
          },
        ],
      },
      {
        h: 'Phase 4: Additional features',
        status: 'Done',
        blocks: [
          {
            ul: [
              'Automations (rules that run when records change)',
              'File attachments and email templates',
              'Notifications and overdue-task alerts',
              'Settings, plans and optional payments',
              'Live updates',
            ],
          },
        ],
      },
      {
        h: 'Phase 5: Testing and quality assurance',
        status: 'Done',
        blocks: [
          {
            ul: [
              'Unit and API tests, plus browser checks of the main flows',
              'Bug fixing',
              'Security checks such as tenant isolation, replayed codes and token reuse',
            ],
          },
        ],
      },
      {
        h: 'Phase 6: Deployment and maintenance',
        status: 'In progress',
        blocks: [
          {
            ul: [
              'Docker Compose for local use and a production stack with automatic HTTPS (ready)',
              'Put the app live on a server and set up database backups (next)',
              'Collect user feedback, fix bugs and improve',
              'Future ideas: more sign-in providers, WhatsApp or SMS messages, email sequences',
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'design',
    title: 'Design',
    sub: 'UI/UX guidelines and visual design system',
    blurb: 'Look and feel: colours, fonts and the choices the app remembers.',
    icon: Palette,
    intro: 'Dealwave uses a clean, calm look: a pure black (AMOLED) dark theme by default, one green accent colour, and two fonts.',
    sections: [
      {
        h: '1. UI/UX',
        blocks: [
          {
            ul: [
              'Clean and simple screens in plain words.',
              'The same layout, buttons and forms on every page.',
              'Mobile-friendly: the side menu becomes a drawer on a phone.',
              'Easy navigation with a left menu.',
              'Reusable components (buttons, cards, tables, drawer, form) so every page looks the same.',
            ],
          },
        ],
      },
      {
        h: '2. Color and theme',
        blocks: [{ p: 'Colours are CSS variables, so the whole app switches theme at once.' }, { colors: true }, { p: 'Charts read the same colours through a small helper, because chart images cannot read CSS variables.' }],
      },
      {
        h: '3. Fonts and typography',
        blocks: [
          {
            ul: [
              '**Headings:** Bricolage Grotesque, slightly tight letter spacing.',
              '**Body text:** Figtree, with system fonts as a fallback.',
              'Heading sizes go from H1 down to H3, body text stays easy to read, and weights are regular, medium, semibold and bold.',
            ],
          },
        ],
      },
      {
        h: '4. Memory (UI preferences)',
        blocks: [
          { p: 'The browser remembers these choices for each person:' },
          {
            ul: [
              'Theme mode: dark by default, light only if the person chose it.',
              'Leads view: list or board.',
              'Deals view: board or list.',
              'The browser colour bar (theme-color) follows the chosen theme.',
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'memory',
    title: 'Memory',
    sub: 'Project memory: progress, decisions and current work',
    blurb: 'The project notebook: key decisions, what happened, and what comes next.',
    icon: Brain,
    intro: 'This page is the project’s notebook. It keeps progress, decisions and current work in one place, so nothing important is forgotten between work sessions. Update it often.',
    sections: [
      {
        h: '1. Memory (key context and decisions)',
        blocks: [
          {
            ul: [
              'The project name is Dealwave CRM (earlier name: Pravah).',
              'Each company is a separate tenant. Isolation is enforced in PostgreSQL with Row-Level Security.',
              'The app connects to the database with a low-privilege role, never a superuser.',
              'Secrets (JWT secret, database passwords) come from the .env file.',
              'The 2FA encryption salt keeps its old value (pravah-totp-v1) on purpose, so old 2FA secrets still work after the rename.',
              'The project is plain JavaScript. TypeScript was removed.',
              'Dark theme is AMOLED black and is the default.',
            ],
          },
        ],
      },
      {
        h: '2. What happened',
        blocks: [
          {
            table: {
              head: ['Update', 'Details'],
              rows: [
                ['Core CRM', 'Leads, contacts, accounts, deals, tasks, reports, automations, files, email'],
                ['Security and extras', '2FA, live updates, AI helper switch, optional payments'],
                ['New sign-in features', 'Forgot password, email verification, Continue with Google'],
                ['Rename', 'Pravah became Dealwave'],
                ['Theme', 'Whole frontend moved to AMOLED black dark theme'],
                ['Language switch', 'TypeScript removed, project is now plain JavaScript'],
                ['Project pages', 'PRD, Architecture, Rules, Phases, Design and Memory added to the frontend'],
              ],
            },
          },
          { p: 'Known issue: on a phone, some pipeline strip labels are cut off.' },
        ],
      },
      {
        h: '3. Currently working',
        blocks: [
          {
            ul: [
              '**In progress:** getting the project ready to put live.',
              '**Current area:** deployment (Docker Compose and the production stack).',
              '**Next:** run the production stack on a server with a domain, set up database backups, and try real Google login and real email.',
            ],
          },
        ],
      },
      {
        h: '4. Updates',
        blocks: [{ ul: ['Update this page after every big change.', 'Keep only true and current information.', 'Remove old notes that no longer matter.'] }],
      },
      {
        h: '5. Purpose',
        blocks: [{ ul: ['Keep context across work sessions.', 'Stay consistent and work faster.', 'Make sure nothing important is forgotten.'] }],
      },
    ],
  },
];

/** Turns **bold** pieces of a string into <strong>. */
function Rich({ text }) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') ? (
      <strong key={i} className="font-semibold text-ink">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function ArchitectureDiagram() {
  const W = 136;
  const H = 56;
  const rowA = 150;
  const rowB = 270;
  const cb = 100;
  const cc = 270;
  const ca = 440;
  const cp = 664;
  const cw = 664;
  const edge = 'rgb(var(--muted))';
  const ink = 'rgb(var(--ink))';
  const quiet = 'rgb(var(--muted))';
  const accent = 'rgb(var(--primary))';
  const box = (cx, cy, main) => (
    <rect
      x={cx - W / 2}
      y={cy - H / 2}
      width={W}
      height={H}
      rx="8"
      fill={main ? accent : 'none'}
      fillOpacity={main ? 0.14 : 1}
      stroke={main ? accent : edge}
      strokeWidth={main ? 2 : 1.25}
    />
  );
  const label = (cx, cy, name, note) => (
    <>
      <text x={cx} y={cy - 2} textAnchor="middle" fontWeight="600" fill={ink} fontSize="13">
        {name}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize="11.5" fill={quiet}>
        {note}
      </text>
    </>
  );
  const small = (props, words) => (
    <text fontSize="11.5" fill={quiet} {...props}>
      {words}
    </text>
  );
  return (
    <figure className="my-2">
      <svg viewBox="0 0 760 330" role="img" aria-label="The browser talks to the API; a separate worker handles background jobs" className="w-full">
        <defs>
          <marker id="arch-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill={edge} />
          </marker>
        </defs>
        <text x="24" y="28" fontSize="15" fontWeight="600" fill={ink}>
          The browser talks to the API; a worker handles background jobs
        </text>
        <g fill="none" stroke={edge} strokeWidth="1.25">
          <path d={`M${cb + W / 2} ${rowA}H${cc - W / 2}`} markerEnd="url(#arch-arrow)" />
          <path d={`M${cc + W / 2} ${rowA}H${ca - W / 2}`} markerEnd="url(#arch-arrow)" />
          <path d={`M${ca + W / 2} ${rowA}H${cp - W / 2}`} markerEnd="url(#arch-arrow)" />
          <path d={`M${ca} ${rowA + H / 2}V${rowB - H / 2}`} markerStart="url(#arch-arrow)" markerEnd="url(#arch-arrow)" />
          <path d={`M${cw - W / 2} ${rowB}H${ca + W / 2}`} markerEnd="url(#arch-arrow)" />
          <path d={`M${cw} ${rowB - H / 2}V${rowA + H / 2}`} markerEnd="url(#arch-arrow)" />
          <path d={`M${ca} ${rowA - H / 2}V84H${cb}V${rowA - H / 2}`} strokeDasharray="5 4" markerEnd="url(#arch-arrow)" />
        </g>
        {box(cb, rowA, false)}
        {label(cb, rowA, 'Browser', 'React web app')}
        {box(cc, rowA, false)}
        {label(cc, rowA, 'Caddy', 'HTTPS in production')}
        {box(ca, rowA, true)}
        {label(ca, rowA, 'API', 'Node.js + Express')}
        {box(cp, rowA, false)}
        {label(cp, rowA, 'PostgreSQL', 'Row-Level Security')}
        {box(ca, rowB, false)}
        {label(ca, rowB, 'Redis', 'queues, live events')}
        {box(cw, rowB, false)}
        {label(cw, rowB, 'Worker', 'BullMQ jobs')}
        {small({ x: (ca + cb) / 2, y: 76, textAnchor: 'middle' }, 'live updates (Server-Sent Events)')}
        {small({ x: (ca + cp) / 2, y: rowA - 8, textAnchor: 'middle' }, 'SQL')}
        {small({ x: ca + 10, y: (rowA + rowB) / 2 + 4 }, 'jobs, events')}
        {small({ x: (ca + cw) / 2, y: rowB - 8, textAnchor: 'middle' }, 'reads jobs')}
        {small({ x: cw - 10, y: (rowA + rowB) / 2 + 4, textAnchor: 'end' }, 'saves results')}
      </svg>
    </figure>
  );
}

function Block({ b }) {
  if (b.p)
    return (
      <p className="max-w-[760px] text-[15px] leading-relaxed text-muted">
        <Rich text={b.p} />
      </p>
    );
  if (b.ul)
    return (
      <ul className="max-w-[760px] space-y-2 text-[15px] leading-relaxed">
        {b.ul.map((t) => (
          <li key={t} className="flex gap-3">
            <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
            <span>
              <Rich text={t} />
            </span>
          </li>
        ))}
      </ul>
    );
  if (b.table)
    return (
      <div className="scroll-thin max-w-[860px] overflow-x-auto rounded-panel border border-line">
        <table className="w-full min-w-[480px] text-left text-[14.5px]">
          <thead className="bg-sunken text-[13px] text-muted">
            <tr>
              {b.table.head.map((h) => (
                <th key={h} className="px-4 py-2.5 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {b.table.rows.map((r) => (
              <tr key={r[0]} className="border-t border-line align-top">
                {r.map((c, i) => (
                  <td key={i} className={clsx('px-4 py-2.5', i === 0 && 'font-medium')}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  if (b.code)
    return (
      <pre className="scroll-thin max-w-[860px] overflow-x-auto rounded-panel border border-line bg-sunken p-4 text-[13px] leading-relaxed">
        <code>{b.code}</code>
      </pre>
    );
  if (b.diagram) return <ArchitectureDiagram />;
  if (b.colors)
    return (
      <div className="scroll-thin max-w-[860px] overflow-x-auto rounded-panel border border-line">
        <table className="w-full min-w-[480px] text-left text-[14.5px]">
          <thead className="bg-sunken text-[13px] text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Use</th>
              <th className="px-4 py-2.5 font-medium">Dark theme</th>
              <th className="px-4 py-2.5 font-medium">Light theme</th>
            </tr>
          </thead>
          <tbody>
            {COLORS.map(([use, dark, light]) => (
              <tr key={use} className="border-t border-line">
                <td className="px-4 py-2.5 font-medium">{use}</td>
                {[dark, light].map((hex, n) => (
                  <td key={n} className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-2.5">
                      <span className="h-5 w-5 rounded border border-line" style={{ background: hex }} aria-hidden />
                      <code className="text-[13px]">{hex}</code>
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  return null;
}

function StatusPill({ status }) {
  const done = status === 'Done';
  return (
    <span
      className={clsx(
        'rounded-full px-2.5 py-0.5 text-[12.5px] font-medium',
        done ? 'bg-success-soft text-success' : 'bg-warn-soft text-warn',
      )}
    >
      {status}
    </span>
  );
}

function DocsShell({ children }) {
  const { user } = useAuth();
  const links = [{ to: '/docs', label: 'Overview', end: true, icon: Layers }, ...PAGES.map((p) => ({ to: `/docs/${p.slug}`, label: p.title, icon: p.icon }))];
  return (
    <div className="min-h-full bg-bg text-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-5">
          <Link to="/" aria-label="Dealwave home">
            <Logo light={false} />
          </Link>
          <Link to="/" className="inline-flex items-center gap-1.5 text-[14px] text-muted hover:text-ink">
            <ArrowLeft className="h-4 w-4" />
            {user ? 'Back to app' : 'Back to home'}
          </Link>
        </div>
      </header>
      <div className="mx-auto grid max-w-[1200px] gap-8 px-5 py-8 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Project pages" className="scroll-thin -mx-1 flex gap-1 overflow-x-auto pb-1 lg:sticky lg:top-20 lg:mx-0 lg:block lg:self-start lg:space-y-1 lg:overflow-visible">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                clsx(
                  'flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-control px-3 py-2 text-[14.5px] transition-colors',
                  isActive ? 'bg-primary-soft font-medium text-primary' : 'text-muted hover:bg-sunken hover:text-ink',
                )
              }
            >
              <l.icon className="h-[18px] w-[18px]" />
              {l.label}
            </NavLink>
          ))}
        </nav>
        <main className="min-w-0 pb-16">{children}</main>
      </div>
    </div>
  );
}

export function DocsIndex() {
  return (
    <DocsShell>
      <h1 className="font-display text-[34px] font-semibold leading-tight">Project pages</h1>
      <p className="mt-2 max-w-[640px] text-[15.5px] leading-relaxed text-muted">
        Six short pages that explain what Dealwave CRM is, how it is built, the rules we follow, how the work is planned, how it looks, and where the project stands today.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {PAGES.map((p) => (
          <Link key={p.slug} to={`/docs/${p.slug}`} className="group rounded-panel border border-line bg-surface p-5 transition-colors hover:border-primary">
            <p.icon className="h-6 w-6 text-primary" />
            <h2 className="mt-3 font-display text-[20px] font-semibold">{p.title}</h2>
            <p className="text-[13.5px] text-muted">{p.sub}</p>
            <p className="mt-2 text-[14.5px] leading-relaxed">{p.blurb}</p>
          </Link>
        ))}
      </div>
    </DocsShell>
  );
}

export function DocsPage() {
  const { slug } = useParams();
  const page = PAGES.find((p) => p.slug === slug);
  if (!page) return <Navigate to="/docs" replace />;
  const idx = PAGES.indexOf(page);
  const next = PAGES[idx + 1];
  const prev = PAGES[idx - 1];
  return (
    <DocsShell>
      <p className="text-[13.5px] text-muted">{page.sub}</p>
      <h1 className="mt-1 font-display text-[34px] font-semibold leading-tight">{page.title}</h1>
      <p className="mt-3 max-w-[700px] text-[16px] leading-relaxed">{page.intro}</p>
      <div className="mt-8 space-y-9">
        {page.sections.map((s) => (
          <section key={s.h} className="space-y-3">
            <h2 className="flex flex-wrap items-center gap-3 font-display text-[22px] font-semibold">
              {s.h}
              {s.status && <StatusPill status={s.status} />}
            </h2>
            {s.blocks.map((b, i) => (
              <Block key={i} b={b} />
            ))}
          </section>
        ))}
      </div>
      <div className="mt-12 flex items-center justify-between gap-4 border-t border-line pt-5 text-[14.5px]">
        {prev ? (
          <Link to={`/docs/${prev.slug}`} className="text-muted hover:text-ink">
            ← {prev.title}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link to={`/docs/${next.slug}`} className="font-medium text-primary hover:underline">
            {next.title} →
          </Link>
        ) : (
          <Link to="/docs" className="font-medium text-primary hover:underline">
            All pages
          </Link>
        )}
      </div>
    </DocsShell>
  );
}
