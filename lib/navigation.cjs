const isExternalUrl = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
};

const isGuideUrl = (value, entryUrl) => {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.href === entryUrl;
  } catch {
    return false;
  }
};

module.exports = { isExternalUrl, isGuideUrl };
