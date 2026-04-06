/**
 * commands/admin/premium.js
 * View and manage premium status. Grant/revoke is owner-only.
 */

'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const GuildConfig   = require('../../models/GuildConfig');
const embed         = require('../../utils/embed');
const premiumConfig = require('../../config/premium');
const { isOwner }   = require('../../utils/permissions');

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
          { name: 'Basic  ($4.99/mo)',      value: 'basic'      },
          { name: 'Pro    ($9.99/mo)',      value: 'pro'        },
          { name: 'Enterprise ($29.99/mo)', value: 'enterprise' },
        )
      )
    )

    .addSubcommand(sub => sub
      .setName('revoke')
      .setDescription('[Bot Owner] Revoke premium from a guild.')
      .addStringOption(o => o.setName('guild_id').setDescription('Guild ID').setRequired(true))
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'status') {
      const cfg  = await GuildConfig.get(interaction.guild.id);
      const tier = cfg.premiumTier ?? null;

      if (!cfg.premium) {
        return interaction.reply({
          embeds: [embed.base({ color: 0x95a5a6 })
            .setTitle('💎 Premium Status')
            .setDescription(
              'This server is **not** on a premium plan.\n\n' +
              '**Available Plans:**\n' +
              `🔹 **Basic** — $4.99/mo — 1.5× XP, 10 concurrent giveaways\n` +
              `🔸 **Pro** — $9.99/mo — Everything in Basic + voice logs, bonus entries\n` +
              `💎 **Enterprise** — $29.99/mo — Everything in Pro + white-label options\n\n` +
              '[**→ Upgrade Now**](https://onboardx.bot/premium)'
            )],
          flags: MessageFlags.Ephemeral,
        });
      }

      const tierInfo = premiumConfig.tiers[tier];
      return interaction.reply({
        embeds: [embed.base({ color: 0xF1C40F })
          .setTitle('💎 Premium Active')
          .addFields(
            { name: '🏷️ Tier',    value: tier.charAt(0).toUpperCase() + tier.slice(1), inline: true },
            { name: '💰 Price',   value: `$${tierInfo?.price ?? '?'}/mo`,              inline: true },
            { name: '✅ Features', value: (tierInfo?.features ?? []).join(', ') || 'All', inline: false },
          )],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Owner-only commands
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({
        embeds: [embed.error('Permission Denied', 'This command is restricted to bot owners.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'grant') {
      const guildId = interaction.options.getString('guild_id');
      const tier    = interaction.options.getString('tier');

      await GuildConfig.update(guildId, { premium: true, premiumTier: tier });
      return interaction.reply({
        embeds: [embed.success('Premium Granted', `Guild \`${guildId}\` granted **${tier}** tier.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'revoke') {
      const guildId = interaction.options.getString('guild_id');
      await GuildConfig.update(guildId, { premium: false, premiumTier: null });
      return interaction.reply({
        embeds: [embed.success('Premium Revoked', `Premium removed from guild \`${guildId}\`.`)],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
