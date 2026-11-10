# TSA International School, Rawatsar — Website & Portals

Full-stack school website and management system.

- **Frontend:** plain HTML, CSS and JavaScript in `frontend/`
- **Backend:** FastAPI + SQLAlchemy in `backend/`
- **Database:** PostgreSQL (Supabase compatible)
- **Auth:** JWT bearer tokens with role-based access

The FastAPI backend also serves the frontend, so the whole project runs on a
single URL.

---

## Project layout

```text
.
├── backend/
│   ├── main.py            # FastAPI app, routers, static frontend
│   ├── database.py        # DB engine + session
│   ├── model.py           # SQLAlchemy tables
│   ├── schemas.py         # Pydantic validation
│   ├── deps.py            # Current user + role checks
│   ├── auth_utils.py      # JWT create/decode
│   ├── security.py        # Argon2 password hashing
│   ├── ratelimit.py       # Proxy-aware in-memory rate limiter
│   ├── seed_admin.py      # Create/reset the initial admin
│   ├── routers/           # API endpoints
│   ├── .env.example       # Environment variable template
│   └── requirements.txt
├── frontend/
│   ├── *.html             # Public pages + portals
│   ├── script.js          # Public website logic
│   ├── portal.js          # Student portal
│   ├── parent.js          # Parent portal
│   ├── teacher.js         # Teacher portal
│   ├── admissions-portal.js
│   ├── admin/             # Admin/owner dashboard
│   └── assets/            # Original TSA logo and favicon
├── Procfile               # Generic process manager config
├── render.yaml            # Render blueprint (optional)
└── requirements.txt       # Root shim for hosts that expect it
```

---

## Local setup

### 1. Create a virtual environment

```bash
python3 -m venv school
source school/bin/activate
pip install -r backend/requirements.txt
```

### 2. Configure environment

```bash
cp backend/.env.example backend/.env
```

Fill in `backend/.env`:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL / Supabase connection string |
| `JWT_SECRET_KEY` | Long random signing secret (32+ chars) |
| `JWT_ALGORITHM` | `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Token lifetime, default `30` |
| `ADMIN_EMAIL` | Initial admin email |
| `ADMIN_PASSWORD` | Initial admin password |
| `ALLOWED_ORIGINS` | Comma-separated origins; `*` locally |

**Never commit** `backend/.env` or `backend/token.txt`.

### 3. Create the admin account

```bash
cd backend
python seed_admin.py
```

### 4. Run the app

```bash
cd backend
uvicorn main:app --host 127.0.0.1 --port 8011 --reload
```

Open <http://127.0.0.1:8011/>.

- Public website: `/`
- Portal hub: `/portals.html`
- Student: `/portal.html`
- Parent: `/parent.html`
- Teacher: `/teacher.html`
- Admissions: `/admissions-portal.html`
- Admin/Owner login: `/admin/`

API docs: <http://127.0.0.1:8011/docs>

---

## Deployment

The project works on any host that can run a Python web process
(Render, Railway, Fly.io, a VPS, etc.).

### Build command

```bash
pip install -r backend/requirements.txt
```

### Start command

```bash
cd backend && uvicorn main:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips="*"
```

The included `Procfile` and `render.yaml` already contain these values.

### Environment variables on the host

Add the same variables listed above in the hosting dashboard. `ALLOWED_ORIGINS`
should be your real domain, for example:

```text
ALLOWED_ORIGINS=https://tsarawatsar.school,https://www.tsarawatsar.school
```

If the frontend and API are served from the same domain (the default setup),
you can also set `ALLOWED_ORIGINS=*` safely because authentication uses
`Authorization: Bearer` headers, not cookies.

### Supabase note

Supabase's direct database host can be IPv6-only. If your host does not support
outbound IPv6, use the **Supabase connection pooler** URL (port `6543`) for
`DATABASE_URL` instead of the direct connection URL (port `5432`). Both work
with the app; the pooler is usually the safer choice on shared hosting.

### Move Supabase to a nearby region (biggest speed win)

Every database query has to travel from the app server to the database and back.
If the Supabase project is in a distant region, each query can take hundreds of
milliseconds and a page that runs a few queries feels very slow. Hosting the
database in a nearby region is the single biggest speed improvement for this
project.

For a school in Rajasthan the best regions are:

| Service | Recommended region |
|---|---|
| Supabase | **Mumbai** (`ap-south-1`) or Singapore (`ap-southeast-1`) |
| Render | **Singapore** (the closest region Render offers) |

**Step 1 — create the new project**

1. Supabase Dashboard → **New project**.
2. Region: **Mumbai** (`ap-south-1`).
3. Save the database password somewhere safe.

The free plan allows two active projects, so the old project can stay online
while you migrate and test.

**Shortcut — let the script do it**

Instead of editing `.env.migrate` by hand, run the interactive helper:

```bash
cd backend
../school/bin/python migrate_to_nearby.py
```

It asks for the new project ref, region and database password (hidden input),
finds the working pooler host, shows the latency of both projects, copies every
row, verifies the row counts and writes `backend/.env.render` containing the new
`DATABASE_URL` ready to paste into Render. Nothing is changed until you confirm.

The manual steps below do exactly the same thing.

**Step 2 — copy the data**

Open `backend/.env.migrate` (create it, it is git-ignored) and add both
connection strings using the **pooler** URL of each project (port `6543`):

```bash
SOURCE_DATABASE_URL=postgresql+psycopg://postgres.<old-ref>:<password>@aws-0-<old-region>.pooler.supabase.com:6543/postgres?sslmode=require
TARGET_DATABASE_URL=postgresql+psycopg://postgres.<new-ref>:<password>@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require
```

Then run:

```bash
cd backend
set -a && . .env.migrate && set +a

