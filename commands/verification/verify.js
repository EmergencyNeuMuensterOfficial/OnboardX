/**
 * commands/verification/verify.js
 * Resend the verification panel or manually verify a user (admin).
 */

'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const VerificationService  = require('../../services/VerificationService');
const GuildConfig          = require('../../models/GuildConfig');
const embed                = require('../../utils/embed');
const { assertPermission } = require('../../utils/permissions');

module.exports = {
  cooldown: 5_000,

  data: new SlashCommandBuilder()
    .setName('verify')
    .setDescription('Verification system management.')

    .addSubcommand(sub => sub
      .setName('panel')
      .setDescription('Resend the verification panel to the configured channel.')
    )

    .addSubcommand(sub => sub
      .setName('force')
      .setDescription('[Admin] Manually verify a member, bypassing captcha.')
      .addUserOption(o => o.setName('user').setDescription('Member to verify').setRequired(true))
    )

    .addSubcommand(sub => sub
      .setName('status')
      .setDescription('Check your verification status.')
    ),

  async execute(interaction, client, guildCfg) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'panel') {
      if (!await assertPermission(interaction, 'admin')) return;

      const cfg = await GuildConfig.get(interaction.guild.id);
      if (!cfg.verification?.channelId || !cfg.verification?.roleId) {
        return interaction.reply({
          embeds: [embed.warn(
            'Not Configured',
            'Please configure verification first with `/config verification`.'
          )],
          flags: MessageFlags.Ephemeral,
        });
      }

      const channel = interaction.guild.channels.cache.get(cfg.verification.channelId);
      if (!channel) {
        return interaction.reply({
          embeds: [embed.error('Channel Not Found', 'The configured verification channel no longer exists.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      await VerificationService.sendPanel(channel, cfg.verification.roleId);
      return interaction.reply({
        embeds: [embed.success('Panel Sent', `Verification panel posted in ${channel}.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'force') {
      if (!await assertPermission(interaction, 'admin')) return;

      const cfg    = await GuildConfig.get(interaction.guild.id);
      const roleId = cfg.verification?.roleId;
      if (!roleId) {
        return interaction.reply({
          embeds: [embed.error('Not Configured', 'No verification role is set.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const target = interaction.options.getMember('user');
      if (!target) {
        return interaction.reply({
          embeds: [embed.error('Not Found', 'User not found in this server.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const role = interaction.guild.roles.cache.get(roleId);
      if (!role) {
        return interaction.reply({ embeds: [embed.error('Role Not Found', 'The verification role no longer exists.')], flags: MessageFlags.Ephemeral });
      }

      await target.roles.add(role, `Force-verified by ${interaction.user.tag}`);
      return interaction.reply({
        embeds: [embed.success('Verified', `${target} has been manually verified.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'status') {
      const cfg    = await GuildConfig.get(interaction.guild.id);
      const roleId = cfg.verification?.roleId;

      if (!cfg.modules?.verification || !roleId) {
        return interaction.reply({
          embeds: [embed.info('Verification', 'Verification is not enabled in this server.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const isVerified = interaction.member.roles.cache.has(roleId);
      return interaction.reply({
        embeds: [isVerified
          ? embed.success('✅ Verified', 'You are verified in this server.')
          : embed.warn('Not Verified', 'You have not completed verification yet.')],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
