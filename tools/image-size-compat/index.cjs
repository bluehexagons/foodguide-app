const { readFile, readFileSync } = require('node:fs');
const parser = require('image-size-next');

// appdmg needs the pre-v2 callable API for buffers, paths, and file callbacks.
const imageSize = (input, callback) => {
  if (typeof input !== 'string') {
    return parser.imageSize(input);
  }
  if (typeof callback !== 'function') {
    return parser.imageSize(readFileSync(input));
  }
  readFile(input, (error, buffer) => {
    if (error) {
      callback(error);
      return;
    }
    let dimensions;
    try {
      dimensions = parser.imageSize(buffer);
    } catch (error) {
      callback(error);
      return;
    }
    callback(null, dimensions);
  });
};

module.exports = Object.assign(imageSize, parser, { imageSize });
