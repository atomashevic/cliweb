import { app, session as ElectronSession, type Session } from 'electron';
import { options } from './args';
import { PROFILE_PARTITION } from './profile';

export const sessionPromise = new Promise<Session>((resolve) => {
  app.whenReady().then(() => {
    const partition = options.private
      ? `cliweb-private-${process.pid}`
      : `persist:${PROFILE_PARTITION}`;
    const session = ElectronSession.fromPartition(partition);
    // pretend we're Chrome
    const userAgent = session
      .getUserAgent()
      .replace(/\sElectron\/\S+/, '')
      .replace(new RegExp(`\\s${app.getName()}/\\S+`), '');

    session.setUserAgent(userAgent);
    resolve(session);
  });
});

export async function flushSessionCookies(): Promise<void> {
  if (!app.isReady()) return;
  const session = await sessionPromise;
  if (session.isPersistent()) await session.cookies.flushStore();
}

export async function clearSiteData(rawUrl: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('The current page does not have a clearable site origin');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Site data can only be cleared for HTTP and HTTPS pages');
  }

  const session = await sessionPromise;
  await session.clearData({
    origins: [url.origin],
    dataTypes: [
      'backgroundFetch',
      'cache',
      'cookies',
      'fileSystems',
      'indexedDB',
      'localStorage',
      'serviceWorkers',
      'webSQL',
    ],
    originMatchingMode: 'origin-in-all-contexts',
  });
  if (session.isPersistent()) await session.cookies.flushStore();
  return url.origin;
}
