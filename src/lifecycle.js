module.exports = {
  async afterCreate(event) {
    const { result } = event;

    try {
      if (result.status === "PAID") {
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + 365);

        await strapi.entityService.create("api::membership.membership", {
          data: {
            user: result.user?.id || result.user,
            subscription: result.subscription,
            startDate,
            endDate,
            status: "ACTIVE",
          },
        });
      }
    } catch (err) {
      strapi.log.error("Membership lifecycle error:", err);
    }
  },
};