# OnboardX V2 Dashboard

React and Tailwind dashboard for configuring OnboardX V2 Discord servers. It runs on Vercel or Netlify with serverless functions, Discord OAuth, and the same MongoDB `guild_configs` collection used by the bot.

## What Is Included

- `index.html` - Vite app entry
- `src/App.tsx` - TSX React routes for home, callback, dashboard, and status
- `src/main.css` - Tailwind styles
- `netlify/functions/auth.js` - exchanges Discord OAuth code for a dashboard session
- `netlify/functions/guilds.js` - lists servers the logged-in user can manage
- `netlify/functions/stats.js` - loads guild info, channels, roles, and stored stats
- `netlify/functions/config.js` - loads and saves server configuration
- `netlify/functions/status.js` - public status JSON for `/status`
- `netlify/functions/_configAdapter.js` - maps dashboard fields to bot config fields
- `netlify/functions/_utils.js` - shared MongoDB, Discord API, CORS, and JWT helpers

## Setup Tutorial For Vercel

### 1. Import The Project

1. Push the repository to GitHub.
2. In Vercel, choose **Add New Project**.
3. Import the repository.
4. Set **Root Directory** to:

```text
onboardx-dashboard
```

This is important. If Vercel deploys the repository root instead, `/callback` can return `404 Not Found`.

Use these build settings:

```text
Framework Preset: Vite
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

The included `vercel.json` maps:

- `/callback`, `/dashboard`, and `/status` to the React app
- `/api/auth`, `/api/guilds`, `/api/stats`, `/api/config`, `/api/status` to Vercel serverless functions

### 2. Create Or Reuse A Discord Application

1. Open the Discord Developer Portal: https://discord.com/developers/applications
2. Select your OnboardX bot application, or create a new application.
3. Go to **OAuth2**.
4. Copy the **Client ID**.
5. Reset/copy the **Client Secret**.
6. Add this redirect URL:

```text
https://YOUR-VERCEL-SITE.vercel.app/callback
```

If you use a custom domain, also add:

```text
https://YOUR-DOMAIN.com/callback
```

### 3. Set The Client ID In The Login Page

Open `index.html` and set:

```html
<meta name="discord-client-id" content="YOUR_DISCORD_CLIENT_ID">
```

The React login button reads this meta tag automatically.

### 4. Add Vercel Environment Variables

In Vercel, open **Project Settings** then **Environment Variables** and add:

| Variable | Value |
| --- | --- |
| `DISCORD_CLIENT_ID` | Discord OAuth client ID |
| `DISCORD_CLIENT_SECRET` | Discord OAuth client secret |
| `DISCORD_BOT_TOKEN` | Your Discord bot token |
| `MONGODB_URI` | Same MongoDB URI used by the bot |
| `MONGODB_DATABASE` | Same database name used by the bot, usually `onboardx` |
| `JWT_SECRET` | Long random secret, 32+ characters |
| `REDIRECT_URI` | `https://YOUR-VERCEL-SITE.vercel.app/callback` |

Important: `REDIRECT_URI` must exactly match the redirect URL in Discord, including `https`, domain, and `/callback`.

Important: `MONGODB_DATABASE` must match the bot database exactly. The bot defaults to `onboardx`, while an older dashboard build defaulted to `OnboardX`; those are different databases.

### 5. Redeploy

After adding environment variables:

1. Go to **Deployments**.
2. Click **Redeploy**.
3. Open your Vercel URL.
4. Login with Discord.
5. Pick a server where the bot is installed and your account has management permissions.
6. Change settings and click **Speichern**.

## Setup Tutorial For Netlify

### 1. Create Or Reuse A Discord Application

1. Open the Discord Developer Portal: https://discord.com/developers/applications
2. Select your OnboardX bot application, or create a new application.
3. Go to **OAuth2**.
4. Copy the **Client ID**.
5. Reset/copy the **Client Secret**.
6. Add this redirect URL:

