/**
 * commands/giveaway/giveaway.js
 * Full giveaway management: start, end, reroll, list.
 */

'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const GiveawayService      = require('../../services/GiveawayService');
const Giveaway             = require('../../models/Giveaway');
const embed                = require('../../utils/embed');
const time                 = require('../../utils/time');
const cfg                  = require('../../config/default');
const premCfg              = require('../../config/premium');
const { assertPermission } = require('../../utils/permissions');

function canManageGiveaways(interaction, guildCfg) {
  if (
    interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    interaction.member.permissions.has(PermissionFlagsBits.KickMembers) ||
    interaction.member.permissions.has(PermissionFlagsBits.BanMembers) ||
    interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)
  ) {
    return true;
  }

  const managerRoleId = guildCfg?.giveaway?.managerRoleId;
  return managerRoleId ? interaction.member.roles.cache.has(managerRoleId) : false;
}

module.exports = {
  cooldown: 10_000,

  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Manage giveaways.')

    .addSubcommand(sub => sub
      .setName('start')
      .setDescription('Start a new giveaway.')
      .addStringOption(o => o.setName('prize').setDescription('What is being given away?').setRequired(true))
      .addStringOption(o => o.setName('duration').setDescription('Duration (e.g. 1h, 2d, 30m)').setRequired(true))
      .addIntegerOption(o => o.setName('winners').setDescription('Number of winners (default: 1)').setMinValue(1).setMaxValue(20))
      .addChannelOption(o => o.setName('channel').setDescription('Channel (default: current)'))
    )

    .addSubcommand(sub => sub
      .setName('end')
      .setDescription('End a giveaway early.')
      .addStringOption(o => o.setName('id').setDescription('Giveaway document ID').setRequired(true))
    )

    .addSubcommand(sub => sub
      .setName('reroll')
      .setDescription('Reroll winners for an ended giveaway.')
      .addStringOption(o => o.setName('id').setDescription('Giveaway document ID').setRequired(true))
      .addIntegerOption(o => o.setName('count').setDescription('Number of new winners').setMinValue(1).setMaxValue(10))
    )

    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List giveaways in this server, including ended ones.')
    ),

  async execute(interaction, client, guildCfg) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'start') {
      if (!canManageGiveaways(interaction, guildCfg)) {
        if (!await assertPermission(interaction, 'mod')) return;
      }

      const prize       = interaction.options.getString('prize');
      const durStr      = interaction.options.getString('duration');
      const winnerCount = interaction.options.getInteger('winners') ?? 1;
      const targetCh    = interaction.options.getChannel('channel') ?? interaction.channel;

      const durationMs = time.parseDuration(durStr);
      if (!durationMs) {
        return interaction.reply({
          embeds: [embed.error('Invalid Duration', 'Please use a format like `1h`, `2d30m`, `30s`.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (durationMs < cfg.giveaway.minDuration || durationMs > cfg.giveaway.maxDuration) {
        return interaction.reply({
          embeds: [embed.error('Invalid Duration', 'Duration must be between 1 minute and 30 days.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const maxWinners = guildCfg?.premium ? premCfg.giveaway.maxWinners : 5;
      if (winnerCount > maxWinners) {
        return interaction.reply({
          embeds: [embed.premiumRequired(`${winnerCount} winners (max ${maxWinners} on free tier)`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      const active = await Giveaway.getActive();
      const guildActive = active.filter(g => g.guildId === interaction.guild.id);
      const maxActive = guildCfg?.premium ? premCfg.giveaway.maxConcurrent : 3;
      if (guildActive.length >= maxActive) {
        return interaction.reply({
          embeds: [embed.warn('Limit Reached', `Maximum ${maxActive} concurrent giveaways.`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const giveaway = await GiveawayService.start(client, {
        channel: targetCh,
        prize,
        durationMs,
        winners: winnerCount,
        hostedBy: interaction.user.id,
      });

      return interaction.editReply({
        embeds: [embed.success(
          'Giveaway Started!',
          `Prize: **${prize}**\nEnds: ${time.relative(Date.now() + durationMs)}\nID: \`${giveaway.id}\``
        )],
      });
    }

    if (sub === 'end') {
      const id = interaction.options.getString('id');
      const giveaway = await Giveaway.get(id);

      if (!giveaway) {
        return interaction.reply({
          embeds: [embed.error('Not Found', 'Giveaway not found.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (giveaway.hostedBy !== interaction.user.id) {
        return interaction.reply({
          embeds: [embed.error('Not Allowed', 'Only the giveaway creator can end this giveaway.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await GiveawayService.end(client, id);
      return interaction.editReply({
        embeds: [embed.success('Ended', `Giveaway \`${id}\` ended and winners selected.`)],
      });
    }

    if (sub === 'reroll') {
      const id = interaction.options.getString('id');
      const count = interaction.options.getInteger('count') ?? 1;
      const giveaway = await Giveaway.get(id);

      if (!giveaway) {
        return interaction.reply({
          embeds: [embed.error('Not Found', 'Giveaway not found.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (giveaway.hostedBy !== interaction.user.id) {
        return interaction.reply({
          embeds: [embed.error('Not Allowed', 'Only the giveaway creator can reroll this giveaway.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const newWinners = await GiveawayService.reroll(client, id, count);

      if (!newWinners) {
        return interaction.editReply({
          embeds: [embed.error('Reroll Failed', 'Giveaway not found or not yet ended.')],
        });
      }

      const mentions = newWinners.map(winnerId => `<@${winnerId}>`).join(', ') || 'No eligible entries.';
      return interaction.editReply({
        embeds: [embed.success('Rerolled!', `Giveaway \`${id}\`\nNew winner(s): ${mentions}`)],
      });
    }

    if (sub === 'list') {
      const giveaways = await Giveaway.getByGuild(interaction.guild.id);

      if (!giveaways.length) {
        return interaction.reply({
          embeds: [embed.info('No Giveaways', 'There are no giveaways for this server yet.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const lines = giveaways.map(giveaway => {
        const endsAt = giveaway.endsAt?.toMillis ? giveaway.endsAt.toMillis() : giveaway.endsAt;
        const status = giveaway.ended ? 'Ended' : 'Active';
        const timing = giveaway.ended ? 'ended' : `ends ${time.relative(endsAt)}`;
        return `ID: \`${giveaway.id}\` | **${status}** | **${giveaway.prize}** | ${timing}`;
      });

      return interaction.reply({
        embeds: [embed.base().setTitle('Giveaways').setDescription(lines.join('\n'))],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
