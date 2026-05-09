/**
 * commands/admin/config.js
 * Master configuration command for server admins.
 * Enables/disables modules and sets channels, roles, and options.
 */

'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const GuildConfig = require('../../models/GuildConfig');
const embed       = require('../../utils/embed');
const { assertPermission } = require('../../utils/permissions');

const LOG_EVENTS = [
  'messageDelete',
  'messageEdit',
  'memberJoin',
  'memberLeave',
  'roleChange',
  'modAction',
  'channelCreate',
  'channelDelete',
  'voiceUpdate',
];

module.exports = {
  cooldown: 5_000,

  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure OnboardX V2 for this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(sub => sub
      .setName('module')
      .setDescription('Enable or disable a feature module.')
      .addStringOption(o => o
        .setName('name')
        .setDescription('Module to toggle')
        .setRequired(true)
        .addChoices(
          { name: 'Logging', value: 'logging' },
          { name: 'Verification', value: 'verification' },
          { name: 'Leveling', value: 'leveling' },
          { name: 'Giveaways', value: 'giveaways' },
          { name: 'Polls', value: 'polls' },
          { name: 'Join Roles', value: 'joinRoles' },
          { name: 'Welcome', value: 'welcome' },
          { name: 'AutoMod', value: 'automod' },
          { name: 'Anti-Spam', value: 'antispam' },
          { name: 'Reaction Roles', value: 'reactionRoles' },
        ))
      .addBooleanOption(o => o
        .setName('enabled')
        .setDescription('Enable or disable the module')
        .setRequired(true)))

    .addSubcommand(sub => sub
      .setName('log-channel')
      .setDescription('Set the channel where log events are posted.')
      .addChannelOption(o => o
        .setName('channel')
        .setDescription('Log channel')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)))

    .addSubcommand(sub => sub
      .setName('log-event')
      .setDescription('Toggle a specific logging event.')
      .addStringOption(o => o
        .setName('event')
        .setDescription('Log event to change')
        .setRequired(true)
        .addChoices(...LOG_EVENTS.map(event => ({ name: event, value: event }))))
      .addBooleanOption(o => o
        .setName('enabled')
        .setDescription('Enable or disable this event')
        .setRequired(true)))

    .addSubcommand(sub => sub
      .setName('verification')
      .setDescription('Configure the verification system.')
      .addChannelOption(o => o
        .setName('channel')
        .setDescription('Channel to post the verification panel')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
      .addRoleOption(o => o
        .setName('role')
        .setDescription('Role to assign after verification')
        .setRequired(true))
      .addStringOption(o => o
        .setName('type')
        .setDescription('CAPTCHA type')
        .addChoices(
          { name: 'Math (default)', value: 'math' },
          { name: 'Image (premium)', value: 'image' },
        )))

    .addSubcommand(sub => sub
      .setName('leveling')
      .setDescription('Configure the leveling system.')
      .addChannelOption(o => o
        .setName('channel')
        .setDescription('Channel for level-up announcements (blank = same channel)')
        .addChannelTypes(ChannelType.GuildText))
      .addStringOption(o => o
        .setName('message')
        .setDescription('Custom level-up message. Use {user}, {level}, {guild}'))
      .addNumberOption(o => o
        .setName('multiplier')
        .setDescription('XP multiplier (0.1 - 5.0)')
        .setMinValue(0.1)
        .setMaxValue(5.0))
      .addBooleanOption(o => o
        .setName('stack_roles')
        .setDescription('Keep lower role rewards when a higher one is earned')))

    .addSubcommand(sub => sub
      .setName('welcome')
      .setDescription('Configure welcome and farewell channels and options.')
      .addChannelOption(o => o
        .setName('welcome_channel')
        .setDescription('Channel for welcome messages')
        .addChannelTypes(ChannelType.GuildText))
      .addChannelOption(o => o
        .setName('farewell_channel')
        .setDescription('Channel for farewell messages')
        .addChannelTypes(ChannelType.GuildText))
      .addBooleanOption(o => o
        .setName('dm_enabled')
        .setDescription('Enable or disable DM welcomes'))
      .addRoleOption(o => o
        .setName('autorole')
        .setDescription('Role assigned to new members')))

    .addSubcommand(sub => sub
      .setName('manager-roles')
      .setDescription('Set optional manager roles for giveaways and polls.')
      .addRoleOption(o => o
        .setName('giveaway_role')
        .setDescription('Role allowed to manage giveaways'))
      .addRoleOption(o => o
        .setName('poll_role')
        .setDescription('Role allowed to manage polls')))

    .addSubcommand(sub => sub
      .setName('view')
      .setDescription('View current server configuration.')),

  async execute(interaction, client, guildCfg) {
    if (!await assertPermission(interaction, 'admin')) return;

    const sub = interaction.options.getSubcommand();

    if (sub === 'module') {
      const name    = interaction.options.getString('name');
      const enabled = interaction.options.getBoolean('enabled');
      await GuildConfig.update(interaction.guild.id, { [`modules.${name}`]: enabled });

      return interaction.reply({
        embeds: [embed.success('Module Updated', `**${name}** has been **${enabled ? 'enabled' : 'disabled'}**.`)],
        flags: 64,
      });
    }

    if (sub === 'log-channel') {
      const channel = interaction.options.getChannel('channel');
      await GuildConfig.update(interaction.guild.id, {
        'logging.channelId': channel.id,
        'modules.logging': true,
      });

      return interaction.reply({
        embeds: [embed.success('Log Channel Set', `Logs will be posted in ${channel}.`)],
        flags: 64,
      });
    }

    if (sub === 'log-event') {
      const event = interaction.options.getString('event');
      const enabled = interaction.options.getBoolean('enabled');

      await GuildConfig.update(interaction.guild.id, {
        [`logging.events.${event}`]: enabled,
        'modules.logging': true,
      });

      return interaction.reply({
        embeds: [embed.success('Logging Updated', `**${event}** logging is now **${enabled ? 'enabled' : 'disabled'}**.`)],
        flags: 64,
      });
    }

    if (sub === 'verification') {
      const channel = interaction.options.getChannel('channel');
      const role    = interaction.options.getRole('role');
      const type    = interaction.options.getString('type') ?? 'math';

      if (type === 'image' && !guildCfg?.premium) {
        return interaction.reply({
          embeds: [embed.premiumRequired('Image CAPTCHA')],
          flags: 64,
        });
      }

      await GuildConfig.update(interaction.guild.id, {
        'verification.channelId': channel.id,
        'verification.roleId': role.id,
        'verification.type': type,
        'modules.verification': true,
      });

      const VerificationService = require('../../services/VerificationService');
      await VerificationService.sendPanel(channel, role.id);

      return interaction.reply({
        embeds: [embed.success('Verification Configured', `Panel posted in ${channel}. Role: ${role}.`)],
        flags: 64,
      });
    }

    if (sub === 'leveling') {
      const channel    = interaction.options.getChannel('channel');
      const message    = interaction.options.getString('message');
      const multiplier = interaction.options.getNumber('multiplier');
      const stackRoles = interaction.options.getBoolean('stack_roles');

      const updates = {};
      if (channel) updates['leveling.channelId'] = channel.id;
      if (message) updates['leveling.customMessage'] = message;
      if (multiplier !== null) updates['leveling.multiplier'] = multiplier;
      if (stackRoles !== null) updates['leveling.stackRoles'] = stackRoles;

      if (!Object.keys(updates).length) {
        return interaction.reply({
          embeds: [embed.warn('Nothing Updated', 'Please provide at least one option to update.')],
          flags: 64,
        });
      }

      await GuildConfig.update(interaction.guild.id, updates);
      return interaction.reply({
        embeds: [embed.success('Leveling Updated', 'Leveling settings saved.')],
        flags: 64,
      });
    }

    if (sub === 'welcome') {
      const welcomeChannel = interaction.options.getChannel('welcome_channel');
      const farewellChannel = interaction.options.getChannel('farewell_channel');
      const dmEnabled = interaction.options.getBoolean('dm_enabled');
      const autorole = interaction.options.getRole('autorole');

      const updates = {};
      if (welcomeChannel) updates['welcome.channelId'] = welcomeChannel.id;
      if (farewellChannel) updates['welcome.farewellChannelId'] = farewellChannel.id;
      if (dmEnabled !== null) updates['welcome.dmEnabled'] = dmEnabled;
      if (autorole) updates['welcome.autoRoleId'] = autorole.id;

      if (!Object.keys(updates).length) {
        return interaction.reply({
          embeds: [embed.warn('Nothing Updated', 'Provide at least one welcome setting to change.')],
          flags: 64,
        });
      }

      updates['modules.welcome'] = true;
      await GuildConfig.update(interaction.guild.id, updates);
      return interaction.reply({
        embeds: [embed.success('Welcome Updated', 'Welcome and farewell settings were saved.')],
        flags: 64,
      });
    }

    if (sub === 'tickets') {
      const logChannel = interaction.options.getChannel('log_channel');
      const maxOpenPerUser = interaction.options.getInteger('max_open_per_user');

      const updates = {};
      if (logChannel) updates['tickets.logChannelId'] = logChannel.id;
      if (maxOpenPerUser !== null) updates['tickets.maxOpenPerUser'] = maxOpenPerUser;

      if (!Object.keys(updates).length) {
        return interaction.reply({
          embeds: [embed.warn('Nothing Updated', 'Provide at least one ticket setting to change.')],
          flags: 64,
        });
      }

      await GuildConfig.update(interaction.guild.id, updates);
      return interaction.reply({
        embeds: [embed.success('Tickets Updated', 'Ticket settings were saved.')],
        flags: 64,
      });
    }

    if (sub === 'manager-roles') {
      const giveawayRole = interaction.options.getRole('giveaway_role');
      const pollRole = interaction.options.getRole('poll_role');

      const updates = {};
      if (giveawayRole) updates['giveaway.managerRoleId'] = giveawayRole.id;
      if (pollRole) updates['poll.managerRoleId'] = pollRole.id;

      if (!Object.keys(updates).length) {
        return interaction.reply({
          embeds: [embed.warn('Nothing Updated', 'Provide at least one manager role to change.')],
          flags: 64,
        });
      }

      await GuildConfig.update(interaction.guild.id, updates);
      return interaction.reply({
        embeds: [embed.success('Manager Roles Updated', 'Giveaway and poll manager roles were saved.')],
        flags: 64,
      });
    }

    if (sub === 'view') {
      const cfg = await GuildConfig.get(interaction.guild.id);
      const mods = cfg.modules ?? {};
      const enabledLogEvents = Object.entries(cfg.logging?.events ?? {})
        .filter(([, enabled]) => enabled)
        .map(([name]) => name)
        .join(', ') || 'None';
      const joinRoleCount = (cfg.joinRoles?.humanRoles?.length ?? 0) + (cfg.joinRoles?.botRoles?.length ?? 0);
      const premiumValue = cfg.premium
        ? `Yes (${cfg.premiumTier ?? 'basic'}${cfg.premiumExpiresAt ? `, expires <t:${Math.floor(new Date(cfg.premiumExpiresAt).getTime() / 1000)}:R>` : ', no expiry'})`
        : 'No';

      const fields = [
        { name: 'Modules', value: Object.entries(mods).map(([k, v]) => `${v ? 'ON' : 'OFF'} ${k}`).join('\n') || 'None', inline: true },
        { name: 'Log Channel', value: cfg.logging?.channelId ? `<#${cfg.logging.channelId}>` : 'Not set', inline: true },
        { name: 'Verify Role', value: cfg.verification?.roleId ? `<@&${cfg.verification.roleId}>` : 'Not set', inline: true },
        { name: 'XP Multiplier', value: String(cfg.leveling?.multiplier ?? 1.0), inline: true },
        { name: 'Premium', value: premiumValue, inline: true },
        { name: 'Log Events', value: enabledLogEvents.slice(0, 1024), inline: false },
        { name: 'Welcome', value: cfg.welcome?.channelId ? `<#${cfg.welcome.channelId}>` : 'Not set', inline: true },
        { name: 'Tickets', value: cfg.tickets?.channelId ? `<#${cfg.tickets.channelId}>` : 'Not set', inline: true },
        { name: 'Join Roles', value: `${joinRoleCount} configured`, inline: true },
        { name: 'Giveaway Manager', value: cfg.giveaway?.managerRoleId ? `<@&${cfg.giveaway.managerRoleId}>` : 'Not set', inline: true },
        { name: 'Poll Manager', value: cfg.poll?.managerRoleId ? `<@&${cfg.poll.managerRoleId}>` : 'Not set', inline: true },
      ];

      const viewEmbed = embed.base()
        .setTitle(`Config - ${interaction.guild.name}`)
        .addFields(fields);

      return interaction.reply({ embeds: [viewEmbed], flags: 64 });
    }
  },
};
