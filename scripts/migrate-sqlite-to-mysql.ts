import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import mysql from 'mysql2/promise'
import { createDatabase, initializeDatabase } from '../server/mysql.ts'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('缺少 DATABASE_URL')
const url = new URL(databaseUrl)
if (!/^[A-Za-z0-9_$]+$/.test(url.pathname.slice(1))) throw new Error('DATABASE_URL 中的数据库名无效')
const databaseName = url.pathname.slice(1)
const serverUrl = new URL(databaseUrl)
serverUrl.pathname = '/'
const connection = await mysql.createConnection(serverUrl.toString())
await connection.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
await connection.end()

const sqlitePath = resolve(process.argv[2] ?? 'data/omwai.db')
if (!existsSync(sqlitePath)) throw new Error(`SQLite 文件不存在: ${sqlitePath}`)
const source = new DatabaseSync(sqlitePath, { readOnly: true })
const target = createDatabase(databaseUrl)
await initializeDatabase(target)

const tables = ['users', 'submissions', 'managed_providers', 'audit_logs', 'model_rankings', 'model_ranking_syncs'] as const
const migrated: Record<string, number> = {}
await target.transaction(async mysqlConnection => {
  await mysqlConnection.query('SET FOREIGN_KEY_CHECKS = 0')
  try {
    for (const table of [...tables].reverse()) await mysqlConnection.query(`DELETE FROM \`${table}\``)
    for (const table of tables) {
      const rows = source.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
      if (rows.length) {
        const columns = Object.keys(rows[0])
        const placeholders = columns.map(() => '?').join(', ')
        const sql = `INSERT INTO \`${table}\` (${columns.map(column => `\`${column}\``).join(', ')}) VALUES (${placeholders})`
        for (const row of rows) await mysqlConnection.execute(sql, columns.map(column => row[column]))
      }
      migrated[table] = rows.length
    }
  } finally {
    await mysqlConnection.query('SET FOREIGN_KEY_CHECKS = 1')
  }
})
source.close()
await target.pool.end()
console.log(JSON.stringify({ sqlitePath, database: databaseName, migrated }, null, 2))
