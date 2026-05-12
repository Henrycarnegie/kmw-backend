'use strict';

module.exports = {
  async index(ctx) {
    const plans = await strapi.entityService.findMany('api::subscription-plan.subscription-plan');
    ctx.body = plans;
  }
};
