export class AppError extends Error {
  constructor(codigo, mensaje, status) {
    super(mensaje);
    this.codigo = codigo;
    this.status = status;
  }
}

export const asyncHandler = (handler) => (request, response, next) => {
  Promise.resolve(handler(request, response, next)).catch(next);
};

export const notFound = (request, response, next) => {
  next(new AppError("NO_ENCONTRADO", "La ruta solicitada no existe.", 404));
};

export const errorHandler = (error, request, response, next) => {
  if (response.headersSent) return next(error);
  const status = Number.isInteger(error.status) ? error.status : 500;
  const codigo =
    status === 500 ? "ERROR_SERVIDOR" : error.codigo || "ERROR_SERVIDOR";
  const mensaje =
    status === 500 ? "Ocurrió un error interno del servidor." : error.message;
  if (status === 500) console.error(error);
  response.status(status).json({ error: { codigo, mensaje } });
};
