'use strict';

/**
 * forum-thread service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::forum-thread.forum-thread');
