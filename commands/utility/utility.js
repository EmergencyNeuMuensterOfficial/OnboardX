/**
 * commands/utility/utility.js
 * General-purpose utility commands.
 */

'use strict';

const { SlashCommandBuilder, version: djsVersion } = require('discord.js');
const embed  = require('../../utils/embed');
const config = require('../../config/default');
const os     = require('os');

module.exports = {
  cooldown: 3_000,

  data: new SlashCommandBuilder()
    .setName('utility')
    .setDescription('Utility and information commands.')

    .addSubcommand(sub => sub
      .setName('ping')
      .setDescription('Check bot latency and API response time.')
    )

    .addSubcommand(sub => sub
      .setName('info')
      .setDescription('Display bot statistics and system info.')
    )

    .addSubcommand(sub => sub
      .setName('avatar')
      .setDescription('Get a user\'s avatar.')
      .addUserOption(o => o.setName('user').setDescription('User (default: yourself)'))
    )

    .addSubcommand(sub => sub
      .setName('userinfo')
      .setDescription('Display information about a member.')
      .addUserOption(o => o.setName('user').setDescription('User (default: yourself)'))
    )

    .addSubcommand(sub => sub
      .setName('serverinfo')
      .setDescription('Display information about this server.')
    )

    .addSubcommand(sub => sub
      .setName('help')
      .setDescription('View all available commands and features.')
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();

    // ── Ping ───────────────────────────────────────────────────────────────
    if (sub === 'ping') {
      const sent = await interaction.reply({
        embeds: [embed.info('🏓 Pinging...', 'Measuring latency...')],
        fetchReply: true,
      });

      const roundtrip = sent.createdTimestamp - interaction.createdTimestamp;
      const wsLatency = client.ws.ping;

      const latencyColor = wsLatency < 100 ? config.successColor
        : wsLatency < 250 ? config.warnColor
        : config.errorColor;

      return interaction.editReply({
        embeds: [embed.base({ color: latencyColor })
          .setTitle('🏓 Pong!')
          .addFields(
            { name: '📡 Roundtrip', value: `\`${roundtrip}ms\``,  inline: true },
            { name: '💓 WS Ping',   value: `\`${wsLatency}ms\``,  inline: true },
          )],
      });
    }

    // ── Info ───────────────────────────────────────────────────────────────
    if (sub === 'info') {
      const uptime    = formatUptime(client.uptime);
      const memUsage  = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
      const cpuModel  = os.cpus()[0]?.model ?? 'Unknown';
      const nodeVer   = process.version;

      const infoEmbed = embed.base()
        .setTitle(`${config.botName} — System Info`)
        .setThumbnail(client.user.displayAvatarURL())
        .addFields(
          { name: '🤖 Bot',          value: `v${config.botVersion}`,     inline: true },
          { name: '⚙️ discord.js',   value: `v${djsVersion}`,             inline: true },
          { name: '🟩 Node.js',      value: nodeVer,                       inline: true },
          { name: '🖥️ Servers',      value: `${client.guilds.cache.size}`, inline: true },
          { name: '👤 Users',        value: `${client.users.cache.size}`,  inline: true },
          { name: '⏱️ Uptime',       value: uptime,                        inline: true },
          { name: '💾 Memory',       value: `${memUsage} MB`,              inline: true },
          { name: '📡 WS Ping',      value: `${client.ws.ping}ms`,         inline: true },
          { name: '🔧 Commands',     value: `${client.commands.size}`,     inline: true },
        );

      return interaction.reply({ embeds: [infoEmbed] });
    }

    // ── Avatar ─────────────────────────────────────────────────────────────
    if (sub === 'avatar') {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const url  = user.displayAvatarURL({ dynamic: true, size: 1024 });

      const avatarEmbed = embed.base()
        .setTitle(`${user.username}'s Avatar`)
        .setImage(url)
        .setDescription(`[PNG](${user.displayAvatarURL({ format: 'png', size: 1024 })}) | [JPG](${user.displayAvatarURL({ format: 'jpg', size: 1024 })}) | [WEBP](${user.displayAvatarURL({ format: 'webp', size: 1024 })})`);

      return interaction.reply({ embeds: [avatarEmbed] });
    }

    // ── UserInfo ───────────────────────────────────────────────────────────
    if (sub === 'userinfo') {
      const user   = interaction.options.getUser('user') ?? interaction.user;
      const member = interaction.guild.members.cache.get(user.id);

      const roles = member?.roles.cache
        .filter(r => r.id !== interaction.guild.id)
        .sort((a, b) => b.position - a.position)
        .map(r => r.toString())
        .slice(0, 10)
        .join(' ') || 'None';

      const userEmbed = embed.base()
        .setTitle(`👤 ${user.username}`)
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: '🆔 ID',           value: `\`${user.id}\``,                                                  inline: true },
          { name: '🤖 Bot',          value: user.bot ? 'Yes' : 'No',                                           inline: true },
          { name: '📅 Created',      value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`,               inline: true },
          { name: '📥 Joined Server', value: member?.joinedAt ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>` : 'Unknown', inline: true },
          { name: '🔝 Top Role',     value: member?.roles.highest.toString() ?? 'None',                        inline: true },
          { name: '🏷️ Roles',        value: roles,                                                             inline: false },
        );

      return interaction.reply({ embeds: [userEmbed] });
    }

    // ── ServerInfo ─────────────────────────────────────────────────────────
    if (sub === 'serverinfo') {
      const g       = interaction.guild;
      const owner   = await g.fetchOwner().catch(() => null);
      const created = `<t:${Math.floor(g.createdTimestamp / 1000)}:D>`;

      const serverEmbed = embed.base()
        .setTitle(`🏠 ${g.name}`)
        .setThumbnail(g.iconURL({ dynamic: true }))
        .addFields(
          { name: '🆔 ID',          value: `\`${g.id}\``,                         inline: true },
          { name: '👑 Owner',       value: owner?.user.tag ?? 'Unknown',            inline: true },
          { name: '📅 Created',     value: created,                                 inline: true },
          { name: '👥 Members',     value: `${g.memberCount}`,                      inline: true },
          { name: '📢 Channels',    value: `${g.channels.cache.size}`,              inline: true },
          { name: '🎭 Roles',       value: `${g.roles.cache.size}`,                 inline: true },
          { name: '😀 Emojis',      value: `${g.emojis.cache.size}`,                inline: true },
          { name: '🚀 Boost Level', value: `Level ${g.premiumTier}`,                inline: true },
          { name: '💎 Boosts',      value: `${g.premiumSubscriptionCount ?? 0}`,    inline: true },
          { name: '✅ Verification', value: verificationLevel(g.verificationLevel), inline: true },
        );

      if (g.bannerURL()) serverEmbed.setImage(g.bannerURL({ size: 1024 }));

      return interaction.reply({ embeds: [serverEmbed] });
    }

    // ── Help ───────────────────────────────────────────────────────────────
    if (sub === 'help') {
      const helpEmbed = embed.base()
        .setTitle(`📖 ${config.botName} — Command Reference`)
        .setThumbnail(client.user.displayAvatarURL())
        .setDescription(
          'OnboardX V2 is a full-featured server management bot.\n' +
          'All commands use Discord slash commands — just type `/`!'
        )
        .addFields(
          {
            name:  '⚙️ Admin',
            value: '`/config module` `/config log-channel` `/config verification` `/config leveling` `/config view`\n`/logging` `/levelrole`',
          },
          {
            name:  '🔨 Moderation',
            value: '`/mod ban` `/mod kick` `/mod timeout` `/mod untimeout` `/mod warn` `/mod purge` `/mod unban`',
          },
          {
            name:  '📈 Leveling',
            value: '`/rank view` `/rank leaderboard` `/rank setxp` `/rank reset`',
          },
          {
            name:  '🎉 Giveaways',
            value: '`/giveaway start` `/giveaway end` `/giveaway reroll` `/giveaway list`',
          },
          {
            name:  '📊 Polls',
            value: '`/poll create` `/poll close` `/poll results`',
          },
          {
            name:  '🔐 Verification',
            value: '`/verify panel` `/verify force` `/verify status`',
          },
          {
            name:  '🔧 Utility',
            value: '`/utility ping` `/utility info` `/utility avatar` `/utility userinfo` `/utility serverinfo`',
          },
          {
            name:  '💎 Premium',
            value: 'Unlock higher XP multipliers, more giveaway winners, image captchas, advanced logging, and more!\n[**→ View Plans**](https://onboardx.bot/premium)',
          },
        );

      return interaction.reply({ embeds: [helpEmbed] });
    }
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s  / 60);
  const h = Math.floor(m  / 60);
  const d = Math.floor(h  / 24);
  return `${d}d ${h % 24}h ${m % 60}m ${s % 60}s`;
}

function verificationLevel(level) {
  return ['None', 'Low', 'Medium', 'High', 'Very High'][level] ?? 'Unknown';
}
