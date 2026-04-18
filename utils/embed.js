/**
 * utils/embed.js
 * Centralised embed factory. Ensures consistent design language across all
 * bot responses. Respects guild branding for premium servers.
 */

'use strict';

const { EmbedBuilder } = require('discord.js');
const config           = require('../config/default');

/**
 * Build a base embed with footer + timestamp.
 * @param {object} [opts]
 * @param {number} [opts.color]
 * @param {string} [opts.footer] Override footer text
 * @returns {EmbedBuilder}
 */
function base({ color = config.botColor, footer = config.embedFooter } = {}) {
  return new EmbedBuilder()
    .setColor(color)
    .setFooter({ text: footer })
    .setTimestamp();
}

/**
 * Success embed (green).
 */
function success(title, description) {
  return base({ color: config.successColor })
    .setTitle(`✅ ${title}`)
    .setDescription(description);
}

/**
 * Error embed (red).
 */
function error(title, description) {
  return base({ color: config.errorColor })
    .setTitle(`❌ ${title}`)
    .setDescription(description);
}

/**
 * Warning embed (yellow).
 */
function warn(title, description) {
  return base({ color: config.warnColor })
    .setTitle(`⚠️ ${title}`)
    .setDescription(description);
}

/**
 * Info embed (blurple).
 */
function info(title, description) {
  return base({ color: config.botColor })
    .setTitle(`ℹ️ ${title}`)
    .setDescription(description)
    .setAuthor({ name: "OnboardX V2"});
}

/**
 * Premium feature denied embed.
 */
function premiumRequired(feature) {
  return base({ color: config.premiumColor })
    .setTitle('💎 Premium Feature')
    .setDescription(
      `**${feature}** is a premium-only feature.\n\n` +
      'Upgrade your server to unlock advanced logging, higher XP boosts, ' +
      'custom branding, and more.\n\n' +
      '[**→ View Plans**](https://onboardx.bot/premium)'
    );
}

/**
 * Logging embed — used by LoggingService.
 */
function log(event, fields = [], color = config.botColor) {
  const embed = base({ color }).setTitle(event);
  for (const { name, value, inline } of fields) {
    embed.addFields({ name, value: String(value).slice(0, 1024), inline: inline ?? false });
  }
  return embed;
}

/**
 * Level-up embed.
 */
function levelUp(member, level, roleReward = null) {
  const embed = base({ color: config.successColor })
    .setTitle('🎉 Level Up!')
    .setDescription(
      `${member} has reached **Level ${level}**!` +
      (roleReward ? `\n🎁 You earned the <@&${roleReward}> role!` : '')
    )
    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }));
  return embed;
}

/**
 * Giveaway embed.
 */
function giveaway({ prize, winners, endsAt, hostedBy, entries = 0, ended = false }) {
  const embed = base({ color: ended ? 0x95a5a6 : config.premiumColor })
    .setTitle(ended ? `🎁 Giveaway Ended — ${prize}` : `🎁 Giveaway — ${prize}`)
    .addFields(
      { name: 'Winners',  value: `\`${winners}\``,                inline: true },
      { name: 'Entries',  value: `\`${entries}\``,                inline: true },
      { name: 'Ends',     value: ended ? 'Ended' : `<t:${Math.floor(endsAt / 1000)}:R>`, inline: true },
      { name: 'Hosted by', value: `<@${hostedBy}>`,              inline: false }
    )
    .setDescription(ended ? 'This giveaway has ended.' : '🖱️ Click the button below to enter!');
  return embed;
}

/**
 * Poll embed.
 */
function poll({ question, options, anonymous, endsAt, totalVotes = 0, pollId = null }) {
  const optionLines = options.map((opt, i) => {
    const pct = totalVotes ? Math.round((opt.votes / totalVotes) * 100) : 0;
    const bar = buildBar(pct);
    return `**${i + 1}.** ${opt.label}\n${bar} ${pct}% (${opt.votes} vote${opt.votes !== 1 ? 's' : ''})`;
  });

  return base({ color: config.botColor, footer: pollId ? `Poll ID: ${pollId}` : config.embedFooter })
    .setTitle(`📊 ${question}`)
    .setDescription(optionLines.join('\n\n'))
    .addFields(
      { name: 'Total Votes', value: `\`${totalVotes}\``,                         inline: true },
      { name: 'Anonymous',   value: anonymous ? 'Yes' : 'No',                    inline: true },
      { name: 'Closes',      value: `<t:${Math.floor(endsAt / 1000)}:R>`,        inline: true }
    );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildBar(pct, len = 10) {
  const filled = Math.round((pct / 100) * len);
  return '█'.repeat(filled) + '░'.repeat(len - filled);
}

module.exports = { base, success, error, warn, info, premiumRequired, log, levelUp, giveaway, poll, buildBar };
