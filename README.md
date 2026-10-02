# BS With Leon

The tuition system for the Academy of Business Studies by Leon Fambeck, one
Next.js app serving three apps:

| App | URL | Who signs in |
|---|---|---|
| **Staff** | `/staff` | Leon and the team: email + password (owner · manager · staff) |
| **Student** | `/student` | students: their name + a 6-digit code from Leon |
| **Parent** | `/parent` | parents: their child's name + a 6-digit code |

**Stack:** Next.js 16 · React 19 · PostgreSQL (Drizzle ORM) · two private S3
buckets (PDFs, images) · Redis cache · JWT auth with role-based access ·
Docker for local services · Railway for hosting.

- How it fits together, with diagrams: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**
- Deploying to Railway: **[DEPLOY.md](DEPLOY.md)**
- Code conventions: **[BUILD-GUIDE.md](BUILD-GUIDE.md)**

---

## Run it on your computer

### 1 · What you need

| | Version | Check with |
|---|---|---|
| **Node.js** | 20.9 or newer (22 LTS recommended) | `node -v` |
| **Docker Desktop** | any recent | `docker compose version` |
| *or, instead of Docker* | PostgreSQL 15+ installed locally | `psql --version` |

Git Bash, PowerShell, macOS and Linux shells all work. Commands below are
shown for Bash; the PowerShell equivalent of `cp` is `Copy-Item`.

### 2 · Get the code and install

```bash
cd bswl-next
npm install
cp .env.example .env
```

`.env.example` already matches the Docker services, so for a first run you
only need to change one thing (step 4).

### 3 · Start the database, cache and file storage

```bash
docker compose up -d
```

This starts, in the background:

| Service | Address | What it holds |
|---|---|---|
| Postgres | `localhost:5433` (user `bswl`, db `bswl`) | all user data |
| Redis | `localhost:6380` | cache, rate limits |
| MinIO (S3) | API `localhost:9000` · console http://localhost:9001 (`bswl_minio` / `bswl_minio_local_dev`) | buckets `bswl-documents` and `bswl-media` |

Check: `docker compose ps` shows everything *running* or *healthy*.
`minio-init` exits after creating the two buckets; that is expected.

> **No Docker?** Point `DATABASE_URL` in `.env` at your own Postgres, for
> example `postgres://postgres:yourpassword@localhost:5432/bswl` (create the
> empty `bswl` database first), and set `REDIS_URL=` and `S3_ENDPOINT=` to
> nothing. The cache then runs in memory, and the two buckets become two
> folders under `.storage/`. Everything else works the same.

### 4 · Create keys and the first account

Generate web-push keys (for reminders) and paste them into `.env`:

```bash
npm run vapid
# → copy "Public Key" into VAPID_PUBLIC_KEY and "Private Key" into VAPID_PRIVATE_KEY
```

The JWT and ticket secrets in `.env.example` are fine for your own computer.
**Never reuse them on a server.**

Choose the first owner account in `.env`:

```env
SEED_OWNER_EMAIL=you@example.com
SEED_OWNER_NAME="Your Name"
SEED_OWNER_PASSWORD=Pick-A-Temporary-Password-1
SEED_DEMO=1          # 1 = also load ~40 demo students with fees and attendance
```

### 5 · Create the tables and seed

```bash
npm run db:migrate     # applies every migration in drizzle/
npm run db:seed        # owner account, default config, syllabus; demo data if SEED_DEMO=1
```

Both are safe to run again: the seed fills only what is empty.

### 6 · Start the app

```bash
npm run dev
```

Open **http://localhost:3000/staff** and sign in with the owner email and
temporary password. You are asked to choose your own password straight
away.

### 7 · Try the student and parent apps

1. In the staff app go to **Student app → Access**, pick a student and
   press **Create access**. The 6-digit code and the username are shown
   once (there is a *Copy for WhatsApp* button). A student who already has
   a login gets a fresh one from their row.
2. Open **http://localhost:3000/student** and sign in with that username
   and code.
3. For parents: the same tab, **Give a parent access**, then
   **http://localhost:3000/parent** with the child's full name and the code.

Push notifications need HTTPS, so on `localhost` the reminder switch may
say it isn't available. That's expected; it works on the deployed site.

---

## Everyday commands

| Command | Does |
|---|---|
| `npm run dev` | dev server on :3000 with hot reload |
| `npm test` | integration tests against the Postgres in `DATABASE_URL` |
| `npm run typecheck` | TypeScript check (unused variables are errors) |
| `npm run lint` | ESLint |
| `npm run build` then `npm start` | production build (standalone) + the ops scripts |
| `npm run db:generate` | after editing `src/db/schema.ts`: writes a new migration |
| `npm run db:migrate` | apply pending migrations |
| `npm run db:seed` | idempotent seed |
| `npm run db:studio` | browse the database in Drizzle Studio |
| `docker compose down` | stop the services (data is kept) |
| `docker compose down -v` | stop and **delete** local data |
| `docker compose --profile app up --build` | run the production Docker image locally |

### Changing the database

1. Edit `src/db/schema.ts`.
2. `npm run db:generate -- --name what_changed`, which creates a new SQL file in `drizzle/`.
3. Read the generated SQL, then `npm run db:migrate`.
4. Commit both files; Railway applies the migration on the next deploy.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `docker compose up` says *failed to connect to the docker API* or *500 Internal Server Error* | Docker Desktop is not running or is stuck. Start it from the Start menu (or quit it from the tray and start again); wait until it says *Engine running*. |
| `port is already allocated` | Something else uses 5433, 6380, 9000 or 9001. Stop it, or change the left-hand port in `docker-compose.yml` **and** the matching URL in `.env`. |
| Health check: http://localhost:3000/api/health says `"db":"down"` | Postgres isn't reachable: check `docker compose ps` and `DATABASE_URL`. |
| `Invalid environment: JWT_ACCESS_SECRET …` | A required variable is missing or too short (secrets need 32+ characters). Compare `.env` with `.env.example`. |
| Sign-in says *too many tries* | The rate limit (10 per 10 min per email). Wait, or restart the dev server to clear the in-memory counter (with Redis: `docker compose restart redis`). |
| A page keeps sending you back to the login | Your session ended or the cookies belong to another port. Sign in again; use the same host every time (`localhost` vs `127.0.0.1` are different cookies). |
| Uploads fail with an S3 error | MinIO isn't up, or the buckets weren't created: `docker compose up -d minio-init`. |
| The student app shows an old version | Service worker cache: close the tab, reopen; in DevTools → Application → Service Workers → *Unregister*. |
| `.env` values with spaces break `source .env` | Quote them: `SEED_OWNER_NAME="Leon Fambeck"`. |

---

## Project layout

```
src/app/            pages and API routes (staff · student · parent · api)
src/server/         business logic, one file per area
src/lib/            shared: auth, RBAC, db, cache, storage, dates, constants
src/components/     UI for each app
src/styles/         the original stylesheets, kept verbatim
src/db/schema.ts    all 41 tables
drizzle/            migrations
scripts/            migrate · seed · cron-push
tests/              integration tests
docs/               architecture
```
