# AGENTS.md

## Project overview
This repository is a library-management application with:
- a Node.js/Express backend under `src/`
- static frontend assets served from the repo root (`index.html`, `js/`, `css/`)
- Supabase as the primary data layer via `src/api/supabase.js`
- a legacy root-level server implementation (`server.js`) that was used in the initial Google Sheets prototype and is now completely inactive
- `main.js` is effectively empty and not used by the active app

The active server entry is `src/server.js`, and all API routes are mounted from `src/routes/index.js`.

> Critical: the root-level `server.js` is legacy/dead code. It uses `google-spreadsheet` and the old Google Sheets workflow. It must not be used as the active runtime, and it should be treated as reference-only, never as a target for new edits.

## Start and validate
Use these commands from the repo root:

```bash
npm install
npm start
# or
node src/server.js
```

Development watch mode is available:

```bash
npm run dev
```

## Key files
- `src/server.js` — Express app bootstrap and static file hosting
- `src/routes/index.js` — API route registration
- `src/controllers/libraryController.js` — backend business logic for auth, books, students, teachers, reports, and settings
- `src/api/supabase.js` — Supabase client initialization
- `index.html` and `js/` — frontend UI entry points
- `package.json` — project scripts and dependencies

## Architecture notes
- The backend serves the frontend statically from the repo root:
  - `app.use(express.static(path.join(__dirname, '../')))` in `src/server.js`
- API routes are grouped under `/api` and handled by `src/controllers/libraryController.js`
- Environment variables are expected from the repo-root `.env` file, and `src/api/supabase.js` loads them with `dotenv`
- Many controller methods interact directly with Supabase tables (`schools`, `users`, `books`, `students`, `transactions`, etc.)

## Staff password policy
- `src/utils/staffPasswordPolicy.js` defines `validateStaffPassword(newPassword, { username })` — the min-length/letter/digit rule (and "not same as username" check) applied whenever a personal staff/teacher/admin password is set or changed (`saveTeacher`, `updatePassword`, `changeStaffPassword` in `libraryController.js`). It must stay behaviorally identical to the same-named file in the Deneliz project (shared `users` table/rule).
- `STAFF_PASSWORD_POLICY_ENFORCE_FROM` (env var, `YYYY-MM-DD`, Europe/Istanbul day) turns on *forced* password-change-at-login for staff whose current password doesn't meet the rule. Undefined/empty/invalid = enforcement is fully off and behavior is unchanged. When set and reached, `/api/login` (staff branch) returns `status: 'password_change_required'` with a short-lived, single-purpose `passwordChangeToken` instead of a normal session ticket; `POST /api/changeStaffPassword` consumes that token to set a compliant password and issue a real session ticket. Duty (nöbetçi) logins and magic-login are never subject to this (no personal password involved).
- The plaintext `users.password` column migration is complete: this project's code no longer reads or writes it anywhere — every write (`saveTeacher`, `updatePassword`, `changeStaffPassword`) explicitly sets `password: null`, and every read path (`verifyStaffPassword`, login's candidate query, `computeUserPv` in `src/utils/sessionToken.js`) uses `password_hash` only. The pv (ticket fingerprint) source is `password_hash` exclusively.

## Hesabım (self-service account) uçları
- `POST /api/getMyAccount` and `POST /api/updateMyAccount` (`libraryController.js`) let a logged-in admin/teacher view and edit **only their own** `full_name`/`email`/`phone`/password — never another user's row.
- The acting user's row is identified **only** via `getSchoolAuth`'s `auth.uid`, which itself comes only from the verified ktToken payload (`payload.uid`), never from the request body. Duty/magic tickets have no `uid` and are rejected by these two endpoints.
- `updateMyAccount` uses an explicit allowlist of body fields; any other field (`role`, `kt_role`, `ktRole`, `ktClasses`, `classTeacherOf`, `username`, `id`, `app_roles`, `school_id`, ...) in the request body is rejected with 400, never silently dropped.
- Changing email or password requires `currentPassword` (checked via `verifyStaffPassword`); changing only name/phone does not. Email uniqueness is checked school-scoped (same `school_id`), case-insensitive — consistent with how `login`/`findLibraryUserForReset` already resolve identity per-school rather than globally.

## Workflow conventions
- Prefer small, targeted edits close to the relevant feature area rather than broad refactors
- When changing backend behavior, look at the matching route in `src/routes/index.js` and the controller method in `src/controllers/libraryController.js`
- Keep the frontend and backend contracts aligned: request/response shapes are often consumed directly in `js/`
- Keep secrets in `.env`; do not hardcode credentials or tokens in source files
- Prefer updating existing patterns and naming conventions already used in the controller file over introducing a new style

