const parser = require('image-size-next');

// appdmg expects require('image-size') to be callable, including its file callback API.
module.exports = Object.assign(parser.imageSize, parser);
