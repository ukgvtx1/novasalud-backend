import app from './app.js'
import { config } from './config.js'
import { pool } from './db.js'

const start = async () => {
  await pool.query("SET time_zone = '-05:00'")
  app.listen(config.port, () => console.log(`NovaSalud backend escuchando en http://localhost:${config.port}`))
}

start().catch((error) => {
  console.error('No se pudo iniciar el backend.', error)
  process.exitCode = 1
})
