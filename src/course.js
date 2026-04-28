// Restricts courses based on the membership
module.exports = {
  async find(ctx) {
    const user = ctx.state.user;

    if (!user) {
      // only free courses
      return await strapi.entityService.findMany("api::course.course", {
        filters: { accessType: "FREE" },
      });
    }

    const membership = await strapi.entityService.findMany(
      "api::membership.membership",
      {
        filters: { user: user.id, status: "ACTIVE" },
      }
    );

    if (!membership.length) {
      return await strapi.entityService.findMany("api::course.course", {
        filters: { accessType: "FREE" },
      });
    }

    // member sees free + member courses
    return await strapi.entityService.findMany("api::course.course", {
      filters: {
        accessType: { $in: ["FREE", "MEMBER"] },
      },
    });
  },
};