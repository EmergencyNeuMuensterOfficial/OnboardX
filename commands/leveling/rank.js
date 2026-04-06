/**
 * commands/leveling/rank.js
 * View XP rank, leaderboard, and admin XP management.
 */

'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const LevelingService      = require('../../services/LevelingService');
const UserXP               = require('../../models/UserXP');
const embed                = require('../../utils/embed');
const { assertPermission } = require('../../utils/permissions');

module.exports = {
  cooldown: 5_000,

  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('View XP rank and leaderboard.')

    .addSubcommand(sub => sub
      .setName('view')
      .setDescription('View your (or another user\'s) rank card.')
      .addUserOption(o => o.setName('user').setDescription('User to view (default: yourself)'))
    )

    .addSubcommand(sub => sub
      .setName('leaderboard')
      .setDescription('Show the top 10 users in this server.')
    )

    .addSubcommand(sub => sub
      .setName('setxp')
      .setDescription('[Admin] Set a user\'s total XP.')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('New total XP amount').setRequired(true).setMinValue(0))
    )

    .addSubcommand(sub => sub
      .setName('reset')
      .setDescription('[Admin] Reset a user\'s XP to zero.')
      .addUserOption(o => o.setName('user').setDescription('Target user').setRequired(true))
    ),

  async execute(interaction, client, guildCfg) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'view') {
      const target = interaction.options.getUser('user') ?? interaction.user;
      await interaction.deferReply();

      const profile = await LevelingService.getProfile(interaction.guild.id, target.id);

      const bar       = buildBar(profile.progressPct);
      const rankEmbed = embed.base({ color: 0x5865F2 })
        .setAuthor({ name: `${target.username}'s Rank`, iconURL: target.displayAvatarURL({ dynamic: true }) })
        .addFields(
          { name: '🏆 Rank',     value: `#${profile.rank ?? '?'}`,                   inline: true },
          { name: '⭐ Level',    value: `${profile.level}`,                           inline: true },
          { name: '✨ Total XP', value: `${profile.totalXp.toLocaleString()}`,        inline: true },
          { name: '📊 Progress', value: `${bar}\n${profile.xp}/${profile.xpNeeded} XP (${profile.progressPct}%)`, inline: false },
          { name: '💬 Messages', value: `${(profile.messages ?? 0).toLocaleString()}`, inline: true },
        );

      return interaction.editReply({ embeds: [rankEmbed] });
    }

    if (sub === 'leaderboard') {
      await interaction.deferReply();
      const top = await UserXP.leaderboard(interaction.guild.id, 10);

      if (!top.length) {
        return interaction.editReply({
          embeds: [embed.info('No Data', 'No XP data found for this server yet.')],
        });
      }

      const medals = ['🥇', '🥈', '🥉'];
      const lines  = await Promise.all(
        top.map(async (u, i) => {
          const medal = medals[i] ?? `**${i + 1}.**`;
          return `${medal} <@${u.id}> — Level **${u.level}** · ${u.totalXp.toLocaleString()} XP`;
        })
      );

      return interaction.editReply({
        embeds: [embed.base().setTitle('🏆 XP Leaderboard').setDescription(lines.join('\n'))],
      });
    }

    if (sub === 'setxp') {
      if (!await assertPermission(interaction, 'admin')) return;
      const user   = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');

      await UserXP.setXP(interaction.guild.id, user.id, amount);
      return interaction.reply({
        embeds: [embed.success('XP Set', `${user}'s XP has been set to **${amount.toLocaleString()}**.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'reset') {
      if (!await assertPermission(interaction, 'admin')) return;
      const user = interaction.options.getUser('user');

      await UserXP.setXP(interaction.guild.id, user.id, 0);
      return interaction.reply({
        embeds: [embed.success('XP Reset', `${user}'s XP has been reset.`)],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};

function buildBar(pct, len = 14) {
  const filled = Math.round((pct / 100) * len);
  return '`' + '█'.repeat(filled) + '░'.repeat(len - filled) + '`';
}
