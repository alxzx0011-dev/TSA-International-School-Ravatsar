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
