const releasePage = 'https://github.com/bluehexagons/foodguide-app/releases';
const releaseApi = 'https://api.github.com/repos/bluehexagons/foodguide-app/releases/latest';

interface Download {
  label: string;
  url: string;
}

function versionParts(version: string) {
  const match = /^(\d{1,8})\.(\d{1,8})\.(\d{1,8})(?:-app\.(\d{1,8}))?$/.exec(version);
  if (!match) {
    throw new Error('Unsupported desktop version');
  }
  const [, major, minor, patch, desktop] = match;
  return [Number(major), Number(minor), Number(patch), desktop ? Number(desktop) : Infinity];
}

export function isNewerDesktopVersion(candidate: string, current: string) {
  const installed = versionParts(current);
  const available = versionParts(candidate);
  const index = available.findIndex((value, position) => value !== installed[position]);
  return index >= 0 && available[index] > installed[index];
}

function releaseDownloads(
  version: string,
  names: Set<string>,
  platform: NodeJS.Platform,
  arch: string,
) {
  const prefix = `foodguide-app-${version}`;
  const downloads: Download[] = [];
  const addDownload = (name: string, label: string) => {
    if (names.has(name)) {
      downloads.push({
        label,
        url: `${releasePage}/download/v${version}/${encodeURIComponent(name)}`,
      });
    }
  };
  if (platform === 'win32') {
    const portable = `foodguide-app-win32-${arch}-${version}.zip`;
    // The installer filename omits architecture. Confirm it with the matching ZIP.
    if (names.has(portable)) {
      const setup = `${prefix} Setup.exe`;
      addDownload(names.has(setup) ? setup : `${prefix}.Setup.exe`, 'Download Installer');
      addDownload(portable, 'Download Portable ZIP');
    }
  }
  if (platform === 'linux') {
    const debArch = arch === 'x64' ? 'amd64' : arch;
    addDownload(`${prefix}-${arch}.AppImage`, 'Download AppImage');
    addDownload(`foodguide-app_${version}_${debArch}.deb`, 'Download Debian Package');
  }
  return downloads;
}

export async function checkForDesktopUpdate(
  current: string,
  platform: NodeJS.Platform,
  arch: string,
  fetchRelease: (url: string, options: RequestInit) => Promise<Response>,
) {
  const response = await fetchRelease(releaseApi, {
    headers: { Accept: 'application/vnd.github+json' },
    credentials: 'omit',
    redirect: 'error',
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`Release check returned HTTP ${response.status}`);
  }
  const release = (await response.json()) as {
    tag_name?: unknown;
    draft?: unknown;
    prerelease?: unknown;
    assets?: { name?: unknown }[];
  };
  if (
    typeof release?.tag_name !== 'string' ||
    !release.tag_name.startsWith('v') ||
    release.draft !== false ||
    release.prerelease !== false ||
    !Array.isArray(release.assets)
  ) {
    throw new Error('Unexpected release information');
  }
  const version = release.tag_name.slice(1);
  if (!isNewerDesktopVersion(version, current)) {
    return null;
  }
  const names = new Set(
    release.assets.flatMap(asset => (typeof asset?.name === 'string' ? [asset.name] : [])),
  );
  return {
    version,
    notesUrl: `${releasePage}/tag/v${version}`,
    downloads: releaseDownloads(version, names, platform, arch),
  };
}
