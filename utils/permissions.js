/**
 * utils/permissions.js
 * Centralised permission checks for commands and features.
 */

'use strict';

const { PermissionFlagsBits, MessageFlags } = require('discord.js');
const config = require('../config/default');

/**
 * Check if a user is a bot owner.
 */
function isOwner(userId) {
  return config.owners.includes(userId);
}

/**
 * Check if a member has a specific Discord permission.
 * @param {GuildMember} member
 * @param {bigint} permission — e.g. PermissionFlagsBits.BanMembers
 */
function hasPermission(member, permission) {
  return member.permissions.has(permission);
}

/**
 * Check if a member is an admin (ADMINISTRATOR or ManageGuild).
 */
function isAdmin(member) {
  return (
    isOwner(member.id) ||
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  );
}

/**
 * Check if a member is a moderator (Kick/Ban/Timeout members).
 */
function isMod(member) {
  return (
    isAdmin(member) ||
    member.permissions.has(PermissionFlagsBits.KickMembers) ||
    member.permissions.has(PermissionFlagsBits.BanMembers) ||
    member.permissions.has(PermissionFlagsBits.ModerateMembers)
  );
}

/**
 * Assert a permission gate and reply with a standardised error if denied.
 * Returns true if the check PASSES (caller should continue).
 *
 * @param {ChatInputCommandInteraction} interaction
 * @param {'owner'|'admin'|'mod'|bigint} level
 */
async function assertPermission(interaction, level) {
  const member = interaction.member;
  let allowed  = false;

  if (level === 'owner')       allowed = isOwner(member.id);
  else if (level === 'admin')  allowed = isAdmin(member);
  else if (level === 'mod')    allowed = isMod(member);
  else                         allowed = hasPermission(member, level);

  if (!allowed) {
    const { error } = require('./embed');
    await interaction.reply({
      embeds: [error('Permission Denied', 'You do not have permission to use this command.')],
      flags: MessageFlags.Ephemeral,
    });
  }

  return allowed;
}

/**
 * Check if the bot itself has the required permissions in the interaction channel.
 * @param {ChatInputCommandInteraction} interaction
 * @param {bigint[]} permissions
 */
async function assertBotPermissions(interaction, permissions) {
  const botMember = interaction.guild.members.me;
  const missing   = permissions.filter(p => !botMember.permissions.has(p));

  if (missing.length) {
    const names = missing.map(p =>
      Object.entries(PermissionFlagsBits).find(([, v]) => v === p)?.[0] ?? String(p)
    );
    const { error } = require('./embed');
    await interaction.reply({
      embeds: [error('Missing Bot Permissions', `I need: \`${names.join(', ')}\``)],
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  return true;
}

module.exports = { isOwner, hasPermission, isAdmin, isMod, assertPermission, assertBotPermissions };
