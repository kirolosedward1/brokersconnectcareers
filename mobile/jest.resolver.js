const path = require('node:path');

/*
  Resolves a bare import made from the website's shared files as if it were
  made from this project — the same rule metro.config.js gives Metro, so a
  test loads exactly the packages the app bundles.
*/
const webSources = [path.resolve(__dirname, '../src/lib'), path.resolve(__dirname, '../messages')];

const isBare = (request) =>
  !request.startsWith('.') && !path.isAbsolute(request) && !request.startsWith('@/') && !request.startsWith('~/');

module.exports = (request, options) => {
  const fromWebsite = webSources.some((dir) => options.basedir === dir || options.basedir.startsWith(dir + path.sep));
  return options.defaultResolver(request, fromWebsite && isBare(request) ? { ...options, basedir: __dirname } : options);
};
