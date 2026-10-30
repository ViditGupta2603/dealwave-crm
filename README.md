# Dealwave CRM

A multi-tenant CRM for small sales teams: leads, contacts, accounts, deals, tasks, reports and a rule-based automation engine. Built with React, Node.js (Express), PostgreSQL and Redis, and shipped as a Docker stack with demo data.

## Run it (2 minutes)

You need Docker with Compose v2.

```bash
docker compose up --build
```

Open **http://localhost:8080**. Two demo workspaces are created automatically on first start, and the sign-in page has one-click demo logins.

| Workspace | Login | Role |
|---|---|---|
| Sundaram Solar | owner@sundaram.demo | Owner |
| | meera@sundaram.demo | Admin |
| | arjun@sundaram.demo, priya@sundaram.demo | Managers |
| | rohan@, sneha@, karan@, ananya@ `sundaram.demo` | Members (see only their own records) |
| Nimbus Logistics | owner@nimbus.demo | Owner |
| | kavya@, nikhil@, isha@, yash@ `nimbus.demo` | Team |

Password for every demo user: `Demo@12345`

Sundaram Solar has 8 users, 46 accounts, 128 contacts, 168 leads, 96 deals, about 340 activities, 5 automations and 5 custom fields. Nimbus Logistics is a smaller second tenant, useful for checking that data never leaks between workspaces.

Demo data loads only when the database has no workspaces, so restarting never duplicates it. To start clean: `docker compose down -v`.

## What is inside

- **Project pages** at `/docs` (open to everyone, also linked in the sidebar): PRD, Architecture, Rules, Phases, Design and Memory, written in simple English.
- **Landing page** at `/` for visitors who are not signed in: explains the product in plain words (the lead-to-deal story, a jargon decoder, automations, data safety for non-technical readers, plans, FAQ). Signed-in users see the dashboard at the same address.
- **Dashboard** with a pipeline strip (open deal value by stage, drawn as chevrons sized by value), KPIs with month-on-month change, revenue chart, lead sources, tasks, leaderboard and recent activity.
- **Leads, contacts, accounts, deals** with search, filters, sorting, pagination, detail drawer, activity timeline, edit history, CSV import and export for leads, and lead conversion into contact + account + deal.
- **Boards**: deals drag between stages (with lost-reason capture); leads drag between New, Contacted, Qualified and Unqualified. Each has a list view too.
- **Files**: attach PDFs, images, Word, Excel, CSV or text (up to 5 MB) to any lead, contact, account or deal. Stored in PostgreSQL, so they are covered by row level security and by normal backups. The type is checked by extension and by the file's first bytes, so a renamed program cannot pass as a PDF.
- **Email**: write an email from any record using a saved template (`{{name}}`, `{{first_name}}`, `{{company}}`, `{{owner_name}}` fill in automatically). Every email, whether written by hand, sent by an automation or an invitation, is kept in a history with its status. The email also appears on the record's timeline. Invitation links are never stored in the history.
- **Report export**: the Reports page downloads as an Excel workbook (6 sheets) or a PDF.
- **Live updates**: when a teammate (or an automation) changes something, your lists, boards and numbers refresh by themselves (Server-Sent Events over Redis pub/sub, so it still works with several API containers). Members only hear about their own records, and nothing crosses between workspaces.
- **Explainable lead score**: every lead gets a score where each point has a readable reason ("Came from Referral +25"). Fixed rules, no AI service involved. Admins can re-score all leads.
- **Ask Dealwave**: type "deals above 50 lakh closing this month" or "hot leads from website". A sentence becomes a small validated filter (shown to you as "Understood as"), and only that filter is turned into a parameterised query. Neither the rules nor an AI model can write SQL.
- **Summaries and email drafts**: a short briefing on any record, and a drafted email. Without an API key these are produced by built-in rules from your own data. With `ANTHROPIC_API_KEY` set, an AI model writes them instead (see the privacy note below).
- **Two-step sign-in (TOTP)**: authenticator app codes (Google Authenticator, Authy, 1Password, ...) with 8 one-time backup codes. Secrets are stored encrypted, a code can never be used twice, and wrong codes lock the account out for a few minutes.
- **Forgot password**: "Forgot password?" on the sign-in page emails a one-time link (valid 1 hour). Using it ends every existing session and emails a "your password was changed" notice. The form answers identically for known and unknown emails, sends at most one link a minute per person, and only a SHA-256 hash of each link is stored.
- **Email verification**: new sign-ups see a "confirm your email" banner with a resend button (links last 48 hours). People who join by invitation or Google, and everyone who existed before this feature, count as verified. Set `REQUIRE_EMAIL_VERIFICATION=true` to block password sign-in until the email is confirmed.
- **Continue with Google**: sign in or sign up with a Google account (OAuth 2.0 authorization-code flow with PKCE, state and nonce checks). A first-time Google user gets their own workspace; an existing email is linked only if Google says the address is verified, and a password someone set on a never-verified account is discarded when the real owner arrives with Google. Two-step sign-in still applies. The button appears only when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.
- **Calendar**: download any task as an .ics file, or subscribe to a private link so Google, Apple or Outlook calendar shows your open tasks (one-way: Dealwave to your calendar).
- **Online payments (Razorpay)**: when Razorpay keys are set, paid plans are bought through Razorpay Checkout (UPI, cards, netbanking). The payment signature is verified on the server, and a signed webhook confirms it even if the browser is closed. Without keys, plan changes stay instant and free.
- **Tasks** grouped by overdue, today, next 7 days and completed.
- **Reports**: won and lost by month, forecast (raw and probability-weighted), win rate by seller, lead source quality, lost reasons, average sales cycle.
- **Automations**: when a record is created, updated or changes stage, and conditions match, run actions: create task, add note, update field, round-robin assign, in-app notification, email, signed webhook. Every run is logged.
- **Custom fields** per record type, editable pipeline stages, team management with invitations, roles (owner, admin, manager, member), audit log, global search (Ctrl+K), notifications, and an AMOLED-black dark theme (the default, with a light theme toggle in the top bar).
- **Plans and limits** (Starter, Growth, Scale) enforced on users, records and automations.