```text
https://YOUR-NETLIFY-SITE.netlify.app/callback
```

For local Netlify testing, also add:

```text
http://localhost:8888/callback
```

### 2. Set The Client ID In The Login Page

Open `index.html` and set:

```html
<meta name="discord-client-id" content="YOUR_DISCORD_CLIENT_ID">
```

The login button reads this meta tag automatically.

### 3. Deploy The Dashboard To Netlify

1. Push this repository to GitHub.
2. In Netlify, choose **Add new site** then **Import an existing project**.
3. Select the repository.
4. Use these settings:

```text
Base directory: onboardx-dashboard
Build command: npm run build
Publish directory: dist
Functions directory: netlify/functions
```

The included `netlify.toml` already contains the redirects and function bundler config.

### 4. Add Netlify Environment Variables

In Netlify, open **Site settings** then **Environment variables** and add:

| Variable | Value |
| --- | --- |
| `DISCORD_CLIENT_ID` | Discord OAuth client ID |
| `DISCORD_CLIENT_SECRET` | Discord OAuth client secret |
| `DISCORD_BOT_TOKEN` | Your Discord bot token |
| `MONGODB_URI` | Same MongoDB URI used by the bot |
| `MONGODB_DATABASE` | Same database name used by the bot, for example `onboardx` |
| `JWT_SECRET` | Long random secret, 32+ characters |
| `REDIRECT_URI` | `https://YOUR-NETLIFY-SITE.netlify.app/callback` |

Important: `MONGODB_DATABASE` must match the bot database exactly. If the bot uses `DB_NAME`, either set `MONGODB_DATABASE` to that same value or set `DB_NAME` in Netlify too.

### 5. Redeploy

After adding environment variables:

1. Go to **Deploys**.
2. Click **Trigger deploy**.
3. Open your Netlify URL.
4. Login with Discord.
5. Pick a server where the bot is installed and your account has management permissions.
6. Change settings and click **Speichern**.

### 6. Required Bot Permissions

The dashboard can only show and configure servers when:

- the user has Owner, Administrator, Manage Server, Manage Channels, Manage Roles, Kick Members, or Ban Members permission
- the bot is already in that server
- the bot token in `DISCORD_BOT_TOKEN` is valid
- the bot can read guild channels and roles

### 7. Local Testing

From the dashboard folder:

```powershell
cd onboardx-dashboard
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

For full local serverless testing, use `npx netlify dev` instead. Make sure the Discord application has the matching local callback URL in OAuth2 redirects and set `REDIRECT_URI` to that exact callback URL.

## API Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/auth?code=...` | Discord OAuth callback to dashboard JWT |
| `GET` | `/api/guilds` | Managed servers where the bot is present |
| `GET` | `/api/stats?guildId=...` | Guild info, channels, roles, stats |
| `GET` | `/api/config?guildId=...` | Load server config |
| `POST` | `/api/config?guildId=...` | Save server config |
| `GET` | `/api/status` | Public status data for the status page |

All endpoints except `/api/auth` and `/api/status` require:

```text
Authorization: Bearer JWT_FROM_LOGIN
```

## MongoDB Collections

- `guild_configs` - server configuration read by the bot
- `guild_stats` - optional dashboard stats
- `system_docs` - overall bot heartbeat/status
- `cluster_statuses` and `shard_statuses` - internal health rows aggregated by `/api/status`
- `incidents` - optional public incident history

The dashboard can work without `guild_stats`; missing stats show as zero.

## Troubleshooting

If login fails, check `REDIRECT_URI` exactly matches a Discord OAuth redirect.

If no servers appear, make sure the bot is in the server and the logged-in Discord user has management permissions.

If channels or roles do not load, verify `DISCORD_BOT_TOKEN` and bot permissions.

If settings save but the bot does not react immediately, wait for the bot config cache TTL, currently controlled by `GUILD_CONFIG_TTL_MS`.
