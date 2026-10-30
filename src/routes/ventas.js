import { Router } from 'express'
import { asyncHandler } from '../middlewares/errores.js'
import { verificarToken, soloAdmin } from '../middlewares/auth.js'
import { crear, listar, obtener, cobrar, descartar, anular } from '../controllers/ventas.js'

const router = Router()
router.use(verificarToken)
router.get('/', asyncHandler(listar))
router.post('/', asyncHandler(crear))
router.get('/:id', asyncHandler(obtener))
router.put('/:id/cobrar', asyncHandler(cobrar))
router.delete('/:id', asyncHandler(descartar))
router.put('/:id/anular', soloAdmin, asyncHandler(anular))
export default router
