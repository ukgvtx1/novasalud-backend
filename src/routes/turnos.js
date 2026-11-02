import { Router } from "express";
import { asyncHandler } from "../middlewares/errores.js";
import { verificarToken } from "../middlewares/auth.js";
import {
  actual,
  abrir,
  cerrar,
  listar,
  buscarTrabajador,
} from "../controllers/turnos.js";

const router = Router();
router.use(verificarToken);
router.get("/", asyncHandler(listar));
router.get("/trabajadores/:dni", asyncHandler(buscarTrabajador));
router.get("/actual", asyncHandler(actual));
router.post("/abrir", asyncHandler(abrir));
router.post("/cerrar", asyncHandler(cerrar));
export default router;
