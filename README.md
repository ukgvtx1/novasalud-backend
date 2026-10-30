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
