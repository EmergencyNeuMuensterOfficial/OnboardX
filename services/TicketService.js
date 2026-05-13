'use strict';

const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const Ticket = require('../models/Ticket');
const GuildConfig = require('../models/GuildConfig');
const embed = require('../utils/embed');
const logger = require('../utils/logger');
const { hasAdvancedPermission } = require('../utils/permissions');
const IntegrationService = require('./IntegrationService');

class TicketService {
  static async sendPanel(channel) {
    const config = await GuildConfig.get(channel.guild.id);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_open')
        .setLabel(config.tickets?.buttonLabel || 'Open a Ticket')
        .setStyle(ButtonStyle.Primary)
    );

    const panelEmbed = embed.base({ color: 0x5865F2 })
      .setTitle(config.tickets?.panelTitle || 'Support Tickets')
      .setDescription(config.tickets?.panelDescription || [
        'Need help? Click the button below to open a private support ticket.',
        '',
        '- Please describe your issue clearly',
        '- One ticket per issue',
        '- Be patient while the team responds.',
      ].join('\n'));

    await channel.send({ embeds: [panelEmbed], components: [row] });
  }

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
      const thread = await supportChannel.threads.create({
        name: `ticket-${user.username}`,
        type: ChannelType.PrivateThread,
        reason: `Support ticket for ${user.tag}`,
      });

      await thread.members.add(user.id);

      const supportRoleId = config.tickets?.supportRoleId;
      if (supportRoleId) {
        const role = guild.roles.cache.get(supportRoleId);
        if (role) {
          for (const [, member] of role.members) {
            await thread.members.add(member.id).catch(() => {});
          }
        }
      }

      const ticket = await Ticket.create({
        guildId: guild.id,
        userId: user.id,
        channelId: supportChannel.id,
        threadId: thread.id,
        subject: 'Support Request',
        category: config.tickets?.defaultCategory || 'General',
        priority: config.tickets?.defaultPriority || 'normal',
      });

      const row = new ActionRowBuilder().addComponents(ticketButtons(ticket.id, config));
      const openEmbed = embed.base({ color: 0x5865F2 })
        .setTitle(`Ticket #${ticket.ticketNumber}`)
        .setDescription([
          `Welcome ${user}! Support staff will be with you shortly.`,
          '',
          '**Please describe your issue in detail below.**',
          '',
          'Use the buttons below to manage this ticket.',
        ].join('\n'))
        .addFields(
          { name: 'Ticket ID', value: `\`${ticket.id}\``, inline: true },
          { name: 'Opened By', value: user.toString(), inline: true },
          { name: 'Category', value: ticket.category, inline: true },
          { name: 'Priority', value: ticket.priority, inline: true }
        );

      await thread.send({ embeds: [openEmbed], components: [row] });
      await interaction.editReply({
        embeds: [embed.success('Ticket Opened', `Your ticket has been created: ${thread}`)],
      });

      await IntegrationService.emit(guild, 'ticket.opened', {
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        userId: user.id,
        threadId: thread.id,
        category: ticket.category,
        priority: ticket.priority,
      });

      logger.info(`Ticket #${ticket.ticketNumber} opened by ${user.tag} in ${guild.name}`);
    } catch (err) {
      logger.error('TicketService.handleOpen:', err);
      await interaction.editReply({
        embeds: [embed.error('Error', 'Failed to create your ticket. Please try again.')],
      });
    }
  }

  static async handleClose(interaction, ticketId) {
    const ticket = await Ticket.get(ticketId);
    if (!ticket || ticket.status === 'closed') {
      return interaction.reply({
        embeds: [embed.error('Not Found', 'Ticket not found or already closed.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const isMod = await canManageTickets(interaction);
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
        .setTitle('Ticket Closed')
        .setDescription(`This ticket was closed by ${interaction.user}.\n\nThis thread will be locked and archived shortly.`);

      await interaction.channel.send({ embeds: [closedEmbed] });

      const config = await GuildConfig.get(interaction.guild.id);
      const delaySeconds = Math.max(1, Number(config.tickets?.closeDelaySeconds || 3));
      setTimeout(async () => {
        try {
          await interaction.channel.setLocked(true, 'Ticket closed');
          await interaction.channel.setArchived(true, 'Ticket closed');
        } catch {
          // The thread may already be archived or unavailable.
        }
      }, delaySeconds * 1000);

      await interaction.editReply({
        embeds: [embed.success('Ticket Closed', 'The ticket has been closed and will be archived.')],
      });

      await IntegrationService.emit(interaction.guild, 'ticket.closed', {
        ticketId,
        ticketNumber: ticket.ticketNumber,
        closedBy: interaction.user.id,
        threadId: ticket.threadId,
      });
    } catch (err) {
      logger.error('TicketService.handleClose:', err);
      await interaction.editReply({
        embeds: [embed.error('Error', 'Failed to close the ticket.')],
      });
    }
  }

  static async handleTranscript(interaction, ticketId) {
    const ticket = await Ticket.get(ticketId);
    if (!ticket) {
      return interaction.reply({
        embeds: [embed.error('Not Found', 'Ticket not found.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const isMod = await canManageTickets(interaction);
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

      const thread = interaction.channel;
      const messages = await thread.messages.fetch({ limit: 100 });
      const sorted = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

      const html = buildTranscriptHTML(ticket, sorted, interaction.guild.name);
      const file = new AttachmentBuilder(Buffer.from(html, 'utf-8'), { name: `ticket-${ticket.ticketNumber}-transcript.html` });
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

  static async handleClaim(interaction, ticketId) {
    const ticket = await Ticket.get(ticketId);
    if (!ticket || ticket.status === 'closed') {
      return interaction.reply({
        embeds: [embed.error('Not Found', 'Ticket not found or already closed.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!(await canManageTickets(interaction))) {
      return interaction.reply({
        embeds: [embed.error('Forbidden', 'Only ticket staff can claim tickets.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const next = await Ticket.claim(ticketId, interaction.user.id);
    return interaction.reply({
      embeds: [embed.success('Ticket Claimed', `Ticket #${next.ticketNumber} was claimed by ${interaction.user}.`)],
    });
  }

  static async handlePriority(interaction, ticketId) {
    const ticket = await Ticket.get(ticketId);
    if (!ticket || ticket.status === 'closed') {
      return interaction.reply({
        embeds: [embed.error('Not Found', 'Ticket not found or already closed.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!(await canManageTickets(interaction))) {
      return interaction.reply({
        embeds: [embed.error('Forbidden', 'Only ticket staff can change priority.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const priorities = ['normal', 'high', 'urgent'];
    const nextPriority = priorities[(priorities.indexOf(ticket.priority) + 1) % priorities.length] || 'normal';
    const next = await Ticket.setPriority(ticketId, nextPriority);

    return interaction.reply({
      embeds: [embed.info('Ticket Priority Updated', `Ticket #${next.ticketNumber} is now **${next.priority}**.`)],
    });
  }
}

function ticketButtons(ticketId, config) {
  const buttons = [
    new ButtonBuilder()
      .setCustomId(`ticket_close_${ticketId}`)
      .setLabel('Close Ticket')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`ticket_transcript_${ticketId}`)
      .setLabel('Save Transcript')
      .setStyle(ButtonStyle.Secondary),
  ];

  if (config.tickets?.claimEnabled !== false) {
    buttons.push(new ButtonBuilder()
      .setCustomId(`ticket_claim_${ticketId}`)
      .setLabel('Claim')
      .setStyle(ButtonStyle.Success));
  }

  if (config.tickets?.priorityEnabled !== false) {
    buttons.push(new ButtonBuilder()
      .setCustomId(`ticket_priority_${ticketId}`)
      .setLabel('Priority')
      .setStyle(ButtonStyle.Primary));
  }

  return buttons;
}

async function canManageTickets(interaction) {
  if (interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;

  const config = await GuildConfig.get(interaction.guild.id);
  const supportRoleIds = [
    config.tickets?.supportRoleId,
    ...(Array.isArray(config.tickets?.supportRoles) ? config.tickets.supportRoles : []),
  ].filter(Boolean);
  const memberRoles = interaction.member.roles?.cache;

  if (supportRoleIds.some((roleId) => memberRoles?.has(roleId))) return true;
  return hasAdvancedPermission(interaction, 'tickets');
}

function buildTranscriptHTML(ticket, messages, guildName) {
  const rows = messages.map((message) => {
    const time = new Date(message.createdTimestamp).toISOString();
    const content = escapeHtml(message.content || '[no text content]');
    const avatarUrl = message.author.displayAvatarURL({ size: 32, format: 'png' });
    return `
    <div class="message">
      <img class="avatar" src="${avatarUrl}" alt="avatar" />
      <div class="content">
        <span class="author">${escapeHtml(message.author.username)}</span>
        <span class="time">${time}</span>
        <p>${content}</p>
        ${message.attachments.size ? `<em>[${message.attachments.size} attachment(s)]</em>` : ''}
      </div>
    </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Ticket #${ticket.ticketNumber} Transcript - ${escapeHtml(guildName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #313338; color: #dcddde; font-family: 'Segoe UI', sans-serif; padding: 24px; }
  h1 { color: #fff; margin-bottom: 8px; font-size: 1.4rem; }
  .meta { color: #72767d; font-size: 0.85rem; margin-bottom: 24px; }
  .message { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px solid #3f4147; }
  .avatar { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; }
  .content .author { font-weight: 700; color: #fff; margin-right: 8px; }
  .content .time { font-size: 0.75rem; color: #72767d; }
  .content p { margin-top: 4px; white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>
  <h1>Ticket #${ticket.ticketNumber} - ${escapeHtml(guildName)}</h1>
  <p class="meta">Opened by: ${ticket.userId} | Status: ${ticket.status} | Category: ${escapeHtml(ticket.category)} | Priority: ${escapeHtml(ticket.priority)} | Exported: ${new Date().toISOString()}</p>
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
