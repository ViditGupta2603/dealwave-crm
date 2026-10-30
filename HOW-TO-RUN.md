# Dealwave CRM: laptop par kaise chalayein (VS Code + Docker)

Is guide me sab kuch step by step hai. **Kuch bhi env me set karna zaroori nahi** demo chalane ke liye. Env sirf tab chahiye jab real email ya Google login chahiye.

## Naye Project pages (v4)

- App me 6 naye pages hain: **PRD, Architecture, Rules, Phases, Design, Memory**. Kholne ke liye `/docs` (jaise http://localhost:8080/docs). Login ki zaroorat nahi. Sidebar me neeche "Project pages" aur landing page ke upar/footer me bhi link hai.
- Text simple English me hai. Badalna ho to `web/src/pages/Docs.jsx` kholo, saara content wahi ek file me hai.

---

## Ab poora JavaScript hai (v3)

- TypeScript hata diya gaya hai. Backend plain JavaScript (Node.js + Express, ES modules) aur frontend React (`.jsx`) hai. Koi compile/build step API ke liye nahi hai: Docker me bhi seedha `node src/server.js` chalta hai.
- Dev me ab `tsx` nahi chahiye. `npm run dev` ab `node --watch` use karta hai (Node 22 chahiye, jo pehle se required tha).
- Chalane ke commands wahi hain (`docker compose up --build`, `npm run dev:setup` etc.), kuch nahi badla.

---

## Naam badla aur theme badli (v2)

- Project ka naam ab **Dealwave CRM** hai (pehle Pravah). Folder ka naam `dealwave-crm` hai, isliye Docker ke naye volumes aur naya database `dealwave` banega. Purana Pravah wala data nahi aayega; demo data apne aap bhar jata hai.
- Cookie, localStorage aur webhook header ke naam bhi badal gaye (`X-Dealwave-Signature`). Pehle se login the to ek baar dobara sign in karna padega.
- 2FA ka encryption salt jaanbujh kar purana (`pravah-totp-v1`) rakha hai, warna purane 2FA secrets padhe nahi jate.
- **Frontend ab default AMOLED black dark theme** me khulta hai. Upar ke toggle se light theme le sakte ho, choice browser yaad rakhta hai.
- Naam kuch aur chahiye to bata dena, ek command se poore project me badal diya jayega.

---

## Method 1: Docker se (sabse aasan, yahi use karo)

**Kya chahiye:** Docker Desktop (Windows par WSL2 ke saath), aur VS Code (optional, sirf folder kholne ke liye).

1. Zip ko extract karo. VS Code me **File > Open Folder** se `dealwave-crm` folder kholo.
2. VS Code me terminal kholo (**Ctrl + `**) aur chalao:

   ```bash
   docker compose up --build
   ```

3. Pehli baar 5 se 10 minute lagte hain (images ban rahi hain). Jab terminal me `API listening on :4000` dikhe, browser me kholo: **http://localhost:8080**
4. Sign in page par **"Try a demo workspace"** ke buttons se ek click me login ho jayega. Password sabka `Demo@12345`.

**Roz ka kaam:**

| Kaam | Command |
|---|---|
| Band karna | terminal me `Ctrl + C` |
| Dobara chalana (jaldi) | `docker compose up` |
| Background me chalana | `docker compose up -d` |
| Logs dekhna | `docker compose logs -f api` |
| Sab data mita ke saaf shuru | `docker compose down -v` |

**Purana version Docker me chal chuka hai?** Tumhara data bacha rahega. Bas `docker compose up --build` chalao, naya migration (004) apne aap lag jayega, aur purane users "verified" maan liye jayenge. Agar saaf shuru karna ho to `docker compose down -v`.

---

## Naye 3 features bina kisi key ke test karna

Email server (SMTP) set nahi hai to app email **bhejta nahi, uska link logs me print kar deta hai**. Isse tum flow poora test kar sakte ho.

**Link nikalne ka command** (naya terminal kholo):

```bash
# Windows PowerShell
docker compose logs api | Select-String "link for"

# Mac / Linux / Git Bash
docker compose logs api | grep "link for"
```

Aisi line dikhegi: `reset link for abc@example.com: http://localhost:8080/reset-password?token=...`. Us link ko browser me kholo.

**1. Forgot password**
1. Sign in page par **"Forgot password?"** dabao, email daalo (jaise `owner@sundaram.demo`).
2. Upar wala command chalao, `reset link` wali line ka URL browser me kholo.
3. Naya password daalo (do baar), phir naye password se login karo.

**2. Email verification**
1. **Create a workspace** se naya account banao. Upar peela banner dikhega: "Please confirm your email".
2. Command chalao, `verify link` wali line ka URL kholo. "Email confirmed" dikhega aur banner chala jayega.
3. Demo accounts pehle se verified hain, unpar banner nahi aata.

**3. Google login:** iske liye Google ki keys chahiye, neeche dekho.

---

## Real email bhejna (optional): Gmail se

Gmail me pehle **2-Step Verification** on karo, phir Google Account > Security > **App passwords** se 16 akshar ka password banao.

Project ke **root folder** me (jahan `docker-compose.yml` hai) ek file banao, naam `.env` (bas yahi naam), usme likho:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tumhara@gmail.com
SMTP_PASS=sixteenletterapppass
MAIL_FROM=Dealwave CRM <tumhara@gmail.com>
```

Quotes ya extra space mat lagana. Phir `docker compose up -d` chalao. Ab reset aur verify ke emails asli inbox me aayenge.

---

## Google login on karna (optional, lagbhag 10 minute, free)

1. https://console.cloud.google.com kholo, upar **New project** banao (naam kuch bhi).
2. **APIs & Services > OAuth consent screen**: User type **External**, app name `Dealwave`, apna email support email me daalo, save karo. **Audience / Test users** me apna Gmail add karo (Testing mode me sirf wahi log login kar sakte hain jo yahan add hon, demo ke liye kaafi hai).
3. **APIs & Services > Credentials > Create credentials > OAuth client ID**. Type: **Web application**.
4. **Authorized redirect URIs** me **bilkul yahi** daalo (ek bhi akshar ya slash alag hua to nahi chalega):

   ```
   http://localhost:8080/api/auth/google/callback
   ```

5. Create dabao. **Client ID** aur **Client secret** copy karo.
6. Root folder wali `.env` file me ye 2 line jodo:

   ```
   GOOGLE_CLIENT_ID=yaha-client-id-paste-karo.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=yaha-secret-paste-karo
   ```

7. `docker compose up -d` chalao, sign in page refresh karo. **"Continue with Google"** button dikhne lagega. (Keys na ho to button chhupa rehta hai, baaki app waise hi chalta hai.)

Pehli baar Google se aane wale ko apna naya workspace ("Naam's workspace") apne aap ban jata hai. Pehle se account wale email se aaye to usi account me login hota hai.

**Agar port 8080 ki jagah 8081 use karna pada** (`WEB_PORT=8081`), to `.env` me `APP_URL=http://localhost:8081` bhi daalo aur Google me redirect URI bhi `http://localhost:8081/api/auth/google/callback` karo.

---

## Method 2: VS Code me code edit karte hue chalana (bina poora Docker build)

Jab code badal ke turant result dekhna ho. **Chahiye:** Node 22, Docker Desktop (sirf database ke liye).

**Ek baar ka setup:**

```bash
# terminal 1: sirf database aur Redis chalu karo (Docker me)
docker compose -f docker-compose.dev.yml up -d

# API ka setup
cd api
npm install
cp .env.dev.example .env        # Windows PowerShell: copy .env.dev.example .env
npm run dev:setup               # tables banata hai aur demo data bharta hai
```

**Har baar chalane ke liye (3 terminal):**

```bash
# terminal A (API)
cd api && npm run dev

# terminal B (background worker: automations ke liye)
cd api && npm run dev:worker

# terminal C (website)
cd web && npm install && npm run dev
```

Browser me kholo: **http://localhost:5173**

Is method me `api/.env` file hi sab settings leti hai (export wagairah nahi karna). Wahi file me SMTP/Google ki lines hain, bas `#` hatao. Google ka redirect URI is method me `http://localhost:5173/api/auth/google/callback` hoga.

Reset/verify ke link is method me **API wale terminal (A)** me print hote hain: `link for` dhundo.

---

## Tests chalana

```bash
cd api && npm test     # 178 tests. Postgres aur Redis chahiye (dev compose chalu rakho)
cd web && npm test     # 7 tests
```

API tests apna alag database `dealwave_test` banate hain, tumhara data nahi chhute. Agar tumhara dev Postgres 5433 par hai to tests ke liye ye set karo:

```bash
# Mac / Linux
TEST_ADMIN_DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres TEST_REDIS_URL=redis://localhost:6380/1 npm test
```

(Windows PowerShell me pehle `$env:TEST_ADMIN_DATABASE_URL="..."` aur `$env:TEST_REDIS_URL="..."` set karo, phir `npm test`.)

---

## Aam dikkatein

| Dikkat | Kaaran aur hal |
|---|---|
| `port is already allocated` (8080) | Koi aur app 8080 le rahi hai. `.env` me `WEB_PORT=8081` aur `APP_URL=http://localhost:8081` daalo |
| Pehli build bahut der le rahi hai | Normal hai. Dobara chalane par jaldi hoga |
| `exec ./docker-entrypoint.sh: no such file or directory` (Windows) | File ki line endings CRLF ho gayi. VS Code me `api/docker-entrypoint.sh` kholo, neeche kone me **CRLF** par click karke **LF** chuno, save karo, phir `docker compose up --build` |
| Google par `redirect_uri_mismatch` | Google Cloud me daala URI aur `APP_URL` + `/api/auth/google/callback` bilkul same hona chahiye (http/https, port, spelling) |
| Google par "Access blocked / app not verified" | Consent screen Testing mode me hai. Apna Gmail **Test users** me add karo |
| Reset/verify email nahi aaya | SMTP set nahi hai to link logs me hai (upar ka command). SMTP set hai to spam folder dekho aur `docker compose logs api` me error dekho |
| Ek minute me dobara link nahi aata | Jaanbujh ke hai: ek insaan ko 1 minute me ek hi link jata hai (email bombing se bachne ke liye). 1 minute ruko |
| `Too many attempts` | Ek IP se sign-in/reset requests ki limit 20 per minute hai. 1 minute ruko |
| `.env` badalne ke baad kuch nahi hua | `docker compose up -d` dobara chalao (containers naye env ke saath dobara bante hain) |
| Bilkul saaf shuru karna hai | `docker compose down -v` (data mit jayega), phir `docker compose up --build` |

---

## Interview me ye 3 features kaise samjhayein (chhota)

- **Forgot password:** "Token random 32 byte ka hai, DB me sirf uska SHA-256 hash rakhta hoon, 1 ghante me expire, ek hi baar chalta hai (atomic UPDATE se). Form har email par ek jaisa jawab deta hai taaki koi pata na laga sake kaun sa email registered hai. Reset ke baad sabhi sessions revoke ho jate hain."
- **Email verification:** "Soft by default (banner), strict mode ek env flag se (`REQUIRE_EMAIL_VERIFICATION`). Purane users migration me hi verified mark ho jate hain taaki koi lock na ho."
- **Google login:** "Authorization-code flow with PKCE, state aur nonce check. Email se account tabhi link karta hoon jab Google bole email verified hai. Pre-hijacking se bachne ke liye agar kisi ne pehle bina verify kiye is email se password account banaya tha, to Google se asli owner aate hi wo password hata deta hoon. 2FA Google login par bhi lagu rehta hai."
