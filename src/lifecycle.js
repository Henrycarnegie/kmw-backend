module.exports = {
  async afterCreate(event) {
    const { result } = event;

    if (result.status === "PAID") {
      const startDate = new Date();

      const endDate = new Date();
      endDate.setDate(endDate.getDate() + 30);

      await strapi.entityService.create(
        "api::membership.membership",
        {
          data: {
            user: result.user,
            subscription: result.subscription,
            startDate,
            endDate,
            status: "ACTIVE",
          },
        }
      );
    }
  },
};