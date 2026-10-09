// Electron Packager supplies paths relative to the project, with a leading slash.
// Keep the compiled runtime, production dependencies, guide assets, and licenses.
export const ignoreFile = (filePath: string) => {
  const normalized = filePath.replaceAll('\\', '/');
  if (
    /\/(?:\.git|\.github|test|tests)(?:\/|$)/.test(normalized) ||
    /\.(?:[cm]?tsx?|map)$/.test(normalized)
  ) {
    return true;
  }
  if (['', '/', '/dist', '/dist/lib', '/app', '/app/foodguide'].includes(normalized)) {
    return false;
  }
  return !/^\/(?:dist\/(?:index\.cjs$|lib\/navigation\.cjs$)|package\.json$|LICENSE$|node_modules(?:\/|$)|app\/foodguide\/(?:LICENSE$|html(?:\/|$)))/.test(
    normalized,
  );
};
