import { createMocks } from 'node-mocks-http';
import { Pool } from 'pg';

import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import { PostgresDatabase } from '../apiUtils/database/LocalDatabase';
import trackingSummaryHandler from '../pages/api/tracking/summary';

jest.mock('pg');
jest.mock('../apiUtils/database/DatabaseFactory');

describe('tracking summary', () => {
  beforeEach(() => jest.clearAllMocks());

  it('groups server events by release and platform with distinct confirmed installations', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [
        {
          releaseId: 'release-id',
          runtimeVersion: '1.1.2',
          updateId: 'update-id',
          platform: 'ios',
          uniqueInstallations: '2',
          manifestRequests: '5',
          downloadAttempts: '3',
          assetRequests: '4',
          bytesTransferred: '1200',
        },
      ],
    });
    (Pool as unknown as jest.Mock).mockImplementation(() => ({ query }));

    const rows = await new PostgresDatabase().getReleaseMetricsHierarchy();

    expect(rows[0]).toEqual(
      expect.objectContaining({
        uniqueInstallations: 2,
        manifestRequests: 5,
        downloadAttempts: 3,
        assetRequests: 4,
        bytesTransferred: 1200,
      })
    );
    expect(query.mock.calls[0][0]).toContain('COUNT(DISTINCT installation_id)');
    expect(query.mock.calls[0][0]).toContain('offered_release = TRUE');
    expect(query.mock.calls[0][0]).toContain('r.runtime_version AS "runtimeVersion"');
  });

  it('returns global unique installations and the runtime hierarchy', async () => {
    const database = {
      getReleaseMetricsHierarchy: jest
        .fn()
        .mockResolvedValue([{ releaseId: 'a', platform: 'ios' }]),
      getGlobalUniqueInstallations: jest.fn().mockResolvedValue(3),
    };
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(database);
    const { req, res } = createMocks({ method: 'GET' });

    await trackingSummaryHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({
      releases: [{ releaseId: 'a', platform: 'ios' }],
      uniqueInstallations: 3,
    });
  });

  it('separates manifest offers from asset transfer counters', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [] });
    (Pool as unknown as jest.Mock).mockImplementation(() => ({ query }));
    const database = new PostgresDatabase();

    await database.recordManifestRequest('release-id', 'android');
    await database.recordAssetRequest(
      'release-id',
      'android',
      2048,
      '576634c0-6482-4c50-8c60-169f7ac9b7b8'
    );

    expect(query.mock.calls[0][1]).toEqual(['release-id', 'android']);
    expect(query.mock.calls[1][1]).toEqual([
      'release-id',
      'android',
      2048,
      '576634c0-6482-4c50-8c60-169f7ac9b7b8',
    ]);
    expect(query.mock.calls[1][0]).toContain('release_download_attempts');
    expect(query.mock.calls[1][0]).toContain('bytes_transferred');
  });
});
