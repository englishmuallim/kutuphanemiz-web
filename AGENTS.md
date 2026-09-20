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

## Workflow conventions
- Prefer small, targeted edits close to the relevant feature area rather than broad refactors
- When changing backend behavior, look at the matching route in `src/routes/index.js` and the controller method in `src/controllers/libraryController.js`
- Keep the frontend and backend contracts aligned: request/response shapes are often consumed directly in `js/`
- Keep secrets in `.env`; do not hardcode credentials or tokens in source files
- Prefer updating existing patterns and naming conventions already used in the controller file over introducing a new style

## Database (Supabase) - Shared with Deneliz
This Supabase database is shared with a separate project named Deneliz (exam/test analysis app). Shared tables must be treated as cross-project data and edited carefully.

### Shared tables
- `schools` — SHARED
- `students` — SHARED
- `users` — SHARED
- `session` — SHARED

### Kütüphanemiz-specific columns
In `schools`, these columns belong to this project and are relevant to Kütüphanemiz:
- `kt_pass` — legacy field, not actively used; avoid changing unless explicitly required
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