# compare round-trip latency of both projects
../school/bin/python migrate_data.py --benchmark

# see how much data will be copied (no writes)
../school/bin/python migrate_data.py --dry-run

# create the tables and copy every row
../school/bin/python migrate_data.py --reset --yes

# confirm both databases hold the same number of rows
../school/bin/python migrate_data.py --verify
```

The script is safe to re-run: rows that already exist are skipped. It copies
all tables in foreign-key order and fixes the `id` sequences afterwards.

**Step 3 — point the app at the new database**

Render Dashboard → your service → **Environment** → `DATABASE_URL` → paste the
new project's pooler URL → **Save** → **Manual Deploy**.

Keep `backend/.env.migrate` only until the migration is verified, then delete
it. Never commit it.

**Step 4 — verify, then keep the old project as a backup**

1. Open the site and log in with the admin account.
2. Check students, attendance, fees, results and the portals.
3. Leave the old Supabase project untouched for a week.
4. After that you can pause or delete it.

**Rollback** — if anything looks wrong, put the old `DATABASE_URL` back in
Render and redeploy. The old database was never modified by the script.

### Render checklist (if the site is slow)

1. **Use the Supabase pooler URL** in Render's `DATABASE_URL`:
   - Supabase Dashboard → Project Settings → Database → Connection string
   - Choose **Connection pooling / Transaction** mode
   - Copy the URI and add `+psycopg` after `postgresql`, e.g.
     `postgresql+psycopg://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require`
2. **Keep the free instance awake.** Render free web services sleep after
   inactivity, so the first request can take 50+ seconds. Create a free
   UptimeRobot/cron-job.org monitor that calls `/api/health` every 5 minutes.
3. **Use the closest region.** Keep the Render region and the Supabase region
   as close as possible (Singapore + Mumbai/Singapore works well).
4. **Redeploy after changing environment variables.**
5. If login still times out, upgrade the Render instance or move the backend to
   a small VPS / Railway / Fly.io. The app is a standard FastAPI + Uvicorn
   process and runs anywhere Python 3.12 is available.

The app already enables GZip compression, static-asset caching, connection
timeouts and a 20-second SQL statement timeout, so slow connections fail with a
clear message instead of hanging forever.

### Health check

Use `/api/health` (or `/health`). It returns:

```json
{ "status": "healthy" }
```

### Database tables

`Base.metadata.create_all()` creates any missing tables on startup. It does
**not** alter existing columns. For schema changes use a migration tool such as
Alembic.

---

## Phase 1 features

These work with the existing logins — no extra accounts or API keys needed.

| Feature | Who can use it | Endpoint(s) |
|---|---|---|
| Class timetable | Admin builds it; teachers, parents and students view it | `/api/timetable`, `/api/timetable/mine` |
| Homework submission | Teacher posts homework; student submits; teacher checks and adds a remark | `/api/portal/homework`, `/api/teacher/homework/...` |
| Leave applications | Parent applies; teacher or admin approves/rejects; parent and student see the status | `/api/parent/leave`, `/api/teacher/leave` |
| Password change | Every logged-in user from the "Change Password" button | `/auth/change-password` |
| Admission → Student | Admin approves an application, then clicks **Convert to Student** | `/api/admissions/{id}/convert` |

New tables: `timetable_slots`, `homework_submissions`, `leave_requests`.

---

## Roles and portals

| Role | Portal |
|---|---|
| `admin`, `owner` | `/admin/dashboard.html` |
| `teacher` | `/teacher.html` |
| `admissions` | `/admissions-portal.html` |
| `parent` | `/parent.html` |
| `student` | `/portal.html` |

Creating a student automatically creates:

1. a student login (`<admission-no>@student.tsarawatsar.school` by default), and
2. a parent login linked to that student.

If the parent email is already used by another account, the parent login falls
back to `parent.<admission-no>@tsarawatsar.school`.

---

## Security notes

- Passwords are stored with Argon2 hashes, never in plain text.
- All private endpoints require a valid JWT and the correct role.
- Login, registration, admission and contact endpoints are rate limited.
- Database text is escaped before being inserted into the page HTML.
- Result "PDF" uses the browser print dialog (Print / Save as PDF).
- Rotate or remove all demo accounts before going live.
- Keep `backend/.env` and `backend/token.txt` out of version control.

---

## Useful commands

```bash
# Check backend syntax
python -m compileall backend

# Check frontend JavaScript syntax
for f in frontend/*.js frontend/admin/*.js; do node --check "$f"; done

# Reset the admin password
cd backend && python seed_admin.py
```
