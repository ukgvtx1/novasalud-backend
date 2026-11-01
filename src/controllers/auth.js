import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { pool } from '../db.js'
import { config } from '../config.js'
import { AppError } from '../middlewares/errores.js'

const publicUser = ({ id, nombre, email, rol, dni }) => ({ id, nombre, email, rol, dni: dni || null })

export const login = async (request, response) => {
  const { email, password } = request.body || {}
  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    throw new AppError('VALIDACION', 'Email y contraseña son obligatorios.', 400)
  }
  if (!config.jwtSecret) throw new AppError('ERROR_SERVIDOR', 'JWT_SECRET no está configurado.', 500)
  const [rows] = await pool.execute(
    'SELECT id, nombre, email, password_hash, rol, dni FROM usuarios WHERE email = ? AND activo = 1 LIMIT 1',
    [email.trim().toLowerCase()]
  )
  const user = rows[0]
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    throw new AppError('CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos.', 401)
  }
  const token = jwt.sign({ id: user.id, rol: user.rol }, config.jwtSecret, { expiresIn: '8h' })
  response.json({ token, usuario: publicUser(user) })
}

export const me = async (request, response) => {
  const [rows] = await pool.execute(
    'SELECT id, nombre, email, rol, dni FROM usuarios WHERE id = ? AND activo = 1 LIMIT 1',
    [request.usuario.id]
  )
  if (!rows[0]) throw new AppError('TOKEN_INVALIDO', 'El usuario del token ya no está activo.', 401)
  response.json({ usuario: publicUser(rows[0]) })
}
