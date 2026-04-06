/**
 * commands/admin/levelrole.js
 * Add or remove role rewards for reaching specific levels.
 */

'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const GuildConfig          = require('../../models/GuildConfig');
const embed                = require('../../utils/embed');
const { assertPermission } = require('../../utils/permissions');
const premCfg              = require('../../config/premium');

module.exports = {
  cooldown: 5_000,

  data: new SlashCommandBuilder()
    .setName('levelrole')
    .setDescription('Manage role rewards granted at specific levels.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add a role reward at a level.')
      .addIntegerOption(o => o.setName('level').setDescription('Level threshold').setRequired(true).setMinValue(1))
      .addRoleOption(o => o.setName('role').setDescription('Role to assign').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a role reward.')
      .addIntegerOption(o => o.setName('level').setDescription('Level to remove').setRequired(true))
    )
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List all configured role rewards.')
    ),

  async execute(interaction, client, guildCfg) {
    if (!await assertPermission(interaction, 'admin')) return;
    const sub = interaction.options.getSubcommand();

    const cfg     = await GuildConfig.get(interaction.guild.id);
    const rewards = cfg.leveling?.roleRewards ?? [];
    const maxRewards = guildCfg?.premium ? premCfg.leveling.maxRoleRewards : 5;

    if (sub === 'add') {
      const level = interaction.options.getInteger('level');
      const role  = interaction.options.getRole('role');

      if (rewards.length >= maxRewards) {
        return interaction.reply({
          embeds: [embed.warn(
            'Limit Reached',
            `You can have at most **${maxRewards}** role rewards.` +
            (guildCfg?.premium ? '' : ' Upgrade to Premium for up to 25.')
          )],
          flags: MessageFlags.Ephemeral,
        });
      }

      const exists = rewards.findIndex(r => r.level === level);
      const updated = exists >= 0
        ? rewards.map(r => r.level === level ? { level, roleId: role.id } : r)
        : [...rewards, { level, roleId: role.id }];

      await GuildConfig.update(interaction.guild.id, { 'leveling.roleRewards': updated });

      return interaction.reply({
        embeds: [embed.success('Role Reward Added', `${role} will be assigned at **Level ${level}**.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'remove') {
      const level   = interaction.options.getInteger('level');
      const updated = rewards.filter(r => r.level !== level);
      if (updated.length === rewards.length) {
        return interaction.reply({
          embeds: [embed.warn('Not Found', `No role reward found at level ${level}.`)],
          flags: MessageFlags.Ephemeral,
        });
      }
      await GuildConfig.update(interaction.guild.id, { 'leveling.roleRewards': updated });
      return interaction.reply({
        embeds: [embed.success('Removed', `Role reward for level ${level} removed.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'list') {
      if (!rewards.length) {
        return interaction.reply({
          embeds: [embed.info('No Role Rewards', 'No role rewards configured yet.')],
          flags: MessageFlags.Ephemeral,
        });
      }
      const lines = rewards
        .sort((a, b) => a.level - b.level)
        .map(r => `Level **${r.level}** → <@&${r.roleId}>`);

      return interaction.reply({
        embeds: [embed.base().setTitle('🏆 Role Rewards').setDescription(lines.join('\n'))],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
