// business logic related to membership


module.exports = ({ strapi }) => ({
  calculateEndDate(startDate, durationDays) {
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + durationDays);
    return endDate;
  },
});