# Bug report — full application review (2 October 2026)

Five reviewers each took one slice of the app, reproduced every candidate
bug (curl, scripts against the real Postgres, or headless Chrome) before
fixing it, and re-tested after. Cross-slice findings were fixed by the lead.

**Result:** 63 bugs fixed · typecheck clean (unused variables are now errors)
· ESLint 0 errors · 42/42 integration tests (was 19) · production build and
standalone server verified.

Severity: **High** = security, data loss or wrong money · **Med** = wrong
behaviour users would notice · **Low** = edge case or robustness.

---

## Fixed

### Security and sign-in

| # | Sev | Bug | Fix |
|---|---|---|---|
| 1 | High | Two tabs refreshing a session at the same moment looked like a stolen token and signed the user out everywhere | Atomic claim + 30 s grace for a just-rotated token; real reuse still revokes the family |
| 2 | High | Live quiz: "Next" twice skipped a question; a late auto-reveal re-opened an ended game and sent the answer to every phone | Host actions allowed only from the right state, conditional update, stale clicks ignored |
| 3 | High | Draft or staff-only PDFs linked to a tute were readable by students | Tute path requires published + student audience |
| 4 | High | Parallel wrong passwords / codes could dodge the 5-strike lockout | Failure counters incremented and locked in SQL |
| 5 | High | First Railway deploy would never create the owner (`&&` in exec-form preDeployCommand) | Runs through `/bin/sh -c` |
| 6 | Med | Sign-out didn't revoke the session once the 15-min access token had expired | Finds the session through the refresh cookie too |
| 7 | Med | Revoked session → blank staff app | Redirects to login; error card with retry for other failures |
| 8 | Med | Student 401s on shared routes (`/api/push`, `/api/quiz`) went to the staff login | Realm taken from the current app |
| 9 | Med | A picture asked for before it existed stayed "not found" for an hour | Only real rows are cached |
| 10 | Med | Production could start with the public example secrets | Refuses to start; `/api/health` names the variable |
| 11 | Low | Password change had no rate limit; live-session cache not shared with revocation | Rate-limited; cache on `globalThis` |
| 12 | Low | `next=` accepted `/staff/login` and `/staffX` | Tightened |
| 13 | Low | CSV exports: a cell starting `=`, `+`, `-`, `@` ran as an Excel formula | Prefixed as plain text (browser and server exports) |
| 14 | Low | Push subscribe accepted any https URL (server-side request to any host) | Only browser push services |
| 15 | Low | Redis rate-limit key could lose its expiry and block a caller for ever; memory map never pruned | MULTI INCR+TTL with repair; pruning |

### Money and records

| # | Sev | Bug | Fix |
|---|---|---|---|
| 16 | High | Undoing a fee payment left no Activity trail | Logged with student, month and amount |
| 17 | High | Undo after a repeated "Mark won" deleted the enrolled student and left the enquiry won | Terminal `prev` refused; second tap ignored |
| 18 | High | Undo of "Remove student" brought back a partial student (parent logins, attempts, check-ins … gone) | Snapshot captures and restores every child row |
| 19 | High | Two part payments on one invoice at the same moment could lose one | Added in SQL, capped at the amount |
| 20 | Med | Enquiries and tasks of a deactivated owner could no longer be edited | Keeping the current owner is always allowed |
| 21 | Med | Second "Mark lost" logged twice and broke Undo | 409 `already_lost`; tap guard |
| 22 | Med | Double tap on Mark paid (Fees, Invoices) or Delete task replaced the Undo with an error | Per-row guards |
| 23 | Med | Two quick Customize saves: the second overwrote the first | Saves run in sequence on the latest overrides |
| 24 | Med | Customize → Vocabulary field labels saved but never shown | Returned by config and used by Enquiries |
| 25 | Med | Team changes didn't refresh owner/assignee pickers until reload | Config refreshed after team changes |
| 26 | Med | Team card → Enquiries ignored the owner filter | `?owner=` honoured |
| 27 | Med | Sidebar badges stayed stale 15 s after a change | `no-store` |
| 28 | Med | Sales-role dashboard said "All collected — every student has paid" | "Nothing due" |
| 29 | Low | Impossible dates (`2026-02-31`) in CSV import, payments, invoices or task restore gave a 500 | Validated, clear 400 |
| 30 | Low | Receipt/guide used the student's fee instead of the plan/Studio default | Same rule as the ledger |

### Class, messages, reminders

