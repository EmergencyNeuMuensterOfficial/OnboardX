/**
 * services/TicketService.js
 * Thread-based support ticket system.
 * Each ticket = one private thread in the configured support channel.
 * Includes transcript export on close (HTML file).
 */

'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  AttachmentBuilder,
  MessageFlags,
} = require('discord.js');
const Ticket      = require('../models/Ticket');
const GuildConfig = require('../models/GuildConfig');
const embed       = require('../utils/embed');
const logger      = require('../utils/logger');

class TicketService {
  /**
   * Post the ticket open panel to the configured channel.
   * @param {TextChannel} channel
   */
  static async sendPanel(channel) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_open')
        .setLabel('🎫 Open a Ticket')
        .setStyle(ButtonStyle.Primary)
    );

    const panelEmbed = embed.base({ color: 0x5865F2 })
      .setTitle('🎫 Support Tickets')
      .setDescription(
        'Need help? Click the button below to open a private support ticket.\n\n' +
        '• Please describe your issue clearly\n' +
        '• One ticket per issue\n' +
        '• Be patient — our team will respond shortly'
      );

    await channel.send({ embeds: [panelEmbed], components: [row] });
  }

  /**
   * Handle the "Open a Ticket" button.
   * @param {ButtonInteraction} interaction
   */
  static async handleOpen(interaction) {
    const { guild, user } = interaction;
    const config = await GuildConfig.get(guild.id);

    if (!config.modules?.tickets) {
      return interaction.reply({
        embeds: [embed.error('Tickets Disabled', 'The ticket system is not currently enabled.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const openTickets = await Ticket.listOpen(guild.id, 100);
    const userOpenTickets = openTickets.filter(ticket => ticket.userId === user.id);
    const maxOpenPerUser = config.tickets?.maxOpenPerUser ?? 1;

    if (userOpenTickets.length >= maxOpenPerUser) {
      const thread = guild.channels.cache.get(userOpenTickets[0].threadId);
      return interaction.reply({
        embeds: [embed.warn(
          'Ticket Already Open',
          `You already reached the limit of **${maxOpenPerUser}** open ticket(s).${thread ? ` Existing ticket: ${thread}.` : ''}`
        )],
        flags: MessageFlags.Ephemeral,
      });
    }

    const supportChannelId = config.tickets?.channelId;
    if (!supportChannelId) {
      return interaction.reply({
        embeds: [embed.error('Not Configured', 'No support channel configured. Please contact an admin.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const supportChannel = guild.channels.cache.get(supportChannelId);
    if (!supportChannel) {
      return interaction.reply({
        embeds: [embed.error('Channel Not Found', 'The support channel no longer exists.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      // Create a private thread
      const thread = await supportChannel.threads.create({
        name: `ticket-${user.username}`,
        type: ChannelType.PrivateThread,
        reason: `Support ticket for ${user.tag}`,
      });

      // Add the user to the thread
      await thread.members.add(user.id);

      // Add support role members if configured
      const supportRoleId = config.tickets?.supportRoleId;
      if (supportRoleId) {
        const role = guild.roles.cache.get(supportRoleId);
        if (role) {
          const members = role.members;
          for (const [, member] of members) {
            await thread.members.add(member.id).catch(() => {});
          }
        }
      }

      // Persist ticket
      const ticket = await Ticket.create({
        guildId:   guild.id,
        userId:    user.id,
        channelId: supportChannel.id,
        threadId:  thread.id,
        subject:   'Support Request',
      });

      // Send opening message in thread
      const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`ticket_close_${ticket.id}`)
          .setLabel('🔒 Close Ticket')
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`ticket_transcript_${ticket.id}`)
          .setLabel('📄 Save Transcript')
          .setStyle(ButtonStyle.Secondary)
      );

      const openEmbed = embed.base({ color: 0x5865F2 })
        .setTitle(`🎫 Ticket #${ticket.ticketNumber}`)
        .setDescription(
          `Welcome ${user}! Support staff will be with you shortly.\n\n` +
          '**Please describe your issue in detail below.**\n\n' +
          'Use the buttons below to close the ticket or export a transcript.'
        )
        .addFields(
          { name: '🆔 Ticket ID', value: `\`${ticket.id}\``, inline: true },
          { name: '👤 Opened By', value: user.toString(),     inline: true },
        );

      await thread.send({ embeds: [openEmbed], components: [closeRow] });

      await interaction.editReply({
        embeds: [embed.success('Ticket Opened', `Your ticket has been created: ${thread}`)],
      });

      logger.info(`Ticket #${ticket.ticketNumber} opened by ${user.tag} in ${guild.name}`);
    } catch (err) {
      logger.error('TicketService.handleOpen:', err);
      await interaction.editReply({
        embeds: [embed.error('Error', 'Failed to create your ticket. Please try again.')],
      });
    }
  }

  /**
   * Handle the "Close Ticket" button.
   * @param {ButtonInteraction} interaction
   * @param {string} ticketId
   */
  static async handleClose(interaction, ticketId) {
    const ticket = await Ticket.get(ticketId);
    if (!ticket || ticket.status === 'closed') {
      return interaction.reply({
        embeds: [embed.error('Not Found', 'Ticket not found or already closed.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Must be the ticket owner or have manage messages
    const isMod = interaction.member.permissions.has(PermissionFlagsBits.ManageMessages);
    if (ticket.userId !== interaction.user.id && !isMod) {
      return interaction.reply({
        embeds: [embed.error('Forbidden', 'Only the ticket creator or moderators can close this ticket.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      await Ticket.close(ticketId, interaction.user.id);

      const closedEmbed = embed.base({ color: 0x95a5a6 })
        .setTitle('🔒 Ticket Closed')
        .setDescription(
          `This ticket was closed by ${interaction.user}.\n\n` +
          'This thread will be locked and archived shortly.'
        );

      await interaction.channel.send({ embeds: [closedEmbed] });

      // Lock and archive the thread after a short delay
      setTimeout(async () => {
        try {
          await interaction.channel.setLocked(true,  'Ticket closed');
          await interaction.channel.setArchived(true, 'Ticket closed');
        } catch { /* may already be archived */ }
      }, 3_000);

      await interaction.editReply({
        embeds: [embed.success('Ticket Closed', 'The ticket has been closed and will be archived.')],
      });
    } catch (err) {
      logger.error('TicketService.handleClose:', err);
      await interaction.editReply({
        embeds: [embed.error('Error', 'Failed to close the ticket.')],
      });
    }
  }

  /**
   * Generate and send an HTML transcript of the ticket thread.
   * @param {ButtonInteraction} interaction
   * @param {string} ticketId
   */
  static async handleTranscript(interaction, ticketId) {
    const isMod = interaction.member.permissions.has(PermissionFlagsBits.ManageMessages);
    const ticket = await Ticket.get(ticketId);

    if (!ticket) {
      return interaction.reply({
        embeds: [embed.error('Not Found', 'Ticket not found.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (ticket.userId !== interaction.user.id && !isMod) {
      return interaction.reply({
        embeds: [embed.error('Forbidden', 'Only the ticket creator or moderators can export transcripts.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      const config = await GuildConfig.get(interaction.guild.id);

      if (config.tickets?.transcripts === false) {
        return interaction.reply({
          embeds: [embed.error('Disabled', 'Ticket transcripts are disabled for this server.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      const thread   = interaction.channel;
      const messages = await thread.messages.fetch({ limit: 100 });
      const sorted   = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

      const html = buildTranscriptHTML(ticket, sorted, interaction.guild.name);
      const buf  = Buffer.from(html, 'utf-8');
      const file = new AttachmentBuilder(buf, { name: `ticket-${ticket.ticketNumber}-transcript.html` });
      const logChannelId = config.tickets?.logChannelId;

      if (logChannelId) {
        const logChannel = interaction.guild.channels.cache.get(logChannelId);
        if (logChannel) {
          await logChannel.send({
            embeds: [embed.info('Ticket Transcript Exported', `Ticket #${ticket.ticketNumber} exported by ${interaction.user}.`)],
            files: [file],
          }).catch(() => {});
        }
      }

      await interaction.editReply({
        embeds: [embed.success('Transcript Ready', `Ticket #${ticket.ticketNumber} transcript exported.`)],
        files: [file],
      });
    } catch (err) {
      logger.error('TicketService.handleTranscript:', err);
      await interaction.editReply({
        embeds: [embed.error('Error', 'Failed to generate transcript.')],
      });
    }
  }
}

// ── HTML transcript builder ───────────────────────────────────────────────────
function buildTranscriptHTML(ticket, messages, guildName) {
  const rows = messages.map(m => {
    const time    = new Date(m.createdTimestamp).toISOString();
    const content = escapeHtml(m.content || '[no text content]');
    const avatarUrl = m.author.displayAvatarURL({ size: 32, format: 'png' });
    return `
    <div class="message">
      <img class="avatar" src="${avatarUrl}" alt="avatar" />
      <div class="content">
        <span class="author">${escapeHtml(m.author.username)}</span>
        <span class="time">${time}</span>
        <p>${content}</p>
        ${m.attachments.size ? `<em>[${m.attachments.size} attachment(s)]</em>` : ''}
      </div>
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Ticket #${ticket.ticketNumber} Transcript — ${escapeHtml(guildName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #313338; color: #dcddde; font-family: 'Segoe UI', sans-serif; padding: 24px; }
  h1   { color: #fff; margin-bottom: 8px; font-size: 1.4rem; }
  .meta { color: #72767d; font-size: 0.85rem; margin-bottom: 24px; }
  .message { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px solid #3f4147; }
  .avatar  { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; }
  .content .author { font-weight: 700; color: #fff; margin-right: 8px; }
  .content .time   { font-size: 0.75rem; color: #72767d; }
  .content p       { margin-top: 4px; white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>
  <h1>🎫 Ticket #${ticket.ticketNumber} — ${escapeHtml(guildName)}</h1>
  <p class="meta">Opened by: ${ticket.userId} | Status: ${ticket.status} | Exported: ${new Date().toISOString()}</p>
  <div id="messages">${rows}</div>
</body>
</html>`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = TicketService;
