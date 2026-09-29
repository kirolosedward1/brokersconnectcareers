// Learn more https://docs.expo.dev/guides/customizing-metro
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

/*
  The app shares code with the website, which lives one directory up:
  pure modules under ../src/lib (imported as `@/lib/...`, the website's own
  alias) and the message catalogues in ../messages. Metro has to watch those
  folders to bundle them, and nothing else of the website.

  A bare import made from one of the website's files (`zod`, say) would
  otherwise resolve by walking up from ../src/lib into the website's own
  node_modules: a second copy of the package, and on an EAS builder — which
  installs only this project — no copy at all. So such imports are resolved
  as if made from this project. Everything else resolves normally, including
  the nested node_modules a hoisted install still has.
*/
const projectRoot = __dirname;
const webRoot = path.resolve(projectRoot, '..');
const webSources = [path.join(webRoot, 'src', 'lib'), path.join(webRoot, 'messages')];

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), ...webSources];

const isBare = (name) =>
  !name.startsWith('.') && !name.startsWith('/') && !name.startsWith('@/') && !name.startsWith('~/');

const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const next = upstream ?? context.resolveRequest;
  const fromWebsite = webSources.some((dir) => context.originModulePath.startsWith(dir + path.sep));
  if (fromWebsite && isBare(moduleName)) {
    return next({ ...context, originModulePath: path.join(projectRoot, 'package.json') }, moduleName, platform);
  }
  return next(context, moduleName, platform);
};

module.exports = config;