## Architecture

```
Browser -> nginx (web) -> /api -> Express API -> PostgreSQL (row level security)
                                      |-> Redis + BullMQ -> worker (automations, overdue-task alerts)
```

| Service | Purpose |
|---|---|
| `web` | React 18 + Vite + Tailwind, served by nginx, which also proxies `/api` |
| `api` | Express 5, Zod validation, raw SQL via `pg`. Runs migrations, optionally seeds, then serves |
| `worker` | BullMQ worker: executes automations, sends overdue-task notifications every 30 minutes |
| `postgres` | PostgreSQL 16 |
| `redis` | Job queue and rate-limit state |

### How multi-tenancy is enforced

Every tenant-owned table has a `tenant_id` and PostgreSQL **row level security** with `FORCE ROW LEVEL SECURITY`. The API connects as `crm_app`, a non-superuser role without `BYPASSRLS`, and each request runs inside a transaction that sets `app.tenant_id` from the verified JWT. So even if an application query forgot a `WHERE tenant_id = ...`, the database would refuse to return or modify another tenant's rows. Migrations run with a separate owner connection. Cross-tenant reads and writes were tested directly at the database level, not only through the API.

Other design points:

- **Sign-in tokens never touch JavaScript storage.** The access token (15 min) lives only in the page's memory. The refresh token is an `httpOnly`, `SameSite=Strict` cookie (also `Secure` over HTTPS) scoped to `/api/auth`, so page scripts cannot read it, and cookie-based refresh additionally needs an `x-requested-with` header. Refresh tokens rotate on every use, are stored hashed, and **reuse of an old refresh token revokes the user's sessions**. Browser tabs take turns refreshing (Web Locks API) so rotation never trips that theft detection by accident. Non-browser clients can send `x-return-refresh-token: 1` to receive the token in JSON instead.
- Members only see records they own; managers and above see the whole workspace.
- Webhook automations go through an SSRF guard that blocks private and loopback addresses (override with `ALLOW_PRIVATE_WEBHOOKS=true` for local testing only).
- Login and per-tenant API rate limiting, Helmet headers, Zod validation on every input, audit log for every change.

## Deploy to a server with HTTPS

1. Point your domain's DNS A record at the server and open ports 80 and 443.
2. `cp .env.example .env` and set `DOMAIN`, `POSTGRES_PASSWORD`, `APP_DB_PASSWORD` (hex values are safest, e.g. `openssl rand -hex 24`) and `JWT_SECRET` (`openssl rand -hex 48`).
3. `docker compose -f docker-compose.prod.yml up -d --build`

