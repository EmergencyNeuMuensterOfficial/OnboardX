'use strict';

const crypto = require('crypto');
const GuildConfig = require('../models/GuildConfig');
const logger = require('../utils/logger');

const PROVIDER_URLS = [
  'webhookUrl',
  'zapierWebhookUrl',
  'iftttWebhookUrl',
  'notionWebhookUrl',
  'googleSheetsWebhookUrl',
];

class IntegrationService {
  static async emit(guild, event, payload = {}) {
    try {
      const guildId = typeof guild === 'string' ? guild : guild?.id;
      if (!guildId) return;

      const config = await GuildConfig.get(guildId);
      if (config.premium !== true || config.integrations?.enabled !== true) return;

      const enabledEvents = Array.isArray(config.integrations.events) ? config.integrations.events : [];
      if (enabledEvents.length && !enabledEvents.includes(event)) return;

      const urls = PROVIDER_URLS
        .map((key) => config.integrations?.[key])
        .filter((url) => typeof url === 'string' && /^https?:\/\//i.test(url));
      if (!urls.length) return;

      const body = JSON.stringify({
        event,
        guildId,
        guildName: guild?.name ?? null,
        timestamp: new Date().toISOString(),
        payload,
      });
      const headers = {
        'content-type': 'application/json',
        'user-agent': 'OnboardX-Integrations/1.0',
      };

      if (config.integrations.secret) {
        headers['x-onboardx-signature'] = crypto
          .createHmac('sha256', String(config.integrations.secret))
          .update(body)
          .digest('hex');
      }

      await Promise.all(urls.map((url) => postJson(url, body, headers)));
    } catch (err) {
      logger.warn(`Integration emit failed (${event}): ${err.message}`);
    }
  }
}

async function postJson(url, body, headers) {
  const response = await fetch(url, { method: 'POST', headers, body });
  if (!response.ok) {
    throw new Error(`${url} responded ${response.status}`);
  }
}

module.exports = IntegrationService;
