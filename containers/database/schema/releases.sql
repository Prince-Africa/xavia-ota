CREATE TABLE IF NOT EXISTS releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  runtime_version VARCHAR(255) NOT NULL,
  path VARCHAR(255) NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  commit_hash VARCHAR(255) NOT NULL,
  commit_message TEXT NOT NULL,
  update_id VARCHAR(255),
  repository_url VARCHAR(255),
  status VARCHAR(32) NOT NULL DEFAULT 'inactive'
);
CREATE INDEX IF NOT EXISTS releases_runtime_status_idx ON releases (runtime_version, status);
CREATE UNIQUE INDEX IF NOT EXISTS releases_runtime_update_id_unique
  ON releases (runtime_version, update_id) WHERE update_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS releases_one_active_per_runtime_unique
  ON releases (runtime_version) WHERE status = 'active';
