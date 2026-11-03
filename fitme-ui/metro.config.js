const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Ensure uppercase asset extensions like .PNG and .JPG are recognized as assets
['png', 'PNG', 'jpg', 'JPG', 'jpeg', 'JPEG'].forEach((ext) => {
  if (!config.resolver.assetExts.includes(ext)) {
    config.resolver.assetExts.push(ext);
  }
});

module.exports = config;