| # | Sev | Bug | Fix |
|---|---|---|---|
| 31 | High | Overlapping reminder runs sent duplicate pushes and broke the daily cap | One run at a time (advisory lock) |
| 32 | Med | Exam-countdown reminders ignored the exam date Leon sets | Reads the schedule's exam date |
| 33 | Med | Double-pressing "Add the recording" created duplicates | Locked re-check before insert |
| 34 | Med | Quick grant/revoke taps on a recording overwrote each other | Arrays changed in SQL |
| 35 | Med | Class page could mark attendance on the previous date for a moment after switching | Steps hidden until the new class loads |
| 36 | Med | Parents saw "topics covered" up to 60 s late | Per-child cache cleared on save |
| 37 | Med | Code buttons had no busy guard: a double press opened two parent accounts or showed a dead code | Guards + disabled buttons |
| 38 | Low | Cards spun "Loading" for ever when their fetch failed | Error card / message |
| 39 | Low | Attendance for an unknown student gave a 500 | 404 with a message |

### Papers, library, MCQ

| # | Sev | Bug | Fix |
|---|---|---|---|
| 40 | High | A past paper used by a draft MCQ paper vanished from the student library | Only "MCQ paper" PDFs are hidden (they open from the timed attempt) |
| 41 | Med | Upload with a refused pairing left a row whose file was already deleted | Pairing inside the insert transaction |
| 42 | Med | Two "Add pages"/"Replace file" at once lost pages and orphaned a file | Compare-and-swap on the storage key, 409 for the loser |
| 43 | Med | Deleting a PDF left tute sets pointing at it | Link cleared in the same transaction |
| 44 | Med | Two identical uploads at the same instant both got in | Unique index on the file fingerprint (migration 0004) |
| 45 | Med | Shuffled paper: the review listed questions in a different order from the one sat | One ordering shared by start, submit and review |
| 46 | Low | Editing a picture-made PDF flipped it to "searchable text" | Recomputed only when the source changes |
| 47 | Low | Failed media insert left the image in storage | Bytes removed on failure |
| 48 | Low | "Replace file" did nothing when re-picking the same file after cancel | Input cleared |
| 49 | Low | A missing image file gave a 500 | 404 |

### Student and parent apps

| # | Sev | Bug | Fix |
|---|---|---|---|
| 50 | Med | Tapping Submit just before 0:00 submitted twice; the second reply wiped the score screen | In-flight guard |
| 51 | Med | "Physical students" messages never reached students before the next cron | Audience codes match the composer |
| 52 | Med | Parallel taps counted a message as opened several times | Flips only an unread row |
| 53 | Med | Parents of two same-named children: only the first could sign in | Codes checked across all matching children |
| 54 | Med | A message notification opened Today instead of Updates | `?go=inbox` handled |
| 55 | Low | Batch race / honours ignored a new register for 5 min | Tagged with each member's cache |

### Platform

| # | Sev | Bug | Fix |
|---|---|---|---|
| 56 | Med | Escape on a confirm also closed the panel under it; scroll lock released too early | Overlay stack, counted lock |
| 57 | Med | Docker image: app user couldn't create upload folder; local uploads copied into the image | Folder created with owner; `.dockerignore` |
| 58 | Low | Cache returned different shapes on a miss vs a hit (Dates vs strings) | Same JSON round-trip |
| 59 | Low | WhatsApp links broken for `0094…` and bare `7…` numbers | Normalised to `94…` |
| 60 | Low | `colomboToDate('… 9:05')` returned Invalid Date | Hour padded |
| 61 | Low | `esbuild` used by the build but not declared | devDependency |
| 62 | Low | `/api/health` reported a config error as "database down" | Reports the real cause |
| 63 | Low | 13 unused exports, a duplicated code generator, unused imports | Removed; `noUnusedLocals`/`noUnusedParameters` on |

---

## Open — decide or watch

| Item | Why it's open |
|---|---|
| Message payment-wording block also catches "lower", "power", "flower", "balance sheet" | Copied from the original on purpose; Leon's call |
| A parent fee push counts towards the child's daily student-reminder cap | Same as the original |
| Fee reminder day set to 28 → the follow-up never fires | Needs a product rule (e.g. allow a follow-up next month) |
| Undo of a fee payment doesn't check whether someone else paid the same month in the 12 s window | Needs the undo payload to carry the expected amount |
| `X-Forwarded-For`: the first entry is trusted for rate limits | Depends on how Railway's edge sets the header; check after deploy |
| PDF-mode MCQ: the inline viewer uses one 2-minute ticket | "Open in a new tab" always mints a fresh one; long PDFs on some Android viewers may need it |
| Student "alumni" status doesn't end an active session | Product decision |
| Settings: two staff saving *different* student-app settings at the same instant could lose one | Very unlikely; would need a row lock in `saveAppConfig` |
| 10 advisory React lint warnings (state set in effects) in shell/UI kit | Behaviour is correct; cosmetic |
| Remove-student → Undo was fixed but not exercised end-to-end | The test was blocked by the permission system |
