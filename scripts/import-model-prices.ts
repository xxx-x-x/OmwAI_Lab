import { readFile } from 'node:fs/promises'
import { createDatabase, initializeDatabase } from '../server/mysql.ts'
import { importPrices, validatePriceImport } from '../server/price-import.ts'

const file = process.argv[2] ?? new URL('../data/curated-model-prices.json', import.meta.url)
const rows = validatePriceImport(JSON.parse(await readFile(file, 'utf8')))
const database = createDatabase(process.env.DATABASE_URL ?? '')
try {
  await initializeDatabase(database)
  console.log(JSON.stringify({ imported: await importPrices(database, rows), source: String(file) }))
} finally {
  await database.pool.end()
}