Caddy obtains and renews the certificate automatically. In this stack no database or Redis port is published, demo seeding and demo logins are off by default, and the API refuses to start in production with a placeholder `JWT_SECRET`. Back up the `pgdata` volume (for example with `pg_dump`) on a schedule.

## Develop without Docker

The easy way (details in `HOW-TO-RUN.md`): `docker compose -f docker-compose.dev.yml up -d` starts only Postgres and Redis, then copy `api/.env.dev.example` to `api/.env`, run `npm run dev:setup` and `npm run dev` in `api/`, and `npm run dev` in `web/`.

Or by hand, with your own Postgres and Redis:

Requires Node 22, PostgreSQL 16 and Redis.

```bash
# API
cd api && npm install
export DATABASE_URL=postgres://crm_app:secret@localhost:5432/dealwave
export MIGRATION_DATABASE_URL=postgres://postgres:postgres@localhost:5432/dealwave
export APP_DB_PASSWORD=secret JWT_SECRET=$(openssl rand -hex 48) REDIS_URL=redis://localhost:6379 SEED_DEMO=true
npm run build && npm run migrate && npm run seed
npm run start        # API on :4000
npm run worker       # in a second terminal

# Web
cd web && npm install && npm run dev    # http://localhost:5173, proxies /api to :4000
```

## Tests

```bash
cd api && npm test      # 178 tests: auth, forgot password, email verification, Google sign-in (Google mocked), cookies, token reuse, two-step sign-in, RLS at database level, roles, files, email, export, live updates, AI, calendar, billing, automation rules
cd web && npm test      # unit tests for formatting and email templates
```

The API tests need a reachable PostgreSQL superuser and Redis. They create a throwaway database called `dealwave_test` with its own database role (`crm_app_test`) and use Redis database 1, so they never touch a running dev stack. Point them elsewhere with `TEST_ADMIN_DATABASE_URL` and `TEST_REDIS_URL`. The suite was also mutation-checked: deliberately breaking the owner check, the file-signature check, the CSRF header check and RLS each made tests fail. `.github/workflows/ci.yml` runs everything on every push.

## Settings you may want

| Variable | Default | Meaning |
|---|---|---|
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | empty | Turn on real email delivery. Without them emails are saved in the history as "Saved, not sent" |
| `COOKIE_SECURE` | auto | `Secure` flag on the refresh cookie. Automatic: on when `APP_URL` starts with `https://` |
| `TRUST_PROXY_HOPS` | 1 | How many proxies sit in front of the API (2 with Caddy + nginx) |
| `AUTH_RATE_LIMIT_PER_MIN` | 20 | Sign-in and sign-up attempts per IP per minute |
| `APP_DB_USER` | `crm_app` | Name of the low-privilege database role the API uses |
| `ANTHROPIC_API_KEY`, `AI_MODEL` | empty | Optional. Lets an AI model write summaries, email drafts and understand search sentences. Empty means the built-in versions are used and nothing leaves your server |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | empty | Turn on online payments. Add a webhook in the Razorpay dashboard pointing to `https://YOUR_DOMAIN/api/webhooks/razorpay` for `payment.captured` |
| `TOTP_ENCRYPTION_KEY` | derived from `JWT_SECRET` | Encrypts two-step secrets in the database (`openssl rand -hex 32`). Do not change it later or people must set up two-step again |
| `REFRESH_RATE_LIMIT_PER_MIN` | 120 | Session refreshes per IP per minute |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | empty | Turn on "Continue with Google". In Google Cloud Console create an OAuth client (Web application) and add `APP_URL` + `/api/auth/google/callback` as an authorized redirect URI |
| `REQUIRE_EMAIL_VERIFICATION` | false | `true` blocks password sign-in until the email is confirmed (needs working SMTP) |

**AI privacy:** only when `ANTHROPIC_API_KEY` is set, the text of the record you ask about (name, company, notes, recent activity) is sent to Anthropic's API to produce a summary or draft. A workspace admin can switch this off per workspace under Settings, AI assistant, and the built-in versions are used instead. Lead scoring never uses an AI service.

## Project layout

```
api/  migrations/001_init.sql       schema, indexes, RLS policies
      migrations/002_files_email.sql  attachments, email templates, email log
      migrations/003_realtime_ai_security.sql  AI switch, two-step sign-in, payments
      migrations/004_password_reset_verify_google.sql  reset/verify links, Google id, verified flag
      src/routes/                   auth, team, records, settings, workflows, reports, emails, attachments
      test/                         vitest suites
      src/workflow/engine.js        automation rule engine
      src/worker.js, src/seed.js
web/  src/pages/                    Dashboard, Records, Deals, Tasks, Reports, Automations, Settings, Auth
      src/components/               UI kit, layout, generic list page, record drawer and form
docker-compose.yml                  local stack
docker-compose.prod.yml + Caddyfile production stack with HTTPS
```

