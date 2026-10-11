// Electron Packager supplies paths relative to the project, with a leading slash.
// Keep the compiled runtime, production dependencies, guide assets, and licenses.
const runtimeFiles = new Set([
  '/dist/index.cjs',
  '/dist/lib/navigation.cjs',
  '/package.json',
  '/LICENSE',
  '/app/foodguide/LICENSE',
]);
const runtimeDirectories = ['/node_modules', '/app/foodguide/html'];
// Packager must traverse these parent directories to reach the allowed files.
const parentDirectories = new Set(['', '/', '/dist', '/dist/lib', '/app', '/app/foodguide']);

export const ignoreFile = (filePath: string) => {
  const normalized = filePath.replaceAll('\\', '/');
  if (
    /\/(?:\.git|\.github|test|tests)(?:\/|$)/.test(normalized) ||
    /\.(?:[cm]?tsx?|map)$/.test(normalized)
  ) {
    return true;
  }
  return !(
    parentDirectories.has(normalized) ||
    runtimeFiles.has(normalized) ||
    runtimeDirectories.some(
      directory => normalized === directory || normalized.startsWith(`${directory}/`),
    )
  );
};
