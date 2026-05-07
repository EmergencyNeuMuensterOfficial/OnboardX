/**
 * commands/moderation/warn.js
 * Persistent warning system with auto-punishments.
 */

'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const Warning              = require('../../models/Warning');
const GuildConfig          = require('../../models/GuildConfig');
const LoggingService       = require('../../services/LoggingService');
const embed                = require('../../utils/embed');
const time                 = require('../../utils/time');
const { assertPermission } = require('../../utils/permissions');

module.exports = {
  cooldown: 3_000,

  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warning management system.')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)

    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add a warning to a member.')
      .addUserOption(o => o.setName('user').setDescription('Member to warn').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Reason for warning').setRequired(true))
    )

    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('View all warnings for a member.')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
    )

    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a specific warning by ID.')
      .addStringOption(o => o.setName('id').setDescription('Warning document ID').setRequired(true))
    )

    .addSubcommand(sub => sub
      .setName('clear')
      .setDescription('Clear ALL warnings for a member.')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
    ),

  async execute(interaction, client, guildCfg) {
    if (!await assertPermission(interaction, 'mod')) return;

    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    // ── Add ────────────────────────────────────────────────────────────────
    if (sub === 'add') {
      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason');

      if (!target || target.user.bot) {
        return interaction.reply({ embeds: [embed.error('Invalid User', 'Cannot warn this user.')], flags: MessageFlags.Ephemeral });
      }

      const { warning, count } = await Warning.add(guildId, target.id, {
        reason,
        moderatorId: interaction.user.id,
      });

      // DM the warned user
      await target.send({
        embeds: [embed.warn(
          `⚠️ Warning in ${interaction.guild.name}`,
          `**Reason:** ${reason}\n**Total warnings:** ${count}`
        )],
      }).catch(() => {});

      // Auto-punishment thresholds (configurable)
      const thresholds  = guildCfg?.moderation?.warnThresholds ?? {
        [guildCfg?.moderation?.warnThresholdTimeout ?? 3]: 'mute',
        [guildCfg?.moderation?.warnThresholdKick ?? 5]: 'kick',
        [guildCfg?.moderation?.warnThresholdBan ?? 7]: 'ban',
      };
      const timeoutDurationMs = Number(guildCfg?.moderation?.timeoutDuration ?? 10) * 60_000;
      let   autoPunish  = null;

      for (const [n, action] of Object.entries(thresholds)) {
        if (count >= parseInt(n)) autoPunish = action;
      }

      let punishNote = '';
      if (autoPunish === 'mute' && target.moderatable) {
        await target.timeout(timeoutDurationMs, `Auto-timeout: ${count} warnings`).catch(() => {});
        punishNote = `\n⏱️ **Auto-timeout applied** (${Math.round(timeoutDurationMs / 60_000)} minutes)`;
      } else if (autoPunish === 'kick' && target.kickable) {
        await target.kick(`Auto-kick: ${count} warnings`).catch(() => {});
        punishNote = '\n👢 **Auto-kick applied**';
      } else if (autoPunish === 'ban' && target.bannable) {
        await target.ban({ reason: `Auto-ban: ${count} warnings` }).catch(() => {});
        punishNote = '\n🔨 **Auto-ban applied**';
      }

      await LoggingService.logModAction(interaction.guild, {
        action:    'Warning',
        target:    target.user,
        moderator: interaction.user,
        reason,
      });

      return interaction.reply({
        embeds: [embed.warn(
          '⚠️ Warning Issued',
          `${target} has been warned.\n**Reason:** ${reason}\n**Total warnings:** ${count}${punishNote}`
        )],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── List ───────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const user     = interaction.options.getUser('user');
      const warnings = await Warning.getAll(guildId, user.id);

      if (!warnings.length) {
        return interaction.reply({
          embeds: [embed.info('No Warnings', `${user.tag} has no active warnings.`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      const fields = warnings.slice(0, 25).map((w, i) => ({
        name:  `#${i + 1} — ID: \`${w.id.slice(0, 8)}\``,
        value: `**Reason:** ${w.reason}\n**By:** <@${w.moderatorId}>\n**When:** ${w.createdAt?.toDate ? time.relative(w.createdAt.toDate()) : 'Unknown'}`,
      }));

      return interaction.reply({
        embeds: [embed.base({ color: 0xFEE75C })
          .setTitle(`⚠️ Warnings — ${user.username} (${warnings.length} total)`)
          .addFields(fields)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── Remove ─────────────────────────────────────────────────────────────
    if (sub === 'remove') {
      const id     = interaction.options.getString('id');
      const removed = await Warning.remove(guildId, id);

      if (!removed) {
        return interaction.reply({
          embeds: [embed.error('Not Found', 'Warning not found or does not belong to this server.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      return interaction.reply({
        embeds: [embed.success('Warning Removed', `Warning \`${id}\` has been pardoned.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── Clear ──────────────────────────────────────────────────────────────
    if (sub === 'clear') {
      const user  = interaction.options.getUser('user');
      const count = await Warning.clearAll(guildId, user.id);

      return interaction.reply({
        embeds: [embed.success('Warnings Cleared', `Cleared **${count}** warning${count !== 1 ? 's' : ''} for ${user.tag}.`)],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
