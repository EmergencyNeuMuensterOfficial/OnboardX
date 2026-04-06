/**
 * commands/admin/logging.js
 * Fine-grained control over which log events are active.
 */

'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const GuildConfig          = require('../../models/GuildConfig');
const embed                = require('../../utils/embed');
const { assertPermission } = require('../../utils/permissions');

const EVENTS = [
  'messageDelete', 'messageEdit', 'memberJoin', 'memberLeave',
  'roleChange', 'modAction', 'channelCreate', 'channelDelete', 'voiceUpdate',
];

module.exports = {
  cooldown: 5_000,

  data: new SlashCommandBuilder()
    .setName('logging')
    .setDescription('Toggle individual log event types.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption(o => o
      .setName('event')
      .setDescription('Log event to toggle')
      .setRequired(true)
      .addChoices(...EVENTS.map(e => ({ name: e, value: e })))
    )
    .addBooleanOption(o => o
      .setName('enabled')
      .setDescription('Enable or disable this event')
      .setRequired(true)
    ),

  async execute(interaction, client, guildCfg) {
    if (!await assertPermission(interaction, 'admin')) return;

    const event   = interaction.options.getString('event');
    const enabled = interaction.options.getBoolean('enabled');

    // Premium-only events
    const premiumEvents = ['channelCreate', 'channelDelete', 'voiceUpdate'];
    if (premiumEvents.includes(event) && !guildCfg?.premium) {
      return interaction.reply({
        embeds: [embed.premiumRequired(`${event} logging`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    await GuildConfig.update(interaction.guild.id, {
      [`logging.events.${event}`]: enabled,
    });

    return interaction.reply({
      embeds: [embed.success(
        'Log Event Updated',
        `**${event}** logging is now **${enabled ? 'enabled ✅' : 'disabled ❌'}**.`
      )],
      flags: MessageFlags.Ephemeral,
    });
  },
};
