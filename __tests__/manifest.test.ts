import AdmZip from 'adm-zip';
import { createMocks } from 'node-mocks-http';
import FormData from 'form-data';

import { ConfigHelper } from '../apiUtils/helpers/ConfigHelper';
import { UpdateHelper, NoUpdateAvailableError } from '../apiUtils/helpers/UpdateHelper';
import { ZipHelper } from '../apiUtils/helpers/ZipHelper';
import { HashHelper } from '../apiUtils/helpers/HashHelper';
import manifestEndpoint from '../pages/api/manifest';
import { DatabaseFactory } from '../apiUtils/database/DatabaseFactory';
import { DatabaseInterface, Release } from '../apiUtils/database/DatabaseInterface';

jest.mock('../apiUtils/helpers/UpdateHelper');
jest.mock('../apiUtils/helpers/ZipHelper');
jest.mock('../apiUtils/helpers/ConfigHelper');
jest.mock('../apiUtils/helpers/HashHelper');
jest.mock('../apiUtils/database/DatabaseFactory');
jest.mock('form-data');

describe('Manifest API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 405 for non-GET requests', async () => {
    const { req, res } = createMocks({ method: 'POST' });
    await manifestEndpoint(req, res);
    expect(res._getStatusCode()).toBe(405);
    expect(JSON.parse(res._getData())).toMatchSnapshot();
  });

  it('should return 400 for invalid platform', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'web',
        'expo-runtime-version': '1.0.0',
      },
    });
    await manifestEndpoint(req, res);
    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toMatchSnapshot();
  });

  it('should return 400 for missing runtime version', async () => {
    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'ios',
      },
    });
    await manifestEndpoint(req, res);
    expect(res._getStatusCode()).toBe(400);
    expect(JSON.parse(res._getData())).toMatchSnapshot();
  });

  it('should return NoUpdateAvailable when user is already running the latest release', async () => {
    // Mock database to return a release with matching updateId
    const mockRelease: Release = {
      id: 'release-id',
      runtimeVersion: '1.0.0',
      path: 'path/to/update.zip',
      timestamp: '2024-03-20T00:00:00Z',
      commitHash: 'abc123',
      commitMessage: 'Test commit',
      updateId: 'test-update-id',
    };

    const mockDatabase = {
      getLatestReleaseRecordForRuntimeVersion: jest.fn().mockResolvedValue(mockRelease),
      createTracking: jest.fn(),
    } as unknown as DatabaseInterface;

    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    // Mock NoUpdateAvailable directive
    const mockNoUpdateDirective = { type: 'noUpdateAvailable' };
    (UpdateHelper.createNoUpdateAvailableDirectiveAsync as jest.Mock).mockResolvedValue(
      mockNoUpdateDirective
    );

    // Mock FormData
    const mockFormData = {
      append: jest.fn(),
      getBoundary: jest.fn().mockReturnValue('boundary'),
      getBuffer: jest.fn().mockReturnValue(Buffer.from('mock-form-data')),
    };
    (FormData as unknown as jest.Mock).mockImplementation(() => mockFormData);

    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'ios',
        'expo-runtime-version': '1.0.0',
        'expo-protocol-version': '1',
        'expo-current-update-id': 'test-update-id', // Same as the release updateId
      },
    });

    await manifestEndpoint(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(UpdateHelper.createNoUpdateAvailableDirectiveAsync).toHaveBeenCalled();
    expect(mockFormData.append).toHaveBeenCalledWith(
      'directive',
      JSON.stringify(mockNoUpdateDirective),
      expect.any(Object)
    );
    expect(res.getHeader('expo-server-defined-headers')).toMatch(/x-installation-id="[0-9a-f-]+"/);
    expect(mockDatabase.createTracking).not.toHaveBeenCalled();

    const installationId = String(res.getHeader('expo-server-defined-headers')).match(
      /"([0-9a-f-]+)"/
    )![1];
    const second = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'ios',
        'expo-runtime-version': '1.0.0',
        'expo-protocol-version': '1',
        'expo-current-update-id': 'test-update-id',
        'x-installation-id': installationId,
      },
    });
    await manifestEndpoint(second.req, second.res);
    expect(second.res.getHeader('expo-server-defined-headers')).toBe(
      `x-installation-id="${installationId}"`
    );
    expect(mockDatabase.createTracking).toHaveBeenCalledWith({
      releaseId: mockRelease.id,
      platform: 'ios',
      installationId,
    });
  });

  it('should look for an update when the request and release have no update ID', async () => {
    const mockDatabase = {
      getLatestReleaseRecordForRuntimeVersion: jest.fn().mockResolvedValue({
        id: 'release-id',
        runtimeVersion: '1.2.0',
        path: 'updates/1.2.0/update.zip',
        timestamp: '2026-09-24T18:06:32Z',
        commitHash: 'abc123',
      }),
    } as unknown as DatabaseInterface;
    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);
    (UpdateHelper.getLatestUpdateBundlePathForRuntimeVersionAsync as jest.Mock).mockResolvedValue(
      'updates/1.2.0/update'
    );
    (ZipHelper.getZipFromStorage as jest.Mock).mockResolvedValue({
      getEntry: jest.fn().mockReturnValue(null),
    });
    (UpdateHelper.getMetadataAsync as jest.Mock).mockRejectedValue(new Error('stop after lookup'));

    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'android',
        'expo-runtime-version': '1.2.0',
        'expo-protocol-version': '1',
      },
    });

    await manifestEndpoint(req, res);

    expect(UpdateHelper.getLatestUpdateBundlePathForRuntimeVersionAsync).toHaveBeenCalledWith(
      '1.2.0'
    );
    expect(UpdateHelper.createNoUpdateAvailableDirectiveAsync).not.toHaveBeenCalled();
  });

  it('should handle normal update successfully', async () => {
    // Mock database to return a release with different updateId
    const mockRelease: Release = {
      id: 'release-id',
      runtimeVersion: '1.0.0',
      path: 'path/to/update.zip',
      timestamp: '2024-03-20T00:00:00Z',
      commitHash: 'abc123',
      commitMessage: 'Test commit',
      updateId: 'different-update-id',
    };

    const mockDatabase = {
      getLatestReleaseRecordForRuntimeVersion: jest.fn().mockResolvedValue(mockRelease),
      getReleaseByPath: jest.fn().mockResolvedValue(mockRelease),
      createTracking: jest.fn().mockResolvedValue(undefined),
    } as unknown as DatabaseInterface;

    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    const mockMetadata = {
      metadataJson: {
        fileMetadata: {
          ios: {
            assets: [{ path: 'test.png', ext: '.png' }],
            bundle: 'bundle.js',
          },
        },
      },
      createdAt: '2024-03-20T00:00:00Z',
      id: 'test-id',
    };

    // Mock UUID conversion
    const mockUUID = 'test-uuid';
    (HashHelper.convertSHA256HashToUUID as jest.Mock).mockReturnValue(mockUUID);

    // Mock UpdateHelper methods
    (UpdateHelper.getLatestUpdateBundlePathForRuntimeVersionAsync as jest.Mock).mockResolvedValue(
      'path/to/update'
    );
    (UpdateHelper.getMetadataAsync as jest.Mock).mockResolvedValue(mockMetadata);
    (UpdateHelper.getAssetMetadataAsync as jest.Mock).mockResolvedValue({
      hash: 'hash',
      key: 'key',
      fileExtension: '.ext',
      contentType: 'contentType',
      url: 'url',
    });

    // Mock ConfigHelper
    (ConfigHelper.getExpoConfigAsync as jest.Mock).mockResolvedValue({});

    // Mock ZipHelper
    const mockZip = {
      getEntry: jest.fn().mockReturnValue(null),
    };
    (ZipHelper.getZipFromStorage as jest.Mock).mockResolvedValue(mockZip as unknown as AdmZip);

    // Mock FormData
    const mockFormData = {
      append: jest.fn(),
      getBoundary: jest.fn().mockReturnValue('boundary'),
      getBuffer: jest.fn().mockReturnValue(Buffer.from('mock-form-data')),
    };
    (FormData as unknown as jest.Mock).mockImplementation(() => mockFormData);

    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'ios',
        'expo-runtime-version': '1.0.0',
        'expo-protocol-version': '1',
        'expo-current-update-id': 'current-update-id', // Different from the release updateId
        'x-installation-id': '576634c0-6482-4c50-8c60-169f7ac9b7b8',
      },
    });

    await manifestEndpoint(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(mockDatabase.createTracking).toHaveBeenCalledWith({
      platform: 'ios',
      releaseId: 'release-id',
      installationId: '576634c0-6482-4c50-8c60-169f7ac9b7b8',
    });
    expect(mockFormData.append).toHaveBeenCalledWith(
      'manifest',
      expect.any(String),
      expect.any(Object)
    );
  });

  it('should handle rollback update successfully', async () => {
    // Mock database
    const mockDatabase = {
      getLatestReleaseRecordForRuntimeVersion: jest.fn().mockResolvedValue(null),
    } as unknown as DatabaseInterface;

    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    // Mock UpdateHelper methods
    (UpdateHelper.getLatestUpdateBundlePathForRuntimeVersionAsync as jest.Mock).mockResolvedValue(
      'path/to/update'
    );
    (UpdateHelper.createRollBackDirectiveAsync as jest.Mock).mockResolvedValue({
      type: 'rollBackToEmbedded',
      parameters: {
        commitTime: '2024-03-20T00:00:00Z',
      },
    });

    // Mock ZipHelper to indicate rollback
    const mockZip = {
      getEntry: jest.fn().mockReturnValue({ name: 'rollback' }), // Return non-null to indicate rollback
    };
    (ZipHelper.getZipFromStorage as jest.Mock).mockResolvedValue(mockZip as unknown as AdmZip);

    // Mock FormData
    const mockFormData = {
      append: jest.fn(),
      getBoundary: jest.fn().mockReturnValue('boundary'),
      getBuffer: jest.fn().mockReturnValue(Buffer.from('mock-form-data')),
    };
    (FormData as unknown as jest.Mock).mockImplementation(() => mockFormData);

    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'ios',
        'expo-runtime-version': '1.0.0',
        'expo-protocol-version': '1',
        'expo-current-update-id': 'current-id',
        'expo-embedded-update-id': 'embedded-id',
      },
    });

    await manifestEndpoint(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(UpdateHelper.createRollBackDirectiveAsync).toHaveBeenCalled();
    expect(mockFormData.append).toHaveBeenCalledWith(
      'directive',
      expect.any(String),
      expect.any(Object)
    );
  });

  it('should return NoUpdateAvailable when current update matches latest', async () => {
    // Mock database
    const mockDatabase = {
      getLatestReleaseRecordForRuntimeVersion: jest.fn().mockResolvedValue(null),
    } as unknown as DatabaseInterface;

    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    // Mock UpdateHelper methods
    (UpdateHelper.getLatestUpdateBundlePathForRuntimeVersionAsync as jest.Mock).mockResolvedValue(
      'path/to/update'
    );

    const mockMetadata = {
      metadataJson: { fileMetadata: { ios: {} } },
      createdAt: '2024-03-20T00:00:00Z',
      id: 'test-id',
    };
    (UpdateHelper.getMetadataAsync as jest.Mock).mockResolvedValue(mockMetadata);

    // Mock UUID conversion to match current update ID
    (HashHelper.convertSHA256HashToUUID as jest.Mock).mockReturnValue('current-update-id');

    // Mock NoUpdateAvailable directive
    const mockNoUpdateDirective = { type: 'noUpdateAvailable' };
    (UpdateHelper.createNoUpdateAvailableDirectiveAsync as jest.Mock).mockResolvedValue(
      mockNoUpdateDirective
    );

    // Mock ZipHelper
    const mockZip = {
      getEntry: jest.fn().mockReturnValue(null), // Not a rollback
    };
    (ZipHelper.getZipFromStorage as jest.Mock).mockResolvedValue(mockZip as unknown as AdmZip);

    // Mock FormData
    const mockFormData = {
      append: jest.fn(),
      getBoundary: jest.fn().mockReturnValue('boundary'),
      getBuffer: jest.fn().mockReturnValue(Buffer.from('mock-form-data')),
    };
    (FormData as unknown as jest.Mock).mockImplementation(() => mockFormData);

    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'ios',
        'expo-runtime-version': '1.0.0',
        'expo-protocol-version': '1',
        'expo-current-update-id': 'current-update-id', // Will match the converted hash
      },
    });

    await manifestEndpoint(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(UpdateHelper.createNoUpdateAvailableDirectiveAsync).toHaveBeenCalled();
  });

  it('should handle NoUpdateAvailable error from UpdateHelper', async () => {
    // Mock database
    const mockDatabase = {
      getLatestReleaseRecordForRuntimeVersion: jest.fn().mockResolvedValue(null),
    } as unknown as DatabaseInterface;

    (DatabaseFactory.getDatabase as jest.Mock).mockReturnValue(mockDatabase);

    // Mock UpdateHelper to throw NoUpdateAvailableError
    (UpdateHelper.getLatestUpdateBundlePathForRuntimeVersionAsync as jest.Mock).mockRejectedValue(
      new NoUpdateAvailableError()
    );

    // Mock NoUpdateAvailable directive
    const mockNoUpdateDirective = { type: 'noUpdateAvailable' };
    (UpdateHelper.createNoUpdateAvailableDirectiveAsync as jest.Mock).mockResolvedValue(
      mockNoUpdateDirective
    );

    // Mock FormData
    const mockFormData = {
      append: jest.fn(),
      getBoundary: jest.fn().mockReturnValue('boundary'),
      getBuffer: jest.fn().mockReturnValue(Buffer.from('mock-form-data')),
    };
    (FormData as unknown as jest.Mock).mockImplementation(() => mockFormData);

    const { req, res } = createMocks({
      method: 'GET',
      headers: {
        'expo-platform': 'ios',
        'expo-runtime-version': '1.0.0',
        'expo-protocol-version': '1',
      },
    });

    await manifestEndpoint(req, res);

    expect(res._getStatusCode()).toBe(200);
    expect(UpdateHelper.createNoUpdateAvailableDirectiveAsync).toHaveBeenCalled();
  });
});
