import { app } from 'electron';
import path from 'node:path';
import { migrateLegacyPartition } from './profileMigration';

export const PROFILE_PARTITION = 'custom-cliweb';

export type ProfilePaths = {
  userData: string;
  sessionData: string;
  partition: string;
  legacyPartition: string;
  migratedLegacyPartition: boolean;
};

/** Configure cliweb's identity and storage roots before Electron becomes ready. */
export function configureProfile(): ProfilePaths {
  const appData = app.getPath('appData');
  const userData = path.join(appData, 'cliweb');
  const partition = path.join(userData, 'Partitions', PROFILE_PARTITION);
  const legacyPartition = path.join(appData, 'Electron', 'Partitions', PROFILE_PARTITION);

  app.setName('cliweb');
  app.setPath('userData', userData);
  app.setPath('sessionData', userData);

  const migratedLegacyPartition = migrateLegacyPartition(legacyPartition, partition);
  return {
    userData,
    sessionData: userData,
    partition,
    legacyPartition,
    migratedLegacyPartition,
  };
}