## Gizli bilgi kuralı
- `.env` dosyasının içeriğini hiçbir komutla çıktıya yazdırma: `cat`, `grep`, `sed`, `head`, `tail`, `echo`, dotenv çıktısı, `console.log` ile `process.env` yazdırma dahil. Env değişkenlerini kontrol etmen gerekirse sadece "tanımlı mı" ve "uzunluk" bilgisini göster (örn. `SESSION_SECRET`: tanımlı, uzunluk 64).
- `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `KT_SESSION_SECRET`, `SUPER_ADMIN_PASS`, API anahtarları (BREVO, OPENROUTER, GEMINI vb.) ve benzeri tüm gizli değerler raporda, test çıktısında, hata mesajında veya log'da ASLA görünmemeli. Bir değer yanlışlıkla çıktıya düşerse bunu hemen kullanıcıya bildir.
- Kullanıcı şifreleri, hash'ler, oturum bilgileri (`connect.sid` cookie değerleri dahil), magic token'lar ve biletler de raporlara yazılmamalı. Gerekiyorsa sadece "var/yok", uzunluk veya ilk birkaç karakter gibi maskelenmiş bilgi ver.
- Test betiklerinde gizli değerleri sadece `process.env` üzerinden oku, hiçbir dosyaya, çıktıya veya rapora kopyalama.
- Genel olarak komut çıktısı raporlanırken içinde yukarıdakilerden biri varsa o satırı maskeleyerek raporla.

## Database (Supabase) - Shared with Deneliz
This Supabase database is shared with a separate project named Deneliz (exam/test analysis app). Shared tables must be treated as cross-project data and edited carefully.

### Shared tables
- `schools` — SHARED
- `students` — SHARED
- `users` — SHARED
- `session` — SHARED

### Kütüphanemiz-specific columns
In `schools`, these columns belong to this project and are relevant to Kütüphanemiz:
- `kt_pass` — legacy field, no longer referenced anywhere in the code (the old ticket-less admin fallback and `changePassword` that used it were both removed). The column itself still exists in the database with its old values; it is slated for removal but has not been dropped.
- `kt_status`
- `kt_settings`
- `kt_start_date`
- `kt_end_date`

In the same table, columns with the `nt_` prefix belong to Deneliz and must not be modified by this project.

`kt_settings` is a JSONB configuration object used by this app, with fields such as:
- `staff_pass_mode` (`dynamic` / `fixed`)
- `daily_staff_names`
- `daily_staff_password`
- `daily_pass_date`
- `lib_open_time`
- `lib_close_time`
- `max_borrow_limit`
- `dynamic_rules` with layered logic like `min_days`, `max_days`, and `max_pages` for page-based borrowing duration rules

### Project-exclusive tables
- `books` — THIS PROJECT ONLY; Deneliz does not access these
- `transactions` — THIS PROJECT ONLY; Deneliz does not access these

### Critical warning
- `schools`, `students`, `users`, and `session` are shared across this project and Deneliz. Any change in these tables can affect both applications.
- Teacher/admin authentication data in `users` is currently shared/common across both apps. This may be separated later, but the current runtime behavior assumes they are common.
- Do not make schema or row-level changes in shared tables without confirming the impact on Deneliz.
- Default rule: if a field or table is shared, treat it as cross-project data and avoid modifications unless the task is explicitly about shared auth/system behavior.

## Common pitfalls
- The root-level `server.js` is legacy/dead code; it uses `google-spreadsheet` and predates the Supabase-based app. It is reference-only and must not be used as the active runtime.
- `main.js` is empty and unused.
- Some old code paths still reference Google Sheets and `google-spreadsheet`. The active backend is the Supabase-based implementation, so prefer the Supabase path unless the task explicitly targets the legacy Google Sheets flow.
- Accessing Supabase without valid environment variables will fail at runtime; confirm `.env` is present and populated before debugging app logic.

## When making changes
- Verify the affected route or script with the smallest relevant run command
- If the task is about the library data flow, inspect the matching controller method and then validate with the app startup or targeted API call
- If adding a new API endpoint, register it in `src/routes/index.js` and implement the handler in `src/controllers/libraryController.js`

## Related docs
- `README.md` for project-level notes and usage context
- `package.json` for available scripts
