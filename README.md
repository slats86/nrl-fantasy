# The Squad — NRL Fantasy

An unofficial NRL fantasy game for mates, hosted at [nrl.the-squad.com.au](https://nrl.the-squad.com.au).

## Features

- Classic salary-cap fantasy, trades, captains, and round scoring
- Draft leagues with fixtures, ladder, and finals
- Custom games, including State of Origin competitions
- Match Centre with fixtures, results, and player statistics
- Authentication, leagues, welcome emails, and password resets

## Architecture

- Frontend: vanilla HTML, CSS, and JavaScript in `index.html`
- Backend: Node.js native HTTP server in `server.js`
- Data: JSON files, with Railway volume persistence for production data
- Email: Resend
- Hosting: Railway, automatically deployed from the `main` branch
- Build step: none

## Run locally

Node.js 18 or newer is required.

```powershell
npm start
```

The server listens on `PORT`, defaulting to `3000` locally.

## Production configuration

Railway uses these environment variables:

- `APP_URL=https://nrl.the-squad.com.au`
- `FROM_EMAIL=NRL Fantasy <noreply@the-squad.com.au>`
- `RESEND_API_KEY`
- `ADMIN_KEY`

Do not commit secret values to the repository.

## Deployment

Push changes to `main`; Railway deploys them automatically.

```powershell
git add .
git commit -m "Describe the update"
git push
```

The Railway-provided domain remains available as a fallback, while the public production address is `https://nrl.the-squad.com.au`.

## Disclaimer

Unofficial fan project for personal use. Player names and statistics are factual data. Not affiliated with the NRL.
