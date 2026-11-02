import { Router } from "express";
import { asyncHandler } from "../middlewares/errores.js";
import { verificarToken } from "../middlewares/auth.js";
import { obtener } from "../controllers/resumen.js";

const router = Router();
router.get("/", verificarToken, asyncHandler(obtener));
export default router;
