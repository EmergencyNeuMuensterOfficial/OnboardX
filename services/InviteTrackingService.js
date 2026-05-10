'use strict';

const InviteTracker = require('../models/InviteTracker');
const GuildConfig = require('../models/GuildConfig');
const embed = require('../utils/embed');

const inviteCache = new Map();

class InviteTrackingService {
  static async cacheGuild(guild) {
    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites) return;
    inviteCache.set(guild.id, new Map(invites.map(invite => [invite.code, invite.uses ?? 0])));
  }

  static async onInviteCreate(invite) {
    await InviteTrackingService.cacheGuild(invite.guild);
  }

  static async onInviteDelete(invite) {
    await InviteTrackingService.cacheGuild(invite.guild);
  }

  static async onJoin(member) {
    const config = await GuildConfig.get(member.guild.id);
    if (!config.modules?.inviteTracking || config.inviteTracking?.enabled === false) return;

    const before = inviteCache.get(member.guild.id) ?? new Map();
    const invites = await member.guild.invites.fetch().catch(() => null);
    if (!invites) return;

    const used = invites.find(invite => (invite.uses ?? 0) > (before.get(invite.code) ?? 0));
    inviteCache.set(member.guild.id, new Map(invites.map(invite => [invite.code, invite.uses ?? 0])));

    const accountAgeMs = Date.now() - member.user.createdTimestamp;
    const fakeThresholdDays = Number(config.inviteTracking?.fakeThresholdDays ?? 7);
    const fake = fakeThresholdDays > 0 && accountAgeMs < fakeThresholdDays * 24 * 60 * 60 * 1000;

    await InviteTracker.recordJoin(member.guild.id, member.id, used?.inviter?.id ?? null, used?.code ?? null, fake);
    await InviteTrackingService.log(member.guild, config, 'Invite Join', `${member} joined using ${used ? `\`${used.code}\` from ${used.inviter}` : 'an unknown invite'}.${fake ? '\nMarked as fake/young account.' : ''}`);
  }

  static async onLeave(member) {
    const config = await GuildConfig.get(member.guild.id);
    if (!config.modules?.inviteTracking || config.inviteTracking?.trackLeaves === false) return;

    const join = await InviteTracker.recordLeave(member.guild.id, member.id);
    if (join?.inviterId) {
      await InviteTrackingService.log(member.guild, config, 'Invite Leave', `${member.user?.tag ?? member.id} left. Invited by <@${join.inviterId}>.`);
    }
  }

  static async log(guild, config, title, description) {
    const channelId = config.inviteTracking?.logChannelId || config.logging?.joinLeaveChannel || config.logging?.channelId;
    if (!channelId) return;
    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased?.()) {
      await channel.send({ embeds: [embed.info(title, description)] }).catch(() => {});
    }
  }
}

module.exports = InviteTrackingService;
