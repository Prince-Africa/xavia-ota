import mime from 'mime';
import moment from 'moment';

import { HashHelper } from './HashHelper';
import { ZipHelper } from './ZipHelper';
import { DatabaseFactory } from '../database/DatabaseFactory';

export class NoUpdateAvailableError extends Error {}
export type GetAssetMetadataArg =
  | {
      updateBundlePath: string;
      filePath: string;
      ext: null;
      isLaunchAsset: true;
      runtimeVersion: string;
      updateId: string;
      platform: string;
    }
  | {
      updateBundlePath: string;
      filePath: string;
      ext: string;
      isLaunchAsset: false;
      runtimeVersion: string;
      updateId: string;
      platform: string;
    };

export class UpdateHelper {
  // Bundles are named by their UTC publish time (YYYYMMDDHHmmss.zip), and that name is what
  // decides which update devices receive. File creation times are unreliable (Linux volumes
  // often report 1970), so prefer this.
  static getPublishedAtFromFileName(fileName: string): string | null {
    const parsed = moment.utc(fileName.replace(/\.zip$/, ''), 'YYYYMMDDHHmmss', true);
    return parsed.isValid() ? parsed.toISOString() : null;
  }

  static async getLatestUpdateBundlePathForRuntimeVersionAsync(
    runtimeVersion: string
  ): Promise<string> {
    const release = await DatabaseFactory.getDatabase().getLatestReleaseRecordForRuntimeVersion(
      runtimeVersion
    );
    if (!release) throw new NoUpdateAvailableError();
    return release.path.replace(/\.zip$/, '');
  }

  static async getAssetMetadataAsync(arg: GetAssetMetadataArg) {
    const zip = await ZipHelper.getZipFromStorage(arg.updateBundlePath);
    const asset = await ZipHelper.getFileFromZip(zip, arg.filePath);

    const assetHash = HashHelper.getBase64URLEncoding(
      HashHelper.createHash(asset, 'sha256', 'base64')
    );
    const key = HashHelper.createHash(asset, 'md5', 'hex');
    const keyExtensionSuffix = arg.isLaunchAsset ? 'bundle' : arg.ext;
    const contentType = arg.isLaunchAsset ? 'application/javascript' : mime.getType(arg.ext);

    return {
      hash: assetHash,
      key,
      fileExtension: `.${keyExtensionSuffix}`,
      contentType,
      url: `${process.env.HOST}/api/assets?asset=${encodeURIComponent(
        arg.filePath
      )}&runtimeVersion=${encodeURIComponent(arg.runtimeVersion)}&updateId=${encodeURIComponent(
        arg.updateId
      )}&platform=${arg.platform}`,
    };
  }

  static async getMetadataAsync({
    updateBundlePath,
    runtimeVersion,
  }: {
    updateBundlePath: string;
    runtimeVersion: string;
  }) {
    try {
      const zip = await ZipHelper.getZipFromStorage(updateBundlePath);
      const metadataBuffer = await ZipHelper.getFileFromZip(zip, 'metadata.json');
      const metadataJson = JSON.parse(metadataBuffer.toString('utf-8'));

      return {
        metadataJson,
        createdAt: new Date().toISOString(),
        id: HashHelper.createHash(metadataBuffer, 'sha256', 'hex'),
      };
    } catch (error) {
      throw new Error(`No metadata found with runtime version: ${runtimeVersion}. Error: ${error}`);
    }
  }

  static async createRollBackDirectiveAsync(updateBundlePath: string) {
    try {
      const zip = await ZipHelper.getZipFromStorage(updateBundlePath);
      const hasRollback = zip.getEntry('rollback') !== null;

      if (hasRollback) {
        return {
          type: 'rollBackToEmbedded',
          parameters: {
            commitTime: new Date().toISOString(),
          },
        };
      }
      throw new Error('No rollback file found');
    } catch (error) {
      throw new Error(`No rollback found. Error: ${error}`);
    }
  }

  static async createNoUpdateAvailableDirectiveAsync() {
    return {
      type: 'noUpdateAvailable',
    };
  }
}
