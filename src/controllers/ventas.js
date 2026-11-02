import { withConnection, pool } from "../db.js";
import { AppError } from "../middlewares/errores.js";
import { fechaHoraConOffset } from "../utils/fechas.js";
import { calcularImpuestos, redondear } from "../utils/dinero.js";

const METODOS = ["efectivo", "yape", "plin", "tarjeta"];
const COMPROBANTES = ["boleta", "factura"];
const ESTADOS = ["pagada", "espera"];

const idValido = (value) =>
  Number.isInteger(Number(value)) && Number(value) > 0;
const fechaValida = (value) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

const validarBase = (body = {}) => {
  if (!COMPROBANTES.includes(body.comprobante)) {
    throw new AppError(
      "VALIDACION",
      "comprobante debe ser boleta o factura.",
      400,
    );
  }
  if (!ESTADOS.includes(body.estado)) {
    throw new AppError("VALIDACION", "estado debe ser pagada o espera.", 400);
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new AppError(
      "VALIDACION",
      "items debe contener al menos un producto.",
      400,
    );
  }
  const items = new Map();
  for (const item of body.items) {
    if (
      !idValido(item?.producto_id) ||
      !Number.isInteger(item.cantidad) ||
      item.cantidad <= 0
    ) {
      throw new AppError(
        "VALIDACION",
        "Cada item requiere producto_id válido y cantidad entera positiva.",
        400,
      );
    }
    const productoId = Number(item.producto_id);
    items.set(productoId, (items.get(productoId) || 0) + item.cantidad);
  }
  return [...items].map(([producto_id, cantidad]) => ({
    producto_id,
    cantidad,
  }));
};

const validarPagos = (pagos) => {
  if (!Array.isArray(pagos) || pagos.length === 0) {
    throw new AppError(
      "VALIDACION",
      "pagos debe contener al menos un pago.",
      400,
    );
  }
  for (const pago of pagos) {
    if (
      !METODOS.includes(pago?.metodo) ||
      typeof pago.monto !== "number" ||
      !Number.isFinite(pago.monto) ||
      pago.monto <= 0
    ) {
      throw new AppError(
        "VALIDACION",
        "Cada pago requiere método válido y monto positivo.",
        400,
      );
    }
  }
};

const validarClienteFactura = async (connection, comprobante, clienteId) => {
  if (comprobante === "boleta" && clienteId == null) return;
  if (!idValido(clienteId)) {
    throw new AppError(
      "VALIDACION",
      comprobante === "factura"
        ? "La factura exige un cliente con RUC."
        : "El cliente no es válido.",
      400,
    );
  }
  const [rows] = await connection.execute(
    "SELECT id, tipo_doc FROM clientes WHERE id = ? LIMIT 1",
    [Number(clienteId)],
  );
  if (!rows[0]) throw new AppError("VALIDACION", "El cliente no existe.", 400);
  if (comprobante === "factura" && rows[0].tipo_doc !== "RUC") {
    throw new AppError(
      "VALIDACION",
      "La factura exige un cliente con RUC.",
      400,
    );
  }
};

const turnoAbierto = async (connection, usuarioId) => {
  const [rows] = await connection.execute(
    "SELECT id FROM turnos_caja WHERE usuario_id = ? AND estado = 'abierta' ORDER BY id DESC LIMIT 1 FOR UPDATE",
    [usuarioId],
  );
  if (!rows[0])
    throw new AppError(
      "TURNO_CERRADO",
      "Debes abrir una caja antes de vender.",
      409,
    );
  return rows[0].id;
};

const cargarProductos = async (connection, items) => {
  const result = [];
  for (const item of items) {
    const [rows] = await connection.execute(
      "SELECT id, nombre, precio, activo FROM productos WHERE id = ? LIMIT 1 FOR UPDATE",
      [item.producto_id],
    );
    const producto = rows[0];
    if (!producto || !producto.activo)
      throw new AppError(
        "PRODUCTO_NO_DISPONIBLE",
        "El producto no está disponible.",
        409,
      );
    result.push({
      ...item,
      nombre: producto.nombre,
      precio: Number(producto.precio),
    });
  }
  return result;
};

