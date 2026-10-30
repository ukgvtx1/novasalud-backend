import mysql from 'mysql2/promise'
import { config } from './config.js'

export const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
  timezone: '-05:00'
})

export const withConnection = async (callback) => {
  const connection = await pool.getConnection()
  try {
    await connection.query("SET time_zone = '-05:00'")
    return await callback(connection)
  } finally {
    connection.release()
  }
}
