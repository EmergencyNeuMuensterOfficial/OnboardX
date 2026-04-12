// netlify/functions/stats.js
// Returns: guild info, channels, roles, and basic member/message stats from MongoDB

const { verifyToken, botFetch, getDb, ok, err, options, getManagedGuildAccess } = require('./_utils');

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return options();

  try {
    const user = verifyToken(event.headers.authorization);
    const guildId = event.queryStringParameters?.guildId;
    if (!guildId) return err('Missing guildId');

    const access = await getManagedGuildAccess(user.discordToken, guildId);
    if (!access.allowed) return err('Forbidden', 403, { reason: access.reason });

    // Fetch guild info, channels, and roles in parallel (via bot token)
    const startedAt = Date.now();
    const [guild, channels, roles] = await Promise.all([
      botFetch(`/guilds/${guildId}?with_counts=true`),
      botFetch(`/guilds/${guildId}/channels`),
      botFetch(`/guilds/${guildId}/roles`),
    ]);

    // Text channels only
    const textChannels = channels
      .filter((c) => c.type === 0 || c.type === 5) // text + announcement
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ id: c.id, name: c.name, type: c.type }));

    // Roles (excluding @everyone)
    const cleanRoles = roles
      .filter((r) => r.id !== guildId)
      .sort((a, b) => b.position - a.position)
      .map((r) => ({ id: r.id, name: r.name, color: r.color }));

    // Stats from MongoDB
    const db = await getDb();
    const statsCol = db.collection('guild_stats');
    const dbStats = await statsCol.findOne({ guildId }, { projection: { _id: 0 } });

    return ok({
      guild: {
        id:            guild.id,
        name:          guild.name,
        icon:          guild.icon
          ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`
          : null,
        memberCount:   guild.approximate_member_count ?? guild.member_count ?? 0,
        onlineCount:   guild.approximate_presence_count ?? 0,
        boostLevel:    guild.premium_tier,
        boostCount:    guild.premium_subscription_count ?? 0,
      },
      channels: textChannels,
      roles:    cleanRoles,
      stats: {
        messagesTotal:  dbStats?.messagesTotal  ?? 0,
        messagesToday:  dbStats?.messagesToday  ?? 0,
        openTickets:    dbStats?.openTickets    ?? 0,
        automodActions: dbStats?.automodActions ?? 0,
        warnsTotal:     dbStats?.warnsTotal     ?? 0,
        bansTotal:      dbStats?.bansTotal      ?? 0,
      },
      meta: {
        apiLatencyMs: Date.now() - startedAt,
      },
    });
  } catch (e) {
    if (e.name === 'JsonWebTokenError' || e.message === 'No token') return err('Unauthorized', 401);
    console.error('stats error:', e);
    return err('Internal error', 500);
  }
};
