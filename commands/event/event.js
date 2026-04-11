/**
 * commands/event/event.js
 * Event and calendar management with recurring schedules and RSVP support.
 */

'use strict';

const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const EventService = require('../../services/EventService');
const Event = require('../../models/Event');
const embed = require('../../utils/embed');
const time = require('../../utils/time');
const cfg = require('../../config/default');
const { assertPermission } = require('../../utils/permissions');

const REPEAT_CHOICES = [
  { name: 'None', value: 'none' },
  { name: 'Daily', value: 'daily' },
  { name: 'Weekly', value: 'weekly' },
  { name: 'Monthly', value: 'monthly' },
];

module.exports = {
  cooldown: 5_000,

  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('Create and manage scheduled events.')

    .addSubcommand(sub => sub
      .setName('create')
      .setDescription('Create a new event.')
      .addStringOption(o => o.setName('name').setDescription('Event name').setRequired(true))
      .addStringOption(o => o.setName('date').setDescription('Date in YYYY-MM-DD').setRequired(true))
      .addStringOption(o => o.setName('time').setDescription('Time in HH:mm (24h)').setRequired(true))
      .addStringOption(o => o.setName('timezone').setDescription('IANA timezone, e.g. Europe/Berlin').setRequired(true))
      .addStringOption(o => o.setName('repeat').setDescription('Repeat schedule').addChoices(...REPEAT_CHOICES))
      .addIntegerOption(o => o.setName('reminder').setDescription('Reminder minutes before start').setMinValue(1).setMaxValue(10080))
      .addStringOption(o => o.setName('description').setDescription('Event description'))
      .addChannelOption(o => o.setName('channel').setDescription('Channel to post the event in'))
    )

    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('List upcoming events in this server.')
    )

    .addSubcommand(sub => sub
      .setName('cancel')
      .setDescription('Cancel an event.')
      .addStringOption(o => o.setName('id').setDescription('Event ID').setRequired(true))
    )

    .addSubcommand(sub => sub
      .setName('rsvp')
      .setDescription('Toggle your RSVP for an event.')
      .addStringOption(o => o.setName('id').setDescription('Event ID').setRequired(true))
    ),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'create') {
      if (!await assertPermission(interaction, 'admin')) return;

      const name = interaction.options.getString('name');
      const dateInput = interaction.options.getString('date');
      const timeInput = interaction.options.getString('time');
      const timezone = interaction.options.getString('timezone');
      const repeat = interaction.options.getString('repeat') ?? 'none';
      const reminderMinutes = interaction.options.getInteger('reminder') ?? cfg.event.defaultReminderMinutes;
      const description = interaction.options.getString('description') ?? null;
      const channel = interaction.options.getChannel('channel') ?? interaction.channel;

      if (!cfg.event.allowedRepeats.includes(repeat)) {
        return interaction.reply({
          embeds: [embed.error('Invalid Repeat', 'Repeat must be one of: none, daily, weekly, monthly.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      if (!isValidTimeZone(timezone)) {
        return interaction.reply({
          embeds: [embed.error('Invalid Timezone', 'Please provide a valid IANA timezone such as `Europe/Berlin` or `America/New_York`.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const startsAt = parseZonedDateTime(dateInput, timeInput, timezone);
      if (!startsAt) {
        return interaction.reply({
          embeds: [embed.error('Invalid Date or Time', 'Use date `YYYY-MM-DD` and time `HH:mm` (24h).')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const leadMs = startsAt.getTime() - Date.now();
      if (leadMs < cfg.event.minLeadMs || leadMs > cfg.event.maxLeadMs) {
        return interaction.reply({
          embeds: [embed.error('Invalid Start Time', 'Event start must be between 5 minutes and 365 days in the future.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const event = await EventService.create(client, {
        channel,
        name,
        description,
        startsAt,
        timezone,
        repeat,
        reminderMinutes,
        createdBy: interaction.user.id,
      });

      return interaction.editReply({
        embeds: [embed.success(
          'Event Created',
          `**${event.name}** was scheduled for ${time.absolute(startsAt)} (${time.relative(startsAt)}).\nID: \`${event.id}\``
        )],
      });
    }

    if (sub === 'list') {
      const events = await EventService.listUpcoming(interaction.guild.id, 15);
      if (!events.length) {
        return interaction.reply({
          embeds: [embed.info('No Events', 'There are no upcoming events in this server.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const lines = events.map(evt => {
        const startsAt = evt.startsAt?.toDate?.() ?? new Date(evt.startsAt);
        return `• **${evt.name}** — ${time.absolute(startsAt)} — ${evt.attendees.length} attendee(s) — \`${evt.id}\``;
      });

      return interaction.reply({
        embeds: [embed.base().setTitle('Upcoming Events').setDescription(lines.join('\n'))],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'cancel') {
      if (!await assertPermission(interaction, 'admin')) return;

      const id = interaction.options.getString('id');
      const event = await Event.get(id);
      if (!event || event.guildId !== interaction.guild.id) {
        return interaction.reply({
          embeds: [embed.error('Not Found', 'Event not found in this server.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      await EventService.cancel(client, id);
      return interaction.reply({
        embeds: [embed.success('Event Cancelled', `Cancelled **${event.name}**.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    if (sub === 'rsvp') {
      const id = interaction.options.getString('id');
      const event = await Event.get(id);
      if (!event || event.guildId !== interaction.guild.id) {
        return interaction.reply({
          embeds: [embed.error('Not Found', 'Event not found in this server.')],
          flags: MessageFlags.Ephemeral,
        });
      }

      const fakeInteraction = {
        ...interaction,
        customId: `event_rsvp_${id}`,
      };
      return EventService.handleRsvp(fakeInteraction);
    }
  },
};

function isValidTimeZone(timeZone) {
  try {
    Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function parseZonedDateTime(dateInput, timeInput, timeZone) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeInput);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  let utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 3; i += 1) {
    const offset = getTimeZoneOffset(new Date(utcGuess), timeZone);
    utcGuess -= offset;
  }

  const result = new Date(utcGuess);
  if (Number.isNaN(result.getTime())) return null;

  const parts = getParts(result, timeZone);
  if (
    parts.year !== year ||
    parts.month !== month ||
    parts.day !== day ||
    parts.hour !== hour ||
    parts.minute !== minute
  ) {
    return null;
  }

  return result;
}

function getTimeZoneOffset(date, timeZone) {
  const parts = getParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function getParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const values = Object.fromEntries(
    formatter.formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, Number(part.value)])
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}
