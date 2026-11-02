import { withConnection } from '../db.js'
import { AppError } from '../middlewares/errores.js'
import { fechaHoraConOffset } from '../utils/fechas.js'

const dinero = (valor) => Number(Number(valor || 0).toFixed(2))
const FRANJAS = ['mañana', 'tarde', 'noche']

const turnoRespuesta = (fila) => ({
  id: fila.id,
  apertura: fechaHoraConOffset(fila.apertura),
  cierre: fila.cierre ? fechaHoraConOffset(fila.cierre) : null,
  fondo_inicial: dinero(fila.fondo_inicial),
  ventas: dinero(fila.ventas),
  ventas_efectivo: dinero(fila.ventas_efectivo),
  efectivo_esperado: fila.efectivo_esperado == null ? null : dinero(fila.efectivo_esperado),
  efectivo_contado: fila.efectivo_contado == null ? null : dinero(fila.efectivo_contado),
  diferencia: fila.diferencia == null ? null : dinero(fila.diferencia),
  estado: fila.estado,
  franja: fila.franja,
  usuario_dni: fila.usuario_dni || null,
  usuario_nombre: fila.usuario_nombre
})

const validarMonto = (valor, campo) => {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0) {
    throw new AppError('VALIDACION', `${campo} debe ser un número mayor o igual a cero.`, 400)
  }
}

export const actual = async (request, response) => {
  const [rows] = await withConnection((connection) => connection.execute(
    `SELECT t.id, t.apertura, t.cierre, t.fondo_inicial, t.efectivo_esperado,
            t.efectivo_contado, t.estado, t.franja,
            (SELECT COALESCE(SUM(v.total), 0) FROM ventas v WHERE v.turno_id = t.id AND v.estado = 'pagada') AS ventas,
            (SELECT COALESCE(SUM(p.monto), 0)
             FROM pagos p INNER JOIN ventas v ON v.id = p.venta_id
             WHERE v.turno_id = t.id AND v.estado = 'pagada' AND p.metodo = 'efectivo') AS ventas_efectivo,
            CASE WHEN t.efectivo_contado IS NULL THEN NULL
                 ELSE t.efectivo_contado - t.efectivo_esperado END AS diferencia,
            u.dni AS usuario_dni, u.nombre AS usuario_nombre
     FROM turnos_caja t INNER JOIN usuarios u ON u.id = t.usuario_id
     WHERE t.usuario_id = ? AND t.estado = 'abierta'
     ORDER BY t.id DESC LIMIT 1`,
    [request.usuario.id]
  ))
  response.json(rows[0] ? turnoRespuesta(rows[0]) : null)
}

export const buscarTrabajador = async (request, response) => {
  const dni = String(request.params.dni || '')
  if (!/^\d{8}$/.test(dni)) throw new AppError('VALIDACION', 'El DNI debe tener 8 dígitos.', 400)
  const [rows] = await withConnection((connection) => connection.execute(
    'SELECT dni, nombre FROM usuarios WHERE dni = ? AND activo = 1 LIMIT 1',
    [dni]
  ))
  if (!rows[0]) throw new AppError('TRABAJADOR_NO_ENCONTRADO', 'No se encontró un trabajador con ese DNI.', 404)
  response.json({ dni: rows[0].dni, nombre: rows[0].nombre })
}

