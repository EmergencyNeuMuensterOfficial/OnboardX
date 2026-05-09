/**
 * services/PremiumExpiryService.js
 * Sends premium expiry reminders and deactivates expired premium grants.
 */

'use strict';

const db = require('../database/firebase');
const GuildConfig = require('../models/GuildConfig');
const embed = require('../utils/embed');
const logger = require('../utils/logger');

const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

let timer = null;

function start(client) {
  if (timer) return;

  void check(client);
  timer = setInterval(() => void check(client), CHECK_INTERVAL_MS);
}

async function check(client) {
  const now = Date.now();
  let docs = [];

  try {
    docs = await db.getCollection(db.COLLECTIONS.guildConfigs)
      .find({ premium: true, premiumExpiresAt: { $ne: null } })
      .toArray();
  } catch (err) {
    logger.warn(`Premium expiry check failed: ${err.message}`);
    return;
  }

  for (const doc of docs) {
    const guildId = String(doc.guildId || doc._id || '');
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;

    const expiresAt = new Date(doc.premiumExpiresAt);
    if (Number.isNaN(expiresAt.getTime())) continue;

    const remaining = expiresAt.getTime() - now;
    const notifications = {
      sevenDays: false,
      oneDay: false,
      expired: false,
      ...(doc.premiumNotifications ?? {}),
    };

    if (remaining <= 0 && notifications.expired !== true) {
      await notifyGuild(guild, doc, 'Premium Expired', 'Premium for this server has expired and premium features are now disabled.');
      await GuildConfig.update(guildId, {
        premium: false,
        premiumTier: null,
        premiumNotifications: { ...notifications, expired: true },
      });
      continue;
    }

    if (remaining > 0 && remaining <= DAY_MS && notifications.oneDay !== true) {
      await notifyGuild(guild, doc, 'Premium Expires Soon', 'Premium for this server expires in less than 1 day.');
      await GuildConfig.update(guildId, {
        premiumNotifications: { ...notifications, oneDay: true },
      });
      continue;
    }

    if (remaining > DAY_MS && remaining <= 7 * DAY_MS && notifications.sevenDays !== true) {
      await notifyGuild(guild, doc, 'Premium Expires Soon', 'Premium for this server expires in less than 7 days.');
      await GuildConfig.update(guildId, {
        premiumNotifications: { ...notifications, sevenDays: true },
      });
    }
  }
}

async function notifyGuild(guild, config, title, message) {
  const expiresAt = new Date(config.premiumExpiresAt);
  const expiry = Number.isNaN(expiresAt.getTime())
    ? 'Unknown'
    : `<t:${Math.floor(expiresAt.getTime() / 1000)}:F> (<t:${Math.floor(expiresAt.getTime() / 1000)}:R>)`;
  const payload = {
    embeds: [embed.base({ color: 0xF1C40F })
      .setTitle(title)
      .setDescription(message)
      .addFields(
        { name: 'Server', value: guild.name, inline: true },
        { name: 'Tier', value: config.premiumTier || 'basic', inline: true },
        { name: 'Expires', value: expiry, inline: false },
      )],
  };

  await sendLogChannel(guild, config, payload);
  await sendOwner(guild, payload);
}

async function sendLogChannel(guild, config, payload) {
  const channelId = config.logging?.channelId || config.logging?.serverLogChannel || config.logging?.modLogChannel;
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased?.()) {
    await channel.send(payload).catch(() => {});
  }
}

async function sendOwner(guild, payload) {
  const owner = await guild.fetchOwner().catch(() => null);
  await owner?.send(payload).catch(() => {});
}

module.exports = {
  start,
  check,
};
