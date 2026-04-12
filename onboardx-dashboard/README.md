# OnboardX V2 — Dashboard

Discord Bot Dashboard für OnboardX V2. Läuft vollständig auf **Netlify** (Frontend + Serverless Functions + MongoDB).

---

## 🚀 Setup

### 1. Repository auf Netlify deployen

1. Diesen Ordner auf GitHub pushen
2. In Netlify: **Add new site → Import from Git**
3. Build-Einstellungen werden automatisch aus `netlify.toml` gelesen

### 2. Discord Application konfigurieren

1. Gehe zu https://discord.com/developers/applications
2. Erstelle eine neue Application (oder nutze deine Bot-Application)
3. Unter **OAuth2 → Redirects** hinzufügen:
   ```
   https://DEINE-DOMAIN.netlify.app/callback
   ```
4. **Client ID** und **Client Secret** notieren

### 3. Umgebungsvariablen in Netlify setzen

In Netlify → Site settings → Environment variables folgende Variablen setzen:

| Variable              | Beschreibung                                         |
|-----------------------|------------------------------------------------------|
| `DISCORD_CLIENT_ID`   | Client ID deiner Discord Application                 |
| `DISCORD_CLIENT_SECRET` | Client Secret deiner Discord Application           |
| `DISCORD_BOT_TOKEN`   | Bot Token (für Guild-/Channel-/Rollen-Abruf)        |
| `MONGODB_URI`         | MongoDB Connection String (z.B. MongoDB Atlas)       |
| `JWT_SECRET`          | Beliebiger langer zufälliger String (min. 32 Zeichen) |
| `REDIRECT_URI`        | `https://DEINE-DOMAIN.netlify.app/callback`          |

### 4. Login-Page: Client ID eintragen

In `public/index.html` die Zeile:
```js
const CLIENT_ID = '%%DISCORD_CLIENT_ID%%';
```
durch deine echte Client ID ersetzen:
```js
const CLIENT_ID = '1234567890123456789';
```

### 5. MongoDB Datenbank

Die Functions nutzen folgende Collections:
- `guild_configs` — Konfigurationen pro Server
- `guild_stats`   — Statistiken (werden von deinem Bot befüllt)

Dein Bot muss die Stats in `guild_stats` schreiben:
```js
await db.collection('guild_stats').updateOne(
  { guildId },
  { $set: { messagesToday, openTickets, automodActions, warnsTotal, bansTotal } },
  { upsert: true }
);
```

---

## 🗂 Projektstruktur

```
onboardx-dashboard/
├── netlify.toml              # Netlify Build & Redirect-Konfiguration
├── package.json              # Dependencies (mongodb, jsonwebtoken)
├── netlify/
│   └── functions/
│       ├── _utils.js         # Shared helpers (DB, JWT, CORS)
│       ├── auth.js           # POST /api/auth?code=... → JWT
│       ├── guilds.js         # GET  /api/guilds        → Server-Liste
│       ├── config.js         # GET/POST /api/config?guildId=...
│       └── stats.js          # GET /api/stats?guildId=...
└── public/
    ├── index.html            # Login-Seite
    ├── callback.html         # Discord OAuth Callback
    └── dashboard.html        # Haupt-Dashboard
```

## 🔌 API Endpoints

| Method | Endpoint            | Beschreibung                              |
|--------|---------------------|-------------------------------------------|
| GET    | `/api/auth?code=`   | OAuth2 Code → JWT Token                  |
| GET    | `/api/guilds`       | Server wo Bot + User Manage-Guild hat     |
| GET    | `/api/config?guildId=` | Aktuelle Server-Konfiguration          |
| POST   | `/api/config?guildId=` | Konfiguration speichern                |
| GET    | `/api/stats?guildId=`  | Server-Stats, Channels, Rollen         |

Alle Endpoints außer `/api/auth` erfordern `Authorization: Bearer <JWT>`.

## 🔒 Sicherheit

- Nur Nutzer mit **Manage Guild** oder **Administrator**-Permission können die Config ihres Servers sehen/ändern
- JWT-Token laufen nach 7 Tagen ab
- MongoDB-Verbindung ist server-seitig (nie im Frontend)
