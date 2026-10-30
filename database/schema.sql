CREATE DATABASE IF NOT EXISTS novasalud CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE novasalud;
SET time_zone = '-05:00';

CREATE TABLE IF NOT EXISTS usuarios (
	id INT AUTO_INCREMENT PRIMARY KEY,
	nombre VARCHAR(100) NOT NULL,
	email VARCHAR(100) NOT NULL UNIQUE,
	password_hash VARCHAR(255) NOT NULL,
	rol ENUM('admin','trabajador') NOT NULL DEFAULT 'trabajador',
	activo TINYINT(1) NOT NULL DEFAULT 1,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS productos (
	id INT AUTO_INCREMENT PRIMARY KEY,
	codigo VARCHAR(30) NOT NULL UNIQUE,
	nombre VARCHAR(150) NOT NULL,
	presentacion VARCHAR(80),
	categoria VARCHAR(50) NULL,
	precio DECIMAL(10,2) NOT NULL,
	stock_minimo INT NOT NULL DEFAULT 0,
	requiere_receta TINYINT(1) NOT NULL DEFAULT 0,
	activo TINYINT(1) NOT NULL DEFAULT 1,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS lotes (
	id INT AUTO_INCREMENT PRIMARY KEY,
	producto_id INT NOT NULL,
	numero_lote VARCHAR(40) NOT NULL,
	vencimiento DATE NOT NULL,
	stock INT NOT NULL DEFAULT 0,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	UNIQUE KEY uq_lote (producto_id, numero_lote),
	KEY idx_fefo (producto_id, vencimiento),
	FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS clientes (
	id INT AUTO_INCREMENT PRIMARY KEY,
	tipo_doc ENUM('DNI','RUC') NOT NULL,
	numero_doc VARCHAR(11) NOT NULL UNIQUE,
	nombre VARCHAR(150) NOT NULL,
	created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS turnos_caja (
	id INT AUTO_INCREMENT PRIMARY KEY,
	usuario_id INT NOT NULL,
	apertura DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	cierre DATETIME NULL,
	fondo_inicial DECIMAL(10,2) NOT NULL DEFAULT 0,
	efectivo_esperado DECIMAL(10,2) NULL,
	efectivo_contado DECIMAL(10,2) NULL,
	estado ENUM('abierta','cerrada') NOT NULL DEFAULT 'abierta',
	KEY idx_turno_usuario (usuario_id, estado),
	FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS series_comprobante (
	serie VARCHAR(4) PRIMARY KEY,
	tipo ENUM('boleta','factura') NOT NULL,
	ultimo_numero INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ventas (
	id INT AUTO_INCREMENT PRIMARY KEY,
	usuario_id INT NOT NULL,
	cliente_id INT NULL,
	turno_id INT NULL,
	comprobante ENUM('boleta','factura') NOT NULL,
	serie_numero VARCHAR(20) NULL UNIQUE,
	subtotal DECIMAL(10,2) NOT NULL DEFAULT 0,
	igv DECIMAL(10,2) NOT NULL DEFAULT 0,
	total DECIMAL(10,2) NOT NULL DEFAULT 0,
	vuelto DECIMAL(10,2) NOT NULL DEFAULT 0,
	estado ENUM('pagada','espera','anulada') NOT NULL DEFAULT 'pagada',
	idempotency_key VARCHAR(64) NULL,
	fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	anulada_en DATETIME NULL,
	updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
	UNIQUE KEY uq_idem (usuario_id, idempotency_key),
	KEY idx_ventas_usuario_fecha (usuario_id, fecha),
	KEY idx_ventas_estado (estado),
	FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
	FOREIGN KEY (cliente_id) REFERENCES clientes(id) ON DELETE SET NULL,
	FOREIGN KEY (turno_id) REFERENCES turnos_caja(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS detalle_venta (
	id INT AUTO_INCREMENT PRIMARY KEY,
	venta_id INT NOT NULL,
	producto_id INT NOT NULL,
	lote_id INT NULL,
	cantidad INT NOT NULL,
	precio_unitario DECIMAL(10,2) NOT NULL,
	subtotal DECIMAL(10,2) NOT NULL,
	FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE,
	FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE RESTRICT,
	FOREIGN KEY (lote_id) REFERENCES lotes(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS pagos (
	id INT AUTO_INCREMENT PRIMARY KEY,
	venta_id INT NOT NULL,
	metodo ENUM('efectivo','yape','plin','tarjeta') NOT NULL,
	monto DECIMAL(10,2) NOT NULL,
	FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE
);

CREATE OR REPLACE VIEW v_productos AS
SELECT t.*,
	CASE
		WHEN t.stock_total = 0 AND t.stock_vencido > 0 THEN 'vencido'
		WHEN t.stock_total = 0 THEN 'agotado'
		WHEN t.stock_total <= t.stock_minimo THEN 'stock_bajo'
		WHEN t.proximo_vencimiento <= CURDATE() + INTERVAL 30 DAY THEN 'por_vencer'
		ELSE 'normal'
	END AS estado
FROM (
	SELECT p.id, p.codigo, p.nombre, p.presentacion, p.categoria, p.precio,
				 p.stock_minimo, p.requiere_receta, p.activo,
				 COALESCE(SUM(CASE WHEN l.vencimiento >= CURDATE() THEN l.stock END), 0) AS stock_total,
				 MIN(CASE WHEN l.vencimiento >= CURDATE() AND l.stock > 0 THEN l.vencimiento END) AS proximo_vencimiento,
				 COALESCE(SUM(CASE WHEN l.vencimiento < CURDATE() THEN l.stock END), 0) AS stock_vencido
	FROM productos p
	LEFT JOIN lotes l ON l.producto_id = p.id
	GROUP BY p.id
) t;

INSERT INTO series_comprobante (serie, tipo, ultimo_numero) VALUES
	('B001', 'boleta', 0), ('F001', 'factura', 0)
ON DUPLICATE KEY UPDATE serie = serie;
