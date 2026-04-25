/**
 * services/GiveawayService.js
 * Manages the full lifecycle of giveaways: creation, entry, ending,
 * rerolling, and persistence across bot restarts.
 */

'use strict';

const { ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits, MessageFlags } = require('discord.js');
const Giveaway = require('../models/Giveaway');
const embed    = require('../utils/embed');
const time     = require('../utils/time');
const logger   = require('../utils/logger');

class GiveawayService {
  /**
   * Start a new giveaway in a channel.
   *
   * @param {Client} client
   * @param {object} opts
   * @param {TextChannel} opts.channel
   * @param {string}      opts.prize
   * @param {number}      opts.durationMs
   * @param {number}      opts.winners
   * @param {string}      opts.hostedBy  — User ID
   */
  static async start(client, { channel, prize, durationMs, winners, hostedBy }) {
    const endsAt = Date.now() + durationMs;

    // Build initial embed + button
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('giveaway_enter')
        .setLabel('🎉 Enter Giveaway')
        .setStyle(ButtonStyle.Primary)
    );

    const giveEmbed = embed.giveaway({
      prize, winners, endsAt, hostedBy, entries: 0, ended: false,
    });

    const msg = await channel.send({ embeds: [giveEmbed], components: [row] });

    // Persist to Firestore
    const giveaway = await Giveaway.create({
      guildId:   channel.guild.id,
      channelId: channel.id,
      messageId: msg.id,
      prize,
      winners,
      hostedBy,
      endsAt,
    });

    await msg.edit({
      embeds: [embed.giveaway({
        prize,
        winners,
        endsAt,
        hostedBy,
        entries: 0,
        ended: false,
        giveawayId: giveaway.id,
      })],
      components: [row],
    });

    // Schedule end timer
    GiveawayService._schedule(client, giveaway, durationMs);

    logger.info(`Giveaway started: ${giveaway.id} in guild ${channel.guild.id}`);
    return giveaway;
  }

  /**
   * Handle a giveaway button interaction (entry).
   *
   * @param {ButtonInteraction} interaction
   */
  static async handleEntry(interaction) {
    const giveaway = await Giveaway.getByMessage(interaction.message.id);

    if (!giveaway || giveaway.ended) {
      return interaction.reply({
        embeds: [embed.error('Giveaway Ended', 'This giveaway has already ended.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const added = await Giveaway.addEntry(giveaway.id, interaction.user.id);

    if (!added) {
      return interaction.reply({
        embeds: [embed.warn('Already Entered', 'You have already entered this giveaway!')],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Update the embed to show new entry count
    const updated = await Giveaway.get(giveaway.id);
    const giveEmbed = embed.giveaway({
      prize:    updated.prize,
      winners:  updated.winners,
      endsAt:   updated.endsAt.toMillis ? updated.endsAt.toMillis() : updated.endsAt,
      hostedBy: updated.hostedBy,
      entries:  updated.entries.length,
      ended:    false,
      giveawayId: updated.id,
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('giveaway_enter')
        .setLabel(`🎉 Enter Giveaway (${updated.entries.length})`)
        .setStyle(ButtonStyle.Primary)
    );

    await interaction.update({ embeds: [giveEmbed], components: [row] });
  }

  /**
   * End a giveaway by its Firestore ID or messageId.
   *
   * @param {Client} client
   * @param {string} id    — Firestore document ID
   * @param {boolean} [silent]
   */
  static async end(client, id, silent = false) {
    const giveaway = await Giveaway.get(id);
    if (!giveaway || giveaway.ended) return;

    // Clear the in-memory timer if present
    const timer = client.giveaways.get(id);
    if (timer) { clearTimeout(timer); client.giveaways.delete(id); }

    const winnerIds = Giveaway.pickWinners(giveaway.entries, giveaway.winners);
    await Giveaway.end(id, winnerIds);

    if (silent) return;

    try {
      const channel = await client.channels.fetch(giveaway.channelId).catch(() => null);
      if (!channel) return;

      const endsAt  = giveaway.endsAt?.toMillis ? giveaway.endsAt.toMillis() : giveaway.endsAt;
      const giveEmbed = embed.giveaway({
        prize:    giveaway.prize,
        winners:  giveaway.winners,
        endsAt,
        hostedBy: giveaway.hostedBy,
        entries:  giveaway.entries.length,
        ended:    true,
        giveawayId: giveaway.id,
      });

      // Disable enter button
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('giveaway_enter')
          .setLabel('🎉 Giveaway Ended')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true)
      );

      // Edit original message
      try {
        const msg = await channel.messages.fetch(giveaway.messageId);
        await msg.edit({ embeds: [giveEmbed], components: [row] });
      } catch { /* message may have been deleted */ }

      // Announce winners
      const winMentions = winnerIds.length
        ? winnerIds.map(id => `<@${id}>`).join(', ')
        : 'No valid entries.';

      const winEmbed = embed.success(
        '🎉 Giveaway Winners!',
        `**Prize:** ${giveaway.prize}\n**ID:** \`${giveaway.id}\`\n**Winner(s):** ${winMentions}`
      );
      await channel.send({ embeds: [winEmbed] });
    } catch (err) {
      logger.error('GiveawayService.end announcement:', err);
    }
  }

  /**
   * Reroll a giveaway — pick new winners excluding the original ones.
   */
  static async reroll(client, id, count = 1) {
    const giveaway = await Giveaway.get(id);
    if (!giveaway?.ended) return null;

    const exclude   = giveaway.winnerIds ?? [];
    const newWinners = Giveaway.pickWinners(giveaway.entries, count, exclude);
    await Giveaway.update(id, { winnerIds: [...exclude, ...newWinners] });
    return newWinners;
  }

  /**
   * On bot restart, re-schedule all active giveaway timers.
   */
  static async restoreGiveaways(client) {
    const active = await Giveaway.getActive();
    let restored = 0;

    for (const giveaway of active) {
      const endsAt   = giveaway.endsAt?.toMillis ? giveaway.endsAt.toMillis() : giveaway.endsAt;
      const remaining = endsAt - Date.now();

      if (remaining <= 0) {
        // Already overdue — end immediately
        await GiveawayService.end(client, giveaway.id);
      } else {
        GiveawayService._schedule(client, giveaway, remaining);
        restored++;
      }
    }

    if (active.length) logger.info(`Restored ${restored}/${active.length} giveaway timers.`);
  }

  // ── Private ───────────────────────────────────────────────────────────────
  static _schedule(client, giveaway, durationMs) {
    const timer = setTimeout(() => GiveawayService.end(client, giveaway.id), durationMs);
    timer.unref?.(); // Don't prevent Node from exiting
    client.giveaways.set(giveaway.id, timer);
  }
}

module.exports = GiveawayService;
