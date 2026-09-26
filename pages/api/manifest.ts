import FormData from 'form-data';
import { randomUUID } from 'crypto';

import { NextApiRequest, NextApiResponse } from 'next';
import { serializeDictionary } from 'structured-headers';

import { ConfigHelper } from '../../apiUtils/helpers/ConfigHelper';
import { DictionaryHelper } from '../../apiUtils/helpers/DictionaryHelper';
import { HashHelper } from '../../apiUtils/helpers/HashHelper';
import { UpdateHelper, NoUpdateAvailableError } from '../../apiUtils/helpers/UpdateHelper';
import { ZipHelper } from '../../apiUtils/helpers/ZipHelper';
import { getLogger } from '../../apiUtils/logger';
import { DatabaseFactory } from '../../apiUtils/database/DatabaseFactory';

const logger = getLogger('manifest');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getInstallationId(
  req: NextApiRequest,
  res: NextApiResponse
): { id: string; confirmed: boolean } {
  const header = req.headers['x-installation-id'];
  const confirmed = typeof header === 'string' && UUID_PATTERN.test(header);
  const id = confirmed ? header.toLowerCase() : randomUUID();
  res.setHeader(
    'expo-server-defined-headers',
    serializeDictionary(new Map([['x-installation-id', [id, new Map()]]]))
  );
  return { id, confirmed };
}

async function trackInstallation(releaseId: string, platform: string, installationId: string) {
  try {
    await DatabaseFactory.getDatabase().createTracking({ releaseId, platform, installationId });
  } catch (error) {
    logger.error('Failed to track installation', { releaseId, error });
  }
}

async function countManifestRequest(releaseId: string, platform: string) {
  try {
    await DatabaseFactory.getDatabase().recordManifestRequest(releaseId, platform);
  } catch (error) {
    logger.error('Failed to count manifest request', { releaseId, error });
  }
}

export default async function manifestEndpoint(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.json({ error: 'Expected GET.' });
    return;
  }

  logger.info('A client requested a release', {
    runtimeVersion: req.headers['expo-runtime-version'],
    platform: req.headers['expo-platform'],
    protocolVersion: req.headers['expo-protocol-version'],
    apiVersion: req.headers['expo-api-version'],
    currentUpdateId: req.headers['expo-current-update-id'],
  });

  const protocolVersionMaybeArray = req.headers['expo-protocol-version'];
  if (protocolVersionMaybeArray && Array.isArray(protocolVersionMaybeArray)) {
    res.statusCode = 400;
    res.json({
      error: 'Unsupported protocol version. Expected either 0 or 1.',
    });
    return;
  }

  const protocolVersion = parseInt(protocolVersionMaybeArray ?? '0', 10);

  const platform = req.headers['expo-platform'] ?? req.query['platform'];
  if (platform !== 'ios' && platform !== 'android') {
    res.statusCode = 400;
    res.json({
      error: 'Unsupported platform. Expected either ios or android.',
    });
    return;
  }

  const runtimeVersion = req.headers['expo-runtime-version'] ?? req.query['runtime-version'];
  if (!runtimeVersion || typeof runtimeVersion !== 'string') {
    res.statusCode = 400;
    res.json({
      error: 'No runtimeVersion provided.',
    });
    return;
  }

  const installation = getInstallationId(req, res);

  const database = DatabaseFactory.getDatabase();
  const releaseRecord = await database.getLatestReleaseRecordForRuntimeVersion(runtimeVersion);
  if (!releaseRecord) {
    await putNoUpdateAvailableInResponseAsync(req, res, protocolVersion);
    return;
  }
  const updateBundlePath = releaseRecord.path.replace(/\.zip$/, '');
  let updateId = releaseRecord.updateId;
  if (!updateId) {
    const metadata = await UpdateHelper.getMetadataAsync({ updateBundlePath, runtimeVersion });
    updateId = HashHelper.convertSHA256HashToUUID(metadata.id);
    await database.setReleaseUpdateId(releaseRecord.id, updateId);
  }

  const currentUpdateId = req.headers['expo-current-update-id'];
  if (currentUpdateId && updateId && currentUpdateId === updateId) {
    logger.info('User is already running the latest release. Returning NoUpdateAvailable.', {
      runtimeVersion,
    });
    await putNoUpdateAvailableInResponseAsync(req, res, protocolVersion);
    if (res.statusCode === 200) await countManifestRequest(releaseRecord.id, platform);
    return;
  }

  const updateType = await getTypeOfUpdateAsync(updateBundlePath);

  try {
    try {
      if (updateType === UpdateType.NORMAL_UPDATE) {
        logger.info('Found a normal update available.');
        await putUpdateInResponseAsync(
          req,
          res,
          updateBundlePath,
          runtimeVersion,
          platform,
          protocolVersion,
          installation,
          releaseRecord.id,
          updateId
        );
      } else if (updateType === UpdateType.ROLLBACK) {
        logger.info('Rollback is available.');
        await putRollBackInResponseAsync(req, res, updateBundlePath, protocolVersion);
        if (res.statusCode === 200) await countManifestRequest(releaseRecord.id, platform);
      }
    } catch (maybeNoUpdateAvailableError) {
      if (maybeNoUpdateAvailableError instanceof NoUpdateAvailableError) {
        logger.info('psych!! User already running latest available update');
        await putNoUpdateAvailableInResponseAsync(req, res, protocolVersion);
        if (res.statusCode === 200) await countManifestRequest(releaseRecord.id, platform);
        return;
      }
      throw maybeNoUpdateAvailableError;
    }
  } catch (error) {
    logger.error(error);
    res.statusCode = 404;
    res.json({ error });
  }
}

