export default (config) => {
  config.server = {
    ...config.server,
    hmr: false, // This kills the blinking dead
  };
  return config;
};
