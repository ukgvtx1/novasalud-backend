import { pool } from "../db.js";

const prioridad = { agotado: 1, stock_bajo: 2, por_vencer: 3, vencido: 4 };

export const listar = async (request, response) => {
  const [rows] = await pool.execute(
    `SELECT id AS producto_id, nombre, estado, stock_total, stock_minimo, proximo_vencimiento
    FROM v_productos WHERE activo = 1 AND BINARY estado IN (BINARY 'agotado', BINARY 'stock_bajo', BINARY 'por_vencer', BINARY 'vencido')`,
  );
  const avisos = rows
    .sort(
      (a, b) =>
        prioridad[a.estado] - prioridad[b.estado] ||
        a.nombre.localeCompare(b.nombre),
    )
    .map((fila) => ({
      producto_id: fila.producto_id,
      nombre: fila.nombre,
      tipo: fila.estado,
      detalle:
        fila.estado === "por_vencer" || fila.estado === "vencido"
          ? `Vencimiento ${fila.proximo_vencimiento}`
          : `${Number(fila.stock_total)} unidades, mínimo ${Number(fila.stock_minimo)}`,
    }));
  response.json(avisos);
};
