'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const InviteTracker = require('../../models/InviteTracker');
const GuildConfig = require('../../models/GuildConfig');
const embed = require('../../utils/embed');
const { assertPermission } = require('../../utils/permissions');

module.exports = {
  cooldown: 5_000,

  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Invite tracking tools.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub
      .setName('enable')
      .setDescription('Enable or disable invite tracking.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable invite tracking').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('leaderboard')
      .setDescription('Show invite leaderboard.')
    )
    .addSubcommand(sub => sub
      .setName('stats')
      .setDescription('Show invite stats for a member.')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
    ),

  async execute(interaction) {
    if (!await assertPermission(interaction, 'admin')) return;
    const sub = interaction.options.getSubcommand();

    if (sub === 'enable') {
      const enabled = interaction.options.getBoolean('enabled');
      await GuildConfig.update(interaction.guild.id, {
        'modules.inviteTracking': enabled,
        'inviteTracking.enabled': enabled,
      });
      return interaction.reply({ embeds: [embed.success('Invite Tracking', `Invite tracking is now **${enabled ? 'enabled' : 'disabled'}**.`)], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'leaderboard') {
      const rows = await InviteTracker.leaderboard(interaction.guild.id, 10);
      const lines = rows.map((row, index) => {
        const net = Number(row.joins ?? 0) - Number(row.leaves ?? 0) - Number(row.fake ?? 0);
        return `**${index + 1}.** <@${row.inviterId}> - ${row.joins ?? 0} joins, ${row.leaves ?? 0} leaves, ${row.fake ?? 0} fake, **${net} net**`;
      });
      return interaction.reply({ embeds: [embed.base().setTitle('Invite Leaderboard').setDescription(lines.join('\n') || 'No invite data yet.')], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'stats') {
      const user = interaction.options.getUser('user');
      const stats = await InviteTracker.stats(interaction.guild.id, user.id);
      if (!stats) return interaction.reply({ embeds: [embed.info('No Invite Stats', `${user} has no tracked invites yet.`)], flags: MessageFlags.Ephemeral });
      const net = Number(stats.joins ?? 0) - Number(stats.leaves ?? 0) - Number(stats.fake ?? 0);
      return interaction.reply({
        embeds: [embed.base()
          .setTitle(`Invite Stats - ${user.username}`)
          .addFields(
            { name: 'Joins', value: String(stats.joins ?? 0), inline: true },
            { name: 'Leaves', value: String(stats.leaves ?? 0), inline: true },
            { name: 'Fake', value: String(stats.fake ?? 0), inline: true },
            { name: 'Net', value: String(net), inline: true },
          )],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
