import { NextApiRequest, NextApiResponse } from 'next';

import { DatabaseFactory } from '../../../apiUtils/database/DatabaseFactory';

export default async function trackingSummaryHandler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const database = DatabaseFactory.getDatabase();
    const [releases, uniqueInstallations] = await Promise.all([
      database.getReleaseMetricsHierarchy(),
      database.getGlobalUniqueInstallations(),
    ]);
    res.status(200).json({ releases, uniqueInstallations });
  } catch (error) {
    console.error('Failed to fetch tracking summary:', error);
    res.status(500).json({ error: 'Failed to fetch tracking summary' });
  }
}
