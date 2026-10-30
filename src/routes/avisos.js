import { Router } from 'express'
import { asyncHandler } from '../middlewares/errores.js'
import { verificarToken } from '../middlewares/auth.js'
import { listar } from '../controllers/avisos.js'

const router = Router()
router.get('/', verificarToken, asyncHandler(listar))
export default router