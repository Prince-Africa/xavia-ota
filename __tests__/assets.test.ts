import { createMocks } from 'node-mocks-http';

import { UpdateHelper } from '../apiUtils/helpers/UpdateHelper';
import { ZipHelper } from '../apiUtils/helpers/ZipHelper';
import assetsEndpoint from '../pages/api/assets';
import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';

jest.mock('../apiUtils/helpers/UpdateHelper');
jest.mock('../apiUtils/helpers/ZipHelper');
jest.mock('../apiUtils/database/DatabaseFactory');

describe('Assets API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 400 if asset path is missing', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: {
        platform: 'ios',
        runtimeVersion: '1.0.0',
      },
    });

    await assetsEndpoint(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('should return 400 if platform is invalid', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      query: {
        asset: 'test.png',
        platform: 'web',
        runtimeVersion: '1.0.0',
      },
    });

    await assetsEndpoint(req, res);
    expect(res._getStatusCode()).toBe(400);
  });

  it('should serve asset successfully', async () => {
    const mockMetadata = {
      metadataJson: {
        fileMetadata: {
          ios: {
            assets: [{ path: 'test.png', ext: '.png' }],
            bundle: 'bundle.js',
          },
        },
      },
    };

    const getReleaseByUpdateId = jest
      .fn()
      .mockResolvedValue({ path: 'path/to/update.zip', status: 'inactive' });
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({ getReleaseByUpdateId });
    (UpdateHelper.getMetadataAsync as jest.Mock).mockResolvedValue(mockMetadata);
    (ZipHelper.getZipFromStorage as jest.Mock).mockResolvedValue({});
    (ZipHelper.getFileFromZip as jest.Mock).mockResolvedValue(Buffer.from('test'));

    const { req, res } = createMocks({
      method: 'GET',
      query: {
        asset: 'test.png',
        platform: 'ios',
        runtimeVersion: '1.0.0',
        updateId: 'exact-update-id',
      },
    });

    await assetsEndpoint(req, res);
    expect(res._getStatusCode()).toBe(200);
    expect(res._getData()).toMatchSnapshot();
    expect(getReleaseByUpdateId).toHaveBeenCalledWith('1.0.0', 'exact-update-id');
    expect(ZipHelper.getZipFromStorage).toHaveBeenCalledWith('path/to/update');
  });

  it('rejects an update ID without a matching release', async () => {
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue({
      getReleaseByUpdateId: jest.fn().mockResolvedValue(null),
    });
    const { req, res } = createMocks({
      method: 'GET',
      query: {
        asset: 'test.png',
        platform: 'ios',
        runtimeVersion: '1.0.0',
        updateId: 'unknown',
      },
    });
    await assetsEndpoint(req, res);
    expect(res._getStatusCode()).toBe(404);
    expect(ZipHelper.getZipFromStorage).not.toHaveBeenCalled();
  });
});
