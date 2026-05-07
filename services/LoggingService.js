/**
 * services/LoggingService.js
 * Sends structured embed logs to the configured channel when guild events fire.
 * Each event can be toggled per-guild via the config system.
 */

'use strict';

const { AuditLogEvent, PermissionFlagsBits } = require('discord.js');
const GuildConfig = require('../models/GuildConfig');
const embed       = require('../utils/embed');
const logger      = require('../utils/logger');
const cfg         = require('../config/default');

class LoggingService {
  /**
   * Central dispatcher. Resolves the log channel and posts the embed.
   * @param {Guild} guild
   * @param {string} event   — Key matching config.logging.events
   * @param {EmbedBuilder} logEmbed
   */
  static async log(guild, event, logEmbed) {
    try {
      const config   = await GuildConfig.get(guild.id);
      if (!config.modules?.logging) return;
      if (config.logging?.events?.[event] === false) return;

      const channelId = resolveLogChannelId(config.logging ?? {}, event);
      if (!channelId) return;

      const channel = guild.channels.cache.get(channelId);
      if (!channel) return;

      // Ensure bot has permission to send messages
      if (!channel.permissionsFor(guild.members.me)?.has(PermissionFlagsBits.SendMessages)) return;

      await channel.send({ embeds: [logEmbed] });
    } catch (err) {
      logger.error(`LoggingService.log [${event}]:`, err);
    }
  }

  // ── Event Handlers ──────────────────────────────────────────────────────────

  static async onMessageDelete(message) {
    if (!message.guild || message.author?.bot) return;

    const fields = [
      { name: '👤 Author',  value: `${message.author} (${message.author.id})`, inline: true },
      { name: '📌 Channel', value: `${message.channel}`,                       inline: true },
      { name: '🔑 Message ID', value: `\`${message.id}\``,                     inline: true },
    ];
    if (message.content) {
      fields.push({ name: '💬 Content', value: message.content.slice(0, 1000), inline: false });
    }
    if (message.attachments.size) {
      fields.push({ name: '📎 Attachments', value: String(message.attachments.size), inline: true });
    }

    const log = embed.log('🗑️ Message Deleted', fields, cfg.errorColor);
    await LoggingService.log(message.guild, 'messageDelete', log);
  }

  static async onMessageEdit(oldMsg, newMsg) {
    if (!oldMsg.guild || oldMsg.author?.bot) return;
    if (oldMsg.content === newMsg.content)   return;

    const fields = [
      { name: '👤 Author',  value: `${oldMsg.author} (${oldMsg.author.id})`, inline: true },
      { name: '📌 Channel', value: `${oldMsg.channel}`,                      inline: true },
      { name: '🔗 Jump',    value: `[View Message](${newMsg.url})`,          inline: true },
      { name: '📝 Before',  value: (oldMsg.content || '*empty*').slice(0, 500), inline: false },
      { name: '✏️ After',   value: (newMsg.content || '*empty*').slice(0, 500), inline: false },
    ];

    const log = embed.log('✏️ Message Edited', fields, cfg.warnColor);
    await LoggingService.log(oldMsg.guild, 'messageEdit', log);
  }

  static async onMemberJoin(member) {
    const accountAge = Date.now() - member.user.createdTimestamp;
    const dayOld     = accountAge < 86_400_000;

    const fields = [
      { name: '👤 User',         value: `${member} (${member.id})`,                               inline: true },
      { name: '📅 Account Created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
      { name: '👥 Member Count', value: `${member.guild.memberCount}`,                            inline: true },
    ];

    const color = dayOld ? cfg.warnColor : cfg.successColor;
    const log   = embed.log(
      `${dayOld ? '⚠️' : '✅'} Member Joined${dayOld ? ' (New Account)' : ''}`,
      fields,
      color
    ).setThumbnail(member.user.displayAvatarURL({ dynamic: true }));

    await LoggingService.log(member.guild, 'memberJoin', log);
  }

  static async onMemberLeave(member) {
    const joinedAt = member.joinedAt
      ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
      : 'Unknown';

    const roles = member.roles.cache
      .filter(r => r.id !== member.guild.id)
      .map(r => r.toString())
      .join(', ') || 'None';

    const fields = [
      { name: '👤 User',     value: `${member.user.tag} (${member.id})`, inline: true },
      { name: '📅 Joined',   value: joinedAt,                            inline: true },
      { name: '👥 Members',  value: `${member.guild.memberCount}`,       inline: true },
      { name: '🏷️ Roles',    value: roles.slice(0, 500),                 inline: false },
    ];

    const log = embed.log('🚪 Member Left', fields, cfg.errorColor)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }));
    await LoggingService.log(member.guild, 'memberLeave', log);
  }

  static async onRoleChange(oldMember, newMember) {
    const added   = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
    const removed = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
    if (!added.size && !removed.size) return;

    const fields = [
      { name: '👤 Member',       value: `${newMember} (${newMember.id})`,                                     inline: true },
      { name: '➕ Roles Added',  value: added.size   ? added.map(r => r.toString()).join(', ')   : 'None',    inline: false },
      { name: '➖ Roles Removed', value: removed.size ? removed.map(r => r.toString()).join(', ') : 'None',    inline: false },
    ];

    const log = embed.log('🏷️ Roles Updated', fields, cfg.botColor);
    await LoggingService.log(newMember.guild, 'roleChange', log);
  }

  /**
   * Log a moderation action performed via bot commands.
   */
  static async logModAction(guild, { action, target, moderator, reason, duration }) {
    const fields = [
      { name: '⚖️ Action',    value: action,                            inline: true },
      { name: '🎯 Target',    value: `${target} (${target.id})`,       inline: true },
      { name: '🛡️ Moderator', value: `${moderator} (${moderator.id})`, inline: true },
      { name: '📝 Reason',    value: reason || 'No reason provided',   inline: false },
    ];
    if (duration) fields.push({ name: '⏱️ Duration', value: duration, inline: true });

    const log = embed.log(`🔨 Moderation — ${action}`, fields, cfg.warnColor);
    await LoggingService.log(guild, 'modAction', log);
  }
}

function resolveLogChannelId(logging, event) {
  if (event === 'modAction') return logging.modLogChannel ?? logging.channelId;
  if (event === 'messageDelete' || event === 'messageEdit') return logging.messageLogChannel ?? logging.channelId;
  if (event === 'memberJoin' || event === 'memberLeave') return logging.joinLeaveChannel ?? logging.channelId;
  if (event === 'roleChange' || event === 'channelCreate' || event === 'channelDelete' || event === 'voiceUpdate') {
    return logging.serverLogChannel ?? logging.channelId;
  }
  return logging.channelId;
}

module.exports = LoggingService;
