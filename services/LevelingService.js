/**
 * services/LevelingService.js
 * Handles XP grant on messages, level-up announcements, and role reward assignment.
 * Includes cooldown enforcement and premium multiplier support.
 */

'use strict';

const { Collection } = require('discord.js');
const UserXP         = require('../models/UserXP');
const GuildConfig    = require('../models/GuildConfig');
const embed          = require('../utils/embed');
const cfg            = require('../config/default');
const premCfg        = require('../config/premium');
const logger         = require('../utils/logger');

/** @type {Collection<string, number>} `${guildId}:${userId}` → nextXPAllowedAt */
const xpCooldowns = new Collection();

class LevelingService {
  /**
   * Process a message for XP gain.
   * Called from the messageCreate event handler.
   *
   * @param {Message} message
   */
  static async handleMessage(message) {
    const { guild, author, channel } = message;
    if (!guild || author.bot) return;

    try {
      const config = await GuildConfig.get(guild.id);
      if (!config.modules?.leveling) return;

      // Cooldown check
      const key      = `${guild.id}:${author.id}`;
      const now      = Date.now();
      const cooldown = cfg.cooldowns.leveling;
      if ((xpCooldowns.get(key) ?? 0) > now) return;
      xpCooldowns.set(key, now + cooldown);

      // XP calc (with premium multiplier)
      const { min, max } = cfg.leveling.xpPerMessage;
      const base         = Math.floor(Math.random() * (max - min + 1)) + min;
      const multiplier   = config.premium
        ? (config.leveling?.multiplier ?? premCfg.leveling.xpMultiplier)
        : (config.leveling?.multiplier ?? 1.0);
      const xpGain = Math.floor(base * multiplier);

      const { levelled, newLevel, oldLevel } = await UserXP.addXP(guild.id, author.id, xpGain);

      if (!levelled) return;

      // Level-up announcement
      await LevelingService.announceLevel(message, newLevel, config);

      // Role rewards
      await LevelingService.assignRoleReward(message.member, newLevel, config);
    } catch (err) {
      logger.error('LevelingService.handleMessage:', err);
    }
  }

  /**
   * Post a level-up message in the appropriate channel.
   */
  static async announceLevel(message, level, config) {
    const targetChannelId = config.leveling?.channelId;
    const channel         = targetChannelId
      ? message.guild.channels.cache.get(targetChannelId)
      : message.channel;
    if (!channel) return;

    // Custom message support
    const customMsg = config.leveling?.customMessage;
    let levelEmbed;

    if (customMsg) {
      const text = customMsg
        .replace('{user}',  message.author.toString())
        .replace('{level}', level)
        .replace('{guild}', message.guild.name);
      levelEmbed = embed.base({ color: cfg.successColor })
        .setDescription(text)
        .setThumbnail(message.author.displayAvatarURL({ dynamic: true }));
    } else {
      levelEmbed = embed.levelUp(message.member, level);
    }

    await channel.send({ embeds: [levelEmbed] });
  }

  /**
   * Assign role rewards if a matching level threshold is met.
   */
  static async assignRoleReward(member, level, config) {
    const rewards = config.leveling?.roleRewards ?? [];
    if (!rewards.length) return;

    // Find all role rewards at or below current level
    const earned = rewards.filter(r => r.level <= level);
    if (!earned.length) return;

    const stackRoles = config.leveling?.stackRoles ?? false;
    const toAssign   = stackRoles ? earned : [earned.reduce((a, b) => a.level > b.level ? a : b)];

    for (const reward of toAssign) {
      const role = member.guild.roles.cache.get(reward.roleId);
      if (!role || member.roles.cache.has(role.id)) continue;
      try {
        await member.roles.add(role, `Level ${level} reward`);
      } catch (err) {
        logger.warn(`Could not assign level role ${reward.roleId}: ${err.message}`);
      }
    }

    // Remove lower-tier roles if not stacking
    if (!stackRoles && toAssign.length) {
      const keep = toAssign[0].roleId;
      for (const reward of rewards) {
        if (reward.roleId === keep) continue;
        if (!member.roles.cache.has(reward.roleId)) continue;
        try {
          await member.roles.remove(reward.roleId, 'Replaced by higher level reward');
        } catch { /* ignore */ }
      }
    }
  }

  /**
   * Get the XP progress display data for a user.
   */
  static async getProfile(guildId, userId) {
    const data         = await UserXP.get(guildId, userId);
    const xpNeeded     = UserXP.xpForLevel(data.level + 1);
    const pct          = Math.floor((data.xp / xpNeeded) * 100);
    const rank         = await UserXP.getRank(guildId, userId);
    return { ...data, xpNeeded, progressPct: pct, rank };
  }
}

module.exports = LevelingService;
