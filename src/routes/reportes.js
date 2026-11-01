import { Router } from 'express'
import { asyncHandler } from '../middlewares/errores.js'
import { verificarToken, soloAdmin } from '../middlewares/auth.js'
import { obtener, exportarCsv } from '../controllers/reportes.js'

const router = Router()
router.use(verificarToken, soloAdmin)
router.get('/', asyncHandler(obtener))
router.get('/exportar.csv', asyncHandler(exportarCsv))

export default router
