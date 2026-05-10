'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const ModCase = require('../../models/ModCase');
const embed = require('../../utils/embed');
const time = require('../../utils/time');
const { assertPermission } = require('../../utils/permissions');

module.exports = {
  cooldown: 3_000,

  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('Moderation case management.')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addSubcommand(sub => sub
      .setName('view')
      .setDescription('View a moderation case.')
      .addIntegerOption(o => o.setName('id').setDescription('Case ID').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List recent moderation cases.')
      .addUserOption(o => o.setName('user').setDescription('Filter by user'))
    )
    .addSubcommand(sub => sub
      .setName('update')
      .setDescription('Update a moderation case.')
      .addIntegerOption(o => o.setName('id').setDescription('Case ID').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('New reason'))
      .addStringOption(o => o.setName('status').setDescription('Case status').addChoices(
        { name: 'Open', value: 'open' },
        { name: 'Reviewed', value: 'reviewed' },
        { name: 'Appealed', value: 'appealed' },
        { name: 'Closed', value: 'closed' },
      ))
      .addStringOption(o => o.setName('evidence').setDescription('Evidence URL or note'))
    ),

  async execute(interaction) {
    if (!await assertPermission(interaction, 'mod')) return;
    const sub = interaction.options.getSubcommand();

    if (sub === 'view') {
      const modCase = await ModCase.get(interaction.guild.id, interaction.options.getInteger('id'));
      if (!modCase) return interaction.reply({ embeds: [embed.error('Not Found', 'Case not found.')], flags: MessageFlags.Ephemeral });
      return interaction.reply({ embeds: [caseEmbed(modCase)], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'list') {
      const user = interaction.options.getUser('user');
      const cases = await ModCase.list(interaction.guild.id, user?.id, 10);
      const lines = cases.map(c => `#${c.caseId} **${c.action}** ${c.targetTag || c.targetId} - ${c.status} - ${c.createdAt?.toDate ? time.relative(c.createdAt.toDate()) : 'unknown'}`);
      return interaction.reply({ embeds: [embed.base().setTitle('Moderation Cases').setDescription(lines.join('\n') || 'No cases found.')], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'update') {
      const modCase = await ModCase.update(interaction.guild.id, interaction.options.getInteger('id'), {
        reason: interaction.options.getString('reason'),
        status: interaction.options.getString('status'),
        evidence: interaction.options.getString('evidence'),
      });
      if (!modCase) return interaction.reply({ embeds: [embed.error('Not Found', 'Case not found.')], flags: MessageFlags.Ephemeral });
      return interaction.reply({ embeds: [caseEmbed(modCase).setTitle(`Updated Case #${modCase.caseId}`)], flags: MessageFlags.Ephemeral });
    }
  },
};

function caseEmbed(modCase) {
  return embed.base({ color: 0xFEE75C })
    .setTitle(`Moderation Case #${modCase.caseId}`)
    .addFields(
      { name: 'Action', value: modCase.action, inline: true },
      { name: 'Target', value: `${modCase.targetTag || modCase.targetId} (${modCase.targetId})`, inline: true },
      { name: 'Moderator', value: `${modCase.moderatorTag || modCase.moderatorId} (${modCase.moderatorId})`, inline: true },
      { name: 'Reason', value: modCase.reason || 'No reason provided', inline: false },
      { name: 'Status', value: modCase.status || 'open', inline: true },
      { name: 'Evidence', value: modCase.evidence || 'None', inline: false },
    );
}
