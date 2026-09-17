const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

config.maxWorkers = 2;

module.exports = withNativeWind(config, { input: "./global.css" });

