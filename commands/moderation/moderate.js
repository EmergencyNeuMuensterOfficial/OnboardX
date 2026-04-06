/**
 * commands/moderation/moderate.js
 * Core moderation commands: ban, kick, timeout, warn, purge.
 */

'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const LoggingService       = require('../../services/LoggingService');
const embed                = require('../../utils/embed');
const time                 = require('../../utils/time');
const { assertPermission, assertBotPermissions } = require('../../utils/permissions');

module.exports = {
  cooldown: 3_000,

  data: new SlashCommandBuilder()
    .setName('mod')
    .setDescription('Moderation tools.')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)

    // ── Ban ────────────────────────────────────────────────────────────────
    .addSubcommand(sub => sub
      .setName('ban')
      .setDescription('Ban a member.')
      .addUserOption(o => o.setName('user').setDescription('User to ban').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason for the ban'))
      .addIntegerOption(o => o.setName('delete_days').setDescription('Days of messages to delete (0–7)').setMinValue(0).setMaxValue(7))
    )

    // ── Unban ──────────────────────────────────────────────────────────────
    .addSubcommand(sub => sub
      .setName('unban')
      .setDescription('Unban a user by ID.')
      .addStringOption(o => o.setName('user_id').setDescription('User ID to unban').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason'))
    )

    // ── Kick ───────────────────────────────────────────────────────────────
    .addSubcommand(sub => sub
      .setName('kick')
      .setDescription('Kick a member.')
      .addUserOption(o => o.setName('user').setDescription('User to kick').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason'))
    )

    // ── Timeout ────────────────────────────────────────────────────────────
    .addSubcommand(sub => sub
      .setName('timeout')
      .setDescription('Timeout (mute) a member.')
      .addUserOption(o => o.setName('user').setDescription('User to timeout').setRequired(true))
      .addStringOption(o => o.setName('duration').setDescription('Duration (e.g. 10m, 1h, 1d — max 28d)').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason'))
    )

    // ── Untimeout ──────────────────────────────────────────────────────────
    .addSubcommand(sub => sub
      .setName('untimeout')
      .setDescription('Remove a timeout from a member.')
      .addUserOption(o => o.setName('user').setDescription('User to untimeout').setRequired(true))
    )

    // ── Warn ───────────────────────────────────────────────────────────────
    .addSubcommand(sub => sub
      .setName('warn')
      .setDescription('Warn a member (logged).')
      .addUserOption(o => o.setName('user').setDescription('User to warn').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason').setRequired(true))
    )

    // ── Purge ──────────────────────────────────────────────────────────────
    .addSubcommand(sub => sub
      .setName('purge')
      .setDescription('Bulk delete messages.')
      .addIntegerOption(o => o.setName('amount').setDescription('Number of messages (1–100)').setRequired(true).setMinValue(1).setMaxValue(100))
      .addUserOption(o => o.setName('user').setDescription('Only delete messages from this user'))
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();

    // ── Ban ────────────────────────────────────────────────────────────────
    if (sub === 'ban') {
      if (!await assertPermission(interaction, PermissionFlagsBits.BanMembers)) return;
      if (!await assertBotPermissions(interaction, [PermissionFlagsBits.BanMembers])) return;

      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason') ?? 'No reason provided';
      const days   = interaction.options.getInteger('delete_days') ?? 0;

      if (!target) return interaction.reply({ embeds: [embed.error('Not Found', 'User not found in this server.')], flags: MessageFlags.Ephemeral });
      if (!target.bannable) return interaction.reply({ embeds: [embed.error('Cannot Ban', 'I cannot ban this user — they may have a higher role.')], flags: MessageFlags.Ephemeral });

      // DM the target before ban
      await target.send({
        embeds: [embed.warn(`Banned from ${interaction.guild.name}`, `**Reason:** ${reason}`)],
      }).catch(() => {});

      await target.ban({ deleteMessageDays: days, reason });
      await interaction.reply({ embeds: [embed.success('Banned', `${target.user.tag} has been banned.\n**Reason:** ${reason}`)], flags: MessageFlags.Ephemeral });

      await LoggingService.logModAction(interaction.guild, {
        action:     'Ban',
        target:     target.user,
        moderator:  interaction.user,
        reason,
      });
      return;
    }

    // ── Unban ──────────────────────────────────────────────────────────────
    if (sub === 'unban') {
      if (!await assertPermission(interaction, PermissionFlagsBits.BanMembers)) return;
      if (!await assertBotPermissions(interaction, [PermissionFlagsBits.BanMembers])) return;

      const userId = interaction.options.getString('user_id');
      const reason = interaction.options.getString('reason') ?? 'No reason provided';

      try {
        const ban = await interaction.guild.bans.fetch(userId);
        await interaction.guild.members.unban(userId, reason);
        await interaction.reply({ embeds: [embed.success('Unbanned', `${ban.user.tag} has been unbanned.`)], flags: MessageFlags.Ephemeral });
        await LoggingService.logModAction(interaction.guild, { action: 'Unban', target: ban.user, moderator: interaction.user, reason });
      } catch {
        await interaction.reply({ embeds: [embed.error('Not Banned', 'No ban found for that user ID.')], flags: MessageFlags.Ephemeral });
      }
      return;
    }

    // ── Kick ───────────────────────────────────────────────────────────────
    if (sub === 'kick') {
      if (!await assertPermission(interaction, PermissionFlagsBits.KickMembers)) return;
      if (!await assertBotPermissions(interaction, [PermissionFlagsBits.KickMembers])) return;

      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason') ?? 'No reason provided';

      if (!target?.kickable) return interaction.reply({ embeds: [embed.error('Cannot Kick', 'I cannot kick this user.')], flags: MessageFlags.Ephemeral });

      await target.send({
        embeds: [embed.warn(`Kicked from ${interaction.guild.name}`, `**Reason:** ${reason}`)],
      }).catch(() => {});

      await target.kick(reason);
      await interaction.reply({ embeds: [embed.success('Kicked', `${target.user.tag} has been kicked.\n**Reason:** ${reason}`)], flags: MessageFlags.Ephemeral });
      await LoggingService.logModAction(interaction.guild, { action: 'Kick', target: target.user, moderator: interaction.user, reason });
      return;
    }

    // ── Timeout ────────────────────────────────────────────────────────────
    if (sub === 'timeout') {
      if (!await assertPermission(interaction, PermissionFlagsBits.ModerateMembers)) return;
      if (!await assertBotPermissions(interaction, [PermissionFlagsBits.ModerateMembers])) return;

      const target  = interaction.options.getMember('user');
      const durStr  = interaction.options.getString('duration');
      const reason  = interaction.options.getString('reason') ?? 'No reason provided';

      const durationMs = time.parseDuration(durStr);
      if (!durationMs) return interaction.reply({ embeds: [embed.error('Invalid Duration', 'Use formats like `10m`, `1h`, `1d`.')], flags: MessageFlags.Ephemeral });

      const MAX_TIMEOUT = 28 * 24 * 60 * 60 * 1000;
      if (durationMs > MAX_TIMEOUT) return interaction.reply({ embeds: [embed.error('Too Long', 'Maximum timeout is 28 days.')], flags: MessageFlags.Ephemeral });

      if (!target?.moderatable) return interaction.reply({ embeds: [embed.error('Cannot Timeout', 'I cannot timeout this user.')], flags: MessageFlags.Ephemeral });

      await target.timeout(durationMs, reason);
      await interaction.reply({
        embeds: [embed.success('Timed Out', `${target.user.tag} timed out for **${time.formatDuration(durationMs)}**.\n**Reason:** ${reason}`)],
        flags: MessageFlags.Ephemeral,
      });
      await LoggingService.logModAction(interaction.guild, {
        action: 'Timeout', target: target.user, moderator: interaction.user, reason,
        duration: time.formatDuration(durationMs),
      });
      return;
    }

    // ── Untimeout ──────────────────────────────────────────────────────────
    if (sub === 'untimeout') {
      if (!await assertPermission(interaction, PermissionFlagsBits.ModerateMembers)) return;
      const target = interaction.options.getMember('user');
      if (!target) return interaction.reply({ embeds: [embed.error('Not Found', 'User not found.')], flags: MessageFlags.Ephemeral });

      await target.timeout(null, 'Timeout removed by moderator');
      return interaction.reply({ embeds: [embed.success('Timeout Removed', `${target.user.tag}'s timeout has been removed.`)], flags: MessageFlags.Ephemeral });
    }

    // ── Warn ───────────────────────────────────────────────────────────────
    if (sub === 'warn') {
      if (!await assertPermission(interaction, 'mod')) return;

      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason');

      if (!target) return interaction.reply({ embeds: [embed.error('Not Found', 'User not found.')], flags: MessageFlags.Ephemeral });

      await target.send({
        embeds: [embed.warn(`⚠️ Warning from ${interaction.guild.name}`, `**Reason:** ${reason}`)],
      }).catch(() => {});

      await interaction.reply({
        embeds: [embed.success('User Warned', `${target.user.tag} has been warned.\n**Reason:** ${reason}`)],
        flags: MessageFlags.Ephemeral,
      });

      await LoggingService.logModAction(interaction.guild, { action: 'Warn', target: target.user, moderator: interaction.user, reason });
      return;
    }

    // ── Purge ──────────────────────────────────────────────────────────────
    if (sub === 'purge') {
      if (!await assertPermission(interaction, PermissionFlagsBits.ManageMessages)) return;
      if (!await assertBotPermissions(interaction, [PermissionFlagsBits.ManageMessages])) return;

      const amount = interaction.options.getInteger('amount');
      const user   = interaction.options.getUser('user');

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      let messages = await interaction.channel.messages.fetch({ limit: 100 });
      if (user) messages = messages.filter(m => m.author.id === user.id);
      const toDelete = [...messages.values()].slice(0, amount);

      // Discord won't bulk delete messages older than 14 days
      const twoWeeks = Date.now() - 14 * 24 * 60 * 60 * 1000;
      const recent   = toDelete.filter(m => m.createdTimestamp > twoWeeks);

      const deleted = await interaction.channel.bulkDelete(recent, true);

      return interaction.editReply({
        embeds: [embed.success('Purged', `Deleted **${deleted.size}** message${deleted.size !== 1 ? 's' : ''}.`)],
      });
    }
  },
};
