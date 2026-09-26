import mime from 'mime';
import { NextApiRequest, NextApiResponse } from 'next';
import nullthrows from 'nullthrows';

import { UpdateHelper } from '../../apiUtils/helpers/UpdateHelper';
import { ZipHelper } from '../../apiUtils/helpers/ZipHelper';
import { DatabaseFactory } from '../../apiUtils/database/DatabaseFactory';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function assetsEndpoint(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }
  const { asset: assetPath, runtimeVersion, updateId, platform } = req.query;

  if (!assetPath || typeof assetPath !== 'string') {
    res.statusCode = 400;
    res.json({ error: 'No asset path provided.' });
    return;
  }

  if (platform !== 'ios' && platform !== 'android') {
    res.statusCode = 400;
    res.json({ error: 'No platform provided. Expected "ios" or "android".' });
    return;
  }

  if (!runtimeVersion || typeof runtimeVersion !== 'string') {
    res.statusCode = 400;
    res.json({ error: 'No runtimeVersion provided.' });
    return;
  }
  if (!updateId || typeof updateId !== 'string') {
    res.status(400).json({ error: 'No updateId provided.' });
    return;
  }

  try {
    const release = await DatabaseFactory.getDatabase().getReleaseByUpdateId(
      runtimeVersion,
      updateId
    );
    if (!release || (release.status !== 'active' && release.status !== 'inactive')) {
      res.status(404).json({ error: 'Release not found.' });
      return;
    }
    const updateBundlePath = release.path.replace(/\.zip$/, '');
    const zip = await ZipHelper.getZipFromStorage(updateBundlePath);

    const { metadataJson } = await UpdateHelper.getMetadataAsync({
      updateBundlePath,
      runtimeVersion: runtimeVersion as string,
    });

    const assetMetadata = metadataJson.fileMetadata[platform].assets.find(
      (asset: any) => asset.path === assetPath
    );
    const isLaunchAsset = metadataJson.fileMetadata[platform].bundle === assetPath;
    if (!isLaunchAsset && !assetMetadata) {
      res.status(404).json({ error: 'Asset not found.' });
      return;
    }

    const asset = await ZipHelper.getFileFromZip(zip, assetPath as string);

    res.statusCode = 200;
    res.setHeader(
      'content-type',
      isLaunchAsset ? 'application/javascript' : nullthrows(mime.getType(assetMetadata.ext))
    );
    res.end(asset);
    try {
      const installationHeader = req.headers['x-installation-id'];
      const installationId =
        typeof installationHeader === 'string' && UUID_PATTERN.test(installationHeader)
          ? installationHeader.toLowerCase()
          : null;
      await DatabaseFactory.getDatabase().recordAssetRequest(
        release.id,
        platform,
        asset.length,
        installationId
      );
    } catch (error) {
      console.error('Failed to count asset request:', error);
    }
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.json({ error });
  }
}
