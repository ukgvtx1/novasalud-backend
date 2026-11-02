import { Router } from "express";
import { asyncHandler } from "../middlewares/errores.js";
import { verificarToken } from "../middlewares/auth.js";
import { login, me } from "../controllers/auth.js";

const router = Router();
router.post("/login", asyncHandler(login));
router.get("/me", verificarToken, asyncHandler(me));
export default router;
