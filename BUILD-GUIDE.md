# BSWL Next — build guide for contributors

This is the Next.js 16 + PostgreSQL rebuild of the three single-file apps in
`../BSWL-hostinger-upload/` (staff `index.html`, `student/index.html`,
`parent/index.html`). **The goal is an exact functional and visual rebuild.**
When in doubt, open the original file and do what it does.

## Read first

- Specs (exhaustive, extracted from the originals) in
  `C:/Users/blkgu/AppData/Local/Temp/claude/e--Kishini-Akka-Work-BSLeon/b17a40b8-8b6c-4c36-a1fd-2fb1445683c8/scratchpad/`:
  `spec-staff-A.md` (design, CFG, data model, auth, chrome), `spec-staff-B.md`
  (staff pages 3496–6273), `spec-staff-C.md` (class, messages, student-app
  control, papers, quiz host, receipts), `spec-student.md`, `spec-backend-parent.md`
  (parent app, every SQL function's exact logic, push, library).
- Next.js 16 has breaking changes: `params`/`searchParams`/`cookies()` are
  async; `middleware` is `proxy`. Docs: `node_modules/next/dist/docs/`.

## Layout

```
src/db/schema.ts              Drizzle schema (DO NOT EDIT — ask the lead)
src/lib/shared/               client+server safe: rbac.ts, constants.ts (CFG, prices,
                              syllabus, DEFAULT_APP_CONFIG), dates.ts (Colombo time)
src/lib/server/               server-only: db, auth, api, cache, storage, tickets,
                              push, realtime, audit, ratelimit, password, env
src/lib/client/api.ts         client fetch wrapper (auto refresh on 401)
src/server/                   domain services: config, scope, library, mcq, quiz (+ yours)
src/components/staff/         staff UI kit: Icon, ui (Toast/Modal/Panel/Field/Empty/Kpi/
                              BarChart/CountUp/Tabs/Switch/downloadCsv), StaffContext
src/styles/{staff,student,parent}.css   ORIGINAL CSS, verbatim — use its class names
reference/*-shell.html        original HTML skeletons (markup + class names)
```

## Rules

1. **Server**: every route handler is `export const GET = handle(async (req, ctx) => {...})`
   from `@/lib/server/api`. First line authorises:
   `const p = await requireStaff('fees.manage')` (or `requireStudent()`, `requireParent()`).
   Permissions live in `src/lib/shared/rbac.ts`. Validate input with zod via
   `await body(req, Schema)`. Use `paramId(ctx)` for `[id]`. Throw
   `new HttpError(status, 'Human message', 'code')` for refusals.
2. **Scoping**: staff-role users see only their own enquiries/students/tasks — use
   `recordsScope(p)`, `studentsScope(p)`, `tasksScope(p)` from `@/server/scope`.
3. **DB**: `db()` and `schema` from `@/lib/server/db`. Drizzle query builder or
   `sql\`\`` for aggregates. Wrap multi-row writes in `db().transaction`.
4. **Cache**: read-mostly data goes through `cached([...key], ttlSec, loader, [TAG.x])`
   and every write calls `invalidate(TAG.x)` (`@/lib/server/cache`).
5. **Activity feed**: important staff actions call `logActivity(p.id, 'Title', 'detail')`.
6. **Client pages** are `'use client'` components using SWR:
   `useSWR<T>('/api/staff/x', fetcher)` and `post/patch/put/del` from `@/lib/client/api`.
   Staff pages get `useStaff()` (me, can(), isMaster, config, refreshBadges) and
   `useToast()` (`toast`, `toastUndo(msg, undoFn)`, `toastError(e)`); success toasts
   use `<Ok>Saved</Ok>`.
7. **Markup**: reuse the original class names (`card`, `card-h`, `card-b`, `kpis`,
   `kpi`, `tbl`, `bdg bdg-green`, `chip on`, `tabbar`/`tab active`, `fld`,
   `btn-primary`, `btn-ghost`, `pa primary`, `pn-*`, `empty`…). Copy UI strings
   verbatim from the specs. No new colours in the student app (monochrome rule;
   `--urgent` amber means only "this expires").
8. **Dates**: use `todayISO()`, `ymNow()`, `fmtDate()` etc. from `@/lib/shared/dates`
   (Asia/Colombo). Money: `lkr()` from constants.
9. **Answer keys never reach a phone.** Student routes call `@/server/mcq` and
   `@/server/quiz`, which strip `answer`/`why`.
10. **Files**: PDFs → `documents` bucket, images → `media` bucket via
    `putObject(kind, key, bytes, mime)` in `@/lib/server/storage`. Check bytes with
    `sniffPdf` / `sniffImage`, cap with `LIMITS`. Keys: `docs/<yyyy>/<uuid>.pdf`,
    `img/<yyyy>/<uuid>.<ext>`. Never expose a bucket URL: PDFs are opened with
    `grant()` from `@/server/library` (120 s ticket → `/api/files/:id`), images
    with `/api/media/:id`.
11. **Do not edit** shared files owned by the lead: `src/db/schema.ts`, everything in
    `src/lib/**`, `src/server/{config,scope,library,mcq,quiz}.ts`,
    `src/components/staff/{StaffShell,StaffContext,ui,Icon,CommandPalette,PasswordChange}.tsx`,
    `src/proxy.ts`, `src/app/api/auth/**`, `src/app/layout.tsx`, `src/app/staff/layout.tsx`.
    If you need a change there, put it in your final report instead.
12. **Testing**: the lead keeps a dev server on **http://localhost:3000** (hot reload
    picks up your files). Do NOT start `next dev` or `next build` yourself (one
    `.next` folder). Run `npx tsc --noEmit` before you finish — it must be clean
    for your files. Test APIs with curl:
    ```
    curl -s -c /tmp/x.txt -X POST localhost:3000/api/auth/staff/login \
      -H 'content-type: application/json' \
      -d '{"email":"leonfambeck@gmail.com","password":"ChangeMe-OnFirstLogin-2026"}'
    curl -s -b /tmp/x.txt localhost:3000/api/staff/...
    ```
    The DB is a local Postgres with demo data (40 students, payments, attendance).
13. Write code that reads like the rest: short comment blocks that say WHY,
    no dead code, no TODO placeholders for things in your scope.
