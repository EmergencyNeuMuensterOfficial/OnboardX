'use strict';

const { ChannelType, PermissionFlagsBits } = require('discord.js');
const GuildConfig = require('../models/GuildConfig');
const logger = require('../utils/logger');

const tempChannels = new Map();

class TempVoiceService {
  static async handleStateUpdate(oldState, newState) {
    await TempVoiceService.maybeCreate(newState);
    await TempVoiceService.maybeDelete(oldState);
  }

  static async maybeCreate(state) {
    if (!state.guild || !state.member || !state.channelId) return;

    const config = await GuildConfig.get(state.guild.id);
    if (!config.modules?.tempVoice || config.tempVoice?.enabled === false) return;
    if (state.channelId !== config.tempVoice?.createChannelId) return;

    const creatorChannel = state.channel;
    if (!creatorChannel || creatorChannel.type !== ChannelType.GuildVoice) return;

    const parent = config.tempVoice.categoryId || creatorChannel.parentId || null;
    const name = formatName(config.tempVoice.defaultName, state.member);
    const userLimit = Number(config.tempVoice.defaultUserLimit || 0);

    const channel = await state.guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent,
      userLimit: userLimit > 0 ? userLimit : undefined,
      permissionOverwrites: [
        {
          id: state.member.id,
          allow: [
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.MoveMembers,
            PermissionFlagsBits.MuteMembers,
          ],
        },
      ],
      reason: `Temporary voice channel for ${state.member.user.tag}`,
    });

    tempChannels.set(channel.id, {
      guildId: state.guild.id,
      ownerId: state.member.id,
      createdAt: Date.now(),
    });

    await state.setChannel(channel, 'Created temporary voice channel').catch(async (err) => {
      logger.warn(`Temp voice move failed: ${err.message}`);
      await channel.delete('Temp voice owner could not be moved').catch(() => {});
      tempChannels.delete(channel.id);
    });
  }

  static async maybeDelete(state) {
    if (!state.guild || !state.channelId || !tempChannels.has(state.channelId)) return;
    const config = await GuildConfig.get(state.guild.id);
    if (config.tempVoice?.deleteWhenEmpty === false) return;

    const channel = state.guild.channels.cache.get(state.channelId)
      || await state.guild.channels.fetch(state.channelId).catch(() => null);
    if (!channel || channel.members?.size > 0) return;

    await channel.delete('Temporary voice channel empty').catch((err) => {
      logger.warn(`Temp voice delete failed: ${err.message}`);
    });
    tempChannels.delete(state.channelId);
  }
}

function formatName(template, member) {
  return String(template || '{username} voice')
    .replaceAll('{user}', member.user.username)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{displayName}', member.displayName)
    .slice(0, 100);
}

module.exports = TempVoiceService;