## Honest notes

**Verified** (against a real PostgreSQL 16 and Redis, running the API with plain `node` and the built frontend): all 178 API tests and 7 web tests pass. The suite was mutation-checked: deliberately breaking the owner check, the file-signature check, the CSRF header check and RLS each made tests fail. In headless Chromium: sign-in and session restore, two tabs refreshing together, two different people seeing each other's changes live while a member did not see a private record, lead and deal boards, file upload and download, writing an email from a template, Excel and PDF export, Ask Dealwave, the lead drawer's summary and score, the plan page with payment history, and two-step sign-in end to end (wrong code, password alone refused, replayed code refused, backup code works once, lock-out after repeated wrong codes). The container entrypoint (migrate, seed, production mode, `Secure` cookie under an https `APP_URL`) was run on a fresh database.

**Phase 4 (forgot password, email verification, Google) in a real browser:** in headless Chromium, against a pretend Google server running on the same laptop, these 14 checks passed: the Google button signs a new person into a fresh workspace and the session survives a reload (this is the one thing unit tests cannot prove, because the cookie is set after a cross-site redirect); a second Google sign-in returns to the same workspace; sign-up shows the confirm-email banner; the emailed link confirms it once and the banner disappears; forgot password sends a link, a mismatched confirmation is caught, the new password works and the old one does not, and the link cannot be reused; the one-click demo logins still work. Migration 004 was also applied to a database that already had users, and they came out verified. The API was started in production mode on a fresh database.

**JavaScript version:** the whole project is plain JavaScript (ES modules): no TypeScript, no compile step. After converting from the earlier TypeScript version, all 178 API tests, 7 web tests and the 14 browser checks above passed again, and the API, worker and migrations run directly with `node`.

**Not verified:** the real Google (only a pretend one was used, so the first time you add real keys is the first real run; check that the redirect URI in Google Cloud matches exactly), and real email delivery to an inbox. The Docker images and compose files were written but **not built or run**: the environment they were authored in has no access to Docker Hub, so base images cannot be pulled. The compose files were checked with `docker compose config` and pass. Expect that a first `docker compose up --build` might need a small fix. The GitHub Actions workflow has not run either. These were tested only with the network call replaced by a fake: the Anthropic AI calls and the Razorpay order and webhook calls (the signature checks themselves are real and tested). Nothing was tried against the real Anthropic or Razorpay services, and real email delivery was not tried against an SMTP server.

**Sample data:** demo workspaces contain generated sample data, including email history marked as sent, small sample PDFs, and two sample payments per workspace (order ids start with `order_DEMO_`). None of those emails were sent and no money moved.

**Known limits:**

- **Billing** is only as real as your Razorpay setup: without keys, upgrading is instant and free. A paid plan lasts 30 days from payment; there is no automatic renewal or invoice PDF yet.
- **Files** live in PostgreSQL (5 MB each). That keeps isolation and backups simple, but it is not meant for large media, and there is no virus scanning.
- The report PDF prints amounts as "Rs." because the built-in PDF font has no rupee sign. The Excel export uses the proper symbol.
- `npm audit` reports 2 moderate advisories in each of `api` and `web`. API: `uuid` inside `exceljs` (the flagged code path needs a caller-supplied buffer, which exceljs does not use). Web: `react-router-dom` 6 (open redirect through a crafted link target; this app only links to its own fixed paths and server-generated internal paths). The suggested fixes are major-version upgrades (exceljs 3, react-router 7), so they were left alone rather than risk breaking the app. Plan an upgrade and re-run the test suite.
- A person who signed up with Google has no password they know. They can set one with "Forgot password?" if they also want to sign in by email.
- Resetting a password ends all refresh tokens at once, but an access token already issued stays valid for up to 15 minutes (`ACCESS_TTL_MIN`).
- Single-region, single-database deployment. Not built: other single sign-on providers, two-way Google Calendar sync (the calendar link is one-way), WhatsApp or SMS messages, and email sequences.
- The demo logins on the sign-in page are for showcase use. They are hidden in the production compose file.
