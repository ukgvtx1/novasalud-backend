import { withConnection } from '../db.js'
import { fechaHoraConOffset } from '../utils/fechas.js'

const dinero = (valor) => Number(Number(valor || 0).toFixed(2))

export const obtener = async (request, response) => {
  const resumen = await withConnection(async (connection) => {
    if (request.usuario.rol === 'admin') {
      const [ventas] = await connection.execute(
        `SELECT COALESCE(SUM(total), 0) AS monto, COUNT(*) AS transacciones
         FROM ventas
         WHERE estado = 'pagada' AND fecha >= CURDATE() AND fecha < CURDATE() + INTERVAL 1 DAY`
      )
      const [ayer] = await connection.execute(
        `SELECT COALESCE(SUM(total), 0) AS monto
         FROM ventas
         WHERE estado = 'pagada' AND fecha >= CURDATE() - INTERVAL 1 DAY AND fecha < CURDATE()`
      )
      const [stock] = await connection.execute(
        `SELECT
           COALESCE(SUM(CASE WHEN CAST(estado AS BINARY) = CAST('stock_bajo' AS BINARY) THEN 1 ELSE 0 END), 0) AS cantidad,
           COALESCE(SUM(CASE WHEN CAST(estado AS BINARY) IN (CAST('agotado' AS BINARY), CAST('vencido' AS BINARY)) THEN 1 ELSE 0 END), 0) AS criticos
         FROM v_productos WHERE activo = 1`
      )
      const [vencimientos] = await connection.execute(
        "SELECT COALESCE(SUM(CASE WHEN CAST(estado AS BINARY) = CAST('por_vencer' AS BINARY) THEN 1 ELSE 0 END), 0) AS cantidad FROM v_productos WHERE activo = 1"
      )
      const [inventario] = await connection.execute(
        'SELECT COALESCE(SUM(stock_total), 0) AS items FROM v_productos WHERE activo = 1'
      )
      const montoAyer = Number(ayer[0].monto)
      const montoHoy = Number(ventas[0].monto)
      const variacion = montoAyer === 0 ? (montoHoy > 0 ? 100 : 0) : ((montoHoy - montoAyer) / montoAyer) * 100
      return {
        rol: 'admin',
        ventas_hoy: { monto: dinero(montoHoy), transacciones: Number(ventas[0].transacciones), variacion_vs_ayer: dinero(variacion) },
        stock_bajo: { cantidad: Number(stock[0].cantidad), criticos: Number(stock[0].criticos) },
        por_vencer: { cantidad: Number(vencimientos[0].cantidad), dias: 30 },
        inventario: { items: Number(inventario[0].items) }
      }
    }

    const [turnos] = await connection.execute(
      `SELECT id, apertura, fondo_inicial, franja
       FROM turnos_caja WHERE usuario_id = ? AND estado = 'abierta'
       ORDER BY id DESC LIMIT 1`,
      [request.usuario.id]
    )
    const turno = turnos[0]
    const ventas = [{ monto: 0, tickets: 0 }]
    const digitales = [{ monto: 0 }]
    const espera = [{ cantidad: 0 }]
    if (turno) {
      const [ultimoNocturno] = await connection.execute(
        `SELECT COALESCE(MAX(cierre), CURDATE()) AS inicio_operativo
         FROM turnos_caja
         WHERE usuario_id = ? AND estado = 'cerrada' AND franja = 'noche'`,
        [request.usuario.id]
      )
      const inicioOperativo = ultimoNocturno[0].inicio_operativo
      const [ventasOperativas] = await connection.execute(
        `SELECT COALESCE(SUM(total), 0) AS monto, COUNT(*) AS tickets
         FROM ventas
         WHERE usuario_id = ? AND turno_id IS NOT NULL AND estado = 'pagada'
           AND fecha > ? AND fecha <= CURRENT_TIMESTAMP`,
        [request.usuario.id, inicioOperativo]
      )
      const [digitalesOperativos] = await connection.execute(
        `SELECT COALESCE(SUM(p.monto), 0) AS monto
         FROM pagos p INNER JOIN ventas v ON v.id = p.venta_id
         WHERE v.usuario_id = ? AND v.turno_id IS NOT NULL AND v.estado = 'pagada'
           AND v.fecha > ? AND v.fecha <= CURRENT_TIMESTAMP
           AND p.metodo <> 'efectivo'`,
        [request.usuario.id, inicioOperativo]
      )
      const [esperaOperativa] = await connection.execute(
        "SELECT COUNT(*) AS cantidad FROM ventas WHERE usuario_id = ? AND turno_id = ? AND estado = 'espera'",
        [request.usuario.id, turno.id]
      )
      ventas[0] = ventasOperativas[0]
      digitales[0] = digitalesOperativos[0]
      espera[0] = esperaOperativa[0]
    }
    let efectivoEnCaja = 0
    if (turno) {
      const [efectivo] = await connection.execute(
        `SELECT COALESCE(SUM(p.monto), 0) AS monto
         FROM pagos p INNER JOIN ventas v ON v.id = p.venta_id
         WHERE v.turno_id = ? AND v.estado = 'pagada' AND p.metodo = 'efectivo'`,
        [turno.id]
      )
      efectivoEnCaja = Number(turno.fondo_inicial) + Number(efectivo[0].monto)
    }
    return {
      rol: 'trabajador',
      turno: turno ? { id: turno.id, apertura: fechaHoraConOffset(turno.apertura), franja: turno.franja } : null,
      ventas_hoy: { monto: dinero(ventas[0].monto), tickets: Number(ventas[0].tickets) },
      efectivo_en_caja: dinero(efectivoEnCaja),
      pagos_digitales: dinero(digitales[0].monto),
      ventas_en_espera: Number(espera[0].cantidad)
    }
  })
  response.json(resumen)
}
