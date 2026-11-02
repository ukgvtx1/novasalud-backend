import { Router } from "express";
import { asyncHandler } from "../middlewares/errores.js";
import { verificarToken, soloAdmin } from "../middlewares/auth.js";
import {
  listar,
  crear,
  actualizar,
  eliminar,
  agregarLote,
} from "../controllers/productos.js";

const router = Router();
router.use(verificarToken);
router.get("/", asyncHandler(listar));
router.post("/", soloAdmin, asyncHandler(crear));
router.put("/:id", soloAdmin, asyncHandler(actualizar));
router.delete("/:id", soloAdmin, asyncHandler(eliminar));
router.post("/:id/lotes", soloAdmin, asyncHandler(agregarLote));
export default router;
