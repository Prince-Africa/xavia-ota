import { NextApiRequest, NextApiResponse } from 'next';
import { pipeline } from 'stream/promises';

import { ReleaseAssetCache } from '../../apiUtils/helpers/ReleaseAssetCache';
import { DatabaseFactory } from '../../apiUtils/database/DatabaseFactory';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function acceptsGzip(header: string | string[] | undefined): boolean {
  const value = Array.isArray(header) ? header.join(',') : header ?? '';
  return value.split(',').some((encoding) => {
    const [name, ...params] = encoding.trim().toLowerCase().split(';');
    if (name !== 'gzip' && name !== '*') return false;
    return !params.some((param) => /^\s*q=0(\.0*)?\s*$/.test(param));
  });
}

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
    const prepared = await ReleaseAssetCache.getPreparedRelease(release);
    const asset = ReleaseAssetCache.findAsset(prepared, platform, assetPath);
    if (!asset) {
      res.status(404).json({ error: 'Asset not found.' });
      return;
    }

    const file = await ReleaseAssetCache.openAsset(
      release,
      asset,
      acceptsGzip(req.headers['accept-encoding'])
    );
    // The URL names one update's copy of a content-hashed file, so its bytes never change.
    res.statusCode = 200;
    res.setHeader('content-type', asset.contentType ?? 'application/octet-stream');
    res.setHeader('content-length', file.size);
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    if (asset.gzipSize !== null) res.setHeader('vary', 'Accept-Encoding');
    if (file.gzipped) res.setHeader('content-encoding', 'gzip');
    await pipeline(file.handle.createReadStream(), res);

    try {
      const installationHeader = req.headers['x-installation-id'];
      const installationId =
        typeof installationHeader === 'string' && UUID_PATTERN.test(installationHeader)
          ? installationHeader.toLowerCase()
          : null;
      await DatabaseFactory.getDatabase().recordAssetRequest(
        release.id,
        platform,
        file.size,
        installationId
      );
    } catch (error) {
      console.error('Failed to count asset request:', error);
    }
  } catch (error) {
    console.error(error);
    // A phone that drops mid-download has already had headers; the pipeline closed the response.
    if (res.headersSent) return;
    res.statusCode = 500;
    res.json({ error });
  }
}
