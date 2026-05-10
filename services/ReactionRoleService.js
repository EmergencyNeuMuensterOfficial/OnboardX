/**
 * services/ReactionRoleService.js
 * Button-based self-assignable roles.
 * Admins set up panels with /reactionrole; members click to toggle roles.
 */

'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const GuildConfig = require('../models/GuildConfig');
const embed       = require('../utils/embed');
const logger      = require('../utils/logger');

class ReactionRoleService {
  /**
   * Post a reaction-role panel.
   * @param {TextChannel} channel
   * @param {string}      title
   * @param {string}      description
   * @param {Array<{roleId, label, emoji, color}>} roles
   */
  static async sendPanel(channel, { title, description, roles }) {
    const buttons = roles.map(r =>
      new ButtonBuilder()
        .setCustomId(`rr_toggle_${r.roleId}`)
        .setLabel(`${r.emoji ? r.emoji + ' ' : ''}${r.label}`)
        .setStyle(ButtonStyle[r.color] ?? ButtonStyle.Secondary)
    );

    // Discord allows max 5 buttons per row, 5 rows = 25 buttons
    const rows = [];
    for (let i = 0; i < buttons.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
    }

    const panelEmbed = embed.base()
      .setTitle(title ?? '🎭 Self-Assignable Roles')
      .setDescription(description ?? 'Click a button below to toggle a role.');

    const msg = await channel.send({ embeds: [panelEmbed], components: rows });
    return msg;
  }

  static normalizePanel(panel = {}) {
    return {
      messageId: panel.messageId ?? null,
      channelId: panel.channelId ?? null,
      title: panel.title ?? 'Self-Assignable Roles',
      description: panel.description ?? 'Click a button below to toggle a role.',
      roles: Array.isArray(panel.roles) ? panel.roles.slice(0, 25).map(role => ({
        roleId: String(role.roleId ?? ''),
        label: role.label || 'Role',
        emoji: role.emoji || null,
        color: role.color || 'Secondary',
      })).filter(role => role.roleId) : [],
    };
  }

  /**
   * Handle a role-toggle button click.
   * @param {ButtonInteraction} interaction
   * @param {string} roleId
   */
  static async handleToggle(interaction, roleId) {
    const { guild, member } = interaction;

    const config = await GuildConfig.get(guild.id);
    if (!config.modules?.reactionRoles) {
      return interaction.reply({
        embeds: [embed.error('Disabled', 'Self-assignable roles are not enabled.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const role = guild.roles.cache.get(roleId);
    if (!role) {
      return interaction.reply({
        embeds: [embed.error('Role Not Found', 'This role no longer exists.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Safety: never allow assigning roles higher than the bot's top role
    const botTopRole = guild.members.me.roles.highest;
    if (role.position >= botTopRole.position) {
      return interaction.reply({
        embeds: [embed.error('Role Too High', 'I cannot assign this role — it is above my highest role.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      const hasRole = member.roles.cache.has(roleId);
      if (hasRole) {
        await member.roles.remove(roleId, 'Self-service role removal');
        return interaction.reply({
          embeds: [embed.warn('Role Removed', `The **${role.name}** role has been removed from you.`)],
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await member.roles.add(roleId, 'Self-service role assignment');
        return interaction.reply({
          embeds: [embed.success('Role Added', `You now have the **${role.name}** role!`)],
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (err) {
      logger.error('ReactionRoleService.handleToggle:', err);
      return interaction.reply({
        embeds: [embed.error('Error', 'Failed to update your roles. Please try again.')],
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

module.exports = ReactionRoleService;
