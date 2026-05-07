/**
 * commands/poll/poll.js
 * Create multi-option polls with button voting and optional anonymity.
 */

'use strict';

const { SlashCommandBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const PollService  = require('../../services/PollService');
const Poll         = require('../../models/Poll');
const embed        = require('../../utils/embed');
const time         = require('../../utils/time');
const cfg          = require('../../config/default');
const premCfg      = require('../../config/premium');
const { assertPermission } = require('../../utils/permissions');

function canManagePolls(interaction, guildCfg) {
  if (
    interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    interaction.member.permissions.has(PermissionFlagsBits.KickMembers) ||
    interaction.member.permissions.has(PermissionFlagsBits.BanMembers) ||
    interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)
  ) {
    return true;
  }

  const managerRoleId = guildCfg?.poll?.managerRoleId;
  return managerRoleId ? interaction.member.roles.cache.has(managerRoleId) : false;
}

module.exports = {
  cooldown: 5_000,

  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create and manage polls.')

    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create a new poll.')
      .addStringOption(o => o.setName('question').setDescription('Poll question').setRequired(true))
      .addStringOption(o => o.setName('options').setDescription('Options separated by | (e.g. Yes|No|Maybe)').setRequired(true))
      .addStringOption(o => o.setName('duration').setDescription('Duration (e.g. 1h, 1d). Default: 24h'))
      .addBooleanOption(o => o.setName('anonymous').setDescription('Hide who voted for what'))
      .addBooleanOption(o => o.setName('multivote').setDescription('Allow voting on multiple options'))
    )

    .addSubcommand(sub => sub
      .setName('close')
      .setDescription('Close a poll early (creator only).')
      .addStringOption(o => o.setName('id').setDescription('Poll document ID').setRequired(true))
    )

    .addSubcommand(sub => sub
      .setName('results')
      .setDescription('View poll results.')
      .addStringOption(o => o.setName('id').setDescription('Poll document ID').setRequired(true))
    ),

  async execute(interaction, client, guildCfg) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      if (!canManagePolls(interaction, guildCfg)) {
        if (!await assertPermission(interaction, 'mod')) return;
      }

      const question  = interaction.options.getString('question');
      const optStr    = interaction.options.getString('options');
      const durStr    = interaction.options.getString('duration') ?? '24h';
      const anonymous = interaction.options.getBoolean('anonymous') ?? false;
      const multiVote = interaction.options.getBoolean('multivote') ?? false;

      const options = optStr.split('|').map(o => o.trim()).filter(Boolean);

      const maxOptions = guildCfg?.premium ? premCfg.poll.maxOptions : cfg.poll.maxOptions;
      if (options.length < 2 || options.length > maxOptions) {
        return interaction.reply({
          embeds: [embed.error('Invalid Options', `Please provide 2–${maxOptions} options separated by \`|\`.`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      const durationMs = time.parseDuration(durStr) ?? cfg.poll.defaultDuration;

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const poll = await PollService.create({
        channel:    interaction.channel,
        question,
        options,
        anonymous,
        multiVote,
        durationMs,
        createdBy:  interaction.user.id,
      });

      return interaction.editReply({
        embeds: [embed.success('Poll Created', `ID: \`${poll.id}\`\nEnds: ${time.relative(Date.now() + durationMs)}`)],
      });
    }

    if (sub === 'close') {
      const id   = interaction.options.getString('id');
      const poll = await Poll.get(id);

      if (!poll) {
        return interaction.reply({ embeds: [embed.error('Not Found', 'Poll not found.')], flags: MessageFlags.Ephemeral });
      }

      if (poll.createdBy !== interaction.user.id) {
        return interaction.reply({
          embeds: [embed.error('Not Allowed', 'Only the poll creator can close this poll.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      await PollService.close(client, id);
      return interaction.reply({ embeds: [embed.success('Poll Closed', 'The poll has been closed.')], flags: MessageFlags.Ephemeral });
    }

    if (sub === 'results') {
      const id   = interaction.options.getString('id');
      const poll = await Poll.get(id);

      if (!poll) {
        return interaction.reply({ embeds: [embed.error('Not Found', 'Poll not found.')], flags: MessageFlags.Ephemeral });
      }

      const totalVotes = Poll.totalVotes(poll);
      const endsAt     = poll.endsAt?.toMillis ? poll.endsAt.toMillis() : poll.endsAt;

      const resultEmbed = embed.poll({ question: poll.question, options: poll.options, anonymous: poll.anonymous, endsAt, totalVotes });
      resultEmbed.setFooter({ text: `Poll ID: ${poll.id}` });
      return interaction.reply({ embeds: [resultEmbed], flags: MessageFlags.Ephemeral });
    }
  },
};
