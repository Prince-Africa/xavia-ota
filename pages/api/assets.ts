import mime from 'mime';
import { NextApiRequest, NextApiResponse } from 'next';
import nullthrows from 'nullthrows';

import { UpdateHelper } from '../../apiUtils/helpers/UpdateHelper';
import { ZipHelper } from '../../apiUtils/helpers/ZipHelper';
import { DatabaseFactory } from '../../apiUtils/database/DatabaseFactory';

export default async function assetsEndpoint(req: NextApiRequest, res: NextApiResponse) {
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
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.json({ error });
  }
}
