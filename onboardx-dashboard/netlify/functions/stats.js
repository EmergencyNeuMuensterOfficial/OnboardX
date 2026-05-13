// netlify/functions/stats.js

const { verifyToken, botFetch, getDb, ok, err, options, getManagedGuildAccess } = require('./_utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();

  try {
    const user = verifyToken(event.headers.authorization || event.headers.Authorization);
    const guildId = event.queryStringParameters?.guildId;
    if (!guildId || !/^\d+$/.test(guildId)) {
      return err('Missing or invalid guildId', 400);
    }

    const access = await getManagedGuildAccess(user, guildId);
    if (!access.allowed) return err('Forbidden', 403, { reason: access.reason });

    const startedAt = Date.now();
    let degradedReason = access.warning || null;
    let guild = null;
    let channels = [];
    let roles = [];

    try {
      [guild, channels, roles] = await Promise.all([
        botFetch(`/guilds/${guildId}?with_counts=true`),
        botFetch(`/guilds/${guildId}/channels`),
        botFetch(`/guilds/${guildId}/roles`),
      ]);
    } catch (botError) {
      degradedReason = botError.message;
      guild = access.guild || { id: guildId, name: `Server ${guildId}`, icon: null };
      channels = [];
      roles = [];
    }

    const textChannels = channels
      .filter((channel) => channel.type === 0 || channel.type === 5)
      .sort((a, b) => a.position - b.position)
      .map((channel) => ({ id: channel.id, name: channel.name, type: channel.type }));

    const voiceChannels = channels
      .filter((channel) => channel.type === 2)
      .sort((a, b) => a.position - b.position)
      .map((channel) => ({ id: channel.id, name: channel.name, type: channel.type }));

    const categories = channels
      .filter((channel) => channel.type === 4)
      .sort((a, b) => a.position - b.position)
      .map((channel) => ({ id: channel.id, name: channel.name, type: channel.type }));

    const cleanRoles = roles
      .filter((role) => role.id !== guildId)
      .sort((a, b) => b.position - a.position)
      .map((role) => ({ id: role.id, name: role.name, color: role.color }));

    let dbStats = {};
    try {
      const db = await getDb();
      const statsCol = db.collection('guild_stats');
      dbStats = (await statsCol.findOne({ guildId }, { projection: { _id: 0 } })) || {};
    } catch (dbError) {
      console.error('stats db warning:', dbError.message);
    }

    return ok({
      guild: {
        id: guild.id,
        name: guild.name,
        icon: guild.icon
          ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
          : null,
        memberCount: guild.approximate_member_count ?? guild.member_count ?? 0,
        onlineCount: guild.approximate_presence_count ?? 0,
        boostLevel: guild.premium_tier ?? 0,
        boostCount: guild.premium_subscription_count ?? 0,
      },
      channels: textChannels,
      voiceChannels,
      categories,
      roles: cleanRoles,
      stats: {
        messagesTotal: dbStats.messagesTotal ?? 0,
        messagesToday: dbStats.messagesToday ?? 0,
        openTickets: dbStats.openTickets ?? 0,
        automodActions: dbStats.automodActions ?? 0,
        warnsTotal: dbStats.warnsTotal ?? 0,
        bansTotal: dbStats.bansTotal ?? 0,
      },
      meta: {
        apiLatencyMs: Date.now() - startedAt,
        degraded: Boolean(degradedReason),
        degradedReason,
      },
    });
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.name === 'TokenExpiredError' || e.message === 'No token') {
      return err('Unauthorized', 401);
    }
    console.error('stats error:', e);
    return err('Internal error', 500, { details: e.message, code: e.code ?? null });
  }
};
