import { withConnection, pool } from "../db.js";
import { AppError } from "../middlewares/errores.js";

const dinero = (valor) => Number(Number(valor || 0).toFixed(2));
const MAX_DIAS = 366;
const ESTADOS_ALERTA = ["agotado", "vencido", "stock_bajo", "por_vencer"];

const validarRango = (request) => {
  const desde = request.query.desde;
  const hasta = request.query.hasta;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(desde || "") ||
    !/^\d{4}-\d{2}-\d{2}$/.test(hasta || "")
  ) {
    throw new AppError(
      "VALIDACION",
      "desde y hasta deben tener formato YYYY-MM-DD.",
      400,
    );
  }
  const inicio = new Date(`${desde}T00:00:00Z`);
  const fin = new Date(`${hasta}T00:00:00Z`);
  if (
    Number.isNaN(inicio.getTime()) ||
    Number.isNaN(fin.getTime()) ||
    desde > hasta
  ) {
    throw new AppError("VALIDACION", "El rango de fechas no es válido.", 400);
  }
  const dias = Math.floor((fin - inicio) / 86400000) + 1;
  if (dias > MAX_DIAS)
    throw new AppError("VALIDACION", "El rango máximo es de 366 días.", 400);
  return { desde, hasta, dias };
};

const rangoDias = (desde, dias) =>
  Array.from({ length: dias }, (_, index) => {
    const date = new Date(`${desde}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });

const csvValue = (value) => {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const obtener = async (request, response) => {
  const { desde, hasta, dias } = validarRango(request);
  const reporte = await withConnection(async (connection) => {
    const [ventasHoy] = await connection.execute(
      `SELECT COALESCE(SUM(total), 0) AS monto, COUNT(*) AS cantidad
       FROM ventas WHERE estado = 'pagada' AND fecha >= CURDATE() AND fecha < CURDATE() + INTERVAL 1 DAY`,
    );
    const [ventasAyer] = await connection.execute(
      `SELECT COALESCE(SUM(total), 0) AS monto
       FROM ventas WHERE estado = 'pagada' AND fecha >= CURDATE() - INTERVAL 1 DAY AND fecha < CURDATE()`,
    );
    const [ventasPeriodo] = await connection.execute(
      `SELECT COALESCE(SUM(total), 0) AS monto, COUNT(*) AS comprobantes
       FROM ventas WHERE estado = 'pagada' AND fecha >= ? AND fecha < DATE_ADD(?, INTERVAL 1 DAY)`,
      [desde, hasta],
    );
    const [ventasPorDia] = await connection.execute(
      `SELECT DATE(fecha) AS dia, COUNT(*) AS ventas, COALESCE(SUM(total), 0) AS total
       FROM ventas WHERE estado = 'pagada' AND fecha >= ? AND fecha < DATE_ADD(?, INTERVAL 1 DAY)
       GROUP BY DATE(fecha) ORDER BY dia`,
      [desde, hasta],
    );
    const [metodosPago] = await connection.execute(
      `SELECT pg.metodo, COUNT(*) AS operaciones, COALESCE(SUM(pg.monto), 0) AS total
       FROM pagos pg INNER JOIN ventas v ON v.id = pg.venta_id
       WHERE v.estado = 'pagada' AND v.fecha >= ? AND v.fecha < DATE_ADD(?, INTERVAL 1 DAY)
       GROUP BY pg.metodo ORDER BY total DESC`,
      [desde, hasta],
    );
    const [topProductos] = await connection.execute(
      `SELECT p.id, p.nombre, p.presentacion, SUM(d.cantidad) AS unidades, COALESCE(SUM(d.subtotal), 0) AS ingresos
       FROM detalle_venta d INNER JOIN ventas v ON v.id = d.venta_id
       INNER JOIN productos p ON p.id = d.producto_id
       WHERE v.estado = 'pagada' AND v.fecha >= ? AND v.fecha < DATE_ADD(?, INTERVAL 1 DAY)
      GROUP BY p.id, p.nombre, p.presentacion ORDER BY unidades DESC LIMIT 10`,
      [desde, hasta],
    );
    const [totalAlertas] = await connection.execute(
      `SELECT COUNT(*) AS cantidad
       FROM v_productos
       WHERE activo = 1 AND CAST(estado AS BINARY) IN (CAST(? AS BINARY), CAST(? AS BINARY), CAST(? AS BINARY), CAST(? AS BINARY))`,
      ESTADOS_ALERTA,
    );
    const [alertasInventario] = await connection.execute(
      `SELECT id, codigo, nombre, presentacion, stock_total, proximo_vencimiento, estado
       FROM v_productos
       WHERE activo = 1 AND CAST(estado AS BINARY) IN (CAST(? AS BINARY), CAST(? AS BINARY), CAST(? AS BINARY), CAST(? AS BINARY))
       ORDER BY CASE
         WHEN CAST(estado AS BINARY) = CAST('agotado' AS BINARY) THEN 1
         WHEN CAST(estado AS BINARY) = CAST('vencido' AS BINARY) THEN 2
         WHEN CAST(estado AS BINARY) = CAST('stock_bajo' AS BINARY) THEN 3
         WHEN CAST(estado AS BINARY) = CAST('por_vencer' AS BINARY) THEN 4
         ELSE 5
       END, stock_total ASC, nombre
       LIMIT 10`,
      ESTADOS_ALERTA,
    );
    const totalPeriodo = Number(ventasPeriodo[0].monto);
    const cantidadPeriodo = Number(ventasPeriodo[0].comprobantes);
    const montoHoy = Number(ventasHoy[0].monto);
    const montoAyer = Number(ventasAyer[0].monto);
    const variacion =
      montoAyer === 0
        ? montoHoy > 0
          ? 100
          : 0
        : ((montoHoy - montoAyer) / montoAyer) * 100;
    const porDia = new Map(
      ventasPorDia.map((row) => [String(row.dia).slice(0, 10), row]),
    );
    return {
      kpis: {
        ventasHoy: { monto: dinero(montoHoy), variacion: dinero(variacion) },
        ventasPeriodo: {
          monto: dinero(totalPeriodo),
          comprobantes: cantidadPeriodo,
        },
        ticketPromedio: dinero(
          cantidadPeriodo ? totalPeriodo / cantidadPeriodo : 0,
        ),
        productosAlerta: Number(totalAlertas[0].cantidad),
      },
      ventasPorDia: rangoDias(desde, dias).map((dia) => ({
        dia,
        ventas: Number(porDia.get(dia)?.ventas || 0),
        total: dinero(porDia.get(dia)?.total || 0),
      })),
      metodosPago: metodosPago.map((row) => ({
        metodo: row.metodo,
        operaciones: Number(row.operaciones),
        total: dinero(row.total),
      })),
      topProductos: topProductos.map((row) => ({
        id: row.id,
        nombre: row.nombre,
        presentacion: row.presentacion,
        unidades: Number(row.unidades),
        ingresos: dinero(row.ingresos),
      })),
      alertasInventario: alertasInventario.map((row) => ({
        ...row,
        stock_total: Number(row.stock_total),
        proximo_vencimiento: row.proximo_vencimiento || null,
      })),
    };
  });
  response.json(reporte);
};

export const exportarCsv = async (request, response) => {
  const { desde, hasta } = validarRango(request);
  const [rows] = await pool.execute(
    `SELECT v.fecha, v.comprobante, v.serie_numero, COALESCE(c.nombre, '') AS cliente,
            u.nombre AS trabajador, v.total,
            CASE WHEN COUNT(DISTINCT pg.metodo) > 1 THEN 'mixto' ELSE COALESCE(MAX(pg.metodo), '') END AS metodo_pago
     FROM ventas v INNER JOIN usuarios u ON u.id = v.usuario_id
     LEFT JOIN clientes c ON c.id = v.cliente_id
     LEFT JOIN pagos pg ON pg.venta_id = v.id
     WHERE v.estado = 'pagada' AND v.fecha >= ? AND v.fecha < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY v.id, v.fecha, v.comprobante, v.serie_numero, c.nombre, u.nombre, v.total
     ORDER BY v.fecha ASC`,
    [desde, hasta],
  );
  const lines = [
    [
      "fecha",
      "comprobante",
      "serie_numero",
      "cliente",
      "trabajador",
      "total",
      "metodo_pago",
    ],
    ...rows.map((row) => [
      row.fecha,
      row.comprobante,
      row.serie_numero,
      row.cliente,
      row.trabajador,
      dinero(row.total).toFixed(2),
      row.metodo_pago,
    ]),
  ];
  const csv = `\ufeff${lines.map((line) => line.map(csvValue).join(",")).join("\n")}\n`;
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader(
    "Content-Disposition",
    `attachment; filename="reporte-${desde}-${hasta}.csv"`,
  );
  response.send(csv);
};
