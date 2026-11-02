import { Router } from "express";
import { asyncHandler } from "../middlewares/errores.js";
import { verificarToken } from "../middlewares/auth.js";
import { listar, crear } from "../controllers/clientes.js";

const router = Router();
router.use(verificarToken);
router.get("/", asyncHandler(listar));
router.post("/", asyncHandler(crear));
export default router;
