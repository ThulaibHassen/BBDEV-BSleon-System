# Deploying BS With Leon to Railway

One Railway **project** holds everything. Five pieces, each in its own box on
the canvas:

| Piece | What it is | Holds |
|---|---|---|
| **app** | this repo, built from the `Dockerfile` | the Next.js server (staff, student, parent apps + API) |
| **Postgres** | Railway Postgres database | **store 1 — user data** (students, staff, fees, attendance, results, and the index of every file) |
| **documents** | Railway Bucket (S3-compatible) | **store 2 — PDFs**: past papers, marking schemes, tutes, MCQ papers |
| **media** | Railway Bucket (S3-compatible) | **store 3 — images**: MCQ pictures, logos |
| **Redis** | Railway Redis | cache, sign-in rate limits, live-quiz fan-out (disposable — safe to wipe) |
| **cron** *(optional but recommended)* | this repo again, run hourly | push reminders and scheduled messages |

Both buckets are **private**. No file is ever linked straight to a bucket:
PDFs reach a phone only through a two-minute signed ticket, images through
`/api/media/<id>` after a sign-in check.

---

## 1 · First-time setup (about 15 minutes)

1. **Push this folder to GitHub** (a private repo). `.env` and `.storage/` are git-ignored.
2. Railway → **New Project → Deploy from GitHub repo** → pick the repo. Railway
   sees `railway.json` and builds with the `Dockerfile`. This service is **app**.
3. On the canvas: **+ New → Database → PostgreSQL**.
4. **+ New → Database → Redis**.
5. **+ New → Bucket**, name it `documents`. Again: **+ New → Bucket**, name it `media`.
   Open each bucket's **Credentials** tab — you will reference those values below.
6. **app → Variables**. Add (the `${{ }}` parts are Railway reference variables —
   type them exactly and Railway fills in the values):

   ```
   APP_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   REDIS_URL=${{Redis.REDIS_URL}}

   S3_FORCE_PATH_STYLE=false
   S3_BUCKET_DOCUMENTS=${{documents.BUCKET}}
   DOCS_S3_ENDPOINT=${{documents.ENDPOINT}}
   DOCS_S3_REGION=${{documents.REGION}}
   DOCS_S3_ACCESS_KEY_ID=${{documents.ACCESS_KEY_ID}}
   DOCS_S3_SECRET_ACCESS_KEY=${{documents.SECRET_ACCESS_KEY}}
   S3_BUCKET_MEDIA=${{media.BUCKET}}
   MEDIA_S3_ENDPOINT=${{media.ENDPOINT}}
   MEDIA_S3_REGION=${{media.REGION}}
   MEDIA_S3_ACCESS_KEY_ID=${{media.ACCESS_KEY_ID}}
   MEDIA_S3_SECRET_ACCESS_KEY=${{media.SECRET_ACCESS_KEY}}

   JWT_ACCESS_SECRET=<openssl rand -base64 48>
   JWT_REFRESH_PEPPER=<openssl rand -base64 48>
   FILE_TICKET_SECRET=<openssl rand -base64 48>
   CRON_SECRET=<openssl rand -base64 32>

   VAPID_PUBLIC_KEY=<from: npx web-push generate-vapid-keys>
   VAPID_PRIVATE_KEY=<from the same command>
   VAPID_SUBJECT=mailto:leonfambeck@gmail.com

   SEED_OWNER_EMAIL=leonfambeck@gmail.com
   SEED_OWNER_NAME=Leon Fambeck
   SEED_OWNER_PASSWORD=<a temporary password, 10+ chars, letters and digits>
   ```

   If the variable names in your bucket's Credentials tab differ (Railway has
   renamed them before), use whatever that tab shows — only the right-hand
   side changes.

   Generate each secret on your own machine. **Never paste a secret into a
   chat.** Each one appears in exactly one place: this Variables tab.

