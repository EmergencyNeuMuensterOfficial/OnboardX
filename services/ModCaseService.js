'use strict';

const ModCase = require('../models/ModCase');
const GuildConfig = require('../models/GuildConfig');
const embed = require('../utils/embed');

class ModCaseService {
  static async create(guild, data) {
    const config = await GuildConfig.get(guild.id);
    if (config.modules?.modCases === false || config.modCases?.enabled === false) return null;

    const modCase = await ModCase.create(guild.id, data);
    await ModCaseService.log(guild, config, modCase);
    return modCase;
  }

  static async log(guild, config, modCase) {
    const channelId = config.modCases?.logChannelId || config.moderation?.caseLogChannelId || config.logging?.modLogChannel || config.logging?.channelId;
    if (!channelId) return;
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return;

    await channel.send({
      embeds: [embed.base({ color: 0xFEE75C })
        .setTitle(`Moderation Case #${modCase.caseId}`)
        .addFields(
          { name: 'Action', value: modCase.action, inline: true },
          { name: 'Target', value: `${modCase.targetTag || modCase.targetId} (${modCase.targetId})`, inline: true },
          { name: 'Moderator', value: `${modCase.moderatorTag || modCase.moderatorId} (${modCase.moderatorId})`, inline: true },
          { name: 'Reason', value: modCase.reason || 'No reason provided', inline: false },
          { name: 'Status', value: modCase.status || 'open', inline: true },
        )],
    }).catch(() => {});
  }
}

module.exports = ModCaseService;
