import { createMocks } from 'node-mocks-http';

import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import { StorageFactory } from '../apiUtils/storage/StorageFactory';
import { hasAdminSession } from '../apiUtils/helpers/AdminSession';
import rollbackHandler from '../pages/api/rollback';

jest.mock('../apiUtils/database/DatabaseFactory');
jest.mock('../apiUtils/storage/StorageFactory');
jest.mock('../apiUtils/helpers/AdminSession');

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
    const mockStorage = {
      copyFile: jest.fn().mockResolvedValue(true),
    };

    const mockDatabase = {
      getReleaseByPath: jest
        .fn()
        .mockResolvedValue({ repositoryUrl: 'https://github.com/acme/app' }),
      createRelease: jest.fn().mockResolvedValue(true),
    };

    (StorageFactory.getStorage as jest.Mock).mockReturnValue(mockStorage);
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
    expect(res._getData()).toMatchSnapshot();
    expect(mockStorage.copyFile).toHaveBeenCalled();
    expect(mockDatabase.getReleaseByPath).toHaveBeenCalledWith('updates/1.0.0/old.zip');
    expect(mockDatabase.createRelease).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryUrl: 'https://github.com/acme/app' })
    );
  });
});
