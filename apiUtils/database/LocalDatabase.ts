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
      SELECT id, runtime_version as "runtimeVersion", path, (timestamp AT TIME ZONE 'UTC') AS timestamp,
             commit_hash as "commitHash", commit_message as "commitMessage", update_id as "updateId",
             repository_url as "repositoryUrl", status
      FROM ${Tables.RELEASES} WHERE runtime_version = $1 AND status = 'active'
      LIMIT 1
    `;

    const { rows } = await this.pool.query(query, [runtimeVersion]);
    return rows[0] || null;
  }
  async getReleaseByPath(path: string): Promise<Release | null> {
    const query = `
      SELECT id, runtime_version as "runtimeVersion", path, (timestamp AT TIME ZONE 'UTC') AS timestamp,
             commit_hash as "commitHash", commit_message as "commitMessage", update_id as "updateId",
             repository_url as "repositoryUrl", status
      FROM ${Tables.RELEASES} WHERE path = $1
    `;
    const { rows } = await this.pool.query(query, [path]);
    return rows[0] || null;
  }

  async getReleaseByUpdateId(runtimeVersion: string, updateId: string): Promise<Release | null> {
    const { rows } = await this.pool.query(
      `
      SELECT id, runtime_version as "runtimeVersion", path, (timestamp AT TIME ZONE 'UTC') AS timestamp,
             commit_hash as "commitHash", commit_message as "commitMessage", update_id as "updateId",
             repository_url as "repositoryUrl", status
      FROM ${Tables.RELEASES} WHERE runtime_version = $1 AND update_id = $2
    `,
      [runtimeVersion, updateId]
    );
    return rows[0] || null;
  }

  async activateRelease(id: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT runtime_version FROM ${Tables.RELEASES} WHERE id = $1`,
        [id]
      );
      if (!rows.length) throw new Error('Release not found');
      // Serialize activations for the same runtime, including concurrent uploads.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [rows[0].runtime_version]);
      await client.query(`SELECT id FROM ${Tables.RELEASES} WHERE id = $1 FOR UPDATE`, [id]);
      await client.query(
        `UPDATE ${Tables.RELEASES} SET status = 'inactive' WHERE runtime_version = $1 AND status = 'active'`,
        [rows[0].runtime_version]
      );
      await client
        .query(
          `UPDATE ${Tables.RELEASES} SET status = 'active' WHERE id = $1 AND status IN ('uploading', 'inactive', 'active') RETURNING id`,
          [id]
        )
        .then((result) => {
          if (!result.rowCount) throw new Error('Release cannot be activated');
        });
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async rollbackToRelease(
    id: string,
    expectedActiveId: string
  ): Promise<'activated' | 'already_active' | 'same_update_id' | 'active_changed' | 'not_found'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: runtimeRows } = await client.query(
        `SELECT runtime_version FROM ${Tables.RELEASES} WHERE id = $1`,
        [id]
      );
      if (!runtimeRows.length) {
        await client.query('ROLLBACK');
        return 'not_found';
      }
      const runtimeVersion = runtimeRows[0].runtime_version;
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [runtimeVersion]);
      const { rows: targets } = await client.query(
        `SELECT id, update_id, status FROM ${Tables.RELEASES}
         WHERE id = $1 AND runtime_version = $2 FOR UPDATE`,
        [id, runtimeVersion]
      );
      if (
        !targets.length ||
        targets[0].status === 'failed' ||
        targets[0].status === 'uploading' ||
        !targets[0].update_id
      ) {
        await client.query('ROLLBACK');
        return 'not_found';
      }
      const { rows: active } = await client.query(
        `SELECT id, update_id FROM ${Tables.RELEASES}
         WHERE runtime_version = $1 AND status = 'active' FOR UPDATE`,
        [runtimeVersion]
      );
      if (active[0]?.id === id) {
        await client.query('ROLLBACK');
        return 'already_active';
      }
      if (active[0]?.id !== expectedActiveId) {
        await client.query('ROLLBACK');
        return 'active_changed';
      }
      if (active[0]?.update_id && active[0].update_id === targets[0].update_id) {
        await client.query('ROLLBACK');
        return 'same_update_id';
      }
      await client.query(
        `UPDATE ${Tables.RELEASES} SET status = 'inactive'
         WHERE runtime_version = $1 AND status = 'active'`,
        [runtimeVersion]
      );
      await client.query(
        `UPDATE ${Tables.RELEASES} SET status = 'active'
         WHERE id = $1 AND runtime_version = $2`,
        [id, runtimeVersion]
      );
      await client.query('COMMIT');
      return 'activated';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async failRelease(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${Tables.RELEASES} SET status = 'failed' WHERE id = $1 AND status = 'uploading'`,
      [id]
    );
  }

  async retryFailedRelease(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE ${Tables.RELEASES} SET status = 'uploading' WHERE id = $1 AND status = 'failed'`,
      [id]
    );
    return Boolean(result.rowCount);
  }

  async retryStaleUpload(id: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE ${Tables.RELEASES} SET timestamp = now()
       WHERE id = $1 AND status = 'uploading' AND timestamp < now() - interval '15 minutes'`,
      [id]
    );
    return Boolean(result.rowCount);
  }

  async setReleaseUpdateId(id: string, updateId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${Tables.RELEASES} SET update_id = $2 WHERE id = $1 AND update_id IS NULL`,
      [id, updateId]
    );
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
      SELECT to_char(date_trunc('month', download_timestamp + interval '1 hour'), 'YYYY-MM') AS month,
             COUNT(DISTINCT installation_id) AS count
      FROM ${Tables.RELEASES_TRACKING}
      WHERE installation_id IS NOT NULL
      GROUP BY date_trunc('month', download_timestamp + interval '1 hour')
      ORDER BY month DESC
    `);
    return rows.map((row) => ({ month: row.month, count: Number(row.count) }));
  }

  async createRelease(release: Omit<Release, 'id'>): Promise<Release> {
    const query = `
      INSERT INTO ${Tables.RELEASES} (runtime_version, path, timestamp, commit_hash, commit_message, update_id, repository_url, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, runtime_version as "runtimeVersion", path, (timestamp AT TIME ZONE 'UTC') AS timestamp, commit_hash as "commitHash", update_id as "updateId",
                commit_message as "commitMessage", repository_url as "repositoryUrl", status
    `;

    const values = [
      release.runtimeVersion,
      release.path,
      release.timestamp,
      release.commitHash,
      release.commitMessage,
      release.updateId,
      release.repositoryUrl ?? null,
      release.status ?? 'inactive',
    ];
    const { rows } = await this.pool.query(query, values);
    return rows[0];
  }

  async getRelease(id: string): Promise<Release | null> {
    const query = `
      SELECT id, runtime_version as "runtimeVersion", path, (timestamp AT TIME ZONE 'UTC') AS timestamp,
             commit_hash as "commitHash", commit_message as "commitMessage", update_id as "updateId",
             repository_url as "repositoryUrl", status
      FROM ${Tables.RELEASES} WHERE id = $1
    `;

    const { rows } = await this.pool.query(query, [id]);
    return rows[0] || null;
  }

  async listReleases(): Promise<Release[]> {
    const query = `
      SELECT id, runtime_version as "runtimeVersion", path, (timestamp AT TIME ZONE 'UTC') AS timestamp,
             commit_hash as "commitHash", commit_message as "commitMessage", update_id as "updateId",
             repository_url as "repositoryUrl", status
      FROM ${Tables.RELEASES}
      ORDER BY timestamp DESC
    `;

    const { rows } = await this.pool.query(query);
    return rows;
  }
}
