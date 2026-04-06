/**
 * commands/admin/joinroles.js
 *
 * Full management of the Join Roles module:
 *   /joinroles add     — add a role to the human or bot list
 *   /joinroles remove  — remove a role from a list
 *   /joinroles list    — display current configuration
 *   /joinroles settings — set account-age gate and delay
 *   /joinroles clear   — wipe all join roles for a list type
 */

'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require('discord.js');
const GuildConfig          = require('../../models/GuildConfig');
const embed                = require('../../utils/embed');
const { assertPermission } = require('../../utils/permissions');
const premiumConfig        = require('../../config/premium');

/** Free-tier cap */
const FREE_MAX  = 3;
/** Premium cap */
const PREM_MAX  = 10;

module.exports = {
  cooldown: 4_000,

  data: new SlashCommandBuilder()
    .setName('joinroles')
    .setDescription('Configure roles automatically assigned when members join.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    // ── add ───────────────────────────────────────────────────────────────
    .addSubcommand(sub => sub
      .setName('add')
      .setDescription('Add a join role.')
      .addRoleOption(o => o
        .setName('role')
        .setDescription('Role to assign on join')
        .setRequired(true))
      .addStringOption(o => o
        .setName('type')
        .setDescription('Apply to humans, bots, or both (default: humans)')
        .addChoices(
          { name: 'Humans', value: 'human' },
          { name: 'Bots',   value: 'bot'   },
          { name: 'Both',   value: 'both'  },
        ))
    )

    // ── remove ────────────────────────────────────────────────────────────
    .addSubcommand(sub => sub
      .setName('remove')
      .setDescription('Remove a join role.')
      .addRoleOption(o => o
        .setName('role')
        .setDescription('Role to remove')
        .setRequired(true))
      .addStringOption(o => o
        .setName('type')
        .setDescription('Which list to remove from')
        .addChoices(
          { name: 'Humans', value: 'human' },
          { name: 'Bots',   value: 'bot'   },
          { name: 'Both',   value: 'both'  },
        ))
    )

    // ── list ──────────────────────────────────────────────────────────────
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('Show all configured join roles.')
    )

    // ── settings ──────────────────────────────────────────────────────────
    .addSubcommand(sub => sub
      .setName('settings')
      .setDescription('Configure join role behaviour.')
      .addIntegerOption(o => o
        .setName('min_account_age_days')
        .setDescription('Minimum account age in days before join roles are granted (0 = disabled)')
        .setMinValue(0)
        .setMaxValue(365))
      .addIntegerOption(o => o
        .setName('delay_seconds')
        .setDescription('Seconds to wait before assigning roles (0 = instant)')
        .setMinValue(0)
        .setMaxValue(300))
    )

    // ── clear ─────────────────────────────────────────────────────────────
    .addSubcommand(sub => sub
      .setName('clear')
      .setDescription('Remove ALL join roles from a list.')
      .addStringOption(o => o
        .setName('type')
        .setDescription('Which list to clear')
        .setRequired(true)
        .addChoices(
          { name: 'Humans', value: 'human' },
          { name: 'Bots',   value: 'bot'   },
          { name: 'Both',   value: 'both'  },
        ))
    ),

  // ── Execute ────────────────────────────────────────────────────────────────
  async execute(interaction, client, guildCfg) {
    if (!await assertPermission(interaction, 'admin')) return;

    const sub       = interaction.options.getSubcommand();
    const isPremium = guildCfg?.premium ?? false;
    const maxRoles  = isPremium ? PREM_MAX : FREE_MAX;

    const cfg     = await GuildConfig.get(interaction.guild.id);
    const jrCfg   = cfg.joinRoles ?? { humanRoles: [], botRoles: [], minAccountAgeDays: 0, delaySeconds: 0 };

    // ── add ─────────────────────────────────────────────────────────────────
    if (sub === 'add') {
      const role = interaction.options.getRole('role');
      const type = interaction.options.getString('type') ?? 'human';

      // Guard: don't assign @everyone or managed (integration) roles
      if (role.id === interaction.guild.id) {
        return interaction.reply({
          embeds: [embed.error('Invalid Role', 'You cannot use @everyone as a join role.')],
          flags: MessageFlags.Ephemeral,
        });
      }
      if (role.managed) {
        return interaction.reply({
          embeds: [embed.error('Invalid Role', 'Bot/integration roles cannot be assigned manually.')],
          flags: MessageFlags.Ephemeral,
        });
      }
      // Guard: bot must be able to assign the role (hierarchy check)
      if (role.position >= interaction.guild.members.me.roles.highest.position) {
        return interaction.reply({
          embeds: [embed.error(
            'Role Hierarchy',
            `My highest role is below **${role.name}**. Move my role above it first.`
          )],
          flags: MessageFlags.Ephemeral,
        });
      }

      const updates = {};
      const added   = [];
      const already = [];

      for (const listKey of type === 'both' ? ['humanRoles', 'botRoles'] : [`${type}Roles`]) {
        const list = jrCfg[listKey] ?? [];
        if (list.includes(role.id)) { already.push(listKey); continue; }
        if (list.length >= maxRoles) {
          return interaction.reply({
            embeds: [embed.warn(
              'Limit Reached',
              `Maximum **${maxRoles}** join roles per list.` +
              (!isPremium ? ` Upgrade to Premium for up to ${PREM_MAX}.` : '')
            )],
            flags: MessageFlags.Ephemeral,
          });
        }
        updates[`joinRoles.${listKey}`] = [...list, role.id];
        added.push(listKey);
      }

      if (!added.length) {
        return interaction.reply({
          embeds: [embed.warn('Already Added', `${role} is already in the requested list(s).`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      await GuildConfig.update(interaction.guild.id, updates);
      // Also make sure the module is enabled
      await GuildConfig.update(interaction.guild.id, { 'modules.joinRoles': true });

      const listLabels = added.map(l => l === 'humanRoles' ? 'Humans' : 'Bots').join(' & ');
      return interaction.reply({
        embeds: [embed.success(
          '✅ Join Role Added',
          `${role} will be assigned to **${listLabels}** when they join.`
        )],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── remove ───────────────────────────────────────────────────────────────
    if (sub === 'remove') {
      const role = interaction.options.getRole('role');
      const type = interaction.options.getString('type') ?? 'human';

      const updates = {};
      const removed = [];

      for (const listKey of type === 'both' ? ['humanRoles', 'botRoles'] : [`${type}Roles`]) {
        const list = jrCfg[listKey] ?? [];
        if (!list.includes(role.id)) continue;
        updates[`joinRoles.${listKey}`] = list.filter(id => id !== role.id);
        removed.push(listKey);
      }

      if (!removed.length) {
        return interaction.reply({
          embeds: [embed.warn('Not Found', `${role} is not in the requested list(s).`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      await GuildConfig.update(interaction.guild.id, updates);
      const listLabels = removed.map(l => l === 'humanRoles' ? 'Humans' : 'Bots').join(' & ');
      return interaction.reply({
        embeds: [embed.success('✅ Join Role Removed', `${role} removed from **${listLabels}**.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── list ─────────────────────────────────────────────────────────────────
    if (sub === 'list') {
      const humanList = (jrCfg.humanRoles ?? []);
      const botList   = (jrCfg.botRoles   ?? []);

      const fmt = (ids) => ids.length
        ? ids.map(id => `<@&${id}>`).join(', ')
        : '*None configured*';

      const listEmbed = embed.base()
        .setTitle('🎭 Join Roles Configuration')
        .addFields(
          {
            name:   `👤 Human Roles (${humanList.length}/${maxRoles})`,
            value:  fmt(humanList),
            inline: false,
          },
          {
            name:   `🤖 Bot Roles (${botList.length}/${maxRoles})`,
            value:  fmt(botList),
            inline: false,
          },
          {
            name:   '⚙️ Settings',
            value:  [
              `• Min account age: **${jrCfg.minAccountAgeDays ?? 0}** day(s)`,
              `• Delay:           **${jrCfg.delaySeconds ?? 0}** second(s)`,
              `• Module enabled:  **${cfg.modules?.joinRoles ? 'Yes ✅' : 'No ❌'}**`,
            ].join('\n'),
            inline: false,
          },
        );

      return interaction.reply({ embeds: [listEmbed], flags: MessageFlags.Ephemeral });
    }

    // ── settings ─────────────────────────────────────────────────────────────
    if (sub === 'settings') {
      const minAge = interaction.options.getInteger('min_account_age_days');
      const delay  = interaction.options.getInteger('delay_seconds');

      if (minAge === null && delay === null) {
        return interaction.reply({
          embeds: [embed.warn('Nothing to Update', 'Provide at least one setting to change.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const updates = {};
      const changes = [];

      if (minAge !== null) {
        updates['joinRoles.minAccountAgeDays'] = minAge;
        changes.push(`Min account age → **${minAge}** day(s)`);
      }
      if (delay !== null) {
        updates['joinRoles.delaySeconds'] = delay;
        changes.push(`Delay → **${delay}** second(s)`);
      }

      await GuildConfig.update(interaction.guild.id, updates);
      return interaction.reply({
        embeds: [embed.success('Settings Updated', changes.join('\n'))],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── clear ─────────────────────────────────────────────────────────────────
    if (sub === 'clear') {
      const type    = interaction.options.getString('type');
      const updates = {};
      const cleared = [];

      for (const listKey of type === 'both' ? ['humanRoles', 'botRoles'] : [`${type}Roles`]) {
        updates[`joinRoles.${listKey}`] = [];
        cleared.push(listKey);
      }

      await GuildConfig.update(interaction.guild.id, updates);
      const listLabels = cleared.map(l => l === 'humanRoles' ? 'Humans' : 'Bots').join(' & ');
      return interaction.reply({
        embeds: [embed.success('✅ Cleared', `All join roles cleared for **${listLabels}**.`)],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
