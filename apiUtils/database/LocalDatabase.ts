import { Pool } from 'pg';

import {
  DatabaseInterface,
  MonthlyInstallationMetrics,
  Release,
  Tracking,
  TrackingMetrics,
} from './DatabaseInterface';
import { Tables } from './DatabaseFactory';

export class PostgresDatabase implements DatabaseInterface {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
      host: process.env.POSTGRES_HOST,
      port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    });
  }
  async getLatestReleaseRecordForRuntimeVersion(runtimeVersion: string): Promise<Release | null> {
    const query = `
      SELECT id, runtime_version as "runtimeVersion", path, timestamp,
             commit_hash as "commitHash", commit_message as "commitMessage", update_id as "updateId",
             repository_url as "repositoryUrl"
      FROM ${Tables.RELEASES} WHERE runtime_version = $1
      ORDER BY timestamp DESC
      LIMIT 1
    `;

    const { rows } = await this.pool.query(query, [runtimeVersion]);
    return rows[0] || null;
  }
  async getReleaseByPath(path: string): Promise<Release | null> {
    const query = `
      SELECT id, runtime_version as "runtimeVersion", path, timestamp,
             commit_hash as "commitHash", commit_message as "commitMessage", update_id as "updateId",
             repository_url as "repositoryUrl"
      FROM ${Tables.RELEASES} WHERE path = $1
    `;
    const { rows } = await this.pool.query(query, [path]);
    return rows[0] || null;
  }

  async createTracking(
    tracking: Pick<Tracking, 'releaseId' | 'platform' | 'installationId'>
  ): Promise<void> {
    const query = `
      INSERT INTO ${Tables.RELEASES_TRACKING} (release_id, platform, installation_id)
      VALUES ($1, $2, $3)
      ON CONFLICT (release_id, installation_id) DO NOTHING
    `;
    await this.pool.query(query, [tracking.releaseId, tracking.platform, tracking.installationId]);
  }

  async getReleaseTrackingMetrics(releaseId: string): Promise<TrackingMetrics[]> {
    const query = `
      SELECT platform, COUNT(*) as count
      FROM ${Tables.RELEASES_TRACKING}
      WHERE release_id = $1 AND installation_id IS NOT NULL
      GROUP BY platform
    `;
    const { rows } = await this.pool.query(query, [releaseId]);
    return rows.map((row) => ({
      platform: row.platform,
      count: Number(row.count),
    }));
  }

  async getReleaseTrackingMetricsForAllReleases(): Promise<TrackingMetrics[]> {
    const query = `
      SELECT platform, COUNT(*) as count
      FROM ${Tables.RELEASES_TRACKING}
      WHERE installation_id IS NOT NULL
      GROUP BY platform
    `;
    const { rows } = await this.pool.query(query);
    return rows.map((row) => ({
      platform: row.platform,
      count: Number(row.count),
    }));
  }

  async getMonthlyInstallationMetrics(): Promise<MonthlyInstallationMetrics[]> {
    const { rows } = await this.pool.query(`
      SELECT month, count FROM monthly_installations ORDER BY month DESC
    `);
    return rows.map((row) => ({ month: row.month, count: Number(row.count) }));
  }

  async createRelease(release: Omit<Release, 'id'>): Promise<Release> {
    const query = `
      INSERT INTO ${Tables.RELEASES} (runtime_version, path, timestamp, commit_hash, commit_message, update_id, repository_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, runtime_version as "runtimeVersion", path, timestamp, commit_hash as "commitHash", update_id as "updateId",
                repository_url as "repositoryUrl"
    `;

    const values = [
      release.runtimeVersion,
      release.path,
      release.timestamp,
      release.commitHash,
      release.commitMessage,
      release.updateId,
      release.repositoryUrl ?? null,
    ];
    const { rows } = await this.pool.query(query, values);
    return rows[0];
  }

  async getRelease(id: string): Promise<Release | null> {
    const query = `
      SELECT id, runtime_version as "runtimeVersion", path, timestamp,
             commit_hash as "commitHash", commit_message as "commitMessage", update_id as "updateId",
             repository_url as "repositoryUrl"
      FROM ${Tables.RELEASES} WHERE id = $1
    `;

    const { rows } = await this.pool.query(query, [id]);
    return rows[0] || null;
  }

  async listReleases(): Promise<Release[]> {
    const query = `
      SELECT id, runtime_version as "runtimeVersion", path, timestamp,
             commit_hash as "commitHash", commit_message as "commitMessage", update_id as "updateId",
             repository_url as "repositoryUrl"
      FROM ${Tables.RELEASES}
      ORDER BY timestamp DESC
    `;

    const { rows } = await this.pool.query(query);
    return rows;
  }
}
