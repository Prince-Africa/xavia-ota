import { createMocks } from 'node-mocks-http';

import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import { StorageFactory } from '../apiUtils/storage/StorageFactory';
import { hasAdminSession } from '../apiUtils/helpers/AdminSession';
import rollbackHandler from '../pages/api/rollback';
import { ZipHelper } from '../apiUtils/helpers/ZipHelper';
import { HashHelper } from '../apiUtils/helpers/HashHelper';

jest.mock('../apiUtils/database/DatabaseFactory');
jest.mock('../apiUtils/storage/StorageFactory');
jest.mock('../apiUtils/helpers/AdminSession');
jest.mock('../apiUtils/helpers/ZipHelper');
jest.mock('../apiUtils/helpers/HashHelper');

describe('Rollback API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (hasAdminSession as jest.Mock).mockReturnValue(true);
  });

  it('should return 405 for non-POST requests', async () => {
    const { req, res } = createMocks({ method: 'GET' });
    await rollbackHandler(req, res);
    expect(res._getStatusCode()).toBe(405);
    expect(JSON.parse(res._getData())).toMatchSnapshot();
  });

  it('should return 400 for missing required fields', async () => {
    const { req, res } = createMocks({
      method: 'POST',
      body: {},
    });
    await rollbackHandler(req, res);
    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toMatchSnapshot();
  });

  it('should reject rollback without an admin session', async () => {
    (hasAdminSession as jest.Mock).mockReturnValue(false);
    const { req, res } = createMocks({
      method: 'POST',
      body: { path: 'updates/1.0.0/old.zip', runtimeVersion: '1.0.0', commitHash: 'abc123' },
    });

    await rollbackHandler(req, res);

    expect(res._getStatusCode()).toBe(401);
    expect(StorageFactory.getStorage).not.toHaveBeenCalled();
    expect(DatabaseFactory.getDatabase).not.toHaveBeenCalled();
  });

  it('should handle rollback successfully', async () => {
    const mockDatabase = {
      getReleaseByPath: jest.fn().mockResolvedValue({
        id: 'old-id',
        path: 'updates/1.0.0/old.zip',
        runtimeVersion: '1.0.0',
        updateId: 'old-update-id',
        status: 'inactive',
      }),
      activateRelease: jest.fn().mockResolvedValue(undefined),
    };

    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    Date.now = jest.fn(() => new Date('2020-05-13T12:33:37.000Z').getTime());

    const { req, res } = createMocks({
      method: 'POST',
      body: {
        path: 'updates/1.0.0/old.zip',
        runtimeVersion: '1.0.0',
        commitHash: 'abc123',
      },
    });

    await rollbackHandler(req, res);
    expect(res._getStatusCode()).toBe(200);
    expect(JSON.parse(res._getData())).toEqual({
      success: true,
      newPath: 'updates/1.0.0/old.zip',
      updateId: 'old-update-id',
    });
    expect(mockDatabase.getReleaseByPath).toHaveBeenCalledWith('updates/1.0.0/old.zip');
    expect(mockDatabase.activateRelease).toHaveBeenCalledWith('old-id');
    expect(StorageFactory.getStorage).not.toHaveBeenCalled();
  });

  it('backfills a legacy release update ID before activation', async () => {
    const database = {
      getReleaseByPath: jest.fn().mockResolvedValue({
        id: 'legacy-id',
        path: 'updates/1.0.0/old.zip',
        runtimeVersion: '1.0.0',
        status: 'inactive',
      }),
      setReleaseUpdateId: jest.fn(),
      activateRelease: jest.fn(),
    };
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(database);
    (ZipHelper.getZipFromStorage as jest.Mock).mockResolvedValue({});
    (ZipHelper.getFileFromZip as jest.Mock).mockResolvedValue(Buffer.from('metadata'));
    (HashHelper.createHash as jest.Mock).mockReturnValue('hash');
    (HashHelper.convertSHA256HashToUUID as jest.Mock).mockReturnValue('restored-id');
    const { req, res } = createMocks({
      method: 'POST',
      body: {
        path: 'updates/1.0.0/old.zip',
        runtimeVersion: '1.0.0',
      },
    });

    await rollbackHandler(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(database.setReleaseUpdateId).toHaveBeenCalledWith('legacy-id', 'restored-id');
    expect(database.activateRelease).toHaveBeenCalledWith('legacy-id');
  });
});