const descontarFefo = async (connection, productoId, cantidad) => {
  const [lotes] = await connection.execute(
    `SELECT id, stock
     FROM lotes
     WHERE producto_id = ? AND vencimiento >= CURDATE() AND stock > 0
     ORDER BY vencimiento ASC, id ASC
     FOR UPDATE`,
    [productoId],
  );
  const disponible = lotes.reduce((sum, lote) => sum + Number(lote.stock), 0);
  if (disponible < cantidad)
    throw new AppError(
      "STOCK_INSUFICIENTE",
      "No hay stock suficiente para el producto solicitado.",
      409,
    );
  let restante = cantidad;
  const asignaciones = [];
  for (const lote of lotes) {
    if (!restante) break;
    const tomado = Math.min(restante, Number(lote.stock));
    await connection.execute(
      "UPDATE lotes SET stock = stock - ? WHERE id = ?",
      [tomado, lote.id],
    );
    asignaciones.push({ lote_id: lote.id, cantidad: tomado });
    restante -= tomado;
  }
  return asignaciones;
};

const obtenerVenta = async (connection, id) => {
  const [ventas] = await connection.execute(
    `SELECT v.id, v.serie_numero, v.fecha, v.comprobante, v.estado, v.subtotal, v.igv, v.total, v.vuelto, v.usuario_id,
          v.turno_id, c.id AS cliente_id, c.nombre AS cliente_nombre
     FROM ventas v LEFT JOIN clientes c ON c.id = v.cliente_id WHERE v.id = ? LIMIT 1`,
    [id],
  );
  const venta = ventas[0];
  if (!venta) return null;
  const [items] = await connection.execute(
    `SELECT d.producto_id, p.nombre, d.cantidad, d.precio_unitario, d.subtotal
     FROM detalle_venta d INNER JOIN productos p ON p.id = d.producto_id
     WHERE d.venta_id = ? ORDER BY d.id`,
    [id],
  );
  const [pagos] = await connection.execute(
    "SELECT metodo, monto FROM pagos WHERE venta_id = ? ORDER BY id",
    [id],
  );
  return {
    id: venta.id,
    serie_numero: venta.serie_numero,
    fecha: fechaHoraConOffset(venta.fecha),
    turno_id: venta.turno_id,
    cliente: venta.cliente_nombre || null,
    comprobante: venta.comprobante,
    estado: venta.estado,
    items: items.map((item) => ({
      ...item,
      cantidad: Number(item.cantidad),
      precio_unitario: Number(item.precio_unitario),
      subtotal: Number(item.subtotal),
    })),
    subtotal: Number(venta.subtotal),
    igv: Number(venta.igv),
    total: Number(venta.total),
    pagos: pagos.map((pago) => ({
      metodo: pago.metodo,
      monto: Number(pago.monto),
    })),
    vuelto: Number(venta.vuelto),
  };
};

const crearSerie = async (connection, comprobante) => {
  const serie = comprobante === "factura" ? "F001" : "B001";
  const [rows] = await connection.execute(
    "SELECT serie, ultimo_numero FROM series_comprobante WHERE serie = ? FOR UPDATE",
    [serie],
  );
  if (!rows[0])
    throw new AppError(
      "ERROR_SERVIDOR",
      "No existe la serie del comprobante.",
      500,
    );
  const numero = Number(rows[0].ultimo_numero) + 1;
  await connection.execute(
    "UPDATE series_comprobante SET ultimo_numero = ? WHERE serie = ?",
    [numero, serie],
  );
  return `${serie}-${String(numero).padStart(4, "0")}`;
};

