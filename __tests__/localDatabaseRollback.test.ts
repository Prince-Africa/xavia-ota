import { Pool } from 'pg';

import { PostgresDatabase } from '../apiUtils/database/LocalDatabase';

jest.mock('pg');

function databaseWithActive(activeId: string) {
  const query = jest.fn().mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT runtime_version')) return { rows: [{ runtime_version: '1.2.0' }] };
    if (sql.includes('SELECT id, update_id, status')) {
      return { rows: [{ id: 'target-id', update_id: 'target-update', status: 'inactive' }] };
    }
    if (sql.includes('SELECT id, update_id FROM')) {
      return { rows: [{ id: activeId, update_id: 'current-update' }] };
    }
    return { rows: [] };
  });
  const release = jest.fn();
  (Pool as unknown as jest.Mock).mockImplementation(() => ({ connect: async () => ({ query, release }) }));
  return { database: new PostgresDatabase(), query, release };
}

describe('Postgres rollback activation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('switches only the selected runtime in one transaction', async () => {
    const { database, query, release } = databaseWithActive('current-id');

    expect(await database.rollbackToRelease('target-id', 'current-id')).toBe('activated');
    const calls = query.mock.calls.map(([sql]) => String(sql).trim());
    expect(calls[0]).toBe('BEGIN');
    expect(calls).toEqual(expect.arrayContaining([
      expect.stringContaining("SET status = 'inactive'"),
      expect.stringContaining("SET status = 'active'"),
    ]));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'inactive'"), ['1.2.0']);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status = 'active'"), ['target-id', '1.2.0']);
    expect(calls[calls.length - 1]).toBe('COMMIT');
    expect(release).toHaveBeenCalled();
  });

  it('refuses a stale confirmation without changing release status', async () => {
    const { database, query } = databaseWithActive('newer-id');

    expect(await database.rollbackToRelease('target-id', 'previous-id')).toBe('active_changed');
    const calls = query.mock.calls.map(([sql]) => String(sql));
    expect(calls).toContain('ROLLBACK');
    expect(calls.some((sql) => sql.includes('SET status'))).toBe(false);
  });
});

describe('Postgres upload activation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps the active release of another runtime when 1.1.2 is published', async () => {
    const query = jest.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT runtime_version')) {
        return { rows: [{ runtime_version: '1.1.2' }] };
      }
      if (sql.includes("SET status = 'active'")) return { rowCount: 1 };
      return { rows: [] };
    });
    const release = jest.fn();
    (Pool as unknown as jest.Mock).mockImplementation(() => ({ connect: async () => ({ query, release }) }));

    await new PostgresDatabase().activateRelease('new-1.1.2-ota');

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'inactive' WHERE runtime_version = $1 AND status = 'active'"),
      ['1.1.2']
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'active' WHERE id = $1"),
      ['new-1.1.2-ota']
    );
    const statements = query.mock.calls.map(([sql]) => String(sql).trim());
    expect(statements[statements.length - 1]).toBe('COMMIT');
    expect(release).toHaveBeenCalled();
  });
});
