/**
 * services/AutoModService.js
 * Content-based auto-moderation:
 *  • Blocked word / phrase filter
 *  • Discord invite link filter
 *  • External link filter
 *  • Excessive CAPS filter
 *  • Zalgo / unicode abuse filter
 *
 * Each filter can be toggled independently per guild.
 */

'use strict';

const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const GuildConfig    = require('../models/GuildConfig');
const LoggingService = require('./LoggingService');
const embed          = require('../utils/embed');
const logger         = require('../utils/logger');

const INVITE_REGEX   = /discord(?:\.gg|app\.com\/invite|\.com\/invite)\/[a-zA-Z0-9-]+/gi;
const URL_REGEX      = /https?:\/\/[^\s]+/gi;
const ZALGO_REGEX    = /[\u0300-\u036f\u0489]/g;

class AutoModService {
  /**
   * Run all enabled automod checks on a message.
   * Returns true if the message was actioned (caller should abort further processing).
   *
   * @param {Message} message
   * @returns {Promise<boolean>}
   */
  static async check(message) {
    const { guild, member, content } = message;
    if (!guild || message.author.bot || !content) return false;
    if (member?.permissions?.has(PermissionFlagsBits.ManageMessages)) return false;

    const config = await GuildConfig.get(guild.id);
    const am = normalizeAutoModConfig(config);
    if (!am.enabled) return false;
    if (AutoModService._hasWhitelistedRole(member, am.whitelistRoles)) return false;

    // ── 1. Blocked words ──────────────────────────────────────────────────
    if (am.wordFilter?.enabled && am.wordFilter.words?.length) {
      const lower = content.toLowerCase();
      const hit   = am.wordFilter.words.find(w => lower.includes(w.toLowerCase()));
      if (hit) {
        await AutoModService._action(message, am, `Blocked word detected`);
        return true;
      }
    }

    // ── 2. Invite filter ──────────────────────────────────────────────────
    if (am.inviteFilter?.enabled && INVITE_REGEX.test(content)) {
      INVITE_REGEX.lastIndex = 0;
      await AutoModService._action(message, am, 'Discord invite link');
      return true;
    }
    INVITE_REGEX.lastIndex = 0;

    // ── 3. External link filter ───────────────────────────────────────────
    if (am.linkFilter?.enabled && URL_REGEX.test(content)) {
      URL_REGEX.lastIndex = 0;
      const whitelist = am.linkFilter.whitelist ?? [];
      const links     = content.match(URL_REGEX) ?? [];
      URL_REGEX.lastIndex = 0;
      const blocked   = links.find(l => !isWhitelistedUrl(l, whitelist));
      if (blocked) {
        await AutoModService._action(message, am, 'Unapproved external link');
        return true;
      }
    }
    URL_REGEX.lastIndex = 0;

    // ── 4. Caps filter ────────────────────────────────────────────────────
    if (am.capsFilter?.enabled && content.length >= 8) {
      const letters  = content.replace(/[^a-zA-Z]/g, '');
      const uppers   = content.replace(/[^A-Z]/g, '');
      const capsPct  = letters.length ? (uppers.length / letters.length) * 100 : 0;
      if (capsPct >= (am.capsFilter.threshold ?? 70)) {
        await AutoModService._action(message, am, `Excessive caps (${Math.round(capsPct)}%)`);
        return true;
      }
    }

    // ── 5. Zalgo / unicode abuse ──────────────────────────────────────────
    if (am.zalgoFilter?.enabled) {
      const matches = content.match(ZALGO_REGEX);
      if (matches && matches.length >= (am.zalgoFilter.threshold ?? 10)) {
        await AutoModService._action(message, am, 'Zalgo / unicode abuse');
        return true;
      }
    }

    return false;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  static _hasWhitelistedRole(member, roleIds = []) {
    if (!member || !Array.isArray(roleIds) || !roleIds.length) return false;
    return roleIds.some(roleId => member.roles?.cache?.has(String(roleId)));
  }

  static async _action(message, am, reason) {
    await message.delete().catch(() => {});

    const action = am.action ?? 'delete_warn';

    if (action !== 'delete') {
      const notice = await message.channel.send({
        embeds: [embed.warn('⚠️ Message Removed', `${message.author} — ${reason}`)],
      }).catch(() => null);

      if (notice) setTimeout(() => notice.delete().catch(() => {}), 5_000);
    }

    if ((action === 'delete_timeout5' || action === 'delete_timeout30') && message.member?.moderatable) {
      const durationMs = action === 'delete_timeout30' ? 30 * 60_000 : 5 * 60_000;
      await message.member.timeout(durationMs, `AutoMod: ${reason}`).catch(() => {});
    }

    // Log the action
    await LoggingService.logModAction(message.guild, {
      action:    `AutoMod`,
      target:    message.author,
      moderator: message.guild.members.me.user,
      reason,
    });

    logger.debug(`AutoMod [${message.guild.name}] removed message from ${message.author.tag}: ${reason}`);
  }
}

function normalizeAutoModConfig(config) {
  const raw = config.automod ?? {};

  return {
    enabled: config.modules?.automod === true || raw.enabled === true,
    action: raw.action ?? 'delete_warn',
    whitelistRoles: normalizeStringArray(raw.whitelistRoles),
    wordFilter: {
      enabled: raw.wordFilter?.enabled === true,
      words: normalizeStringArray(raw.wordFilter?.words),
    },
    inviteFilter: {
      enabled: raw.inviteFilter?.enabled === true || raw.antiInvite === true,
    },
    linkFilter: {
      enabled: raw.linkFilter?.enabled === true || raw.antiLinks === true,
      whitelist: normalizeStringArray(raw.linkFilter?.whitelist ?? raw.allowedDomains),
    },
    capsFilter: {
      enabled: raw.capsFilter?.enabled === true || raw.antiCaps === true,
      threshold: Number(raw.capsFilter?.threshold ?? raw.capsThreshold ?? 70),
    },
    zalgoFilter: {
      enabled: raw.zalgoFilter?.enabled === true || raw.antiZalgo === true,
      threshold: Number(raw.zalgoFilter?.threshold ?? raw.zalgoThreshold ?? 10),
    },
  };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item).trim().toLowerCase()).filter(Boolean);
}

function isWhitelistedUrl(url, whitelist) {
  if (!whitelist.length) return false;

  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return whitelist.some(domain => {
      const normalized = String(domain).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      return hostname === normalized || hostname.endsWith(`.${normalized}`);
    });
  } catch {
    return whitelist.some(domain => String(url).toLowerCase().includes(String(domain).toLowerCase()));
  }
}

module.exports = AutoModService;
