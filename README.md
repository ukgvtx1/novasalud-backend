# NovaSalud Backend

Backend independiente de NovaSalud con Node.js, Express, MariaDB/MySQL y JWT.

## Instalación

```bash
npm install
cp .env.example .env
npm run dev
```

El servidor escucha en `http://localhost:3006` cuando `PORT=3006`.

## Primera prueba

```bash
curl http://localhost:3006/health
```

## Migracion de turnos

En una base existente, ejecutar `database/migrations/001_turnos_franja_usuario_dni.sql` con un usuario que pueda modificar el esquema. La migracion es idempotente, conserva turnos y ventas, y agrega `usuarios.dni` y `turnos_caja.franja`.

El ciclo operativo del trabajador empieza despues del ultimo cierre de un turno nocturno. Sin turno abierto, el resumen del trabajador devuelve sus metricas operativas en cero. El resumen de administrador mantiene el calculo por fecha calendario.

## Contrato de turnos y resumen

`POST /api/turnos/abrir` recibe `fondo_inicial` y `franja` (`mañana`, `tarde` o `noche`). El campo `usuario_dni` puede llegar desde clientes antiguos, pero se ignora: la identidad se obtiene del JWT y de `usuarios`.

La respuesta de apertura y `GET /api/turnos/actual` es:

```json
{
	"id": 8,
	"apertura": "2026-10-31T22:00:00-05:00",
	"fondo_inicial": 100,
	"estado": "abierta",
	"franja": "noche",
	"usuario_dni": "73456789",
	"usuario_nombre": "Ana Torres"
}
```

`POST /api/turnos/cerrar` recibe `efectivo_contado` y devuelve `turno_id`, `franja`, `efectivo_esperado`, `efectivo_contado` y `diferencia`. `GET /api/resumen` devuelve cero para las metricas operativas del trabajador sin turno abierto; con turno abierto usa el periodo posterior al ultimo cierre nocturno. El admin conserva el resumen por fecha calendario.

Las ventas pagadas y en espera se asocian automaticamente con el usuario autenticado y su turno abierto. Una venta sin turno devuelve `409 TURNO_CERRADO`.

## Comandos de prueba

Con el servidor ejecutandose en `http://localhost:3006`, `pruebas.http` contiene el flujo de apertura, consulta, cierre y venta. El flujo de ciclo operativo se puede comprobar con:

1. Abrir `noche`, crear una venta pagada y consultar `/api/resumen`.
2. Cerrar la noche y abrir `mañana`; `/api/resumen` debe mostrar `ventas_hoy` y `pagos_digitales` en cero.
3. Crear una venta matutina; el trabajador debe ver solo esa venta y el admin debe conservar el total global.
4. Cerrar la mañana y repetir `POST /api/ventas`; debe responder `409 TURNO_CERRADO`.
