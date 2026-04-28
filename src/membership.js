const addDays = (date, days) => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};

module.exports = ({ strapi }) => ({

  calculateEndDate(startDate, durationDays) {
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + durationDays);
    return endDate;
  },

  async tryActivateMembership(membershipId) {
    const membership = await strapi.entityService.findOne(
      "api::membership.membership",
      membershipId,
      { populate: ["payment"] }
    );

    const formSubmitted = membership.googleFormSubmitted;
    const paymentPaid = membership.payment?.status === "PAID";

    if (formSubmitted && paymentPaid) {
      return await strapi.entityService.update(
        "api::membership.membership",
        membershipId,
        {
          data: {
            membershipStatus: "active",
            startDate: new Date(),
            endDate: addDays(new Date(), 365),
          },
        }
      );
    }
  },

});