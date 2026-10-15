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
  const destination = new URL('https://foodguide.bluehexagons.com/');
  destination.hash = new URL(value).hash;
  return destination.href;
};
