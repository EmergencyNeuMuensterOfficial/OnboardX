/**
 * services/VerificationService.js
 * Button-based CAPTCHA verification system with DM fallback support.
 */

'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  Collection,
} = require('discord.js');

const GuildConfig = require('../models/GuildConfig');
const captcha = require('../utils/captcha');
const embed = require('../utils/embed');
const logger = require('../utils/logger');

/** @type {Collection<string, {answer:string, attempts:number, maxAttempts:number, guildId:string, roleId:string|null, timeoutId:NodeJS.Timeout, viaDm:boolean, createdAt:number}>} */
const pending = new Collection();

class VerificationService {
  static async sendPanel(channel) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('verify_start')
        .setLabel('Verify Me')
        .setStyle(ButtonStyle.Success)
    );

    const panelEmbed = embed.base({ color: 0x57F287 })
      .setTitle('Verification Required')
      .setDescription(
        'To access this server you must complete a quick verification.\n\n' +
        'Click the button below to begin.\n' +
        'You will have 2 minutes to complete the challenge.'
      );

    await channel.send({ embeds: [panelEmbed], components: [row] });
  }

  static async handleStart(interaction) {
    const { guild, user } = interaction;
    const config = await GuildConfig.get(guild.id);

    if (!config.modules?.verification) {
      return interaction.reply({
        embeds: [embed.error('Verification Disabled', 'Verification is not currently active.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const roleId = config.verification?.roleId;
    if (roleId && interaction.member.roles.cache.has(roleId)) {
      return interaction.reply({
        embeds: [embed.info('Already Verified', 'You are already verified in this server.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (pending.has(this._key(guild.id, user.id))) {
      return interaction.reply({
        embeds: [embed.warn('Pending', 'You already have an active verification challenge. Check your DMs.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const type = config.verification?.type ?? 'math';
    const result = type === 'image' ? await captcha.imageCaptcha() : captcha.mathCaptcha();
    const timeoutSecs = config.verification?.timeout ?? 120;
    const maxAttempts = config.verification?.maxAttempts ?? 3;

    if (result.attachment) {
      await interaction.reply({ files: [result.attachment], flags: MessageFlags.Ephemeral });
      return this._dmChallenge(interaction, result, guild, roleId, timeoutSecs, maxAttempts);
    }

    this._setPendingState(guild.id, user.id, {
      answer: String(result.answer),
      attempts: 0,
      maxAttempts,
      guildId: guild.id,
      roleId: roleId ?? null,
      viaDm: false,
    }, timeoutSecs, guild, user);

    const modal = new ModalBuilder()
      .setCustomId('verify_modal')
      .setTitle('Verification Challenge');

    const challengeInput = new TextInputBuilder()
      .setCustomId('verify_answer')
      .setLabel(result.question)
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Enter your answer here')
      .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(challengeInput));
    await interaction.showModal(modal);
  }

  static async handleModal(interaction) {
    const { guild, user } = interaction;
    const state = pending.get(this._key(guild.id, user.id));

    if (!state) {
      return interaction.reply({
        embeds: [embed.error('Session Expired', 'Your verification session has expired. Please try again.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const input = interaction.fields.getTextInputValue('verify_answer').trim();
    await this._handleAnswer(interaction, guild, user, state, input);
  }

  static async handleDmAnswer(message) {
    if (!message.channel?.isDMBased?.() || message.author.bot) return false;

    const match = this._findPendingForUser(message.author.id, true);
    if (!match) return false;

    const { state } = match;
    const guild = message.client.guilds.cache.get(state.guildId)
      ?? await message.client.guilds.fetch(state.guildId).catch(() => null);

    if (!guild) {
      this._clearPending(state.guildId, message.author.id);
      await message.reply({ embeds: [embed.error('Session Expired', 'The server for this verification session is no longer available.')] }).catch(() => {});
      return true;
    }

    await this._handleAnswer(message, guild, message.author, state, message.content.trim());
    return true;
  }

  static async _handleAnswer(target, guild, user, state, input) {
    state.attempts += 1;

    const correct = input.toLowerCase() === String(state.answer).toLowerCase();
    if (correct) {
      await this._onSuccess(target, guild, user, state);
      return;
    }

    if (state.attempts >= state.maxAttempts) {
      await this._onFailed(target, guild, user, state);
      return;
    }

    const remaining = state.maxAttempts - state.attempts;
    await this._reply(target,
      {
        embeds: [embed.warn('Wrong Answer', `That is incorrect. You have **${remaining}** attempt${remaining !== 1 ? 's' : ''} remaining.`)],
        flags: MessageFlags.Ephemeral,
      },
      {
        embeds: [embed.warn('Wrong Answer', `That is incorrect. You have **${remaining}** attempt${remaining !== 1 ? 's' : ''} remaining.`)],
      }
    );
  }

  static async _onSuccess(target, guild, user, state) {
    this._clearPending(guild.id, user.id);

    try {
      if (state.roleId) {
        const member = await guild.members.fetch(user.id);
        const role = guild.roles.cache.get(state.roleId);
        if (role && member) await member.roles.add(role, 'Verified via captcha');
      }
    } catch (err) {
      logger.warn(`Verification role assign failed: ${err.message}`);
    }

    await this._reply(target,
      {
        embeds: [embed.success('Verified!', `Welcome to **${guild.name}**! You now have access to the server.`)],
        flags: MessageFlags.Ephemeral,
      },
      {
        embeds: [embed.success('Verified!', `Welcome to **${guild.name}**! You now have access to the server.`)],
      }
    );
  }

  static async _onFailed(target, guild, user, state) {
    this._clearPending(guild.id, user.id);

    await this._reply(target,
      {
        embeds: [embed.error('Verification Failed', `You have used all ${state.maxAttempts} attempts.\nYou may be temporarily removed. Please contact a moderator to appeal.`)],
        flags: MessageFlags.Ephemeral,
      },
      {
        embeds: [embed.error('Verification Failed', `You have used all ${state.maxAttempts} attempts.\nYou may be temporarily removed. Please contact a moderator to appeal.`)],
      }
    );

    try {
      const member = await guild.members.fetch(user.id);
      await member.kick('Failed verification captcha');
    } catch {
      // ignore
    }
  }

  static async _onTimeout(guild, user) {
    const state = pending.get(this._key(guild.id, user.id));
    if (!state) return;

    this._clearPending(guild.id, user.id);
    await user.send({
      embeds: [embed.error('Verification Timed Out', 'Your verification session expired. Please rejoin or click the verify button again.')],
    }).catch(() => {});
  }

  static async _dmChallenge(interaction, result, guild, roleId, timeoutSecs, maxAttempts) {
    this._setPendingState(guild.id, interaction.user.id, {
      answer: String(result.answer),
      attempts: 0,
      maxAttempts,
      guildId: guild.id,
      roleId: roleId ?? null,
      viaDm: true,
    }, timeoutSecs, guild, interaction.user);

    try {
      const dm = await interaction.user.createDM();
      await dm.send({
        embeds: [embed.info('Verification', `Solve this challenge for **${guild.name}**.\n\nReply in this DM with only the answer.`)],
        files: result.attachment ? [result.attachment] : [],
      });
      await interaction.followUp({
        embeds: [embed.info('Check Your DMs', `I sent your verification challenge in DMs. Reply there to complete verification for **${guild.name}**.`)],
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    } catch {
      this._clearPending(guild.id, interaction.user.id);
      await interaction.followUp({
        embeds: [embed.warn('DMs Disabled', 'Please enable DMs from server members to receive your verification challenge.')],
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }
  }

  static _setPendingState(guildId, userId, state, timeoutSecs, guild, user) {
    this._clearPending(guildId, userId);
    const timeoutId = setTimeout(() => this._onTimeout(guild, user), timeoutSecs * 1000);
    pending.set(this._key(guildId, userId), {
      ...state,
      timeoutId,
      createdAt: Date.now(),
    });
  }

  static _clearPending(guildId, userId) {
    const key = this._key(guildId, userId);
    const state = pending.get(key);
    if (state?.timeoutId) clearTimeout(state.timeoutId);
    pending.delete(key);
  }

  static _findPendingForUser(userId, viaDmOnly = false) {
    const match = [...pending.entries()]
      .filter(([key, state]) => key.split(':')[1] === String(userId) && (!viaDmOnly || state.viaDm === true))
      .sort((a, b) => (b[1].createdAt ?? 0) - (a[1].createdAt ?? 0))[0];

    if (!match) return null;
    return { key: match[0], state: match[1] };
  }

  static _key(guildId, userId) {
    return `${guildId}:${userId}`;
  }

  static async _reply(target, interactionPayload, messagePayload) {
    if (typeof target.fields?.getTextInputValue === 'function' || typeof target.deferred === 'boolean' || typeof target.replied === 'boolean') {
      if (target.deferred || target.replied) return target.followUp(interactionPayload).catch(() => {});
      return target.reply(interactionPayload).catch(() => {});
    }

    if (typeof target.reply === 'function') {
      return target.reply(messagePayload).catch(() => {});
    }

    return null;
  }
}

module.exports = VerificationService;
