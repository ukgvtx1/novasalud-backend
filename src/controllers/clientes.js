import { pool } from '../db.js'
import { AppError } from '../middlewares/errores.js'

const clienteDesdeFila = (fila) => ({
  id: fila.id,
  tipo_doc: fila.tipo_doc,
  numero_doc: fila.numero_doc,
  nombre: fila.nombre
})

const validarCliente = (body = {}) => {
  const { tipo_doc: tipoDoc, numero_doc: numeroDoc, nombre } = body
  if (!['DNI', 'RUC'].includes(tipoDoc)) {
    throw new AppError('VALIDACION', 'tipo_doc debe ser DNI o RUC.', 400)
  }
  const longitud = tipoDoc === 'DNI' ? 8 : 11
  if (typeof numeroDoc !== 'string' || !new RegExp(`^\\d{${longitud}}$`).test(numeroDoc)) {
    throw new AppError('VALIDACION', `${tipoDoc} debe tener ${longitud} dígitos.`, 400)
  }
  if (typeof nombre !== 'string' || !nombre.trim()) {
    throw new AppError('VALIDACION', 'nombre es obligatorio.', 400)
  }
  return [tipoDoc, numeroDoc, nombre.trim()]
}

export const listar = async (request, response) => {
  const query = typeof request.query.q === 'string' ? request.query.q.trim() : ''
  const like = `%${query}%`
  const [rows] = await pool.execute(
    `SELECT id, tipo_doc, numero_doc, nombre
     FROM clientes
     WHERE (? = '' OR nombre LIKE ? OR numero_doc LIKE ?)
     ORDER BY nombre ASC`,
    [query, like, like]
  )
  response.json(rows.map(clienteDesdeFila))
}

export const crear = async (request, response) => {
  const datos = validarCliente(request.body)
  try {
    const [result] = await pool.execute(
      'INSERT INTO clientes (tipo_doc, numero_doc, nombre) VALUES (?, ?, ?)',
      datos
    )
    const [rows] = await pool.execute(
      'SELECT id, tipo_doc, numero_doc, nombre FROM clientes WHERE id = ?',
      [result.insertId]
    )
    response.status(201).json(clienteDesdeFila(rows[0]))
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      throw new AppError('VALIDACION', 'El número de documento ya está registrado.', 400)
    }
    throw error
  }
}
