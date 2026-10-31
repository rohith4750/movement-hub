// Movement Hub mobile is a standalone project inside the monorepo (not an npm workspace),
// so it keeps its own React / React Native versions. Pin Metro to this folder's node_modules
// so it never picks up the web app's React from the repo root.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [__dirname];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];

module.exports = config;
