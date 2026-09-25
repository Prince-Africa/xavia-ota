import { createMocks } from 'node-mocks-http';

import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import { StorageFactory } from '../apiUtils/storage/StorageFactory';
import releasesHandler from '../pages/api/releases';

jest.mock('../apiUtils/database/DatabaseFactory');
jest.mock('../apiUtils/storage/StorageFactory');

describe('Releases API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 405 for non-GET requests', async () => {
    const { req, res } = createMocks({ method: 'POST' });
    await releasesHandler(req, res);
    expect(res._getStatusCode()).toBe(405);
    expect(JSON.parse(res._getData())).toMatchSnapshot();
  });

  it('should return releases successfully', async () => {
    const mockStorage = {
      listDirectories: jest.fn().mockResolvedValue(['1.0.0']),
      listFiles: jest.fn().mockResolvedValue([
        {
          name: 'update.zip',
          created_at: '2024-03-20T00:00:00Z',
          metadata: { size: 1000 },
        },
      ]),
    };

    const mockDatabase = {
      listReleases: jest.fn().mockResolvedValue([
        {
          path: 'updates/1.0.0/update.zip',
          commitHash: 'abc123',
        },
      ]),
    };

    (StorageFactory.getStorage as jest.Mock).mockReturnValue(mockStorage);
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    const { req, res } = createMocks({ method: 'GET' });
    await releasesHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toMatchSnapshot();
  });

  it('dates releases by their bundle file name, not the file creation time', async () => {
    const mockStorage = {
      listDirectories: jest.fn().mockResolvedValue(['1.1.2', '1.2.0']),
      listFiles: jest.fn().mockImplementation(async (folder: string) =>
        folder === 'updates/1.1.2'
          ? [
              {
                name: '20260801090000.zip',
                created_at: '1970-01-01T00:00:00.000Z',
                metadata: { size: 1 },
              },
            ]
          : [
              {
                name: '20260925113047.zip',
                created_at: '1970-01-01T00:00:00.000Z',
                metadata: { size: 2 },
              },
            ]
      ),
    };
    const mockDatabase = { listReleases: jest.fn().mockResolvedValue([]) };

    (StorageFactory.getStorage as jest.Mock).mockReturnValue(mockStorage);
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    const { req, res } = createMocks({ method: 'GET' });
    await releasesHandler(req, res);

    const { releases } = JSON.parse(res._getData());
    expect(releases.map((r: { path: string; timestamp: string }) => [r.path, r.timestamp])).toEqual(
      [
        ['updates/1.1.2/20260801090000.zip', '2026-08-01T10:00:00.000+01:00'],
        ['updates/1.2.0/20260925113047.zip', '2026-09-25T12:30:47.000+01:00'],
      ]
    );
  });

  it('should handle errors gracefully', async () => {
    const mockStorage = {
      listDirectories: jest.fn().mockRejectedValue(new Error('Storage error')),
    };

    (StorageFactory.getStorage as jest.Mock).mockReturnValue(mockStorage);

    const { req, res } = createMocks({ method: 'GET' });
    await releasesHandler(req, res);

    expect(res._getStatusCode()).toBe(500);
    expect(JSON.parse(res._getData())).toMatchSnapshot();
  });
});