const insertarDetalles = async (connection, ventaId, items, pagada) => {
  for (const item of items) {
    const asignaciones = pagada
      ? await descontarFefo(connection, item.producto_id, item.cantidad)
      : [{ lote_id: null, cantidad: item.cantidad }];
    for (const asignacion of asignaciones) {
      await connection.execute(
        "INSERT INTO detalle_venta (venta_id, producto_id, lote_id, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?, ?)",
        [
          ventaId,
          item.producto_id,
          asignacion.lote_id,
          asignacion.cantidad,
          item.precio,
          redondear(item.precio * asignacion.cantidad),
        ],
      );
    }
  }
};

const guardarPagos = async (connection, ventaId, pagos) => {
  for (const pago of pagos) {
    await connection.execute(
      "INSERT INTO pagos (venta_id, metodo, monto) VALUES (?, ?, ?)",
      [ventaId, pago.metodo, pago.monto],
    );
  }
};

export const crear = async (request, response) => {
  const body = request.body || {};
  const itemsInput = validarBase(body);
  const pagos = body.estado === "pagada" ? body.pagos : [];
  if (body.estado === "pagada") validarPagos(pagos);
  const idempotencyKey = request.get("Idempotency-Key")?.trim() || null;
  if (idempotencyKey && idempotencyKey.length > 64)
    throw new AppError(
      "VALIDACION",
      "Idempotency-Key no puede superar 64 caracteres.",
      400,
    );
  const result = await withConnection(async (connection) => {
    await connection.beginTransaction();
    try {
      if (idempotencyKey) {
        const [existing] = await connection.execute(
          "SELECT id FROM ventas WHERE usuario_id = ? AND idempotency_key = ? LIMIT 1",
          [request.usuario.id, idempotencyKey],
        );
        if (existing[0]) {
          const sale = await obtenerVenta(connection, existing[0].id);
          await connection.commit();
          return { sale, duplicate: true };
        }
      }
      const turnoId = await turnoAbierto(connection, request.usuario.id);
      await validarClienteFactura(
        connection,
        body.comprobante,
        body.cliente_id,
      );
      const items = await cargarProductos(connection, itemsInput);
      const total = redondear(
        items.reduce((sum, item) => sum + item.precio * item.cantidad, 0),
      );
      const impuestos = calcularImpuestos(total);
      let vuelto = 0;
      if (body.estado === "pagada") {
        const sumaPagos = redondear(
          pagos.reduce((sum, pago) => sum + pago.monto, 0),
        );
        if (sumaPagos < total)
          throw new AppError(
            "VALIDACION",
            "La suma de pagos debe cubrir el total.",
            400,
          );
        const efectivo = pagos
          .filter((pago) => pago.metodo === "efectivo")
          .reduce((sum, pago) => sum + pago.monto, 0);
        vuelto = redondear(Math.max(0, efectivo - total));
      }
      const serieNumero =
        body.estado === "pagada"
          ? await crearSerie(connection, body.comprobante)
          : null;
      const [insert] = await connection.execute(
        `INSERT INTO ventas (usuario_id, cliente_id, turno_id, comprobante, serie_numero, subtotal, igv, total, vuelto, estado, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          request.usuario.id,
          body.cliente_id == null ? null : Number(body.cliente_id),
          turnoId,
          body.comprobante,
          serieNumero,
          impuestos.subtotal,
          impuestos.igv,
          impuestos.total,
          vuelto,
          body.estado,
          idempotencyKey,
        ],
      );
      await insertarDetalles(
        connection,
        insert.insertId,
        items,
        body.estado === "pagada",
      );
      if (body.estado === "pagada")
        await guardarPagos(connection, insert.insertId, pagos);
      const sale = await obtenerVenta(connection, insert.insertId);
      await connection.commit();
      return { sale, duplicate: false };
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
  response.status(result.duplicate ? 200 : 201).json(result.sale);
};

export const listar = async (request, response) => {
  const estado = request.query.estado || "";
  const desde = request.query.desde || "";
  const hasta = request.query.hasta || "";
  const page = Number.parseInt(request.query.page || "1", 10);
  const limit = Number.parseInt(request.query.limit || "20", 10);
  if (estado && !["pagada", "espera", "anulada"].includes(estado))
    throw new AppError("VALIDACION", "estado no es válido.", 400);
  if (desde && !fechaValida(desde))
    throw new AppError(
      "VALIDACION",
      "desde debe tener formato YYYY-MM-DD.",
      400,
    );
  if (hasta && !fechaValida(hasta))
    throw new AppError(
      "VALIDACION",
      "hasta debe tener formato YYYY-MM-DD.",
      400,
    );
  if (page < 1 || limit < 1 || limit > 100)
    throw new AppError("VALIDACION", "page y limit no son válidos.", 400);
  const own = request.usuario.rol !== "admin";
  const conditions = [];
  const params = [];
  if (own) {
    conditions.push("v.usuario_id = ?");
    params.push(request.usuario.id);
  }
  if (estado) {
    conditions.push("v.estado = ?");
    params.push(estado);
  }
  if (desde) {
    conditions.push("v.fecha >= ?");
    params.push(`${desde} 00:00:00`);
  }
  if (hasta) {
    conditions.push("v.fecha <= ?");
    params.push(`${hasta} 23:59:59`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [count] = await pool.execute(
    `SELECT COUNT(*) AS total FROM ventas v ${where}`,
    params,
  );
  const offset = (page - 1) * limit;
  const [rows] = await pool.execute(
    `SELECT v.id, v.serie_numero, v.fecha, v.turno_id, c.nombre AS cliente,
       CASE WHEN COUNT(DISTINCT p.metodo) > 1 THEN 'mixto' ELSE MAX(p.metodo) END AS metodo_pago,
       v.total, v.estado${own ? "" : ", u.nombre AS usuario_nombre"}
    FROM ventas v LEFT JOIN pagos p ON p.venta_id = v.id INNER JOIN usuarios u ON u.id = v.usuario_id
    LEFT JOIN clientes c ON c.id = v.cliente_id
     ${where} GROUP BY v.id ORDER BY v.fecha DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );
  response.json({
    data: rows.map((row) => ({
      id: row.id,
      serie_numero: row.serie_numero,
      fecha: fechaHoraConOffset(row.fecha),
      turno_id: row.turno_id,
      cliente: row.cliente || null,
      metodo_pago: row.metodo_pago || null,
      total: Number(row.total),
      estado: row.estado,
      ...(own ? {} : { usuario_nombre: row.usuario_nombre }),
    })),
    page,
    limit,
    total: Number(count[0].total),
  });
};

export const obtener = async (request, response) => {
  if (!idValido(request.params.id))
    throw new AppError("VALIDACION", "El ID de la venta no es válido.", 400);
  const [rows] = await pool.execute(
    "SELECT id FROM ventas WHERE id = ? AND (usuario_id = ? OR ? = 1) LIMIT 1",
    [
      Number(request.params.id),
      request.usuario.id,
      request.usuario.rol === "admin" ? 1 : 0,
    ],
  );
  if (!rows[0]) throw new AppError("NO_ENCONTRADO", "La venta no existe.", 404);
  response.json(await obtenerVenta(pool, Number(request.params.id)));
};

export const cobrar = async (request, response) => {
  if (!idValido(request.params.id))
    throw new AppError("VALIDACION", "El ID de la venta no es válido.", 400);
  const pagos = request.body?.pagos;
  validarPagos(pagos);
  const sale = await withConnection(async (connection) => {
    await connection.beginTransaction();
    try {
      const [rows] = await connection.execute(
        `SELECT id, usuario_id, cliente_id, comprobante, total, estado
         FROM ventas WHERE id = ? AND (usuario_id = ? OR ? = 1) LIMIT 1 FOR UPDATE`,
        [
          Number(request.params.id),
          request.usuario.id,
          request.usuario.rol === "admin" ? 1 : 0,
        ],
      );
      const venta = rows[0];
      if (!venta)
        throw new AppError(
          "NO_ENCONTRADO",
          "La venta no existe o no es del usuario.",
          404,
        );
      if (venta.estado !== "espera")
        throw new AppError("VALIDACION", "La venta no está en espera.", 400);
      const turnoId = await turnoAbierto(connection, request.usuario.id);
      const [details] = await connection.execute(
        `SELECT d.producto_id, d.cantidad, p.nombre, p.precio
         FROM detalle_venta d INNER JOIN productos p ON p.id = d.producto_id
         WHERE d.venta_id = ? ORDER BY d.id`,
        [venta.id],
      );
      const items = await cargarProductos(
        connection,
        details.map((item) => ({
          producto_id: item.producto_id,
          cantidad: Number(item.cantidad),
        })),
      );
      const total = Number(venta.total);
      const sumaPagos = redondear(
        pagos.reduce((sum, pago) => sum + pago.monto, 0),
      );
      if (sumaPagos < total)
        throw new AppError(
          "VALIDACION",
          "La suma de pagos debe cubrir el total.",
          400,
        );
      const efectivo = pagos
        .filter((pago) => pago.metodo === "efectivo")
        .reduce((sum, pago) => sum + pago.monto, 0);
      const vuelto = redondear(Math.max(0, efectivo - total));
      const serieNumero = await crearSerie(connection, venta.comprobante);
      await connection.execute(
        `UPDATE ventas SET turno_id = ?, serie_numero = ?, vuelto = ?, estado = 'pagada' WHERE id = ?`,
        [turnoId, serieNumero, vuelto, venta.id],
      );
      await connection.execute("DELETE FROM detalle_venta WHERE venta_id = ?", [
        venta.id,
      ]);
      await insertarDetalles(connection, venta.id, items, true);
      await guardarPagos(connection, venta.id, pagos);
      const result = await obtenerVenta(connection, venta.id);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
  response.json(sale);
};

export const descartar = async (request, response) => {
  if (!idValido(request.params.id))
    throw new AppError("VALIDACION", "El ID de la venta no es válido.", 400);
  const [result] = await pool.execute(
    "DELETE FROM ventas WHERE id = ? AND usuario_id = ? AND estado = 'espera'",
    [Number(request.params.id), request.usuario.id],
  );
  if (!result.affectedRows)
    throw new AppError(
      "NO_ENCONTRADO",
      "La venta no existe o no está en espera.",
      404,
    );
  response.status(204).send();
};

export const anular = async (request, response) => {
  if (!idValido(request.params.id))
    throw new AppError("VALIDACION", "El ID de la venta no es válido.", 400);
  const sale = await withConnection(async (connection) => {
    await connection.beginTransaction();
    try {
      const [rows] = await connection.execute(
        "SELECT id, estado FROM ventas WHERE id = ? LIMIT 1 FOR UPDATE",
        [Number(request.params.id)],
      );
      if (!rows[0])
        throw new AppError("NO_ENCONTRADO", "La venta no existe.", 404);
      if (rows[0].estado === "anulada")
        throw new AppError("VALIDACION", "La venta ya está anulada.", 400);
      const [details] = await connection.execute(
        "SELECT lote_id, cantidad FROM detalle_venta WHERE venta_id = ? AND lote_id IS NOT NULL",
        [Number(request.params.id)],
      );
      for (const detail of details)
        await connection.execute(
          "UPDATE lotes SET stock = stock + ? WHERE id = ?",
          [detail.cantidad, detail.lote_id],
        );
      await connection.execute(
        "UPDATE ventas SET estado = 'anulada', anulada_en = CURRENT_TIMESTAMP WHERE id = ?",
        [Number(request.params.id)],
      );
      const result = await obtenerVenta(connection, Number(request.params.id));
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
  response.json(sale);
};
