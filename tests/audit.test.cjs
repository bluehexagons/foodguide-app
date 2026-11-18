const assert = require('node:assert/strict');
const { test } = require('node:test');

const knownAdvisory = {
  dependency: 'picomatch',
  url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
};

test('the full desktop audit allows only the known advisory and its dependency effects', async () => {
  const { hasOnlyKnownAdvisory } = await import('../tools/audit.mjs');
  const known = {
    picomatch: { via: [knownAdvisory] },
    tinyglobby: { via: ['picomatch'] },
    'node-gyp': { via: ['tinyglobby'] },
  };
  assert(hasOnlyKnownAdvisory(known));
  assert(!hasOnlyKnownAdvisory({}));
  assert(!hasOnlyKnownAdvisory({ ...known, other: { via: ['missing'] } }));
  assert(!hasOnlyKnownAdvisory({ ...known, other: { via: [knownAdvisory] } }));
  assert(
    !hasOnlyKnownAdvisory({
      ...known,
      picomatch: { via: [knownAdvisory, { ...knownAdvisory, url: 'other-advisory' }] },
    }),
  );
});
