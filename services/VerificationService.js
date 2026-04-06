/**
 * services/VerificationService.js
 * Button-based CAPTCHA verification system.
 * Sends a DM challenge and assigns a role on success.
 */

'use strict';

const { ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  ChannelType, MessageFlags } = require('discord.js');
const { Collection } = require('discord.js');
const GuildConfig    = require('../models/GuildConfig');
const captcha        = require('../utils/captcha');
const embed          = require('../utils/embed');
const logger         = require('../utils/logger');

/** @type {Collection<string, {answer, attempts, guildId, roleId, timeoutId}>} */
const pending = new Collection();

class VerificationService {
  /**
   * Send the initial verification panel to the configured channel.
   * Called from the /verification setup command.
   *
   * @param {TextChannel} channel
   * @param {string}      roleId
   */
  static async sendPanel(channel, roleId) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('verify_start')
        .setLabel('✅ Verify Me')
        .setStyle(ButtonStyle.Success)
    );

    const panelEmbed = embed.base({ color: 0x57F287 })
      .setTitle('🔐 Verification Required')
      .setDescription(
        'To access this server you must complete a quick verification.\n\n' +
        '**Click the button below to begin.**\n' +
        '⏱️ You will have 2 minutes to complete the challenge.'
      );

    await channel.send({ embeds: [panelEmbed], components: [row] });
  }

  /**
   * Handle the "Verify Me" button press.
   * Sends a DM with a CAPTCHA challenge.
   *
   * @param {ButtonInteraction} interaction
   */
  static async handleStart(interaction) {
    const { guild, user } = interaction;
    const config          = await GuildConfig.get(guild.id);

    if (!config.modules?.verification) {
      return interaction.reply({
        embeds: [embed.error('Verification Disabled', 'Verification is not currently active.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Already verified?
    const roleId = config.verification?.roleId;
    if (roleId && interaction.member.roles.cache.has(roleId)) {
      return interaction.reply({
        embeds: [embed.info('Already Verified', 'You are already verified in this server!')],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Already in pending
    if (pending.has(`${guild.id}:${user.id}`)) {
      return interaction.reply({
        embeds: [embed.warn('Pending', 'You already have an active verification challenge. Check your DMs!')],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Generate CAPTCHA
    const type   = config.verification?.type ?? 'math';
    const result = type === 'image'
      ? await captcha.imageCaptcha()
      : captcha.mathCaptcha();

    const timeoutSecs = config.verification?.timeout ?? 120;
    const maxAttempts = config.verification?.maxAttempts ?? 3;

    // Open a modal for the answer
    const modal = new ModalBuilder()
      .setCustomId('verify_modal')
      .setTitle('🔐 Verification Challenge');

    const challengeInput = new TextInputBuilder()
      .setCustomId('verify_answer')
      .setLabel(result.question)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter your answer here')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(challengeInput));

    // Attach image if image-based captcha
    const components = result.attachment
      ? [result.attachment]
      : [];

    if (components.length) {
      await interaction.reply({ files: components, flags: MessageFlags.Ephemeral });
      // Can't show modal after file reply — fallback to DM approach
      return VerificationService._dmChallenge(interaction, result, guild, roleId, timeoutSecs, maxAttempts);
    }

    // Store pending state BEFORE modal so timeout starts
    const timeoutId = setTimeout(
      () => VerificationService._onTimeout(guild, user),
      timeoutSecs * 1_000
    );
    pending.set(`${guild.id}:${user.id}`, {
      answer:   result.answer,
      attempts: 0,
      maxAttempts,
      guildId:  guild.id,
      roleId,
      timeoutId,
    });

    await interaction.showModal(modal);
  }

  /**
   * Handle modal submission.
   *
   * @param {ModalSubmitInteraction} interaction
   */
  static async handleModal(interaction) {
    const { guild, user } = interaction;
    const key             = `${guild.id}:${user.id}`;
    const state           = pending.get(key);

    if (!state) {
      return interaction.reply({
        embeds: [embed.error('Session Expired', 'Your verification session has expired. Please try again.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const input = interaction.fields.getTextInputValue('verify_answer').trim();
    state.attempts++;

    const correct = input.toLowerCase() === state.answer.toLowerCase();

    if (correct) {
      await VerificationService._onSuccess(interaction, guild, user, state);
    } else if (state.attempts >= state.maxAttempts) {
      await VerificationService._onFailed(interaction, guild, user, state);
    } else {
      const remaining = state.maxAttempts - state.attempts;
      await interaction.reply({
        embeds: [embed.warn(
          '❌ Wrong Answer',
          `That's incorrect. You have **${remaining}** attempt${remaining !== 1 ? 's' : ''} remaining.`
        )],
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  static async _onSuccess(interaction, guild, user, state) {
    clearTimeout(state.timeoutId);
    pending.delete(`${guild.id}:${user.id}`);

    try {
      if (state.roleId) {
        const member = await guild.members.fetch(user.id);
        const role   = guild.roles.cache.get(state.roleId);
        if (role && member) await member.roles.add(role, 'Verified via captcha');
      }
    } catch (err) {
      logger.warn(`Verification role assign failed: ${err.message}`);
    }

    await interaction.reply({
      embeds: [embed.success('✅ Verified!', `Welcome to **${guild.name}**! You now have access to the server.`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  static async _onFailed(interaction, guild, user, state) {
    clearTimeout(state.timeoutId);
    pending.delete(`${guild.id}:${user.id}`);

    await interaction.reply({
      embeds: [embed.error(
        '❌ Verification Failed',
        `You have used all ${state.maxAttempts} attempts.\n` +
        'You may be temporarily removed. Please contact a moderator to appeal.'
      )],
      flags: MessageFlags.Ephemeral,
    });

    // Optionally kick member
    try {
      const member = await guild.members.fetch(user.id);
      await member.kick('Failed verification captcha');
    } catch { /* May not have permission or member already left */ }
  }

  static async _onTimeout(guild, user) {
    const key   = `${guild.id}:${user.id}`;
    const state = pending.get(key);
    if (!state) return;
    pending.delete(key);

    try {
      const member = await guild.members.fetch(user.id).catch(() => null);
      if (member) {
        await user.send({
          embeds: [embed.error('⏱️ Verification Timed Out', 'Your verification session expired. Please rejoin or click the verify button again.')],
        }).catch(() => {});
      }
    } catch { /* ignore */ }
  }

  // DM fallback for image captchas
  static async _dmChallenge(interaction, result, guild, roleId, timeoutSecs, maxAttempts) {
    try {
      const dm = await interaction.user.createDM();
      await dm.send({
        embeds: [embed.info('🔐 Verification', `Solve this challenge: **${result.question}**`)],
        files:  result.attachment ? [result.attachment] : [],
      });
    } catch {
      await interaction.followUp({
        embeds: [embed.warn('DMs Disabled', 'Please enable DMs from server members to receive your verification challenge.')],
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

module.exports = VerificationService;