7. **app → Settings → Networking → Generate Domain** (or add your own domain,
   e.g. `bswl.businessbooster.lk`, and point a CNAME at it).
8. **Deploy.** On every deploy Railway runs the pre-deploy step from
   `railway.json` — `node scripts/migrate.js && node scripts/seed.js` — which
   applies any new migrations and, the first time only, creates the owner
   account, the default student-app config and the syllabus/weight rows.
   Then it starts the server and waits for `/api/health` to answer.
9. Open `https://<your-domain>/staff`, sign in with `SEED_OWNER_EMAIL` and the
   temporary password. You are asked to choose a new password straight away.
   Then delete `SEED_OWNER_PASSWORD` from Variables — it is never used again.

### The hourly reminders (cron service)

10. **+ New → GitHub Repo →** the same repo. Name the service **cron**.
11. cron → Settings → **Config-as-code file**: `railway.cron.json`. That file
    runs `node scripts/cron-push.js` on the schedule `30 * * * *`
    (minute 30 UTC = minute 0 in Sri Lanka).
12. cron → Variables:
    ```
    APP_URL=https://${{app.RAILWAY_PUBLIC_DOMAIN}}
    CRON_SECRET=${{app.CRON_SECRET}}
    ```
    The cron service holds no database or bucket keys — it only knocks on
    `/api/cron/tick` with the shared secret, and the app does the work.

---

## 2 · Every later deploy

`git push`. Railway rebuilds, runs migrations, swaps the container when the
health check passes. Zero manual steps.

Changing the database schema: edit `src/db/schema.ts`, run
`npm run db:generate` locally, commit the new file in `drizzle/`. The next
deploy applies it.

---

## 3 · Running it locally

```bash
npm install
cp .env.example .env
docker compose up -d        # Postgres :5433, Redis :6380, MinIO :9000 (console :9001)
npm run db:migrate
npm run db:seed             # SEED_DEMO=1 in .env adds a demo roster
npm run dev                 # http://localhost:3000/staff
```

No Docker? Point `DATABASE_URL` at any Postgres 15+, leave `REDIS_URL` and
`S3_ENDPOINT` empty: the cache falls back to memory and the two buckets fall
back to two folders under `.storage/` (still two separate stores).

To run the production image locally: `docker compose --profile app up --build`.

---

## 4 · Backups and safety

- **Postgres:** Railway → Postgres → **Backups** → enable daily backups.
  For an extra copy: `pg_dump "$DATABASE_URL" > bswl-$(date +%F).sql`.
- **Buckets:** files are never overwritten (every upload gets a new key), so a
  bad edit in the app cannot destroy an old file. Deleting a document in the
  Library deletes its file too — that is the only way a file disappears.
- **Redis** holds nothing that cannot be rebuilt. Wiping it signs nobody out
  (sessions live in Postgres) — it only clears the cache and rate counters.

## 5 · Security model in one page

- **Staff**: email + password (argon2id). Five wrong passwords pause the
  account for 15 minutes; sign-in is also rate-limited per IP and per email.
- **Students / parents**: name + a 6-digit code issued by staff, valid 24 h,
  stored only as a hash. Five wrong codes lock the login until a new code.
- **Sessions**: a 15-minute access JWT (HS256) in an httpOnly cookie, plus a
  rotating refresh token (httpOnly, `SameSite=Strict`, scoped to `/api/auth`).
  Re-using an old refresh token — the sign of a stolen one — revokes the whole
  session family. Deactivating a staff member or locking a login takes effect
  within 30 seconds.
- **Role-based access**: owner > manager > staff, plus student and parent
  realms. Every API route checks a named permission (`src/lib/shared/rbac.ts`);
  staff-role users only ever see their own enquiries, students and tasks.
- **Answer keys never reach a phone**: questions go out without answers;
  marking happens on the server against the server's clock.
- **Documents**: private bucket → two-minute HMAC ticket → streamed by the app,
  with every issue logged (who opened what, when).
