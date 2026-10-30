import express from 'express'
import cors from 'cors'
import { config } from './config.js'
import authRoutes from './routes/auth.js'
import { notFound, errorHandler } from './middlewares/errores.js'

const app = express()
app.use(cors({ origin: config.corsOrigin, allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'] }))
app.use(express.json())
app.get('/health', (request, response) => response.json({ ok: true }))
app.use('/api/auth', authRoutes)
app.use(notFound)
app.use(errorHandler)
export default app
