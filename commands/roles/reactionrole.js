/**
 * commands/roles/reactionrole.js
 * Create button-based self-assignable role panels.
 */

'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const ReactionRoleService  = require('../../services/ReactionRoleService');
const GuildConfig          = require('../../models/GuildConfig');
const embed                = require('../../utils/embed');
const { assertPermission } = require('../../utils/permissions');

module.exports = {
  cooldown: 5_000,

  data: new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Create self-assignable role panels.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)

    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create a role-selection panel.')
      .addStringOption(o => o.setName('roles').setDescription('Role IDs + labels — format: roleId:Label:emoji, ... (comma-separated)').setRequired(true))
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post the panel').addChannelTypes(ChannelType.GuildText))
      .addStringOption(o => o.setName('title').setDescription('Panel title'))
      .addStringOption(o => o.setName('description').setDescription('Panel description'))
    )

    .addSubcommand(sub => sub
      .setName('enable')
      .setDescription('Enable the self-assignable roles module.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable or disable').setRequired(true))
    ),

  async execute(interaction, client, guildCfg) {
    if (!await assertPermission(interaction, 'admin')) return;

    const sub = interaction.options.getSubcommand();

    if (sub === 'enable') {
      const enabled = interaction.options.getBoolean('enabled');
      await GuildConfig.update(interaction.guild.id, { 'modules.reactionRoles': enabled });
      return interaction.reply({
        embeds: [embed.success('Reaction Roles', `Self-assignable roles are now **${enabled ? 'enabled ✅' : 'disabled ❌'}**.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'create') {
      const rawRoles  = interaction.options.getString('roles');
      const channel   = interaction.options.getChannel('channel') ?? interaction.channel;
      const title     = interaction.options.getString('title');
      const desc      = interaction.options.getString('description');

      // Parse: "roleId:Label:emoji, roleId2:Label2"
      const roleEntries = rawRoles.split(',').map(s => {
        const parts = s.trim().split(':');
        return {
          roleId: parts[0]?.trim(),
          label:  parts[1]?.trim() ?? 'Role',
          emoji:  parts[2]?.trim() ?? null,
          color:  'Secondary',
        };
      }).filter(r => r.roleId);

      // Validate roles exist in the guild
      const invalid = roleEntries.filter(r => !interaction.guild.roles.cache.has(r.roleId));
      if (invalid.length) {
        return interaction.reply({
          embeds: [embed.error('Invalid Roles', `Could not find roles: ${invalid.map(r => `\`${r.roleId}\``).join(', ')}`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (roleEntries.length > 25) {
        return interaction.reply({
          embeds: [embed.error('Too Many Roles', 'Maximum 25 roles per panel.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const message = await ReactionRoleService.sendPanel(channel, {
        title,
        description: desc,
        roles: roleEntries,
      });

      // Ensure module is enabled
      const cfg = await GuildConfig.get(interaction.guild.id);
      const panel = ReactionRoleService.normalizePanel({
        messageId: message.id,
        channelId: channel.id,
        title,
        description: desc,
        roles: roleEntries,
      });
      await GuildConfig.update(interaction.guild.id, {
        'modules.reactionRoles': true,
        'reactionRoles.panels': [...(cfg.reactionRoles?.panels ?? []), panel],
      });

      return interaction.reply({
        embeds: [embed.success('Panel Created', `Role panel posted in ${channel} with **${roleEntries.length}** role${roleEntries.length !== 1 ? 's' : ''}.`)],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