enum UpdateType {
  NORMAL_UPDATE,
  ROLLBACK,
}

async function getTypeOfUpdateAsync(updateBundlePath: string): Promise<UpdateType> {
  const zip = await ZipHelper.getZipFromStorage(updateBundlePath);
  const hasRollback = zip.getEntry('rollback') !== null;
  return hasRollback ? UpdateType.ROLLBACK : UpdateType.NORMAL_UPDATE;
}

async function putUpdateInResponseAsync(
  req: NextApiRequest,
  res: NextApiResponse,
  updateBundlePath: string,
  runtimeVersion: string,
  platform: string,
  protocolVersion: number,
  installation: { id: string; confirmed: boolean },
  releaseId: string,
  updateId: string
): Promise<void> {
  const currentUpdateId = req.headers['expo-current-update-id'];
  const { metadataJson, createdAt } = await UpdateHelper.getMetadataAsync({
    updateBundlePath,
    runtimeVersion,
  });

  // NoUpdateAvailable directive only supported on protocol version 1
  // for protocol version 0, serve most recent update as normal
  if (currentUpdateId === updateId && protocolVersion === 1) {
    logger.info('returning NoUpdateAvailable to client');
    throw new NoUpdateAvailableError();
  }

  const expoConfig = await ConfigHelper.getExpoConfigAsync({
    updateBundlePath,
    runtimeVersion,
  });
  const platformSpecificMetadata = metadataJson.fileMetadata[platform];
  const manifest = {
    id: updateId,
    createdAt,
    runtimeVersion,
    assets: await Promise.all(
      (platformSpecificMetadata.assets as any[]).map((asset: any) =>
        UpdateHelper.getAssetMetadataAsync({
          updateBundlePath,
          filePath: asset.path,
          ext: asset.ext,
          runtimeVersion,
          updateId,
          platform,
          isLaunchAsset: false,
        })
      )
    ),
    launchAsset: await UpdateHelper.getAssetMetadataAsync({
      updateBundlePath,
      filePath: platformSpecificMetadata.bundle,
      isLaunchAsset: true,
      runtimeVersion,
      updateId,
      platform,
      ext: null,
    }),
    metadata: {},
    extra: {
      expoClient: expoConfig,
    },
  };

  let signature = null;
  const expectSignatureHeader = req.headers['expo-expect-signature'];
  if (expectSignatureHeader) {
    const privateKey = ConfigHelper.getPrivateKey();
    if (!privateKey) {
      res.statusCode = 400;
      res.json({
        error: 'Code signing requested but no key supplied when starting server.',
      });
      return;
    }
    const manifestString = JSON.stringify(manifest);
    const hashSignature = HashHelper.signRSASHA256(manifestString, privateKey);
    const dictionary = DictionaryHelper.convertToDictionaryItemsRepresentation({
      sig: hashSignature,
      keyid: 'main',
    });
    signature = serializeDictionary(dictionary);
  }

  const assetRequestHeaders: { [key: string]: object } = {};
  [...manifest.assets, manifest.launchAsset].forEach((asset) => {
    assetRequestHeaders[asset.key] = {
      'x-installation-id': installation.id,
    };
  });

  const form = new FormData();
  form.append('manifest', JSON.stringify(manifest), {
    contentType: 'application/json',
    header: {
      'content-type': 'application/json; charset=utf-8',
      ...(signature ? { 'expo-signature': signature } : {}),
    },
  });
  form.append('extensions', JSON.stringify({ assetRequestHeaders }), {
    contentType: 'application/json',
  });

  res.statusCode = 200;
  res.setHeader('expo-protocol-version', protocolVersion);
  res.setHeader('expo-sfv-version', 0);
  res.setHeader('cache-control', 'private, max-age=0');
  res.setHeader('content-type', `multipart/mixed; boundary=${form.getBoundary()}`);
  res.write(form.getBuffer());
  res.end();

  await countManifestRequest(releaseId, platform);

  if (installation.confirmed) {
    try {
      await trackInstallation(releaseId, platform, installation.id);
    } catch (error) {
      logger.error('Failed to look up release for installation tracking', { error });
    }
  }
}

