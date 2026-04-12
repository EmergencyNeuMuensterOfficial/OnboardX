/**
 * services/AntiSpamService.js
 * Real-time spam and raid detection.
 *
 * Detects:
 *  • Message rate spam     — too many messages in a short window
 *  • Duplicate spam        — same message content repeated
 *  • Mention spam          — too many @mentions in one message
 *  • Mass-join raid        — many accounts joining in a short burst
 *
 * Actions (configurable per guild):
 *  delete | warn | mute | kick | ban
 */

'use strict';

const { Collection, PermissionFlagsBits, MessageFlags } = require('discord.js');
const GuildConfig    = require('../models/GuildConfig');
const LoggingService = require('./LoggingService');
const embed          = require('../utils/embed');
const logger         = require('../utils/logger');

// ── In-memory rate-limit trackers ─────────────────────────────────────────────
/** userId → [timestampMs, ...] within rolling window */
const msgTracker  = new Collection();
/** userId → [content, ...] */
const dupeTracker = new Collection();
/** guildId → [timestampMs, ...] join timestamps */
const joinTracker = new Collection();

const DEFAULTS = {
  enabled:          false,
  // Message rate
  msgLimit:         6,     // max messages
  msgWindow:        5_000, // per N ms
  // Duplicates
  dupeLimit:        4,     // same content N times
  dupeWindow:       10_000,
  // Mention spam
  mentionLimit:     5,     // mentions per message
  mentionSpamEnabled: true,
  // Raid detection
  raidJoinCount:    10,    // N joins
  raidJoinWindow:   10_000,// within N ms → lockdown
  raidJoinEnabled:  true,
  // Punishment
  punishment:       'mute', // 'delete' | 'warn' | 'mute' | 'kick' | 'ban'
  muteDurationMs:   10 * 60_000, // 10 min
};

class AntiSpamService {
  /**
   * Process an incoming message for spam signals.
   * Called from messageCreate event BEFORE leveling.
   *
   * @param {Message} message
   * @returns {Promise<boolean>} true if the message was flagged (caller should return early)
   */
  static async check(message) {
    const { guild, member, author, content } = message;
    if (!guild || author.bot) return false;
    // Never flag admins
    if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return false;

    const config = await GuildConfig.get(guild.id);
    if (!config.modules?.antispam) return false;

    const s = { ...DEFAULTS, ...(config.antispam ?? {}) };

    // ── 1. Mention spam ──────────────────────────────────────────────────
    const mentions = message.mentions.users.size + message.mentions.roles.size;
    if (s.mentionSpamEnabled !== false && mentions >= s.mentionLimit) {
      await AntiSpamService._punish(message, s, `Mention spam (${mentions} mentions)`);
      return true;
    }

    const now = Date.now();
    const key = `${guild.id}:${author.id}`;

    // ── 2. Message rate ──────────────────────────────────────────────────
    if (!msgTracker.has(key)) msgTracker.set(key, []);
    const msgs = msgTracker.get(key).filter(t => now - t < s.msgWindow);
    msgs.push(now);
    msgTracker.set(key, msgs);

    if (msgs.length >= s.msgLimit) {
      msgTracker.delete(key);
      await AntiSpamService._punish(message, s, `Message spam (${msgs.length} messages/${s.msgWindow / 1000}s)`);
      return true;
    }

    // ── 3. Duplicate messages ────────────────────────────────────────────
    if (content && content.length > 5) {
      if (!dupeTracker.has(key)) dupeTracker.set(key, []);
      const dupes = dupeTracker.get(key).filter(({ t }) => now - t < s.dupeWindow);
      dupes.push({ t: now, c: content });
      dupeTracker.set(key, dupes);

      const sameCount = dupes.filter(d => d.c === content).length;
      if (sameCount >= s.dupeLimit) {
        dupeTracker.delete(key);
        await AntiSpamService._punish(message, s, `Duplicate message spam (repeated ${sameCount}×)`);
        return true;
      }
    }

    return false;
  }

