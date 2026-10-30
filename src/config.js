import dotenv from 'dotenv'

dotenv.config()

const required = (name) => {
  const value = process.env[name]
  if (value === undefined) throw new Error(`Falta la variable de entorno ${name}`)
  return value
}

export const config = {
  db: {
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT || 3306),
    user: required('DB_USER'),
    password: process.env.DB_PASS || '',
    database: required('DB_NAME')
  },
  jwtSecret: process.env.JWT_SECRET || '',
  port: Number(process.env.PORT || 3000),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173'
}
