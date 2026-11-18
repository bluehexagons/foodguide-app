export const isExternalUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
};

export const isGuideUrl = (value: string, entryUrl: string) => {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href === entryUrl;
  } catch {
    return false;
  }
};

/** Share a web destination rather than leaking the desktop installation's file path. */
export const shareGuideUrl = (value: string, entryUrl: string) => {
  if (!isGuideUrl(value, entryUrl)) {
    return null;
  }
  const destination = new URL(publicGuideUrl);
  destination.hash = new URL(value).hash;
  return destination.href;
};
const publicGuideUrl = 'https://foodguide.bluehexagons.com/';
const developmentGuideUrl = 'https://bluehexagons.github.io/foodguide/';

/** Open a shared fragment on the bundled guide without loading the web page. */
export function bundledGuideLink(value: string, entryUrl: string) {
  if (value.length > 132_000) {
    return null;
  }
  try {
    const link = new URL(value.trim());
    const { hash } = link;
    link.hash = '';
    link.pathname = link.pathname.replace(/\/index\.html?$/, '/');
    if (link.href !== publicGuideUrl && link.href !== developmentGuideUrl) {
      return null;
    }
    return entryUrl + hash;
  } catch {
    return null;
  }
}

/** Copy the source Simulator route and its four slot values into a new window. */
export function companionGuideLink(
  entryUrl: string,
  snapshot: { simulator: string; ingredients: string[] } | undefined,
) {
  const fallback = `${entryUrl}#simulator`;
  if (!snapshot || !isGuideUrl(snapshot.simulator, entryUrl)) {
    return fallback;
  }
  const [tab, query] = new URL(snapshot.simulator).hash.split('?');
  if (tab !== '#simulator') {
    return fallback;
  }
  const params = new URLSearchParams(query);
  params.set('ingredients', snapshot.ingredients.join(','));
  return `${fallback}?${params}`;
}
