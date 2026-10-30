import { pool, withConnection } from '../db.js'
import { AppError } from '../middlewares/errores.js'

const productoDesdeFila = (fila) => ({
  id: fila.id,
  codigo: fila.codigo,
  nombre: fila.nombre,
  presentacion: fila.presentacion,
  precio: Number(fila.precio),
  stock_total: Number(fila.stock_total),
  stock_minimo: Number(fila.stock_minimo),
  requiere_receta: Boolean(fila.requiere_receta),
  proximo_vencimiento: fila.proximo_vencimiento || null,
  estado: fila.estado
})

const idValido = (valor) => Number.isInteger(Number(valor)) && Number(valor) > 0

const validarDatosProducto = (body = {}) => {
  const campos = ['codigo', 'nombre', 'presentacion']
  if (campos.some((campo) => typeof body[campo] !== 'string' || !body[campo].trim())) {
    throw new AppError('VALIDACION', 'Código, nombre y presentación son obligatorios.', 400)
  }
  if (typeof body.precio !== 'number' || !Number.isFinite(body.precio) || body.precio < 0) {
    throw new AppError('VALIDACION', 'El precio debe ser un número mayor o igual a cero.', 400)
  }
  if (!Number.isInteger(body.stock_minimo) || body.stock_minimo < 0) {
    throw new AppError('VALIDACION', 'El stock_minimo debe ser un entero mayor o igual a cero.', 400)
  }
  if (typeof body.requiere_receta !== 'boolean') {
    throw new AppError('VALIDACION', 'requiere_receta debe ser booleano.', 400)
  }
}

const datosProducto = (body) => [
  body.codigo.trim(),
  body.nombre.trim(),
  body.presentacion.trim(),
  body.precio,
  body.stock_minimo,
  body.requiere_receta ? 1 : 0
]

const buscarProducto = async (id) => {
  const [rows] = await pool.execute(
    'SELECT id, codigo, nombre, presentacion, precio, stock_total, stock_minimo, requiere_receta, proximo_vencimiento, estado FROM v_productos WHERE id = ? AND activo = 1 LIMIT 1',
    [id]
  )
  return rows[0] ? productoDesdeFila(rows[0]) : null
}

export const listar = async (request, response) => {
  const query = typeof request.query.q === 'string' ? request.query.q.trim() : ''
  const page = Number.parseInt(request.query.page || '1', 10)
  const limit = Number.parseInt(request.query.limit || '20', 10)
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AppError('VALIDACION', 'page debe ser mayor o igual a 1 y limit debe estar entre 1 y 100.', 400)
  }
  const filter = query ? ' AND (nombre LIKE ? OR codigo LIKE ?)' : ''
  const params = query ? [`%${query}%`, `%${query}%`] : []
  const [countRows] = await pool.execute(
    `SELECT COUNT(*) AS total FROM v_productos WHERE activo = 1${filter}`,
    params
  )
  const offset = (page - 1) * limit
  const [rows] = await pool.execute(
    `SELECT id, codigo, nombre, presentacion, precio, stock_total, stock_minimo, requiere_receta, proximo_vencimiento, estado
     FROM v_productos WHERE activo = 1${filter} ORDER BY nombre ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )
  response.json({ data: rows.map(productoDesdeFila), page, limit, total: Number(countRows[0].total) })
}

export const crear = async (request, response) => {
  validarDatosProducto(request.body)
  const [result] = await pool.execute(
    'INSERT INTO productos (codigo, nombre, presentacion, precio, stock_minimo, requiere_receta) VALUES (?, ?, ?, ?, ?, ?)',
    datosProducto(request.body)
  )
  const producto = await buscarProducto(result.insertId)
  response.status(201).json(producto)
}

export const actualizar = async (request, response) => {
  if (!idValido(request.params.id)) throw new AppError('VALIDACION', 'El ID del producto no es válido.', 400)
  validarDatosProducto(request.body)
  const [result] = await pool.execute(
    'UPDATE productos SET codigo = ?, nombre = ?, presentacion = ?, precio = ?, stock_minimo = ?, requiere_receta = ? WHERE id = ? AND activo = 1',
    [...datosProducto(request.body), Number(request.params.id)]
  )
  if (result.affectedRows === 0) throw new AppError('NO_ENCONTRADO', 'El producto no existe.', 404)
  response.json(await buscarProducto(Number(request.params.id)))
}

export const eliminar = async (request, response) => {
  if (!idValido(request.params.id)) throw new AppError('VALIDACION', 'El ID del producto no es válido.', 400)
  const [result] = await pool.execute('UPDATE productos SET activo = 0 WHERE id = ? AND activo = 1', [Number(request.params.id)])
  if (result.affectedRows === 0) throw new AppError('NO_ENCONTRADO', 'El producto no existe.', 404)
  response.status(204).send()
}

const fechaValida = (valor) => typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(Date.parse(`${valor}T00:00:00Z`))

export const agregarLote = async (request, response) => {
  if (!idValido(request.params.id)) throw new AppError('VALIDACION', 'El ID del producto no es válido.', 400)
  const { numero_lote: numeroLote, vencimiento, cantidad } = request.body || {}
  if (typeof numeroLote !== 'string' || !numeroLote.trim() || !fechaValida(vencimiento)) {
    throw new AppError('VALIDACION', 'numero_lote y vencimiento (YYYY-MM-DD) son obligatorios.', 400)
  }
  if (!Number.isInteger(cantidad) || cantidad <= 0) {
    throw new AppError('VALIDACION', 'cantidad debe ser un entero positivo.', 400)
  }
  const productoId = Number(request.params.id)
  await withConnection(async (connection) => {
    await connection.beginTransaction()
    try {
      const [producto] = await connection.execute('SELECT id FROM productos WHERE id = ? AND activo = 1 LIMIT 1', [productoId])
      if (!producto[0]) throw new AppError('NO_ENCONTRADO', 'El producto no existe.', 404)
      const [lotes] = await connection.execute(
        'SELECT id FROM lotes WHERE producto_id = ? AND numero_lote = ? LIMIT 1 FOR UPDATE',
        [productoId, numeroLote.trim()]
      )
      if (lotes[0]) {
        await connection.execute('UPDATE lotes SET stock = stock + ?, vencimiento = ? WHERE id = ?', [cantidad, vencimiento, lotes[0].id])
      } else {
        await connection.execute(
          'INSERT INTO lotes (producto_id, numero_lote, vencimiento, stock) VALUES (?, ?, ?, ?)',
          [productoId, numeroLote.trim(), vencimiento, cantidad]
        )
      }
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    }
  })
  response.status(201).json(await buscarProducto(productoId))
}