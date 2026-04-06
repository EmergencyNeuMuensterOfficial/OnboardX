/**
 * commands/tickets/ticket.js
 * Admin configuration and management for the ticket system.
 */

'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const TicketService        = require('../../services/TicketService');
const Ticket               = require('../../models/Ticket');
const GuildConfig          = require('../../models/GuildConfig');
const embed                = require('../../utils/embed');
const time                 = require('../../utils/time');
const { assertPermission } = require('../../utils/permissions');

module.exports = {
  cooldown: 5_000,

  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticket system management.')

    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Configure the ticket system.')
      .addChannelOption(o => o.setName('channel').setDescription('Channel where tickets are created (threads)').addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addRoleOption(o => o.setName('support_role').setDescription('Role that can see and respond to tickets'))
    )

    .addSubcommand(sub => sub
      .setName('panel')
      .setDescription('Post the ticket open button panel.')
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post the panel in').addChannelTypes(ChannelType.GuildText).setRequired(true))
    )

    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('[Mod] List all open tickets in this server.')
    )

    .addSubcommand(sub => sub
      .setName('close')
      .setDescription('[Mod] Force-close a ticket by ID.')
      .addStringOption(o => o.setName('id').setDescription('Ticket document ID').setRequired(true))
    )

    .addSubcommand(sub => sub
      .setName('disable')
      .setDescription('Disable the ticket system.')
    ),

  async execute(interaction, client, guildCfg) {
    const sub = interaction.options.getSubcommand();

    // ── Setup ──────────────────────────────────────────────────────────────
    if (sub === 'setup') {
      if (!await assertPermission(interaction, 'admin')) return;

      const channel     = interaction.options.getChannel('channel');
      const supportRole = interaction.options.getRole('support_role');

      const updates = {
        'modules.tickets':     true,
        'tickets.channelId':   channel.id,
      };
      if (supportRole) updates['tickets.supportRoleId'] = supportRole.id;

      await GuildConfig.update(interaction.guild.id, updates);
      return interaction.reply({
        embeds: [embed.success('Tickets Configured', `Tickets will open as threads in ${channel}.${supportRole ? `\nSupport role: ${supportRole}` : ''}`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── Panel ──────────────────────────────────────────────────────────────
    if (sub === 'panel') {
      if (!await assertPermission(interaction, 'admin')) return;

      const channel = interaction.options.getChannel('channel');
      await TicketService.sendPanel(channel);
      return interaction.reply({
        embeds: [embed.success('Panel Posted', `Ticket panel posted in ${channel}.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── List ───────────────────────────────────────────────────────────────
    if (sub === 'list') {
      if (!await assertPermission(interaction, 'mod')) return;

      const tickets = await Ticket.listOpen(interaction.guild.id);
      if (!tickets.length) {
        return interaction.reply({
          embeds: [embed.info('No Open Tickets', 'There are no open support tickets right now.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const lines = tickets.map(t => {
        const createdAt = t.createdAt?.toDate ? time.relative(t.createdAt.toDate()) : 'Unknown';
        return `• **#${t.ticketNumber}** — <@${t.userId}> — ${createdAt} — \`${t.id.slice(0, 8)}\``;
      });

      return interaction.reply({
        embeds: [embed.base().setTitle(`🎫 Open Tickets (${tickets.length})`).setDescription(lines.join('\n'))],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── Force close ────────────────────────────────────────────────────────
    if (sub === 'close') {
      if (!await assertPermission(interaction, 'mod')) return;

      const id     = interaction.options.getString('id');
      const ticket = await Ticket.get(id);

      if (!ticket || ticket.guildId !== interaction.guild.id) {
        return interaction.reply({
          embeds: [embed.error('Not Found', 'Ticket not found in this server.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (ticket.status === 'closed') {
        return interaction.reply({
          embeds: [embed.warn('Already Closed', 'This ticket is already closed.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      await Ticket.close(id, interaction.user.id);

      // Archive the thread
      const thread = interaction.guild.channels.cache.get(ticket.threadId);
      if (thread) {
        await thread.send({ embeds: [embed.warn('🔒 Ticket Force-Closed', `Closed by ${interaction.user} (admin).`)] }).catch(() => {});
        setTimeout(async () => {
          await thread.setLocked(true).catch(() => {});
          await thread.setArchived(true).catch(() => {});
        }, 2_000);
      }

      return interaction.reply({
        embeds: [embed.success('Ticket Closed', `Ticket \`${id}\` has been closed.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── Disable ────────────────────────────────────────────────────────────
    if (sub === 'disable') {
      if (!await assertPermission(interaction, 'admin')) return;
      await GuildConfig.update(interaction.guild.id, { 'modules.tickets': false });
      return interaction.reply({
        embeds: [embed.warn('Tickets Disabled', 'The ticket system has been disabled.')],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
