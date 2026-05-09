/**
 * commands/admin/premium.js
 * View and manage premium status. Grant/revoke is owner-only.
 */

'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const GuildConfig = require('../../models/GuildConfig');
const embed = require('../../utils/embed');
const premiumConfig = require('../../config/premium');
const { isOwner } = require('../../utils/permissions');

module.exports = {
  cooldown: 5_000,

  data: new SlashCommandBuilder()
    .setName('premium')
    .setDescription('Manage premium status.')

    .addSubcommand(sub => sub
      .setName('status')
      .setDescription('Check this server\'s premium status.')
    )

    .addSubcommand(sub => sub
      .setName('grant')
      .setDescription('[Bot Owner] Grant premium to a guild.')
      .addStringOption(o => o.setName('guild_id').setDescription('Guild ID').setRequired(true))
      .addStringOption(o => o.setName('tier').setDescription('Premium tier').setRequired(true)
        .addChoices(
          { name: 'Basic  ($4.99/mo)', value: 'basic' },
          { name: 'Pro    ($9.99/mo)', value: 'pro' },
          { name: 'Enterprise ($29.99/mo)', value: 'enterprise' },
        )
      )
      .addStringOption(o => o
        .setName('expires_at')
        .setDescription('Expiration date as YYYY-MM-DD, or leave empty for no expiration')
      )
    )

    .addSubcommand(sub => sub
      .setName('revoke')
      .setDescription('[Bot Owner] Revoke premium from a guild.')
      .addStringOption(o => o.setName('guild_id').setDescription('Guild ID').setRequired(true))
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'status') {
      const cfg = await GuildConfig.get(interaction.guild.id);
      const tier = cfg.premiumTier ?? null;

      if (!cfg.premium) {
        return interaction.reply({
          embeds: [embed.base({ color: 0x95a5a6 })
            .setTitle('Premium Status')
            .setDescription(
              'This server is **not** on a premium plan.\n\n' +
              '**Available Plans:**\n' +
              '- **Basic** - $4.99/mo - 1.5x XP, 10 concurrent giveaways\n' +
              '- **Pro** - $9.99/mo - Everything in Basic + voice logs, bonus entries\n' +
              '- **Enterprise** - $29.99/mo - Everything in Pro + white-label options\n\n' +
              '[**Upgrade Now**](https://onboardx.bot/premium)'
            )],
          flags: MessageFlags.Ephemeral,
        });
      }

      const tierInfo = premiumConfig.tiers[tier];
      return interaction.reply({
        embeds: [embed.base({ color: 0xF1C40F })
          .setTitle('Premium Active')
          .addFields(
            { name: 'Tier', value: tier.charAt(0).toUpperCase() + tier.slice(1), inline: true },
            { name: 'Price', value: `$${tierInfo?.price ?? '?'}/mo`, inline: true },
            { name: 'Expires', value: cfg.premiumExpiresAt ? formatPremiumExpiry(cfg.premiumExpiresAt) : 'Never', inline: true },
            { name: 'Features', value: (tierInfo?.features ?? []).join(', ') || 'All', inline: false },
          )],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!isOwner(interaction.user.id)) {
      return interaction.reply({
        embeds: [embed.error('Permission Denied', 'This command is restricted to bot owners.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'grant') {
      const guildId = interaction.options.getString('guild_id');
      const tier = interaction.options.getString('tier');
      const expiresAtInput = interaction.options.getString('expires_at');
      const premiumExpiresAt = parsePremiumExpiry(expiresAtInput);

      if (expiresAtInput && !premiumExpiresAt) {
        return interaction.reply({
          embeds: [embed.error('Invalid Expiration Date', 'Use `YYYY-MM-DD`, for example `2026-06-10`, or leave it empty for no expiration.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      await GuildConfig.update(guildId, { premium: true, premiumTier: tier, premiumExpiresAt });
      return interaction.reply({
        embeds: [embed.success(
          'Premium Granted',
          `Guild \`${guildId}\` granted **${tier}** tier.\nExpires: **${premiumExpiresAt ? formatPremiumExpiry(premiumExpiresAt) : 'Never'}**`
        )],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'revoke') {
      const guildId = interaction.options.getString('guild_id');
      await GuildConfig.update(guildId, { premium: false, premiumTier: null, premiumExpiresAt: null });
      return interaction.reply({
        embeds: [embed.success('Premium Revoked', `Premium removed from guild \`${guildId}\`.`)],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

function parsePremiumExpiry(value) {
  if (!value) return null;

  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 999));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day) ||
    date.getTime() <= Date.now()
  ) {
    return null;
  }

  return date.toISOString();
}

function formatPremiumExpiry(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  const timestamp = Math.floor(date.getTime() / 1000);
  return `<t:${timestamp}:D> (<t:${timestamp}:R>)`;
}
