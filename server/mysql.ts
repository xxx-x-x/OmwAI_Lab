import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise'

type QueryValue = string | number | boolean | Date | Buffer | null
type ExecuteValues = QueryValue[]

export type DatabaseRow = RowDataPacket & Record<string, unknown>
type Executor = Pool | PoolConnection

export function createDatabase(databaseUrl: string) {
  if (!databaseUrl) throw new Error('缺少 DATABASE_URL，请在 .env 中配置 MySQL 连接地址')
  const url = new URL(databaseUrl)
  if (url.protocol !== 'mysql:') throw new Error('DATABASE_URL 必须使用 mysql:// 协议')
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 10, charset: 'utf8mb4' })

  const all = async <T extends DatabaseRow = DatabaseRow>(sql: string, values: ExecuteValues = [], executor: Executor = pool) => {
    const [rows] = await executor.execute<T[]>(sql, values)
    return rows
  }
  const get = async <T extends DatabaseRow = DatabaseRow>(sql: string, values: ExecuteValues = [], executor: Executor = pool) => (await all<T>(sql, values, executor))[0]
  const run = async (sql: string, values: ExecuteValues = [], executor: Executor = pool) => {
    const [result] = await executor.execute<ResultSetHeader>(sql, values)
    return result
  }
  const prepare = (sql: string) => ({
    all: <T extends DatabaseRow = DatabaseRow>(...values: QueryValue[]) => all<T>(sql, values),
    get: <T extends DatabaseRow = DatabaseRow>(...values: QueryValue[]) => get<T>(sql, values),
    run: (...values: QueryValue[]) => run(sql, values),
  })
  const transaction = async <T>(operation: (connection: PoolConnection) => Promise<T>) => {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const result = await operation(connection)
      await connection.commit()
      return result
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  return { pool, all, get, run, prepare, transaction }
}

export type Database = ReturnType<typeof createDatabase>

