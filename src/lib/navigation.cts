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
