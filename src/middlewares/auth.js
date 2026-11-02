import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { AppError } from "./errores.js";

export const verificarToken = (request, response, next) => {
  const header = request.get("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token || !config.jwtSecret)
    return next(
      new AppError("TOKEN_INVALIDO", "Token ausente o inválido.", 401),
    );
  try {
    request.usuario = jwt.verify(token, config.jwtSecret);
    next();
  } catch {
    next(
      new AppError("TOKEN_INVALIDO", "Token ausente, inválido o vencido.", 401),
    );
  }
};

export const soloAdmin = (request, response, next) => {
  if (request.usuario?.rol !== "admin")
    return next(
      new AppError(
        "SIN_PERMISO",
        "No tienes permiso para realizar esta acción.",
        403,
      ),
    );
  next();
};
