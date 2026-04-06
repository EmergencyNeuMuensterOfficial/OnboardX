/**
 * services/JoinRolesService.js
 *
 * Automatically assigns one or more roles to members when they join a guild.
 * Supports:
 *  - Multiple roles per guild
 *  - Separate role lists for bots vs humans
 *  - Minimum account-age gate (ignore brand-new accounts — anti-raid)
 *  - Delay before assignment (optional, in seconds)
 *  - Premium: up to 10 join roles; free: up to 3
 */

'use strict';

const GuildConfig = require('../models/GuildConfig');
const logger      = require('../utils/logger');

/** How long (ms) to wait between bulk role assignments to avoid rate-limiting */
const ROLE_ASSIGN_DELAY_MS = 300;

class JoinRolesService {
  /**
   * Called from guildMemberAdd. Resolves which roles to assign and adds them.
   *
   * @param {GuildMember} member
   */
  static async onJoin(member) {
    if (!member.guild) return;

    try {
      const config = await GuildConfig.get(member.guild.id);
      if (!config.modules?.joinRoles) return;

      const jrCfg = config.joinRoles ?? {};
      const isBot = member.user.bot;

      // Pick the right role list
      const roleIds = isBot
        ? (jrCfg.botRoles  ?? [])
        : (jrCfg.humanRoles ?? []);

      if (!roleIds.length) return;

      // Account-age gate (human only)
      if (!isBot && jrCfg.minAccountAgeDays) {
        const ageMs  = Date.now() - member.user.createdTimestamp;
        const ageDays = ageMs / 86_400_000;
        if (ageDays < jrCfg.minAccountAgeDays) {
          logger.debug(
            `[JoinRoles] Skipped ${member.user.tag} — account too new ` +
            `(${ageDays.toFixed(1)}d < ${jrCfg.minAccountAgeDays}d required)`
          );
          return;
        }
      }

      // Optional assignment delay (e.g. wait for verification to complete)
      const delayMs = (jrCfg.delaySeconds ?? 0) * 1_000;
      if (delayMs > 0) {
        await new Promise(res => setTimeout(res, delayMs));
        // Re-fetch member — they might have left during the delay
        const refreshed = await member.guild.members.fetch(member.id).catch(() => null);
        if (!refreshed) return;
      }

      // Assign roles sequentially to stay within Discord rate limits
      for (const roleId of roleIds) {
        const role = member.guild.roles.cache.get(roleId);
        if (!role) {
          logger.warn(`[JoinRoles] Role ${roleId} not found in guild ${member.guild.id}`);
          continue;
        }
        if (member.roles.cache.has(roleId)) continue; // Already has it

        try {
          await member.roles.add(role, 'OnboardX Join Role');
        } catch (err) {
          logger.warn(`[JoinRoles] Could not assign role ${role.name}: ${err.message}`);
        }

        // Small gap between each role to avoid rate-limit bursts
        await new Promise(res => setTimeout(res, ROLE_ASSIGN_DELAY_MS));
      }

      logger.debug(
        `[JoinRoles] Assigned ${roleIds.length} role(s) to ${member.user.tag} in ${member.guild.name}`
      );
    } catch (err) {
      logger.error('[JoinRoles] onJoin error:', err);
    }
  }
}

module.exports = JoinRolesService;
