import { withConnection } from '../db.js'
import { AppError } from '../middlewares/errores.js'
import { fechaHoraConOffset } from '../utils/fechas.js'

const dinero = (valor) => Number(Number(valor || 0).toFixed(2))
const FRANJAS = ['mañana', 'tarde', 'noche']

const turnoRespuesta = (fila) => ({
  id: fila.id,
  apertura: fechaHoraConOffset(fila.apertura),
  fondo_inicial: dinero(fila.fondo_inicial),
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
    `SELECT t.id, t.apertura, t.fondo_inicial, t.estado, t.franja,
            u.dni AS usuario_dni, u.nombre AS usuario_nombre
     FROM turnos_caja t INNER JOIN usuarios u ON u.id = t.usuario_id
     WHERE t.usuario_id = ? AND t.estado = 'abierta'
     ORDER BY t.id DESC LIMIT 1`,
    [request.usuario.id]
  ))
  response.json(rows[0] ? turnoRespuesta(rows[0]) : null)
}

export const abrir = async (request, response) => {
  const { fondo_inicial: fondoInicial, franja } = request.body || {}
  validarMonto(fondoInicial, 'fondo_inicial')
  if (!FRANJAS.includes(franja)) {
    throw new AppError('VALIDACION', 'franja debe ser mañana, tarde o noche.', 400)
  }
  const turno = await withConnection(async (connection) => {
    await connection.beginTransaction()
    try {
      const [usuario] = await connection.execute(
        'SELECT id, dni, nombre FROM usuarios WHERE id = ? AND activo = 1 FOR UPDATE',
        [request.usuario.id]
      )
      if (!usuario[0]) throw new AppError('TOKEN_INVALIDO', 'El usuario del token ya no está activo.', 401)
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
