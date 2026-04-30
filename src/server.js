'use strict';

module.exports = (plugin) => {
  
    // get Membership role
   
  const getMembershipRole = async () => {
    return await strapi
      .query('plugin::users-permissions.role')
      .findOne({
        where: { type: 'membership' },
      });
  };

  
//    REGISTER (SIGNUP)
  
  const originalRegister = plugin.controllers.auth.register;

  plugin.controllers.auth.register = async (ctx) => {
    // Run default register
    await originalRegister(ctx);

    const user = ctx.body.user;

    if (!user) return;

    const membershipRole = await getMembershipRole();

    if (membershipRole) {
      // Assign role
      await strapi
        .query('plugin::users-permissions.user')
        .update({
          where: { id: user.id },
          data: {
            role: membershipRole.id,
          },
        });

      // Attach role to response
      ctx.body.user.role = membershipRole;
    }
  };

 
   //    LOGIN
   
  const originalCallback = plugin.controllers.auth.callback;

  plugin.controllers.auth.callback = async (ctx) => {
    // Run default login
    await originalCallback(ctx);

    const user = ctx.body.user;

    if (!user) return;

    // Get full user with role
    const fullUser = await strapi
      .query('plugin::users-permissions.user')
      .findOne({
        where: { id: user.id },
        populate: ['role'],
      });

    if (fullUser) {
      ctx.body.user.role = fullUser.role;
    }
  };

  return plugin;
};