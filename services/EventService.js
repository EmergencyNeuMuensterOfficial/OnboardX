/**
 * services/EventService.js
 * Scheduled events, RSVP handling, recurring rollovers, and attendee reminders.
 */

'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');

const Event = require('../models/Event');
const embed = require('../utils/embed');
const time = require('../utils/time');
const cfg = require('../config/default');
const logger = require('../utils/logger');

class EventService {
  static async create(client, { channel, name, description, startsAt, timezone, repeat, reminderMinutes, createdBy }) {
    const startsDate = startsAt instanceof Date ? startsAt : new Date(startsAt);
    const event = await Event.create({
      guildId: channel.guild.id,
      channelId: channel.id,
      name,
      description,
      startsAt: startsDate,
      timezone,
      repeat,
      reminderMinutes,
      createdBy,
      attendees: [createdBy],
    });

    const row = this._buildActionRow(event.id);
    const eventEmbed = this._buildEventEmbed(event, channel.guild);
    const msg = await channel.send({ embeds: [eventEmbed], components: [row] });

    const updated = await Event.update(event.id, { messageId: msg.id });
    this._schedule(client, updated);
    return updated;
  }

  static async handleRsvp(interaction) {
    const eventId = interaction.customId.replace('event_rsvp_', '');
    const event = await Event.get(eventId);

    if (!event || event.cancelled || event.completed) {
      return interaction.reply({
        embeds: [embed.error('Event Unavailable', 'This event is no longer available for RSVP.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const eventTime = event.startsAt?.toDate?.() ?? new Date(event.startsAt);
    if (eventTime.getTime() <= Date.now()) {
      return interaction.reply({
        embeds: [embed.warn('Event Started', 'This event has already started.')],
        flags: MessageFlags.Ephemeral,
      });
    }

    const { event: updated, joined } = await Event.toggleAttendee(event.id, interaction.user.id);
    await this._refreshMessage(interaction.client, updated);

    return interaction.reply({
      embeds: [joined
        ? embed.success('RSVP Confirmed', `You are signed up for **${updated.name}**.`)
        : embed.info('RSVP Removed', `You are no longer signed up for **${updated.name}**.`)],
      flags: MessageFlags.Ephemeral,
    });
  }

  static async cancel(client, id) {
    const event = await Event.get(id);
    if (!event) return null;

    await Event.cancel(id);
    this._clearTimers(client, id);

    try {
      const channel = await client.channels.fetch(event.channelId).catch(() => null);
      if (channel && event.messageId) {
        const msg = await channel.messages.fetch(event.messageId).catch(() => null);
        if (msg) {
          await msg.edit({
            embeds: [this._buildEventEmbed({ ...event, cancelled: true, completed: true }, channel.guild)],
            components: [this._buildActionRow(event.id, true)],
          }).catch(() => {});
        }
      }
    } catch {
      // ignore
    }

    return event;
  }

  static async restoreEvents(client) {
    const events = await Event.listSchedulable();
    for (const event of events) {
      this._schedule(client, event);
    }
    if (events.length) logger.info(`Restored ${events.length} event schedule(s).`);
  }

  static async listUpcoming(guildId, limit = 10) {
    return Event.listUpcoming(guildId, limit);
  }

  static canManage(interaction) {
    return interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)
      || interaction.member.permissions.has(PermissionFlagsBits.ModerateMembers)
      || interaction.member.permissions.has(PermissionFlagsBits.BanMembers)
      || interaction.member.permissions.has(PermissionFlagsBits.KickMembers);
  }

  static _schedule(client, event) {
    this._clearTimers(client, event.id);

    const startsAt = event.startsAt?.toDate?.() ?? new Date(event.startsAt);
    if (!startsAt || Number.isNaN(startsAt.getTime())) return;

    const timers = {};
    const reminderAt = startsAt.getTime() - (Number(event.reminderMinutes ?? cfg.event.defaultReminderMinutes) * 60 * 1000);
    const reminderDelay = reminderAt - Date.now();
    const startDelay = startsAt.getTime() - Date.now();

    if (reminderDelay > 0) {
      timers.reminder = setTimeout(() => {
        void this._sendReminder(client, event.id);
      }, reminderDelay);
      timers.reminder.unref?.();
    } else if (!event.reminderSentAt && startDelay > 0) {
      void this._sendReminder(client, event.id);
    }

    if (startDelay > 0) {
      timers.start = setTimeout(() => {
        void this._handleStartReached(client, event.id);
      }, startDelay);
      timers.start.unref?.();
    } else {
      void this._handleStartReached(client, event.id);
    }

    client.scheduledEvents.set(event.id, timers);
  }

  static _clearTimers(client, eventId) {
    const timers = client.scheduledEvents.get(eventId);
    if (!timers) return;
    if (timers.reminder) clearTimeout(timers.reminder);
    if (timers.start) clearTimeout(timers.start);
    client.scheduledEvents.delete(eventId);
  }

  static async _sendReminder(client, eventId) {
    const event = await Event.get(eventId);
    if (!event || event.cancelled || event.completed || event.reminderSentAt) return;

    const guild = client.guilds.cache.get(event.guildId) ?? await client.guilds.fetch(event.guildId).catch(() => null);
    const channel = guild ? guild.channels.cache.get(event.channelId) ?? await client.channels.fetch(event.channelId).catch(() => null) : null;
    const startsAt = event.startsAt?.toDate?.() ?? new Date(event.startsAt);

    if (channel?.isTextBased?.()) {
      const mentions = (event.attendees ?? []).map(id => `<@${id}>`).join(' ');
      await channel.send({
        embeds: [embed.info('Event Reminder', `**${event.name}** starts ${time.relative(startsAt)}.\nTimezone: **${event.timezone}**`)],
        content: mentions || undefined,
      }).catch(() => {});
    }

    for (const userId of (event.attendees ?? [])) {
      const user = await client.users.fetch(userId).catch(() => null);
      if (!user) continue;
      await user.send({
        embeds: [embed.info('Event Reminder', `**${event.name}** in **${guild?.name ?? 'your server'}** starts ${time.relative(startsAt)}.`)],
      }).catch(() => {});
    }

    await Event.update(event.id, { reminderSentAt: new Date() });
  }

  static async _handleStartReached(client, eventId) {
    const event = await Event.get(eventId);
    if (!event || event.cancelled) return;

    if (event.repeat && event.repeat !== 'none') {
      const nextStartsAt = this._nextOccurrence(event.startsAt?.toDate?.() ?? new Date(event.startsAt), event.repeat);
      const updated = await Event.update(event.id, {
        startsAt: nextStartsAt,
        reminderSentAt: null,
        completed: false,
      });
      await this._refreshMessage(client, updated);
      this._schedule(client, updated);
      return;
    }

    const updated = await Event.update(event.id, { completed: true });
    await this._refreshMessage(client, updated, true);
    this._clearTimers(client, event.id);
  }

  static async _refreshMessage(client, event, disableButtons = false) {
    if (!event?.messageId) return;

    const guild = client.guilds.cache.get(event.guildId) ?? await client.guilds.fetch(event.guildId).catch(() => null);
    const channel = guild ? guild.channels.cache.get(event.channelId) ?? await client.channels.fetch(event.channelId).catch(() => null) : null;
    if (!channel?.messages?.fetch) return;

    const msg = await channel.messages.fetch(event.messageId).catch(() => null);
    if (!msg) return;

    await msg.edit({
      embeds: [this._buildEventEmbed(event, guild)],
      components: [this._buildActionRow(event.id, disableButtons || event.cancelled || event.completed)],
    }).catch(() => {});
  }

  static _buildActionRow(eventId, disabled = false) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`event_rsvp_${eventId}`)
        .setLabel(disabled ? 'RSVP Closed' : 'Anmelden')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(disabled)
    );
  }

  static _buildEventEmbed(event, guild) {
    const startsAt = event.startsAt?.toDate?.() ?? new Date(event.startsAt);
    const attendeeMentions = (event.attendees ?? []).slice(0, 20).map(id => `<@${id}>`).join(', ') || 'No attendees yet';
    const status = event.cancelled ? 'Cancelled' : event.completed ? 'Completed' : 'Scheduled';

    return embed.base()
      .setTitle(`Event: ${event.name}`)
      .setDescription(event.description || 'No description provided.')
      .addFields(
        { name: 'Status', value: status, inline: true },
        { name: 'Starts', value: `${time.absolute(startsAt)}\n${time.relative(startsAt)}`, inline: true },
        { name: 'Timezone', value: event.timezone || 'UTC', inline: true },
        { name: 'Repeat', value: event.repeat || 'none', inline: true },
        { name: 'Reminder', value: `${event.reminderMinutes ?? cfg.event.defaultReminderMinutes} minute(s) before`, inline: true },
        { name: 'Attendees', value: `${event.attendees?.length ?? 0}`, inline: true },
        { name: 'Signed Up', value: attendeeMentions, inline: false },
      )
      .setFooter({ text: guild ? `${guild.name} • Event ID: ${event.id}` : `Event ID: ${event.id}` });
  }

  static _nextOccurrence(date, repeat) {
    const next = new Date(date.getTime());
    if (repeat === 'daily') next.setUTCDate(next.getUTCDate() + 1);
    else if (repeat === 'weekly') next.setUTCDate(next.getUTCDate() + 7);
    else if (repeat === 'monthly') next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }
}

module.exports = EventService;
