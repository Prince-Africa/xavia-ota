import { Pool } from 'pg';
import { createMocks } from 'node-mocks-http';

import { PostgresDatabase } from '../apiUtils/database/LocalDatabase';
import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import runtimeMetricsHandler from '../pages/api/runtimes/[runtimeVersion]';

jest.mock('pg');
jest.mock('../apiUtils/database/DatabaseFactory');

describe('runtime installation metrics', () => {
  beforeEach(() => jest.clearAllMocks());

  it('counts distinct installations across the selected runtime and platform', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{ iosInstalls: '2', androidInstalls: '3', uniqueInstallsThisMonth: '4' }],
    });
    (Pool as unknown as jest.Mock).mockImplementation(() => ({ query }));
    const database = new PostgresDatabase();

    expect(await database.getRuntimeInstallationMetrics('1.2.0')).toEqual({
      iosInstalls: 2,
      androidInstalls: 3,
      uniqueInstallsThisMonth: 4,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('COUNT(DISTINCT t.installation_id)'),
      ['1.2.0']
    );
    const sql = query.mock.calls[0][0];
    expect(sql).toContain('JOIN releases r ON r.id = t.release_id');
    expect(sql).toContain('r.runtime_version = $1');
    expect(sql).toContain("date_trunc('month', t.download_timestamp + interval '1 hour')");
  });

  it('passes the selected runtime to the API metrics query', async () => {
    const getRuntimeInstallationMetrics = jest.fn().mockResolvedValue({
      iosInstalls: 2,
      androidInstalls: 3,
      uniqueInstallsThisMonth: 4,
    });
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({ getRuntimeInstallationMetrics });
    const { req, res } = createMocks({ method: 'GET', query: { runtimeVersion: '1.2.0' } });

    await runtimeMetricsHandler(req, res);

    expect(getRuntimeInstallationMetrics).toHaveBeenCalledWith('1.2.0');
    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({
      iosInstalls: 2,
      androidInstalls: 3,
      uniqueInstallsThisMonth: 4,
    });
  });
});
