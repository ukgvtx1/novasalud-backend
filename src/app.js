import express from "express";
import cors from "cors";
import { config } from "./config.js";
import authRoutes from "./routes/auth.js";
import productosRoutes from "./routes/productos.js";
import avisosRoutes from "./routes/avisos.js";
import clientesRoutes from "./routes/clientes.js";
import turnosRoutes from "./routes/turnos.js";
import ventasRoutes from "./routes/ventas.js";
import resumenRoutes from "./routes/resumen.js";
import reportesRoutes from "./routes/reportes.js";
import { notFound, errorHandler } from "./middlewares/errores.js";

const app = express();
app.use(
  cors({
    origin: config.corsOrigin,
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
  }),
);
app.use(express.json());
app.get("/health", (request, response) => response.json({ ok: true }));
app.use("/api/auth", authRoutes);
app.use("/api/productos", productosRoutes);
app.use("/api/avisos-stock", avisosRoutes);
app.use("/api/clientes", clientesRoutes);
app.use("/api/turnos", turnosRoutes);
app.use("/api/ventas", ventasRoutes);
app.use("/api/resumen", resumenRoutes);
app.use("/api/reportes", reportesRoutes);
app.use(notFound);
app.use(errorHandler);
export default app;
