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
    `CREATE TABLE IF NOT EXISTS users (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, username VARCHAR(191) NOT NULL UNIQUE, email VARCHAR(191) NOT NULL UNIQUE, password_hash TEXT NOT NULL, role VARCHAR(20) NOT NULL DEFAULT 'user', created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS submissions (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, user_id BIGINT UNSIGNED NULL, submitter_login VARCHAR(191) NOT NULL, name VARCHAR(255) NOT NULL, website VARCHAR(2048) NOT NULL, models TEXT NOT NULL, pricing TEXT NOT NULL, notes TEXT NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending', review_note TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT fk_submissions_user FOREIGN KEY(user_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS managed_providers (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, submission_id BIGINT UNSIGNED NULL UNIQUE, name VARCHAR(255) NOT NULL, website VARCHAR(2048) NOT NULL, models TEXT NOT NULL, pricing TEXT NOT NULL, notes TEXT NOT NULL, active TINYINT(1) NOT NULL DEFAULT 1, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_managed_providers_website (website(191))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS audit_logs (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, admin_id BIGINT UNSIGNED NOT NULL, action VARCHAR(100) NOT NULL, target_type VARCHAR(100) NOT NULL, target_id BIGINT NULL, details TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX idx_audit_logs_admin_id (admin_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS model_rankings (slug VARCHAR(191) NOT NULL PRIMARY KEY, name VARCHAR(255) NOT NULL, creator VARCHAR(255) NOT NULL, creator_color VARCHAR(20) NOT NULL DEFAULT '#625bf6', creator_logo TEXT NOT NULL, context_window_tokens BIGINT NOT NULL DEFAULT 0, intelligence_index DOUBLE NULL, intelligence_estimated TINYINT(1) NOT NULL DEFAULT 0, cost_per_task DOUBLE NULL, input_price DOUBLE NULL, output_price DOUBLE NULL, median_tokens_per_second DOUBLE NULL, latency_seconds DOUBLE NULL, total_response_seconds DOUBLE NULL, is_reasoning TINYINT(1) NOT NULL DEFAULT 0, is_open_weights TINYINT(1) NOT NULL DEFAULT 0, deprecated TINYINT(1) NOT NULL DEFAULT 0, synced_at VARCHAR(40) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS model_ranking_syncs (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, source_url VARCHAR(2048) NOT NULL, model_count INT NOT NULL, synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS model_prices (source_id VARCHAR(100) NOT NULL DEFAULT 'official', provider_id VARCHAR(100) NOT NULL, model_id VARCHAR(191) NOT NULL, model_key VARCHAR(191) NOT NULL, name VARCHAR(255) NOT NULL, provider_name VARCHAR(255) NOT NULL, provider_icon_url VARCHAR(2048) NOT NULL, input_price DOUBLE NULL, output_price DOUBLE NULL, cached_input_price DOUBLE NULL, reasoning TINYINT(1) NOT NULL DEFAULT 0, open_weights TINYINT(1) NOT NULL DEFAULT 0, source_url VARCHAR(2048) NOT NULL, synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(source_id, provider_id, model_id), INDEX idx_model_prices_key (model_key)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS model_price_syncs (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY, source_url VARCHAR(2048) NOT NULL, model_count INT NOT NULL, provider_count INT NOT NULL, synced_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ]
  for (const statement of statements) await database.run(statement)
  const priceColumns = await database.all<{ Field: string } & DatabaseRow>('SHOW COLUMNS FROM model_prices')
  if (!priceColumns.some(column => column.Field === 'source_id')) {
    await database.run("ALTER TABLE model_prices ADD COLUMN source_id VARCHAR(100) NOT NULL DEFAULT 'official' FIRST, DROP PRIMARY KEY, ADD PRIMARY KEY(source_id, provider_id, model_id)")
  }
  if (!priceColumns.some(column => column.Field === 'provider_icon_url')) {
    await database.run("ALTER TABLE model_prices ADD COLUMN provider_icon_url VARCHAR(2048) NOT NULL DEFAULT '' AFTER provider_name")
  }
}
