# Pruebas Locales (Local Testing)

Esta tabla resume los comandos necesarios para probar el pipeline de incidentes de Junando en modo local (desarrollo).

| Objetivo | Comando | Descripción |
| :--- | :--- | :--- |
| **1. Levantar Servicios Base** | `docker compose up -d` | Levanta Redis, Loki, Prometheus, Grafana y Alertmanager. Necesario para deduplicación y trazas. |
| **2. Iniciar Webhook Local** | `pnpm run dev:webhook` | Levanta el servidor local en `http://localhost:4000`. Recibe las alertas y ejecuta el pipeline _inline_ si SQS está desactivado. Deja esta terminal corriendo. |
| **3. Generar Alertas (E2E)** | `pnpm run generate:alert` | Dispara un payload sintético de Alertmanager hacia el Webhook local. Verifica que el LLM procese y Slack reciba el mensaje. |
| **4. Simular Incidentes Complejos** | `pnpm run simulate:incident --scenario=db_outage --target=webhook` | Simula escenarios de incidentes (`db_outage`, `bad_deploy`, `latency_spike`). `--target=webhook` lo envía al puerto 4000. Usa `--mock` para saltear el LLM real. |
| **5. Ejecutar Worker Local** | `pnpm run worker:local --count 5 --type error` | Ejecuta la lógica del worker asíncrono en la terminal sin requerir SQS o Webhook. Usa `--file ./tmp/alerts.json` para procesar archivos. |
| **6. Compilar Cambios (Core)** | `pnpm --filter @junando/core run build` | Si modificas adaptadores o lógica de dominio, debes recompilar el core para que el webhook refleje los cambios. |
| **7. Ejecutar Tests (Vitest)** | `pnpm test` | Corre toda la suite de pruebas unitarias (Fingerprint, Clustering, Payload Normalization, Use Cases). |
| **8. Chequeo de Tipos** | `pnpm typecheck` | Valida que todo el TypeScript del monorepo sea correcto sin emitir archivos. |

## Flujo de Trabajo Recomendado

1. Configura tus variables en `.env.local` (Asegúrate de no definir `SQS_QUEUE_URL` para forzar el modo _inline_ local).
2. Levanta la infraestructura con Docker (`docker compose up -d`).
3. En una terminal, deja corriendo el webhook (`pnpm run dev:webhook`).
4. En otra terminal, dispara las alertas sintéticas (`pnpm run generate:alert`) y observa la notificación en Slack.
