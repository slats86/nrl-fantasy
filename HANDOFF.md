# NRL Fantasy App — Claude Handoff Document
*Last updated: July 11, 2026*

> Production-hardening work is in progress on `agent/production-readiness`. See `PRODUCTION_READINESS.md` before continuing or deploying.

---

## Project Overview

A single-file HTML/JS/CSS SPA — an NRL Fantasy app built for mates, with plans to expand into a multi-sport fantasy platform. Currently hosted on Railway.

**Live URL:** https://nrl.the-squad.com.au/
**Railway fallback URL:** https://nrl-fantasy-production.up.railway.app/
**Repository:** `slats86/nrl-fantasy`
**Key files:**
- `index.html` — the entire frontend (~770KB, single file SPA)
- `server.js` — Node/Express backend (auth, leagues, email, API)

---

## Tech Stack

- **Frontend:** Vanilla JS/CSS/HTML — single file, no build step
- **Backend:** Node.js native HTTP server (`server.js`)
- **Database:** JSON flat-file (persisted on Railway volume)
- **Email:** Resend API
- **Hosting:** Railway (auto-deploys on git push)
- **Git:** PowerShell on Windows — use semicolons not `&&`:
  ```powershell
  git add index.html; git commit -m "message"; git push
  ```

---

## Architecture — index.html

There are **10 `<script>` blocks** in index.html. A SyntaxError in one block kills ALL functions in that block only. Keep this in mind when debugging.

**Critical rule:** Never use single-quoted JS strings containing values like `'classic'`, `'custom'`, `'draft'` inline via Python string interpolation — the `\'` becomes a literal `'` and breaks the JS string. Use template literals or DOM methods instead.

### Page Structure
```
<body>
  #topbar
  #sidebar (desktop only, hidden on mobile)
  #app-main
    .page#pg-home
    .page#pg-classic
    .page#pg-custom
    .page#pg-draft
    .page#pg-match
    .page#pg-leagues
    .page#pg-players
    .page#pg-settings
  #bottom-tabbar (mobile only, 6 tabs)
```

### Bottom nav tabs (mobile)
Home | Classic | Match | Leagues | C.Games | Stats

### CSS key classes
- `.frow` — player row on the field (NOT `.field-row`)
- `.pcard` — player card (`width:108px` base, `max-width:84px` on mobile)
- `.field` — green pitch background (`overflow:hidden`, `border-radius:14px`, `padding:16px 8px`)
- `.pos-filter` — position filter pills on Stats page
- `.grid2` — 2-col grid, collapses to 1-col at `max-width:900px`
- `.page` — each page div, toggled with class `on`

### Mobile breakpoints
- `max-width:768px` — hide sidebar, show bottom tabbar
- `max-width:900px` — collapse grid2 to 1 column
- `max-width:600px` — mobile card/field overrides

### Key JS functions
- `setPage(pg)` — navigate between pages
- `renderAll()` — re-renders current page
- `renderClassic()` / `squadInnerHTML()` — Classic team page
- `renderField()` — renders the pitch with player cards
- `renderLeagues()` — leagues page with format tabs
- `injectCGamesPills(pg)` — injects C.Games sub-nav (uses DOM methods, NOT innerHTML)
- `sooDoLogin()` — async login function (in script block 7)

---

## Backend — server.js

### Main endpoints
- `POST /api/soo/register` — register + sends welcome email
- `POST /api/soo/login` — login
- `POST /api/soo/forgot-password` — generates reset token, sends email (always returns 200)
- `POST /api/soo/reset-password` — validates token, resets password, auto-logs in
- `/api/soo/*` — authentication, league CRUD, picks, scoring, and admin operations
- `GET /api/players` — player data
- `GET /api/rounds` — round data
- `GET /` — serves index.html

### Email (Resend API)
- Uses `RESEND_API_KEY` environment variable set in Railway
- `the-squad.com.au` is verified in Resend for DKIM and SPF
- Production sender: `NRL Fantasy <noreply@the-squad.com.au>`
- Sending to users outside the Resend account has been tested successfully

### Environment variables (Railway)
- `RESEND_API_KEY` — Resend API key
- `ADMIN_KEY` — admin endpoint protection
- `JWT_SECRET` (if applicable)

---

## Domain Setup

The **`the-squad.com.au`** domain is registered with GoDaddy. DNS is managed there.

Long-term vision: multi-sport fantasy platform using subdomains:
- `nrl.the-squad.com.au` — NRL fantasy (current app)
- `afl.the-squad.com.au` — future AFL
- `nba.the-squad.com.au` — future NBA
- Transactional sender: `noreply@the-squad.com.au`

Railway serves the app on `nrl.the-squad.com.au`. Resend is verified and password-reset email works for external users.

---

## Known Issues / Pending Work

### 🔴 Blocking
No known blocking production issues as of July 11, 2026.

### 🟡 In Progress / Recent Fixes
2. **Mobile field card clipping** — Fixed in latest push. `.field` gets `overflow:visible` + `padding:16px 14px` on mobile to prevent `border-radius` clipping edge cards
3. **Stats page position pills wrapping** — Fixed in latest push. `.pos-filter` gets `flex-wrap:nowrap; overflow-x:auto` on mobile

### 🟢 Recently Completed
- Full product review (all 8 pages tested)
- Fixed SyntaxError in script block 7 (broke login + all C.Games features)
- Password reset + welcome email flow
- Bottom nav restructure (6 tabs)
- Leagues page with Classic/Draft/Custom format tabs
- Stats table mobile layout
- iOS input zoom fix (16px font-size on inputs)
- Viewport meta fix

---

## Git Workflow

```powershell
# Run from the repository root
git add index.html
git commit -m "description"
git push
# Railway auto-deploys on push
```

**Never use `&&` in PowerShell** — it's not a valid separator. Use `;` or separate lines.

---

## Debugging Tips

1. **Script block errors:** Open browser console. A SyntaxError will name the block (e.g. "script block 7"). Only functions in that block are affected.
2. **Python editing:** Never use `\'` inside triple-quoted strings that output to JS single-quoted strings. Use template literals in the JS.
3. **Linux/Windows file sync:** If editing via bash on the Linux mount, verify the file synced to Windows before committing. Use `python3 -c "print(len(open('index.html').read()))"` to check file size matches.
4. **Railway logs:** Check Railway dashboard for deploy status and server errors.
5. **Resend errors:** 403 = email blocked by free tier. Check `FROM_EMAIL` and domain verification status.

---

## Conversation Context

This project was built across multiple assisted-development sessions. Read this handoff before making changes, preserve unrelated work, and verify JavaScript syntax after editing the large single-file frontend.
