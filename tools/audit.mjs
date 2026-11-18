import { spawnSync } from 'node:child_process';

const knownAdvisory = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';

export function hasOnlyKnownAdvisory(vulnerabilities) {
  const isKnown = cause => cause?.dependency === 'picomatch' && cause.url === knownAdvisory;
  return (
    Boolean(vulnerabilities?.picomatch?.via?.some(isKnown)) &&
    Object.entries(vulnerabilities).every(
      ([name, { via }]) =>
        via.length > 0 &&
        via.every(cause =>
          typeof cause === 'string'
            ? Object.hasOwn(vulnerabilities, cause)
            : name === 'picomatch' && isKnown(cause),
        ),
    )
  );
}

if (import.meta.main) {
  const result = spawnSync(process.execPath, [process.env.npm_execpath, 'audit', '--json'], {
    encoding: 'utf8',
  });
  if (result.error) {
    throw result.error;
  }
  const report = JSON.parse(result.stdout);
  if (result.status === 0) {
    console.log('Full desktop audit found no vulnerabilities.');
  } else if (result.status === 1 && !report.error && hasOnlyKnownAdvisory(report.vulnerabilities)) {
    console.warn(`Known advisory in desktop build tooling with no upstream fix: ${knownAdvisory}`);
  } else {
    console.error(result.stderr + result.stdout);
    process.exitCode = result.status || 1;
  }
}