async function putRollBackInResponseAsync(
  req: NextApiRequest,
  res: NextApiResponse,
  updateBundlePath: string,
  protocolVersion: number
): Promise<void> {
  if (protocolVersion === 0) {
    logger.error('Rollbacks not supported on protocol version 0');
    throw new Error('Rollbacks not supported on protocol version 0');
  }

  const embeddedUpdateId = req.headers['expo-embedded-update-id'];
  if (!embeddedUpdateId || typeof embeddedUpdateId !== 'string') {
    logger.error('Invalid Expo-Embedded-Update-ID request header specified.');
    throw new Error('Invalid Expo-Embedded-Update-ID request header specified.');
  }

  const currentUpdateId = req.headers['expo-current-update-id'];
  if (currentUpdateId === embeddedUpdateId) {
    logger.error('Found update already exists in the client.');
    throw new NoUpdateAvailableError();
  }

  const directive = await UpdateHelper.createRollBackDirectiveAsync(updateBundlePath);

  let signature = null;
  const expectSignatureHeader = req.headers['expo-expect-signature'];
  if (expectSignatureHeader) {
    const privateKey = ConfigHelper.getPrivateKey();
    if (!privateKey) {
      res.statusCode = 400;
      res.json({
        error: 'Code signing requested but no key supplied when starting server.',
      });
      return;
    }
    const directiveString = JSON.stringify(directive);
    const hashSignature = HashHelper.signRSASHA256(directiveString, privateKey);
    const dictionary = DictionaryHelper.convertToDictionaryItemsRepresentation({
      sig: hashSignature,
      keyid: 'main',
    });
    signature = serializeDictionary(dictionary);
  }

  const form = new FormData();
  form.append('directive', JSON.stringify(directive), {
    contentType: 'application/json',
    header: {
      'content-type': 'application/json; charset=utf-8',
      ...(signature ? { 'expo-signature': signature } : {}),
    },
  });

  res.statusCode = 200;
  res.setHeader('expo-protocol-version', 1);
  res.setHeader('expo-sfv-version', 0);
  res.setHeader('cache-control', 'private, max-age=0');
  res.setHeader('content-type', `multipart/mixed; boundary=${form.getBoundary()}`);
  res.write(form.getBuffer());
  res.end();
}

async function putNoUpdateAvailableInResponseAsync(
  req: NextApiRequest,
  res: NextApiResponse,
  protocolVersion: number
): Promise<void> {
  if (protocolVersion === 0) {
    throw new Error('NoUpdateAvailable directive not available in protocol version 0');
  }

  const directive = await UpdateHelper.createNoUpdateAvailableDirectiveAsync();

  let signature = null;
  const expectSignatureHeader = req.headers['expo-expect-signature'];
  if (expectSignatureHeader) {
    const privateKey = ConfigHelper.getPrivateKey();
    if (!privateKey) {
      res.statusCode = 400;
      res.json({
        error: 'Code signing requested but no key supplied when starting server.',
      });
      return;
    }
    const directiveString = JSON.stringify(directive);
    const hashSignature = HashHelper.signRSASHA256(directiveString, privateKey);
    const dictionary = DictionaryHelper.convertToDictionaryItemsRepresentation({
      sig: hashSignature,
      keyid: 'main',
    });
    signature = serializeDictionary(dictionary);
  }

  const form = new FormData();
  form.append('directive', JSON.stringify(directive), {
    contentType: 'application/json',
    header: {
      'content-type': 'application/json; charset=utf-8',
      ...(signature ? { 'expo-signature': signature } : {}),
    },
  });

  res.statusCode = 200;
  res.setHeader('expo-protocol-version', 1);
  res.setHeader('expo-sfv-version', 0);
  res.setHeader('cache-control', 'private, max-age=0');
  res.setHeader('content-type', `multipart/mixed; boundary=${form.getBoundary()}`);
  res.write(form.getBuffer());
  res.end();
}
