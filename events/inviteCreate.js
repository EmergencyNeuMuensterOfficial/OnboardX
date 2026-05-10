'use strict';

const InviteTrackingService = require('../services/InviteTrackingService');

module.exports = {
  name: 'inviteCreate',
  async execute(invite) {
    await InviteTrackingService.onInviteCreate(invite);
  },
};
