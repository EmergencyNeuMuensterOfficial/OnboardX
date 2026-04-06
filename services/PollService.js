/**
 * services/PollService.js
 * Handles poll creation, button voting, real-time result updates, and closing.
 */

'use strict';

const { ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle, MessageFlags } = require('discord.js');
const Poll   = require('../models/Poll');
const embed  = require('../utils/embed');
const logger = require('../utils/logger');

class PollService {
  /**
   * Create a poll and send it to a channel.
   *
   * @param {object} opts
   * @param {TextChannel} opts.channel
   * @param {string}      opts.question
   * @param {string[]}    opts.options
   * @param {boolean}     opts.anonymous
   * @param {boolean}     opts.multiVote
   * @param {number}      opts.durationMs
   * @param {string}      opts.createdBy — User ID
   */
  static async create({ channel, question, options, anonymous, multiVote, durationMs, createdBy }) {
    const endsAt     = Date.now() + durationMs;
    const pollOptions = options.map(label => ({ label, votes: 0 }));

    // Build vote buttons (up to 5 per row, max 25)
    const rows    = [];
    let   current = new ActionRowBuilder();
    let   colIdx  = 0;

    for (let i = 0; i < options.length; i++) {
      if (colIdx === 5) {
        rows.push(current);
        current = new ActionRowBuilder();
        colIdx  = 0;
      }
      current.addComponents(
        new ButtonBuilder()
          .setCustomId(`poll_vote_${i}`)
          .setLabel(`${i + 1}. ${options[i].slice(0, 25)}`)
          .setStyle(ButtonStyle.Primary)
      );
      colIdx++;
    }
    rows.push(current);

    // Close button row
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('poll_close')
          .setLabel('🔒 Close Poll')
          .setStyle(ButtonStyle.Danger)
      )
    );

    const pollEmbed = embed.poll({ question, options: pollOptions, anonymous, endsAt, totalVotes: 0 });
    const msg       = await channel.send({ embeds: [pollEmbed], components: rows });

    const poll = await Poll.create({
      guildId:  channel.guild.id,
      channelId: channel.id,
      messageId: msg.id,
      question,
      options,
      anonymous,
      multiVote,
      endsAt,
      createdBy,
    });

    // Auto-close timer
    setTimeout(() => PollService.close(msg.client, poll.id), durationMs);

    return poll;
  }

  /**
   * Handle a vote button interaction.
   *
   * @param {ButtonInteraction} interaction
   * @param {number} optionIndex
   */
  static async handleVote(interaction, optionIndex) {
    const poll = await Poll.getByMessage(interaction.message.id);

    if (!poll || poll.ended) {
      return interaction.reply({
        embeds: [embed.error('Poll Closed', 'This poll is no longer accepting votes.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const result = await Poll.vote(poll.id, interaction.user.id, optionIndex);

    if (result.ended) {
      return interaction.reply({
        embeds: [embed.error('Poll Closed', 'This poll has ended.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (result.alreadyVoted) {
      return interaction.reply({
        embeds: [embed.warn('Already Voted', 'You have already voted on this option!')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!result.success) {
      return interaction.reply({
        embeds: [embed.error('Vote Failed', 'Something went wrong. Please try again.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Update the embed with new vote counts
    const updated    = await Poll.get(poll.id);
    const totalVotes = Poll.totalVotes(updated);
    const endsAt     = updated.endsAt?.toMillis ? updated.endsAt.toMillis() : updated.endsAt;

    const pollEmbed = embed.poll({
      question:   updated.question,
      options:    updated.options,
      anonymous:  updated.anonymous,
      endsAt,
      totalVotes,
    });

    await interaction.update({ embeds: [pollEmbed] });

    if (!poll.anonymous) {
      await interaction.followUp({
        embeds: [embed.success('Vote Recorded', `You voted for **${updated.options[optionIndex].label}**.`)],
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  /**
   * Close a poll and disable all buttons.
   *
   * @param {Client} client
   * @param {string} pollId
   */
  static async close(client, pollId) {
    const poll = await Poll.get(pollId);
    if (!poll || poll.ended) return;

    await Poll.end(pollId);

    try {
      const channel = await client.channels.fetch(poll.channelId).catch(() => null);
      if (!channel) return;

      const msg = await channel.messages.fetch(poll.messageId).catch(() => null);
      if (!msg) return;

      const totalVotes = Poll.totalVotes(poll);
      const endsAt     = poll.endsAt?.toMillis ? poll.endsAt.toMillis() : poll.endsAt;

      const finalEmbed = embed.poll({
        question:   poll.question,
        options:    poll.options,
        anonymous:  poll.anonymous,
        endsAt,
        totalVotes,
      }).setTitle(`📊 [CLOSED] ${poll.question}`).setColor(0x95a5a6);

      // Disable all buttons
      const disabledRows = msg.components.map(row => {
        const newRow = new ActionRowBuilder();
        newRow.addComponents(
          row.components.map(btn =>
            ButtonBuilder.from(btn).setDisabled(true)
          )
        );
        return newRow;
      });

      await msg.edit({ embeds: [finalEmbed], components: disabledRows });
    } catch (err) {
      logger.error('PollService.close:', err);
    }
  }
}

module.exports = PollService;
