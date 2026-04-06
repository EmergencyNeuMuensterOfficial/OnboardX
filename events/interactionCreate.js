/**
 * events/interactionCreate.js
 * Central router for ALL Discord interactions:
 *   - Slash commands (ChatInputCommandInteraction)
 *   - Button clicks   (ButtonInteraction)
 *   - Modal submits   (ModalSubmitInteraction)
 *   - Autocomplete    (AutocompleteInteraction)
 */

'use strict';

const { InteractionType, MessageFlags } = require('discord.js');
const GuildConfig         = require('../models/GuildConfig');
const cooldown            = require('../utils/cooldown');
const embed               = require('../utils/embed');
const logger              = require('../utils/logger');
const { isOwner }         = require('../utils/permissions');

// Service routers
const GiveawayService      = require('../services/GiveawayService');
const VerificationService  = require('../services/VerificationService');
const PollService          = require('../services/PollService');
const TicketService        = require('../services/TicketService');
const ReactionRoleService  = require('../services/ReactionRoleService');

module.exports = {
  name: 'interactionCreate',

  async execute(interaction, client) {
    try {
      // ── Slash Commands ──────────────────────────────────────────────────
      if (interaction.isChatInputCommand()) {
        await handleSlash(interaction, client);
        return;
      }

      // ── Button Interactions ─────────────────────────────────────────────
      if (interaction.isButton()) {
        await handleButton(interaction, client);
        return;
      }

      // ── Modal Submits ───────────────────────────────────────────────────
      if (interaction.isModalSubmit()) {
        await handleModal(interaction, client);
        return;
      }

      // ── Autocomplete ────────────────────────────────────────────────────
      if (interaction.isAutocomplete()) {
        await handleAutocomplete(interaction, client);
      }
    } catch (err) {
      logger.error('interactionCreate error:', err);
      const reply = { embeds: [embed.error('Internal Error', 'Something went wrong. Please try again.')], flags: MessageFlags.Ephemeral };
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply);
        } else {
          await interaction.reply(reply);
        }
      } catch { /* Interaction may have expired */ }
    }
  },
};

// ── Handler: Slash Commands ───────────────────────────────────────────────────
async function handleSlash(interaction, client) {
  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  // Fetch guild config (for premium status etc.)
  const config = interaction.guild
    ? await GuildConfig.get(interaction.guild.id)
    : null;

  const isPremium = config?.premium ?? false;

  // Cooldown check (owners bypass)
  if (!isOwner(interaction.user.id)) {
    const remaining = cooldown.check(
      command.data.name,
      interaction.user.id,
      command.cooldown,
      isPremium
    );
    if (remaining) {
      const secs = (remaining / 1_000).toFixed(1);
      return interaction.reply({
        embeds: [embed.warn('Slow Down!', `You can use this command again in **${secs}s**.`)],
        flags: MessageFlags.Ephemeral,
      });
    }
    cooldown.set(command.data.name, interaction.user.id, command.cooldown, isPremium);
  }

  // Premium gate
  if (command.premium && !isPremium) {
    return interaction.reply({
      embeds: [embed.premiumRequired(command.data.name)],
      flags: MessageFlags.Ephemeral,
    });
  }

  await command.execute(interaction, client, config);
}

// ── Handler: Buttons ──────────────────────────────────────────────────────────
async function handleButton(interaction, client) {
  const { customId } = interaction;

  if (customId === 'giveaway_enter') {
    return GiveawayService.handleEntry(interaction);
  }

  if (customId === 'verify_start') {
    return VerificationService.handleStart(interaction);
  }

  if (customId === 'poll_close') {
    // Only the poll creator or mods can close
    const poll = await require('../models/Poll').getByMessage(interaction.message.id);
    if (!poll) return interaction.reply({ embeds: [embed.error('Not Found', 'Poll not found.')], flags: MessageFlags.Ephemeral });
    if (poll.createdBy !== interaction.user.id && !interaction.member.permissions.has(8n)) {
      return interaction.reply({ embeds: [embed.error('Forbidden', 'Only the poll creator or admins can close this poll.')], flags: MessageFlags.Ephemeral });
    }
    return PollService.close(client, poll.id);
  }

  if (customId.startsWith('poll_vote_')) {
    const index = parseInt(customId.split('_')[2], 10);
    return PollService.handleVote(interaction, index);
  }

  // ── Ticket buttons ─────────────────────────────────────────────────────────
  if (customId === 'ticket_open') {
    return TicketService.handleOpen(interaction);
  }

  if (customId.startsWith('ticket_close_')) {
    const ticketId = customId.replace('ticket_close_', '');
    return TicketService.handleClose(interaction, ticketId);
  }

  if (customId.startsWith('ticket_transcript_')) {
    const ticketId = customId.replace('ticket_transcript_', '');
    return TicketService.handleTranscript(interaction, ticketId);
  }

  // ── Reaction-role toggle buttons ───────────────────────────────────────────
  if (customId.startsWith('rr_toggle_')) {
    const roleId = customId.replace('rr_toggle_', '');
    return ReactionRoleService.handleToggle(interaction, roleId);
  }
}

// ── Handler: Modals ───────────────────────────────────────────────────────────
async function handleModal(interaction, client) {
  const { customId } = interaction;

  if (customId === 'verify_modal') {
    return VerificationService.handleModal(interaction);
  }
}

// ── Handler: Autocomplete ─────────────────────────────────────────────────────
async function handleAutocomplete(interaction, client) {
  const command = client.commands.get(interaction.commandName);
  if (typeof command?.autocomplete === 'function') {
    await command.autocomplete(interaction, client);
  }
}