  /**
   * Track a member join for raid detection.
   * @param {GuildMember} member
   */
  static async trackJoin(member) {
    const { guild } = member;
    const config    = await GuildConfig.get(guild.id);
    if (!config.modules?.antispam) return;

    const s   = { ...DEFAULTS, ...(config.antispam ?? {}) };
    if (s.raidJoinEnabled === false) return;
    const now = Date.now();

    if (!joinTracker.has(guild.id)) joinTracker.set(guild.id, []);
    const joins = joinTracker.get(guild.id).filter(t => now - t < s.raidJoinWindow);
    joins.push(now);
    joinTracker.set(guild.id, joins);

    if (joins.length >= s.raidJoinCount) {
      joinTracker.delete(guild.id);
      await AntiSpamService._triggerRaidMode(guild, config, joins.length);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  static async _punish(message, s, reason) {
    // Always delete the offending message first
    await message.delete().catch(() => {});

    await LoggingService.logModAction(message.guild, {
      action:    `AutoMod — ${reason}`,
      target:    message.author,
      moderator: message.guild.members.me.user,
      reason,
    });

    // DM the user
    await message.author.send({
      embeds: [embed.warn(
        `⚠️ Auto-Moderation — ${message.guild.name}`,
        `Your message was removed: **${reason}**.`
      )],
    }).catch(() => {});

    if (s.punishment === 'mute' || s.punishment === 'timeout') {
      if (message.member?.moderatable) {
        await message.member.timeout(s.muteDurationMs, `AutoMod: ${reason}`).catch(() => {});
      }
    } else if (s.punishment === 'kick') {
      if (message.member?.kickable) {
        await message.member.kick(`AutoMod: ${reason}`).catch(() => {});
      }
    } else if (s.punishment === 'ban') {
      if (message.member?.bannable) {
        await message.member.ban({ reason: `AutoMod: ${reason}`, deleteMessageDays: 1 }).catch(() => {});
      }
    }
  }

  static async _triggerRaidMode(guild, config, joinCount) {
    logger.warn(`RAID DETECTED in ${guild.name} (${guild.id}): ${joinCount} joins`);

    // Log to the guild's log channel
    await LoggingService.log(guild, 'modAction', embed.log(
      '🚨 Raid Detected — Lockdown Active',
      [
        { name: '⚡ Trigger', value: `${joinCount} joins in rapid succession` },
        { name: '🔒 Action',  value: 'Server verification level raised to HIGHEST' },
      ],
      0xFF0000
    ));

    // Raise verification level to maximum
    try {
      await guild.setVerificationLevel(4, 'AntiRaid: Mass join detected');
    } catch (err) {
      logger.warn(`Could not raise verification level: ${err.message}`);
    }

    // Optionally notify guild owner
    try {
      const owner = await guild.fetchOwner();
      await owner.send({
        embeds: [embed.base({ color: 0xFF0000 })
          .setTitle('🚨 Raid Alert!')
          .setDescription(
            `Raid detected in **${guild.name}**.\n` +
            `**${joinCount}** accounts joined in rapid succession.\n\n` +
            'Server verification has been set to **Highest** automatically.\n' +
            'Use `/antispam raidmode off` to restore normal settings.'
          )],
      }).catch(() => {});
    } catch { /* owner DM may fail */ }
  }
}

// Auto-clean trackers periodically to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, msgs] of msgTracker) {
    const fresh = msgs.filter(t => now - t < 30_000);
    if (!fresh.length) msgTracker.delete(key);
    else msgTracker.set(key, fresh);
  }
  for (const [key, dupes] of dupeTracker) {
    const fresh = dupes.filter(d => now - d.t < 30_000);
    if (!fresh.length) dupeTracker.delete(key);
    else dupeTracker.set(key, fresh);
  }
  for (const [gId, joins] of joinTracker) {
    const fresh = joins.filter(t => now - t < 30_000);
    if (!fresh.length) joinTracker.delete(gId);
    else joinTracker.set(gId, fresh);
  }
}, 60_000).unref();

module.exports = AntiSpamService;
