import { PostgresDatabase } from './LocalDatabase';

export enum Tables {
  RELEASES = 'releases',
  RELEASES_TRACKING = 'releases_tracking',
}

export class DatabaseFactory {
  private static instance: PostgresDatabase;

  static getDatabase(): PostgresDatabase {
    if (process.env.DB_TYPE === 'postgres') {
      DatabaseFactory.instance = new PostgresDatabase();
    } else {
      throw new Error('Unsupported database type');
    }
    return DatabaseFactory.instance;
  }
}
