// Electron Packager supplies paths relative to the project, with a leading slash.
// Keep only the wrapper, runtime dependencies, guide assets, and licenses.
const ignoreFile = filePath => {
  const normalized = filePath.replaceAll('\\', '/');
  if (/\/(?:\.git|\.github|test|tests)(?:\/|$)/.test(normalized)) {
    return true;
  }
  if (['', '/', '/app', '/app/foodguide'].includes(normalized)) {
    return false;
  }
  return !/^\/(?:index\.js$|package\.json$|LICENSE$|lib(?:\/|$)|node_modules(?:\/|$)|app\/foodguide\/(?:LICENSE$|html(?:\/|$)))/.test(
    normalized,
  );
};

module.exports = { ignoreFile };
