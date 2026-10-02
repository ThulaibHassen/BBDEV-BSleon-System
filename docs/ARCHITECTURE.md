# Architecture

How BS With Leon fits together: the apps, the server, the three stores,
and the database tables. The diagrams are [Mermaid](https://mermaid.js.org/)
and render on GitHub and in VS Code's Markdown preview.

---

## 1 · The whole system

```mermaid
flowchart LR
  subgraph Users["People and their devices"]
    S["Staff<br/>Leon · managers · sales<br/><i>browser, desktop or phone</i>"]
    ST["Students<br/><i>phone PWA</i>"]
    P["Parents<br/><i>phone PWA</i>"]
  end

  subgraph Railway["Railway project"]
    direction TB
    subgraph App["app service — one Next.js 16 server (Docker)"]
      PX["proxy.ts<br/>page guard: valid access JWT<br/>or send to /login"]
      PG["Pages<br/>/staff · /student · /parent<br/>React client components"]
      API["Route handlers /api/*<br/>auth + RBAC check on every call"]
      SV["Domain services<br/>src/server/*<br/>fees · classes · mcq · quiz · library …"]
      PX --> PG
      PG -- "fetch JSON<br/>(httpOnly cookies)" --> API
      API --> SV
    end
    DB[("PostgreSQL<br/><b>Store 1 · user data</b><br/>41 tables")]
    DOC[("Bucket <b>documents</b><br/><b>Store 2 · PDFs</b><br/>private")]
    MED[("Bucket <b>media</b><br/><b>Store 3 · images</b><br/>private")]
    RD[("Redis<br/>cache · rate limits<br/>live-quiz pub/sub")]
    CRON["cron service<br/>hourly at :00 Colombo<br/>scripts/cron-push.js"]
  end

  PUSH["Browser push services<br/>FCM · Apple · Mozilla · Windows"]

  S --> PX
  ST --> PX
  P --> PX
  SV -- "Drizzle ORM / SQL" --> DB
  SV -- "S3 API" --> DOC
  SV -- "S3 API" --> MED
  SV -- "cache-aside, tags" --> RD
  CRON -- "POST /api/cron/tick<br/>x-cron-secret" --> API
  SV -- "web-push (VAPID)" --> PUSH
  PUSH -- "notification" --> ST
  PUSH -- "notification" --> P
```

**Why three stores.** Postgres holds everything about people and money,
plus the *index* of every file (title, year, who may see it, storage key).
The bytes live in two private S3-compatible buckets: one for PDFs, one for
images. Nothing is ever linked straight to a bucket; the app checks who is
asking, then streams the file.

**Redis is disposable.** It holds cached reads, sign-in rate counters and
the live-quiz fan-out. Wiping it loses nothing. Without `REDIS_URL` the app
falls back to an in-process cache.

**Locally** the same shape runs from `docker-compose.yml`: Postgres :5433,
Redis :6380, MinIO :9000 (both buckets). With no Docker, the two buckets
fall back to two folders under `.storage/`.

---

## 2 · Inside the app server

```mermaid
flowchart TB
  subgraph Browser
    C1["Staff pages<br/>StaffShell · SWR"]
    C2["Student app<br/>StudentApp · dock"]
    C3["Parent app<br/>ParentHub"]
    CL["lib/client/api.ts<br/>fetch wrapper<br/>401 → refresh once → retry"]
    C1 & C2 & C3 --> CL
  end

  subgraph Server["Next.js server"]
    PROXY["proxy.ts<br/>JWT signature + expiry only"]
    H["handle() wrapper<br/>JSON errors · zod validation"]
    AUTH["lib/server/auth.ts<br/>requireStaff(perm) · requireStudent() · requireParent()<br/>session still live? (30 s cache)"]
    RBAC["lib/shared/rbac.ts<br/>owner · manager · staff · student · parent<br/>→ permissions"]
    SCOPE["server/scope.ts<br/>staff role sees only own enquiries, students, tasks"]
    SVC["server/*.ts services"]
    LIB["lib/server: db · cache · storage · tickets · push · realtime · audit"]
  end

  CL --> PROXY --> H --> AUTH --> RBAC
  AUTH --> SVC
  SVC --> SCOPE
  SVC --> LIB
```

Every API route starts with one line that names the permission it needs:

```ts
export const POST = handle(async (req) => {
  const p = await requireStaff('fees.manage'); // 401 if signed out, 403 if not allowed
  ...
});
```

| Role | Sees |
|---|---|
| **owner** | everything, including Team (add users, roles) and Settings |
| **manager** | everything except Settings and adding users |
| **staff** (Sales) | Dashboard, Enquiries, Students, Task Book: only their own rows |
| **student** | their own data in the student app; never payments, never answer keys |
| **parent** | their own child's fees, attendance and class progress, nothing else |

---

## 3 · Signing in and staying signed in

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser
  participant A as /api/auth/{realm}/*
  participant DB as Postgres

  B->>A: POST login (email+password, or name+code)
  A->>DB: verify argon2 hash · lockout / rate limit
  A->>DB: insert auth_sessions (refresh hash, family id)
  A-->>B: Set-Cookie access JWT (15 min, path /)<br/>Set-Cookie refresh token (path /api/auth, Strict)
  Note over B,A: every API call carries the access cookie
  B->>A: any /api call after 15 min → 401
  B->>A: POST /refresh (refresh cookie)
  A->>DB: row live? → revoke it, insert next row in the same family
  A-->>B: new access JWT + new refresh token
  Note over A,DB: an already-used refresh token = theft:<br/>the whole family is revoked
```

* Staff: email + password (argon2id). 5 wrong passwords pause the account 15 min.
* Students and parents: name + a 6-digit code staff issue, valid 24 h,
  stored only as a hash. 5 wrong codes lock the login.
* Each realm has its own cookie pair, so a staff and a student session can
  share one browser.

---

## 4 · Opening a past paper (the document ticket)

```mermaid
sequenceDiagram
  autonumber
  participant Ph as Student phone
  participant API as /api/student/library/:id/ticket
  participant DB as Postgres
  participant F as /api/files/:id
  participant BK as documents bucket

  Ph->>API: tap a paper
  API->>DB: published? right batch? inside its time window?<br/>MCQ-paper PDF only after the attempt started
  API->>DB: insert document_log (who opened what)
  API-->>Ph: URL signed with HMAC, valid 120 s
  Ph->>F: GET url (with Range for iPhone)
  F->>F: check signature + expiry only
  F->>BK: stream the object (byte range)
  BK-->>Ph: application/pdf, no-store
```

A link copied into WhatsApp stops working two minutes later. Images
(`/api/media/:id`) need any signed-in session and are cached by the browser
for a year, because a media row never changes.

---

## 5 · Timed MCQ papers and the live quiz

* **Rule zero:** an answer key never reaches a phone early.
  `server/mcq.ts` hands out questions without `answer`/`why`, starts the
  clock **on the server**, and returns the answers once, in the reply to
  submit. `server/quiz.ts` reveals the answer only in the `reveal` state.
* **Live quiz realtime:** the host and every phone poll the state every 2 s
  and also listen on a Server-Sent Events stream (`/api/quiz/:game/events`)
  for an instant nudge. With several app instances the nudge fans out
  through Redis pub/sub.

---

## 6 · Reminders (cron → web push)

```mermaid
flowchart LR
  T["Railway cron<br/>30 * * * * UTC"] -->|POST /api/cron/tick| E["server/push-reminders.ts"]
  E --> Q1{"student sending hour?<br/>daily cap? rest days?"}
  Q1 -->|yes| K["pick one reminder per student<br/>recording · tute · check-in · exam · topics · comeback"]
  E --> Q2{"parent fee day + hour?"}
  Q2 -->|yes| F["fee still due → parent reminder"]
  E --> M["scheduled messages now due → send + fan out"]
  K & F & M --> W["web-push to push_subs<br/>dead endpoints removed"]
  W --> L[("push_log")]
```

---

## 7 · The database

41 tables in one Postgres database (`src/db/schema.ts`, migrations in
`drizzle/`). Grouped by purpose:

```mermaid
erDiagram
  staff ||--o{ auth_sessions : "signs in (realm=staff)"
  staff ||--o{ students : "owns (sales scope)"
  staff ||--o{ records : "owns enquiry"
  staff ||--o{ tasks : "assigned"
  staff ||--o{ activity : "did"
  staff ||--o{ documents : "uploaded"

  records |o--o| students : "enrolled as"

  students ||--|| recurring_plans : "fee plan (same id)"
  recurring_plans ||--o{ recurring_payments : "paid month"
  students ||--o{ invoices : "billed"
  students ||--o| app_logins : "student login"
  students ||--o{ parent_logins : "parent logins"
  students ||--o{ attendance : "came / absent"
  students ||--o{ topic_checks : "self-rating + evidence"
  students ||--o{ tutes : "tute progress"
  students ||--o{ paper_attempts : "logged attempts"
  students ||--o{ checkins : "monthly check-in"
  students ||--o{ recording_views : "watched"
  students ||--o{ message_recipients : "inbox"
  students ||--o{ mcq_attempts : "sat"
  students ||--o{ push_subs : "devices"
  parent_logins ||--o{ push_subs : "devices"

  recordings ||--o{ recording_views : ""
  messages ||--o{ message_recipients : "fan-out"

  mcq_papers ||--o{ mcq_questions : ""
  mcq_papers ||--o{ mcq_attempts : ""
  mcq_papers }o--o| documents : "PDF mode"
  mcq_questions }o--o| media : "question / option pictures"

  quizzes ||--o{ quiz_questions : ""
  quizzes ||--o{ quiz_games : "hosted"
  quiz_games ||--o{ quiz_players : ""
  quiz_games ||--o{ quiz_answers : ""
  quiz_questions ||--o{ quiz_answers : ""

  documents ||--o{ document_log : "ticket issued"
  documents |o--o| documents : "paper ↔ scheme pair"
  tute_assign }o--o| documents : "tute PDF"
```

| Group | Tables |
|---|---|
| **Identity & security** | `staff`, `auth_sessions`, `app_logins`, `parent_logins`, `login_audit`, `activity` |
| **Students & money** | `students`, `recurring_plans`, `recurring_payments`, `invoices`, `records` (enquiries), `tasks`, `products` |
| **Class** | `attendance`, `class_log`, `tute_assign`, `tutes`, `recordings`, `recording_views`, `topic_checks`, `checkins`, `paper_attempts` |
| **Messages & push** | `messages`, `message_recipients`, `push_subs`, `push_log` |
| **Practice** | `mcq_papers`, `mcq_questions`, `mcq_attempts`, `essay_templates`, `quizzes`, `quiz_questions`, `quiz_games`, `quiz_players`, `quiz_answers` |
| **Syllabus & config** | `unit_weights`, `chapters`, `app_config` (one row: student-app config + Customize overrides) |
| **File index** | `documents` + `document_log` (→ bucket *documents*), `media` (→ bucket *media*) |

---

## 8 · Code map

```
src/
  proxy.ts                 page guard (Next 16's middleware)
  db/schema.ts             every table
  lib/shared/              rbac · constants (CFG, prices, syllabus) · dates (Asia/Colombo)
  lib/server/              db · auth · tokens · password · api · cache · storage
                           tickets · push · realtime · ratelimit · audit · env
  lib/client/api.ts        browser fetch wrapper (auto refresh)
  server/                  domain services, one file per area
  app/api/                 route handlers: auth · staff · student · parent · files · media · quiz · cron · health
  app/staff|student|parent each app's layout, login and pages
  components/staff|student|parent  UI; original CSS in src/styles/*.css
scripts/                   migrate · seed · cron-push (bundled to scripts/dist for the image)
drizzle/                   SQL migrations, applied on every deploy
tests/                     node:test suites against a real Postgres
```
