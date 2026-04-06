# 🤖 OnboardX V2

> Production-ready, modular Discord bot — built for large-scale public deployment

![Node.js](https://img.shields.io/badge/Node.js-20%2B-green?logo=node.js&logoColor=white)
![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-Firestore-orange?logo=firebase&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## ✨ Feature Overview

| Module | Slash Command(s) | Description |
|---|---|---|
| 📜 **Logging** | `/logging` | Message edits/deletes, member join/leave, role changes, mod actions |
| 🔐 **Verification** | `/verify` | Button + modal CAPTCHA (math or image), timeout, role assignment |
| 📈 **Leveling** | `/rank` | XP per message, cooldowns, level-up announcements, role rewards, leaderboard |
| 🎉 **Giveaways** | `/giveaway` | Start / end / reroll, persistent across restarts, anti-duplicate entries |
| 📊 **Polls** | `/poll` | Multi-option button polls, anonymous voting, real-time results, auto-close |
| 🎭 **Join Roles** | `/joinroles` | Auto-assign roles to humans/bots on join with account-age gate and delay |
| 👋 **Welcome** | `/welcome` | Custom welcome/farewell embeds, DM welcome, auto-role |
| 🛡️ **AutoMod** | `/automod` | Word filter, invite filter, link filter, caps filter, zalgo filter |
| 🚦 **Anti-Spam** | `/automod antispam` | Rate limiting, duplicate detection, mention flood, raid mode |
| ⚠️ **Warnings** | `/warn` | Persistent warnings, auto-punishment thresholds, pardon system |
| 🔨 **Moderation** | `/mod` | Ban, kick, timeout, unban, purge — with DM notifications |
| 🎫 **Tickets** | `/ticket` | Thread-based support tickets, HTML transcript export |
| 🔘 **Reaction Roles** | `/reactionrole` | Button-based self-assignable role panels |
| ⚙️ **Config** | `/config` | Master setup: enable/disable any module, set channels & roles |
| 💎 **Premium** | `/premium` | Per-guild tier management (Basic / Pro / Enterprise) |
| 🔧 **Utility** | `/utility` | Ping, bot info, avatar, userinfo, serverinfo, help |

---

## 📁 Project Structure

```
OnboardX-V2/
│
├── index.js                     # Shard worker entry point
├── shard.js                     # ShardingManager + cluster orchestration
├── package.json
├── Dockerfile                   # Multi-stage production image
├── docker-compose.yml           # Full stack deployment
├── .env.example                 # Environment variable template
│
├── config/
│   ├── default.js               # Global bot defaults & cooldowns
│   └── premium.js               # Premium tier feature flags
│
├── database/
│   └── firebase.js              # Firebase Admin SDK + Firestore helpers
│
├── handlers/
│   ├── commandHandler.js        # Auto-discovers & deploys slash commands
│   ├── eventHandler.js          # Auto-discovers & registers event modules
│   └── deployCommands.js        # Standalone deploy script
│
├── events/                      # One file per Discord event
│   ├── ready.js
│   ├── interactionCreate.js     # Central router: slash / button / modal / autocomplete
│   ├── messageCreate.js         # AutoMod → AntiSpam → Leveling pipeline
│   ├── messageDelete.js
│   ├── messageUpdate.js
│   ├── guildMemberAdd.js        # Logging + Welcome + AntiSpam + JoinRoles
│   ├── guildMemberRemove.js     # Logging + Welcome farewell
│   ├── guildMemberUpdate.js     # Role-change logging
│   └── guildDelete.js           # Config cleanup on bot leave
│
├── commands/
│   ├── admin/
│   │   ├── config.js            # /config — master setup
│   │   ├── joinroles.js         # /joinroles — auto-assign on join
│   │   ├── levelrole.js         # /levelrole — XP role rewards
│   │   ├── logging.js           # /logging — toggle log events
│   │   └── premium.js           # /premium — manage premium tiers
│   ├── automod/
│   │   └── automod.js           # /automod — filters + anti-spam
│   ├── giveaway/
│   │   └── giveaway.js          # /giveaway — start/end/reroll/list
│   ├── leveling/
│   │   └── rank.js              # /rank — view/leaderboard/setxp/reset
│   ├── moderation/
│   │   ├── moderate.js          # /mod — ban/kick/timeout/unban/purge
│   │   └── warn.js              # /warn — add/list/remove/clear warnings
│   ├── poll/
│   │   └── poll.js              # /poll — create/close/results
│   ├── roles/
│   │   └── reactionrole.js      # /reactionrole — button role panels
│   ├── tickets/
│   │   └── ticket.js            # /ticket — setup/panel/list/close
│   ├── utility/
│   │   └── utility.js           # /utility — ping/info/avatar/userinfo/serverinfo/help
│   ├── verification/
│   │   └── verify.js            # /verify — panel/force/status
│   └── welcome/
│       └── welcome.js           # /welcome — setup/farewell/dm/test/disable
│
├── services/                    # Business logic, no Discord API boilerplate
│   ├── AntiSpamService.js       # Rate/dupe/mention flood + raid-mode lockdown
│   ├── AutoModService.js        # Content filter engine
│   ├── GiveawayService.js       # Timer management, persistent across restarts
│   ├── JoinRolesService.js      # Auto-assign roles on join
│   ├── LevelingService.js       # XP grant, level-up, role reward assignment
│   ├── LoggingService.js        # Embed formatters + channel dispatcher
│   ├── PollService.js           # Poll creation, vote tallying, auto-close
│   ├── ReactionRoleService.js   # Button-based self-assignable role panels
│   ├── TicketService.js         # Thread tickets + HTML transcript export
│   ├── VerificationService.js   # CAPTCHA flow, modal, timeout handling
│   └── WelcomeService.js        # Welcome/farewell embeds + DM + auto-role
│
├── models/                      # Firestore CRUD — one class per collection
│   ├── GuildConfig.js           # Per-guild config with 5-min in-memory cache
│   ├── Giveaway.js              # Giveaway lifecycle + winner selection
│   ├── Poll.js                  # Poll creation + atomic vote recording
│   ├── Ticket.js                # Ticket CRUD + auto-increment ticket numbers
│   ├── UserXP.js                # XP / level data per user per guild
│   └── Warning.js               # Warning records + batch pardon
│
├── utils/
│   ├── captcha.js               # Math + canvas image CAPTCHA generation
│   ├── cooldown.js              # In-memory per-user cooldown manager
│   ├── embed.js                 # Centralised embed factory (consistent design)
│   ├── i18n.js                  # Locale resolver
│   ├── logger.js                # Winston structured logger + daily log rotation
│   ├── permissions.js           # Permission guards + bot permission checks
│   ├── time.js                  # Duration parsing + Discord timestamp helpers
│   └── validation.js            # Input sanitisation + type validators
│
├── locales/
│   ├── en.js                    # English strings
│   └── de.js                    # German strings
│
└── monitoring/
    └── prometheus.yml           # Prometheus scrape config for /metrics endpoint
```

---

## 🚀 Quick Start

### Prerequisites

- **Node.js ≥ 20**
- A [Discord Application](https://discord.com/developers/applications) with bot token and **Message Content Intent** enabled
- A [Firebase project](https://console.firebase.google.com) with Firestore in **Native mode**

### 1 — Clone & Install

```bash
git clone https://github.com/yourorg/onboardx-v2.git
cd onboardx-v2
npm install
```

### 2 — Configure

```bash
cp .env.example .env
# Fill in DISCORD_TOKEN, CLIENT_ID, Firebase credentials, BOT_OWNERS
```

### 3 — Create Firestore Indexes

Go to **Firestore → Indexes** and add the following composite indexes:

| Collection | Fields | Order |
|---|---|---|
| `warnings` | `guildId` ASC, `userId` ASC, `active` ASC, `createdAt` DESC |
| `tickets` | `guildId` ASC, `status` ASC, `createdAt` DESC |
| `giveaways` | `ended` ASC |

### 4 — Deploy Slash Commands

```bash
npm run deploy          # Dev guilds (instant)
# NODE_ENV=production npm run deploy  # Global (up to 1 h propagation)
```

### 5 — Start

```bash
npm run dev             # Development — single process, auto-restart
npm run start           # Production — single process
npm run start:shard     # Production — multi-shard (2 500+ guilds)
npm run start:cluster   # Production — 4-worker cluster
```

---

## 🐳 Docker Deployment

```bash
# Build image
docker build -t onboardx-v2 .

# Run with docker compose
docker compose up -d

# View logs
docker compose logs -f bot

# Scale to 3 instances (use with CLUSTER_COUNT)
docker compose up -d --scale bot=3
```

---

## ⚙️ Per-Server Setup

### Basic Setup (run as server admin)

```
/config module name:logging enabled:true
/config log-channel channel:#audit-logs

/config module name:verification enabled:true
/config verification channel:#verify role:@Member type:math

/config module name:leveling enabled:true
/config leveling channel:#level-ups multiplier:1.0

/config module name:joinRoles enabled:true
/joinroles add role:@Member type:humans
/joinroles settings min_account_age_days:3

/config module name:welcome enabled:true
/welcome setup channel:#welcome message:Welcome {user} to {server}! 🎉

/config module name:tickets enabled:true
/ticket setup channel:#support support_role:@Staff
/ticket panel channel:#open-a-ticket
```

### AutoMod Setup

```
/automod antispam enabled:true punishment:mute
/automod wordfilter action:add word:badword
/automod invitefilter enabled:true
/automod capsfilter enabled:true threshold:70
```

### Giveaway Example

```
/giveaway start prize:Discord Nitro duration:24h winners:1
/giveaway reroll id:<giveaway-id> count:1
```

---

## 🔀 Sharding & Clustering Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         node shard.js                          │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Cluster Primary (PID: main)                            │   │
│  │  Reads CLUSTER_COUNT env var                            │   │
│  │  Spawns N worker processes via Node cluster module      │   │
│  │  Restarts crashed workers automatically                 │   │
│  │  Exposes /health and /metrics on HEALTH_PORT            │   │
│  └──────────┬──────────────────────────────────────────────┘   │
│             │ fork()                                            │
│    ┌────────┴─────────────────────────────────────────┐        │
│    │  Worker #0              Worker #1                 │        │
│    │  Shards [0,1,2,3]       Shards [4,5,6,7]          │        │
│    │                                                   │        │
│    │  Each worker runs a ShardingManager that spawns   │        │
│    │  child processes — one per Discord shard.         │        │
│    │  Each shard child runs index.js                   │        │
│    └───────────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

| Mode | Command | When to use |
|---|---|---|
| Single process | `npm start` | Dev / < 2 500 guilds |
| Multi-shard | `npm run start:shard` | 2 500–50 000 guilds |
| Multi-cluster | `npm run start:cluster` | 50 000+ guilds / RAM bottleneck |

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `TOTAL_SHARDS` | `auto` | Number of Discord gateway shards |
| `SHARDS_PER_CLUSTER` | `4` | Shards per cluster worker |
| `CLUSTER_COUNT` | `1` | Worker processes (1 = no clustering) |
| `SHARD_DELAY_MS` | `5500` | Delay between spawning each shard |
| `HEALTH_PORT` | `9090` | HTTP port for `/health` and `/metrics` |

### Health Endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | Liveness probe — returns `{"status":"ok"}` |
| `GET /metrics` | Full stats: guilds, users, ping per shard, RAM |
| `GET /shards` | Per-shard status table |

---

## 💎 Premium System

Managed per-guild by bot owners via `/premium grant`.

| Tier | Price | Key Features |
|---|---|---|
| **Basic** | $4.99/mo | 1.5× XP, 10 concurrent giveaways, 25 role rewards, 50% cooldown reduction |
| **Pro** | $9.99/mo | Everything in Basic + voice/channel logs, giveaway bonus entries, poll graphs |
| **Enterprise** | $29.99/mo | Everything in Pro + bulk log export, advanced analytics, priority processing |

---

## 🔐 Security Notes

- **Never commit** `.env` or any Firebase service account JSON files
- Firestore security rules should **deny all client-side reads/writes** — bot uses Admin SDK
- All user inputs are sanitised via `utils/validation.js` before hitting Firestore
- AntiSpam and AutoMod run before XP is granted — clean messages only get XP
- Verification includes account-age awareness to flag brand-new accounts
- Captcha sessions expire and auto-kick on failure to prevent manual bypass

---

## 🏗️ Extending the Bot

### Add a command
1. Create `commands/<category>/myCommand.js`
2. Export `{ data, execute, cooldown?, premium? }`
3. `data` must be a `SlashCommandBuilder` instance
4. Run `npm run deploy` — it's auto-discovered, no registration needed

### Add an event
1. Create `events/myEvent.js`
2. Export `{ name, once?, execute }`
3. Restart the bot — auto-loaded

### Add a locale
1. Copy `locales/en.js` → `locales/fr.js`
2. Translate all strings
3. Add `fr` to `utils/i18n.js`

---

## 📜 License

MIT © OnboardX Team
