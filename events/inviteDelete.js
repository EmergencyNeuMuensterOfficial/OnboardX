'use strict';

const InviteTrackingService = require('../services/InviteTrackingService');

module.exports = {
  name: 'inviteDelete',
  async execute(invite) {
    await InviteTrackingService.onInviteDelete(invite);
  },
};
