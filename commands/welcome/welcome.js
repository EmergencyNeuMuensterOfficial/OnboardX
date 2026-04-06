/**
 * commands/welcome/welcome.js
 * Configure the welcome/farewell system.
 */

'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const GuildConfig          = require('../../models/GuildConfig');
const WelcomeService       = require('../../services/WelcomeService');
const embed                = require('../../utils/embed');
const { assertPermission } = require('../../utils/permissions');

module.exports = {
  cooldown: 5_000,

  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Configure welcome and farewell messages.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Set up the welcome channel and message.')
      .addChannelOption(o => o.setName('channel').setDescription('Channel for welcome messages').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('Custom message. Use {user}, {username}, {server}, {memberCount}'))
      .addStringOption(o => o.setName('title').setDescription('Embed title'))
      .addRoleOption(o => o.setName('autorole').setDescription('Role to auto-assign on join'))
    )

    .addSubcommand(sub => sub
      .setName('farewell')
      .setDescription('Set up the farewell channel and message.')
      .addChannelOption(o => o.setName('channel').setDescription('Channel for farewell messages').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('Custom farewell message'))
    )

    .addSubcommand(sub => sub
      .setName('dm')
      .setDescription('Configure a DM sent to new members.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable or disable DM welcome').setRequired(true))
      .addStringOption(o => o.setName('message').setDescription('DM message content'))
    )

    .addSubcommand(sub => sub
      .setName('test')
      .setDescription('Preview the welcome message.')
    )

    .addSubcommand(sub => sub
      .setName('disable')
      .setDescription('Disable the entire welcome/farewell system.')
    ),

  async execute(interaction, client) {
    if (!await assertPermission(interaction, 'admin')) return;

    const sub = interaction.options.getSubcommand();

    if (sub === 'setup') {
      const channel  = interaction.options.getChannel('channel');
      const message  = interaction.options.getString('message');
      const title    = interaction.options.getString('title');
      const autorole = interaction.options.getRole('autorole');

      const updates = { 'modules.welcome': true, 'welcome.channelId': channel.id };
      if (message)  updates['welcome.message']    = message;
      if (title)    updates['welcome.title']       = title;
      if (autorole) updates['welcome.autoRoleId']  = autorole.id;

      await GuildConfig.update(interaction.guild.id, updates);
      return interaction.reply({
        embeds: [embed.success('Welcome Configured', `Welcome messages will be posted in ${channel}.${autorole ? `\nAuto-role: ${autorole}` : ''}`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'farewell') {
      const channel = interaction.options.getChannel('channel');
      const message = interaction.options.getString('message');

      const updates = { 'welcome.farewellChannelId': channel.id };
      if (message) updates['welcome.farewellMessage'] = message;

      await GuildConfig.update(interaction.guild.id, updates);
      return interaction.reply({
        embeds: [embed.success('Farewell Configured', `Farewell messages will be posted in ${channel}.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'dm') {
      const enabled = interaction.options.getBoolean('enabled');
      const message = interaction.options.getString('message');

      const updates = { 'welcome.dmEnabled': enabled };
      if (message) updates['welcome.dmMessage'] = message;

      await GuildConfig.update(interaction.guild.id, updates);
      return interaction.reply({
        embeds: [embed.success('DM Welcome Updated', `DM welcome is now **${enabled ? 'enabled' : 'disabled'}**.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'test') {
      await WelcomeService.onJoin(interaction.member);
      return interaction.reply({
        embeds: [embed.success('Test Sent', 'Welcome message triggered for your account. Check the configured channel!')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'disable') {
      await GuildConfig.update(interaction.guild.id, { 'modules.welcome': false });
      return interaction.reply({
        embeds: [embed.warn('Welcome Disabled', 'The welcome/farewell system has been disabled.')],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
