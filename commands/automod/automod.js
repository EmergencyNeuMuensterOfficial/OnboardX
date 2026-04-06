/**
 * commands/automod/automod.js
 * Configure auto-moderation and anti-spam settings.
 */

'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const GuildConfig          = require('../../models/GuildConfig');
const embed                = require('../../utils/embed');
const { assertPermission } = require('../../utils/permissions');

module.exports = {
  cooldown: 5_000,

  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Configure auto-moderation filters.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

    .addSubcommand(sub => sub
      .setName('antispam')
      .setDescription('Configure anti-spam settings.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable or disable anti-spam').setRequired(true))
      .addIntegerOption(o => o.setName('msg_limit').setDescription('Max messages per window (default: 6)').setMinValue(2).setMaxValue(30))
      .addIntegerOption(o => o.setName('msg_window').setDescription('Window in seconds (default: 5)').setMinValue(1).setMaxValue(30))
      .addIntegerOption(o => o.setName('mention_limit').setDescription('Max mentions per message (default: 5)').setMinValue(2).setMaxValue(20))
      .addStringOption(o => o.setName('punishment').setDescription('Punishment for spam').addChoices(
        { name: 'Delete only', value: 'delete' },
        { name: 'Timeout (10m)', value: 'mute' },
        { name: 'Kick', value: 'kick' },
        { name: 'Ban', value: 'ban' },
      )))

    .addSubcommand(sub => sub
      .setName('wordfilter')
      .setDescription('Manage the blocked word list.')
      .addStringOption(o => o.setName('action').setDescription('Action').setRequired(true).addChoices(
        { name: 'Add word', value: 'add' },
        { name: 'Remove word', value: 'remove' },
        { name: 'List words', value: 'list' },
        { name: 'Clear all', value: 'clear' },
        { name: 'Toggle on/off', value: 'toggle' },
      ))
      .addStringOption(o => o.setName('word').setDescription('Word or phrase to add/remove')))

    .addSubcommand(sub => sub
      .setName('invitefilter')
      .setDescription('Block Discord invite links in messages.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable or disable').setRequired(true)))

    .addSubcommand(sub => sub
      .setName('linkfilter')
      .setDescription('Block external links (with optional whitelist).')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable or disable').setRequired(true))
      .addStringOption(o => o.setName('whitelist_add').setDescription('Domain to whitelist (e.g. youtube.com)'))
      .addStringOption(o => o.setName('whitelist_remove').setDescription('Whitelisted domain to remove')))

    .addSubcommand(sub => sub
      .setName('capsfilter')
      .setDescription('Filter messages with excessive CAPS.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable or disable').setRequired(true))
      .addIntegerOption(o => o.setName('threshold').setDescription('Caps % to trigger (default: 70)').setMinValue(30).setMaxValue(100)))

    .addSubcommand(sub => sub
      .setName('zalgofilter')
      .setDescription('Filter unicode/zalgo abuse.')
      .addBooleanOption(o => o.setName('enabled').setDescription('Enable or disable').setRequired(true))
      .addIntegerOption(o => o.setName('threshold').setDescription('Combining characters required to trigger').setMinValue(1).setMaxValue(50)))

    .addSubcommand(sub => sub
      .setName('status')
      .setDescription('View current automod configuration.')),

  async execute(interaction) {
    if (!await assertPermission(interaction, 'admin')) return;

    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'antispam') {
      const enabled    = interaction.options.getBoolean('enabled');
      const msgLimit   = interaction.options.getInteger('msg_limit');
      const msgWindow  = interaction.options.getInteger('msg_window');
      const mentionLim = interaction.options.getInteger('mention_limit');
      const punishment = interaction.options.getString('punishment');

      const updates = { 'modules.antispam': enabled };
      if (msgLimit !== null) updates['antispam.msgLimit'] = msgLimit;
      if (msgWindow !== null) updates['antispam.msgWindow'] = msgWindow * 1000;
      if (mentionLim !== null) updates['antispam.mentionLimit'] = mentionLim;
      if (punishment) updates['antispam.punishment'] = punishment;

      await GuildConfig.update(guildId, updates);
      return interaction.reply({
        embeds: [embed.success('Anti-Spam Updated', `Anti-spam is now **${enabled ? 'enabled' : 'disabled'}**.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'wordfilter') {
      const action = interaction.options.getString('action');
      const word   = interaction.options.getString('word')?.toLowerCase().trim();
      const cfg    = await GuildConfig.get(guildId);
      const words  = cfg.automod?.wordFilter?.words ?? [];

      if (action === 'toggle') {
        const current = cfg.automod?.wordFilter?.enabled ?? false;
        await GuildConfig.update(guildId, { 'automod.wordFilter.enabled': !current, 'modules.automod': true });
        return interaction.reply({
          embeds: [embed.success('Word Filter', `Word filter is now **${!current ? 'enabled' : 'disabled'}**.`)],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (action === 'add') {
        if (!word) return interaction.reply({ embeds: [embed.error('Missing Word', 'Please provide a word to add.')], flags: MessageFlags.Ephemeral });
        if (words.includes(word)) return interaction.reply({ embeds: [embed.warn('Duplicate', `\`${word}\` is already in the word filter.`)], flags: MessageFlags.Ephemeral });
        await GuildConfig.update(guildId, {
          'automod.wordFilter.words': [...words, word],
          'automod.wordFilter.enabled': true,
          'modules.automod': true,
        });
        return interaction.reply({ embeds: [embed.success('Word Added', `\`${word}\` added to the filter.`)], flags: MessageFlags.Ephemeral });
      }

      if (action === 'remove') {
        if (!word) return interaction.reply({ embeds: [embed.error('Missing Word', 'Please provide a word to remove.')], flags: MessageFlags.Ephemeral });
        const updated = words.filter(w => w !== word);
        await GuildConfig.update(guildId, { 'automod.wordFilter.words': updated });
        return interaction.reply({ embeds: [embed.success('Word Removed', `\`${word}\` removed from the filter.`)], flags: MessageFlags.Ephemeral });
      }

      if (action === 'list') {
        if (!words.length) return interaction.reply({ embeds: [embed.info('Word Filter', 'No words in the filter yet.')], flags: MessageFlags.Ephemeral });
        return interaction.reply({
          embeds: [embed.base().setTitle('Blocked Words').setDescription(words.map(w => `\`${w}\``).join(', '))],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (action === 'clear') {
        await GuildConfig.update(guildId, { 'automod.wordFilter.words': [] });
        return interaction.reply({ embeds: [embed.success('Cleared', 'All words removed from the filter.')], flags: MessageFlags.Ephemeral });
      }
    }

    if (sub === 'invitefilter') {
      const enabled = interaction.options.getBoolean('enabled');
      await GuildConfig.update(guildId, { 'automod.inviteFilter.enabled': enabled, 'modules.automod': true });
      return interaction.reply({
        embeds: [embed.success('Invite Filter', `Invite link filter is now **${enabled ? 'enabled' : 'disabled'}**.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'linkfilter') {
      const enabled      = interaction.options.getBoolean('enabled');
      const addDomain    = interaction.options.getString('whitelist_add');
      const removeDomain = interaction.options.getString('whitelist_remove');
      const cfg          = await GuildConfig.get(guildId);
      const whitelist    = cfg.automod?.linkFilter?.whitelist ?? [];

      let nextWhitelist = whitelist;
      if (addDomain) {
        const normalized = addDomain.toLowerCase();
        if (!nextWhitelist.includes(normalized)) nextWhitelist = [...nextWhitelist, normalized];
      }
      if (removeDomain) {
        const normalized = removeDomain.toLowerCase();
        nextWhitelist = nextWhitelist.filter(domain => domain !== normalized);
      }

      await GuildConfig.update(guildId, {
        'automod.linkFilter.enabled': enabled,
        'automod.linkFilter.whitelist': nextWhitelist,
        'modules.automod': true,
      });

      return interaction.reply({
        embeds: [embed.success('Link Filter', `Link filter **${enabled ? 'enabled' : 'disabled'}**.${addDomain ? ` Added \`${addDomain}\` to whitelist.` : ''}${removeDomain ? ` Removed \`${removeDomain}\` from whitelist.` : ''}`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'capsfilter') {
      const enabled   = interaction.options.getBoolean('enabled');
      const threshold = interaction.options.getInteger('threshold');

      const updates = { 'automod.capsFilter.enabled': enabled, 'modules.automod': true };
      if (threshold !== null) updates['automod.capsFilter.threshold'] = threshold;

      await GuildConfig.update(guildId, updates);
      return interaction.reply({
        embeds: [embed.success('Caps Filter', `Caps filter **${enabled ? 'enabled' : 'disabled'}**${threshold !== null ? ` at **${threshold}%**` : ''}.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'zalgofilter') {
      const enabled = interaction.options.getBoolean('enabled');
      const threshold = interaction.options.getInteger('threshold');

      const updates = { 'automod.zalgoFilter.enabled': enabled, 'modules.automod': true };
      if (threshold !== null) updates['automod.zalgoFilter.threshold'] = threshold;

      await GuildConfig.update(guildId, updates);
      return interaction.reply({
        embeds: [embed.success('Zalgo Filter', `Zalgo filter **${enabled ? 'enabled' : 'disabled'}**${threshold !== null ? ` at **${threshold}** marks` : ''}.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'status') {
      const cfg = await GuildConfig.get(guildId);
      const am  = cfg.automod ?? {};
      const sp  = cfg.antispam ?? {};

      return interaction.reply({
        embeds: [embed.base()
          .setTitle('AutoMod Status')
          .addFields(
            { name: 'Anti-Spam', value: cfg.modules?.antispam ? `ON Punishment: ${sp.punishment ?? 'delete'}` : 'OFF Disabled', inline: false },
            { name: 'Word Filter', value: am.wordFilter?.enabled ? `ON ${am.wordFilter?.words?.length ?? 0} words` : 'OFF Disabled', inline: true },
            { name: 'Invite Filter', value: am.inviteFilter?.enabled ? 'ON Enabled' : 'OFF Disabled', inline: true },
            { name: 'Link Filter', value: am.linkFilter?.enabled ? `ON ${am.linkFilter?.whitelist?.length ?? 0} whitelisted` : 'OFF Disabled', inline: true },
            { name: 'Caps Filter', value: am.capsFilter?.enabled ? `ON @${am.capsFilter?.threshold ?? 70}%` : 'OFF Disabled', inline: true },
            { name: 'Zalgo Filter', value: am.zalgoFilter?.enabled ? `ON ${am.zalgoFilter?.threshold ?? 10} marks` : 'OFF Disabled', inline: true },
          )],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
