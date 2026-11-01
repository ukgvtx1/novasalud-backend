USE novasalud;

-- Migracion idempotente: conserva los registros existentes y asigna manana a turnos antiguos.
SET @sql = (
  SELECT IF(COUNT(*) = 0,
    "ALTER TABLE usuarios ADD COLUMN dni VARCHAR(8) NULL AFTER rol",
    "SELECT 1")
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'usuarios' AND column_name = 'dni'
);
PREPARE migracion FROM @sql;
EXECUTE migracion;
DEALLOCATE PREPARE migracion;

SET @sql = (
  SELECT IF(COUNT(*) = 0,
    "ALTER TABLE turnos_caja ADD COLUMN franja ENUM('mañana','tarde','noche') NOT NULL DEFAULT 'mañana' AFTER fondo_inicial",
    "SELECT 1")
  FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'turnos_caja' AND column_name = 'franja'
);
PREPARE migracion FROM @sql;
EXECUTE migracion;
DEALLOCATE PREPARE migracion;

-- Normaliza una instalacion intermedia que haya usado "manana" sin acento.
ALTER TABLE turnos_caja MODIFY COLUMN franja ENUM('mañana','tarde','noche') NOT NULL DEFAULT 'mañana';