export async function initializeDatabase(database: Database) {
  const statements = [
    `CREATE TABLE IF NOT EXISTS analytics_metadata (id TINYINT UNSIGNED NOT NULL PRIMARY KEY, collected_since DATETIME(3) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS analytics_events (event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY, visitor_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, session_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL, kind ENUM('pageview', 'outbound_intent', 'outbound_click') NOT NULL, path VARCHAR(128) NOT NULL, provider_id VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL, created_at DATETIME(3) NOT NULL, INDEX idx_analytics_time (created_at), INDEX idx_analytics_visitor_time (visitor_id, kind, created_at), INDEX idx_analytics_provider_time (provider_id, created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `INSERT INTO analytics_metadata (id, collected_since) VALUES (1, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id = id`,
    `CREATE TABLE IF NOT EXISTS users (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, username VARCHAR(191) NOT NULL UNIQUE, email VARCHAR(191) NOT NULL UNIQUE, password_hash TEXT NOT NULL, role VARCHAR(20) NOT NULL DEFAULT 'user', email_verified_at TIMESTAMP NULL DEFAULT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS admin_mfa (user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, enabled TINYINT(1) NOT NULL DEFAULT 0, secret TEXT NULL, pending_secret TEXT NULL, pending_expires_at BIGINT NULL, last_step BIGINT NOT NULL DEFAULT -1, failures INT NOT NULL DEFAULT 0, locked_until BIGINT NOT NULL DEFAULT 0, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS mfa_recovery_codes (user_id BIGINT UNSIGNED NOT NULL, code_hash CHAR(64) NOT NULL, used_at TIMESTAMP NULL DEFAULT NULL, PRIMARY KEY (user_id, code_hash), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS email_verification_codes (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, email VARCHAR(191) NOT NULL, purpose VARCHAR(32) NOT NULL, code_hash CHAR(64) NOT NULL, expires_at TIMESTAMP NOT NULL, consumed_at TIMESTAMP NULL DEFAULT NULL, attempts TINYINT UNSIGNED NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_email_codes_lookup (email, purpose, created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS submissions (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NULL, submitter_login VARCHAR(191) NOT NULL, name VARCHAR(255) NOT NULL, website VARCHAR(2048) NOT NULL, models TEXT NOT NULL, pricing TEXT NOT NULL, notes TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending', review_note TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_submissions_user FOREIGN KEY(user_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS site_revisions (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, submission_id BIGINT UNSIGNED NOT NULL, proposal JSON NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending', pending_submission_id BIGINT UNSIGNED GENERATED ALWAYS AS (CASE WHEN status = 'pending' THEN submission_id ELSE NULL END) STORED, review_note TEXT NULL, reviewed_by BIGINT UNSIGNED NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_site_revision_pending (pending_submission_id), INDEX idx_site_revision_history (submission_id, id), FOREIGN KEY (submission_id) REFERENCES submissions(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS managed_providers (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, submission_id BIGINT UNSIGNED NULL UNIQUE, name VARCHAR(255) NOT NULL, website VARCHAR(2048) NOT NULL, models TEXT NOT NULL, pricing TEXT NOT NULL, notes TEXT NOT NULL, active TINYINT(1) NOT NULL DEFAULT 1, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_managed_providers_website (website(191))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS site_logos (provider_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, website VARCHAR(2048) NOT NULL, image MEDIUMBLOB NULL, content_type VARCHAR(32) NULL, digest CHAR(64) NULL, attempted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (provider_id) REFERENCES managed_providers(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS audit_logs (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, admin_id BIGINT UNSIGNED NOT NULL, action VARCHAR(100) NOT NULL, target_type VARCHAR(100) NOT NULL, target_id BIGINT NULL, details TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_audit_logs_admin_id (admin_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS model_rankings (slug VARCHAR(191) NOT NULL PRIMARY KEY, name VARCHAR(255) NOT NULL, creator VARCHAR(255) NOT NULL, creator_color VARCHAR(20) NOT NULL DEFAULT '#625bf6', creator_logo TEXT NOT NULL, context_window_tokens BIGINT NOT NULL DEFAULT 0, intelligence_index DOUBLE NULL, intelligence_estimated TINYINT(1) NOT NULL DEFAULT 0, cost_per_task DOUBLE NULL, input_price DOUBLE NULL, output_price DOUBLE NULL, median_tokens_per_second DOUBLE NULL, latency_seconds DOUBLE NULL, total_response_seconds DOUBLE NULL, is_reasoning TINYINT(1) NOT NULL DEFAULT 0, is_open_weights TINYINT(1) NOT NULL DEFAULT 0, deprecated TINYINT(1) NOT NULL DEFAULT 0, synced_at VARCHAR(40) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS model_ranking_syncs (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, source_url VARCHAR(2048) NOT NULL, model_count INT NOT NULL, synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS model_prices (source_id VARCHAR(100) NOT NULL DEFAULT 'official', provider_id VARCHAR(100) NOT NULL, model_id VARCHAR(191) NOT NULL, model_key VARCHAR(191) NOT NULL, name VARCHAR(255) NOT NULL, provider_name VARCHAR(255) NOT NULL, provider_icon_url VARCHAR(2048) NOT NULL, input_price DOUBLE NULL, output_price DOUBLE NULL, cached_input_price DOUBLE NULL, reasoning TINYINT(1) NOT NULL DEFAULT 0, open_weights TINYINT(1) NOT NULL DEFAULT 0, source_url VARCHAR(2048) NOT NULL, synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(source_id, provider_id, model_id), INDEX idx_model_prices_key (model_key)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS group_authorizations (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, submission_id BIGINT UNSIGNED NOT NULL, user_id BIGINT UNSIGNED NOT NULL, group_name VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, credential TEXT NULL, consent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, revoked_at TIMESTAMP NULL DEFAULT NULL, UNIQUE KEY uq_group_authorization (submission_id, group_name), FOREIGN KEY (submission_id) REFERENCES submissions(id), FOREIGN KEY (user_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS group_authorization_quotes (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, authorization_id BIGINT UNSIGNED NOT NULL, model_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, currency CHAR(3) NOT NULL, billing_unit VARCHAR(64) NOT NULL, input_price DECIMAL(20,8) NULL, output_price DECIMAL(20,8) NULL, source_url VARCHAR(2048) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_at TIMESTAMP NULL DEFAULT NULL, FOREIGN KEY (authorization_id) REFERENCES group_authorizations(id), INDEX idx_group_quote_model (model_id, status)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS site_pricing_settings (submission_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, enabled TINYINT(1) NOT NULL DEFAULT 0, platform VARCHAR(20) NOT NULL DEFAULT 'new-api', revision BIGINT UNSIGNED NOT NULL DEFAULT 0, synced_at TIMESTAMP NULL DEFAULT NULL, last_attempt_at TIMESTAMP NULL DEFAULT NULL, error_code VARCHAR(64) NULL, unsupported_count INT NOT NULL DEFAULT 0, FOREIGN KEY (submission_id) REFERENCES submissions(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS site_public_quotes (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, submission_id BIGINT UNSIGNED NOT NULL, model_id VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, group_name VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, currency CHAR(3) NOT NULL, billing_unit VARCHAR(64) NOT NULL, input_price DECIMAL(20,8) NOT NULL, output_price DECIMAL(20,8) NOT NULL, source_url VARCHAR(2048) NOT NULL, synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (submission_id) REFERENCES submissions(id), INDEX idx_public_quote_model (model_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS model_price_overrides (source_id VARBINARY(400) NOT NULL, provider_id VARBINARY(400) NOT NULL, model_id VARBINARY(764) NOT NULL, input_price DOUBLE NULL, output_price DOUBLE NULL, cached_input_price DOUBLE NULL, release_date VARCHAR(10) NULL, source_url VARCHAR(2048) NOT NULL, source_name VARCHAR(255) NOT NULL, updated_by BIGINT UNSIGNED NOT NULL, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY(source_id, provider_id, model_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    `CREATE TABLE IF NOT EXISTS model_price_syncs (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, source_url VARCHAR(2048) NOT NULL, model_count INT NOT NULL, provider_count INT NOT NULL, synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ]
  for (const statement of statements) await database.run(statement)
  await database.run(`CREATE TABLE IF NOT EXISTS site_public_groups (submission_id BIGINT UNSIGNED NOT NULL, website VARCHAR(2048) NOT NULL, group_name VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, multiplier DOUBLE NOT NULL, detected_at DATETIME(3) NOT NULL, source_url VARCHAR(2048) NOT NULL, PRIMARY KEY (submission_id, group_name), FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await database.run(`CREATE TABLE IF NOT EXISTS site_group_fetches (submission_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, website VARCHAR(2048) NOT NULL, attempted_at DATETIME(3) NOT NULL, FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  await database.run(`CREATE TABLE IF NOT EXISTS site_group_snapshots (submission_id BIGINT UNSIGNED NOT NULL PRIMARY KEY, website VARCHAR(2048) NOT NULL, groups_json JSON NOT NULL, detected_at DATETIME(3) NOT NULL, source_url VARCHAR(2048) NOT NULL, FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
  const publicQuoteColumns = await database.all<{ Field: string } & DatabaseRow>('SHOW COLUMNS FROM site_public_quotes')
  if (!publicQuoteColumns.some(column => column.Field === 'group_multiplier')) {
    await database.run('ALTER TABLE site_public_quotes ADD COLUMN group_multiplier DOUBLE NULL')
  }
  const analyticsIndexes = await database.all('SHOW INDEX FROM analytics_events')
  if (!analyticsIndexes.some(index => index.Key_name === 'idx_analytics_visitor_time')) {
    try { await database.run('ALTER TABLE analytics_events ADD INDEX idx_analytics_visitor_time (visitor_id, kind, created_at)') }
    catch (error) { if ((error as { code?: string }).code !== 'ER_DUP_KEYNAME') throw error }
  }
  const userColumns = await database.all<{ Field: string } & DatabaseRow>('SHOW COLUMNS FROM users')
  if (!userColumns.some(column => column.Field === 'email_verified_at')) {
    await database.run('ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMP NULL DEFAULT NULL AFTER role')
  }
  const submissionColumns = await database.all<{ Field: string } & DatabaseRow>('SHOW COLUMNS FROM submissions')
  if (!submissionColumns.some(column => column.Field === 'local_owner_verified')) {
    await database.run('ALTER TABLE submissions ADD COLUMN local_owner_verified TINYINT(1) NOT NULL DEFAULT 0')
  }
  const siteColumns = [
    ['listing_enable_day', 'DATE NULL'],
    ['listing_enable_count', 'INT UNSIGNED NOT NULL DEFAULT 0'],
    ['founded_at', 'DATE NULL'],
    ['description', 'TEXT NULL'],
    ['probe_credential', 'TEXT NULL'],
    ['probe_notes', 'TEXT NULL'],
    ['probe_group', 'VARCHAR(255) NULL'],
    ['probe_agreement_version', 'VARCHAR(32) NULL'],
    ['probe_consent_at', 'TIMESTAMP NULL DEFAULT NULL'],
    ['owner_identity', 'VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL'],
    ['directory_listed', 'TINYINT(1) NOT NULL DEFAULT 0'],
    ['invoice_supported', 'TINYINT(1) NULL DEFAULT NULL'],
    ['billing_type', 'VARCHAR(32) NULL DEFAULT NULL'],
    ['billing_details', 'VARCHAR(1000) NULL DEFAULT NULL'],
  ]
  for (const [name, definition] of siteColumns) {
    if (!submissionColumns.some(column => column.Field === name)) await database.run(`ALTER TABLE submissions ADD COLUMN ${name} ${definition}`)
  }
  const logoColumns = await database.all<{ Field: string } & DatabaseRow>('SHOW COLUMNS FROM site_logos')
  for (const [name, definition] of [['custom_url', 'VARCHAR(2048) NULL'], ['revision', 'BIGINT UNSIGNED NOT NULL DEFAULT 0'], ['fetch_status', "VARCHAR(20) NOT NULL DEFAULT 'pending'"]]) {
    if (!logoColumns.some(column => column.Field === name)) await database.run(`ALTER TABLE site_logos ADD COLUMN ${name} ${definition}`)
  }
  const priceColumns = await database.all<{ Field: string } & DatabaseRow>('SHOW COLUMNS FROM model_prices')
  for (const [name, definition] of [
    ['modality', "VARCHAR(32) NOT NULL DEFAULT 'text'"],
    ['billing_unit', "VARCHAR(128) NOT NULL DEFAULT '百万 Tokens'"],
    ['pricing_details', 'TEXT NULL'],
    ['source_name', 'VARCHAR(255) NULL'],
    ['price_checked_at', 'VARCHAR(32) NULL'],
  ]) {
    if (!priceColumns.some(column => column.Field === name)) {
      try { await database.run(`ALTER TABLE model_prices ADD COLUMN ${name} ${definition}`) }
      catch (error) { if ((error as { code?: string }).code !== 'ER_DUP_FIELDNAME') throw error }
    }
  }
  if (!priceColumns.some(column => column.Field === 'source_id')) {
    await database.run("ALTER TABLE model_prices ADD COLUMN source_id VARCHAR(100) NOT NULL DEFAULT 'official' FIRST, DROP PRIMARY KEY, ADD PRIMARY KEY(source_id, provider_id, model_id)")
  }
  if (!priceColumns.some(column => column.Field === 'capability_metadata')) {
    await database.run('ALTER TABLE model_prices ADD COLUMN capability_metadata TEXT NULL')
  }
  if (!priceColumns.some(column => column.Field === 'release_date')) {
    await database.run('ALTER TABLE model_prices ADD COLUMN release_date VARCHAR(10) NULL AFTER provider_name')
  }
  if (!priceColumns.some(column => column.Field === 'provider_icon_url')) {
    await database.run("ALTER TABLE model_prices ADD COLUMN provider_icon_url VARCHAR(2048) NOT NULL DEFAULT '' AFTER provider_name")
  }
}
