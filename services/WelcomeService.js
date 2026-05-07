/**
 * services/WelcomeService.js
 * Sends customisable welcome and farewell embeds.
 * Supports: welcome channel, DM welcome, auto-role on join, farewell channel.
 *
 * Placeholder variables in custom messages:
 *   {user}         — mention (@Username)
 *   {username}     — plain username
 *   {server}       — server name
 *   {memberCount}  — current member count
 */

'use strict';

const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const GuildConfig = require('../models/GuildConfig');
const embed       = require('../utils/embed');
const logger      = require('../utils/logger');
const cfg         = require('../config/default');

class WelcomeService {
  /**
   * Called from guildMemberAdd event.
   * @param {GuildMember} member
   */
  static async onJoin(member) {
    const { guild } = member;

    try {
      const config = await GuildConfig.get(guild.id);
      if (!config.modules?.welcome) return;

      const wCfg = config.welcome ?? {};

      // ── 1. Welcome channel message ─────────────────────────────────────
      if (wCfg.channelId) {
        const channel = guild.channels.cache.get(wCfg.channelId);
        if (channel?.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)) {
          const welcomeEmbed = buildWelcomeEmbed(member, wCfg, guild);
          await channel.send({ embeds: [welcomeEmbed] });
        }
      }

      // ── 2. DM welcome ─────────────────────────────────────────────────
      if (wCfg.dmEnabled && wCfg.dmMessage) {
        const text = interpolate(wCfg.dmMessage, member, guild);
        await member.send({
          embeds: [embed.base({ color: cfg.successColor })
            .setTitle(`👋 Welcome to ${guild.name}!`)
            .setDescription(text)
            .setThumbnail(guild.iconURL({ dynamic: true }))],
        }).catch(() => {}); // DMs may be closed
      }

      // ── 3. Auto-role on join ───────────────────────────────────────────
      if (wCfg.autoRoleId) {
        const role = guild.roles.cache.get(wCfg.autoRoleId);
        if (role && guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
          await member.roles.add(role, 'Auto-role on join').catch(err =>
            logger.warn(`WelcomeService auto-role failed: ${err.message}`)
          );
        }
      }
    } catch (err) {
      logger.error('WelcomeService.onJoin:', err);
    }
  }

  /**
   * Called from guildMemberRemove event.
   * @param {GuildMember} member
   */
  static async onLeave(member) {
    const { guild } = member;

    try {
      const config = await GuildConfig.get(guild.id);
      if (!config.modules?.welcome) return;

      const wCfg = config.welcome ?? {};
      if (!wCfg.farewellChannelId) return;

      const channel = guild.channels.cache.get(wCfg.farewellChannelId);
      if (!channel?.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)) return;

      const farewellEmbed = buildFarewellEmbed(member, wCfg, guild);
      await channel.send({ embeds: [farewellEmbed] });
    } catch (err) {
      logger.error('WelcomeService.onLeave:', err);
    }
  }
}

// ── Embed builders ────────────────────────────────────────────────────────────

function buildWelcomeEmbed(member, wCfg, guild) {
  const color       = wCfg.color ?? cfg.successColor;
  const description = wCfg.message
    ? interpolate(wCfg.message, member, guild)
    : `Welcome to **${guild.name}**, ${member}! 🎉\nYou are member **#${guild.memberCount}**.`;

  return embed.base({ color })
    .setTitle(wCfg.title ?? `👋 Welcome!`)
    .setDescription(description)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
    .setImage(wCfg.bannerUrl ?? null)
    .addFields(
      { name: '📅 Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
      { name: '👥 Member Count',    value: `#${guild.memberCount}`,                                    inline: true },
    );
}

function buildFarewellEmbed(member, wCfg, guild) {
  const color       = wCfg.farewellColor ?? cfg.errorColor;
  const description = wCfg.farewellMessage
    ? interpolate(wCfg.farewellMessage, member, guild)
    : `**${member.user.username}** has left the server. We now have **${guild.memberCount}** members.`;

  return embed.base({ color })
    .setTitle(wCfg.farewellTitle ?? '👋 Goodbye!')
    .setDescription(description)
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }));
}

function interpolate(template, member, guild) {
  return template
    .replace(/{user}/g,        member.toString())
    .replace(/{username}/g,    member.user.username)
    .replace(/{server}/g,      guild.name)
    .replace(/{memberCount}/g, String(guild.memberCount))
    .replace(/{count}/g,       String(guild.memberCount))
    .replace(/{id}/g,          member.id);
}

module.exports = WelcomeService;