export const listar = async (request, response) => {
  const page = Number.parseInt(request.query.page || '1', 10)
  const limit = Number.parseInt(request.query.limit || '50', 10)
  if (page < 1 || limit < 1 || limit > 100) {
    throw new AppError('VALIDACION', 'page y limit no son válidos.', 400)
  }
  const own = request.usuario.rol !== 'admin'
  const conditions = []
  const params = []
  if (own) {
    conditions.push('t.usuario_id = ?')
    params.push(request.usuario.id)
  }
  if (request.query.desde) {
    conditions.push('t.apertura >= ?')
    params.push(`${request.query.desde} 00:00:00`)
  }
  if (request.query.hasta) {
    conditions.push('t.apertura <= ?')
    params.push(`${request.query.hasta} 23:59:59`)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const [count] = await withConnection((connection) => connection.execute(
    `SELECT COUNT(*) AS total FROM turnos_caja t ${where}`,
    params
  ))
  const offset = (page - 1) * limit
  const [rows] = await withConnection((connection) => connection.execute(
    `SELECT t.id, t.apertura, t.cierre, t.fondo_inicial, t.efectivo_esperado,
            t.efectivo_contado, t.estado, t.franja,
            (SELECT COALESCE(SUM(v.total), 0) FROM ventas v WHERE v.turno_id = t.id AND v.estado = 'pagada') AS ventas,
            (SELECT COALESCE(SUM(p.monto), 0)
             FROM pagos p INNER JOIN ventas v ON v.id = p.venta_id
             WHERE v.turno_id = t.id AND v.estado = 'pagada' AND p.metodo = 'efectivo') AS ventas_efectivo,
            CASE WHEN t.efectivo_contado IS NULL THEN NULL
                 ELSE t.efectivo_contado - t.efectivo_esperado END AS diferencia,
            u.dni AS usuario_dni, u.nombre AS usuario_nombre
     FROM turnos_caja t INNER JOIN usuarios u ON u.id = t.usuario_id
     ${where}
     ORDER BY t.apertura DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  ))
  response.json({ data: rows.map(turnoRespuesta), page, limit, total: Number(count[0].total) })
}

export const abrir = async (request, response) => {
  const { fondo_inicial: fondoInicial, franja, usuario_dni: usuarioDni } = request.body || {}
  validarMonto(fondoInicial, 'fondo_inicial')
  if (!FRANJAS.includes(franja)) {
    throw new AppError('VALIDACION', 'franja debe ser mañana, tarde o noche.', 400)
  }
  if (!/^\d{8}$/.test(String(usuarioDni || ''))) {
    throw new AppError('VALIDACION', 'usuario_dni debe tener 8 dígitos.', 400)
  }
  const turno = await withConnection(async (connection) => {
    await connection.beginTransaction()
    try {
      const [usuario] = await connection.execute(
        'SELECT id, dni, nombre FROM usuarios WHERE id = ? AND dni = ? AND activo = 1 FOR UPDATE',
        [request.usuario.id, usuarioDni]
      )
      if (!usuario[0]) throw new AppError('SIN_PERMISO', 'El DNI no corresponde al usuario autenticado.', 403)
      const [abiertos] = await connection.execute(
        "SELECT id FROM turnos_caja WHERE usuario_id = ? AND estado = 'abierta' LIMIT 1 FOR UPDATE",
        [request.usuario.id]
      )
      if (abiertos[0]) throw new AppError('VALIDACION', 'Ya tienes un turno abierto.', 400)
      const [result] = await connection.execute(
        'INSERT INTO turnos_caja (usuario_id, fondo_inicial, franja) VALUES (?, ?, ?)',
        [request.usuario.id, fondoInicial, franja]
      )
      const [rows] = await connection.execute(
        `SELECT t.id, t.apertura, t.fondo_inicial, t.estado, t.franja,
                u.dni AS usuario_dni, u.nombre AS usuario_nombre
         FROM turnos_caja t INNER JOIN usuarios u ON u.id = t.usuario_id
         WHERE t.id = ?`,
        [result.insertId]
      )
      await connection.commit()
      return turnoRespuesta(rows[0])
    } catch (error) {
      await connection.rollback()
      throw error
    }
  })
  response.status(201).json(turno)
}

export const cerrar = async (request, response) => {
  const { efectivo_contado: efectivoContado } = request.body || {}
  validarMonto(efectivoContado, 'efectivo_contado')
  const resultado = await withConnection(async (connection) => {
    await connection.beginTransaction()
    try {
      const [turnos] = await connection.execute(
        `SELECT id, fondo_inicial, franja
         FROM turnos_caja
         WHERE usuario_id = ? AND estado = 'abierta'
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [request.usuario.id]
      )
      const turno = turnos[0]
      if (!turno) throw new AppError('TURNO_CERRADO', 'No tienes un turno abierto.', 409)
      const [pagos] = await connection.execute(
        `SELECT COALESCE(SUM(p.monto), 0) AS efectivo
         FROM pagos p
         INNER JOIN ventas v ON v.id = p.venta_id
         WHERE v.turno_id = ? AND v.estado = 'pagada' AND p.metodo = 'efectivo'`,
        [turno.id]
      )
      const efectivoEsperado = dinero(Number(turno.fondo_inicial) + Number(pagos[0].efectivo || 0))
      const diferencia = dinero(efectivoContado - efectivoEsperado)
      await connection.execute(
        `UPDATE turnos_caja
         SET cierre = CURRENT_TIMESTAMP, efectivo_esperado = ?, efectivo_contado = ?, estado = 'cerrada'
         WHERE id = ?`,
        [efectivoEsperado, efectivoContado, turno.id]
      )
      await connection.commit()
      return {
        turno_id: turno.id,
        franja: turno.franja,
        efectivo_esperado: efectivoEsperado,
        efectivo_contado: dinero(efectivoContado),
        diferencia
      }
    } catch (error) {
      await connection.rollback()
      throw error
    }
  })
  response.json(resultado)
}
