import { NextApiRequest, NextApiResponse } from 'next';

import { DatabaseFactory } from '../../apiUtils/database/DatabaseFactory';
import { hasAdminSession } from '../../apiUtils/helpers/AdminSession';
import { HashHelper } from '../../apiUtils/helpers/HashHelper';
import { ZipHelper } from '../../apiUtils/helpers/ZipHelper';

export default async function rollbackHandler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!hasAdminSession(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { path, runtimeVersion } = req.body;

  if (!path) {
    res.status(400).json({ error: 'Missing path' });
    return;
  }

  if (!runtimeVersion) {
    res.status(400).json({ error: 'Missing runtimeVersion' });
    return;
  }

  try {
    const database = DatabaseFactory.getDatabase();
    const source = await database.getReleaseByPath(path);
    if (
      !source ||
      source.runtimeVersion !== runtimeVersion ||
      source.status === 'failed' ||
      source.status === 'uploading'
    ) {
      res.status(404).json({ error: 'Release not found' });
      return;
    }
    let updateId = source.updateId;
    if (!updateId) {
      const zip = await ZipHelper.getZipFromStorage(source.path.replace(/\.zip$/, ''));
      const metadata = await ZipHelper.getFileFromZip(zip, 'metadata.json');
      updateId = HashHelper.convertSHA256HashToUUID(
        HashHelper.createHash(metadata, 'sha256', 'hex')
      );
      await database.setReleaseUpdateId(source.id, updateId);
    }
    await database.activateRelease(source.id);
    res.status(200).json({ success: true, newPath: source.path, updateId });
  } catch (error) {
    console.error('Rollback error:', error);
    res.status(500).json({ error: 'Rollback failed' });
  }
}
