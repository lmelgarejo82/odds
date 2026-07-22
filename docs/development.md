# Desarrollo

Requiere Node.js 22 y npm. Copiar `.env.example` a `.env` para desarrollo local y ejecutar `npm install`, `npx prisma generate`, `npx prisma migrate dev` y `npm run db:seed`.

Controles: `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build` y `npm run validate`. La zona horaria funcional es `America/Asuncion`. Las carpetas `data/raw`, `data/exports` y `evidencias` no se versionan.

La única captura habilitada se ejecuta con `npm run capture:forebet -- --date=2026-07-21`. La URL se construye internamente; no se admiten URL ni fechas arbitrarias. La evidencia queda fuera de Git bajo `var/evidence/forebet`.

Statarea se captura con `npm run capture:statarea -- --date=2026-07-21`. Su evidencia y export raw quedan en `var/evidence/statarea` y `var/exports/statarea`. `npm run verify:statarea-idempotency -- <sha256>` reproduce una evidencia local cuyo hash se verifica, sin realizar acceso de red.

La conciliación offline se ejecuta con `npm run reconcile:fixtures -- --date=2026-07-21`. Los exports quedan bajo `var/exports/reconciliation` y se revalidan con `npm run validate:reconciliation-export -- <ruta>`.

La primera ejecución prospectiva en sombra está fijada exclusivamente a `2026-07-23`:

```powershell
npm run run:prospective-shadow -- --date=2026-07-23
```

En npm 11 sobre PowerShell, si la configuración del entorno consume el separador, la variante explícita equivalente es:

```powershell
$env:npm_config_date = "2026-07-23"
npm run run:prospective-shadow
Remove-Item Env:npm_config_date
```

El comando no acepta URL, otra fecha, resultados, cuotas, códigos de bookmaker, `force`, ranking ni operaciones. Los exports write-once quedan en `var/exports/prospective/2026-07-23`; se validan con `npm run validate:prospective-exports` y se auditan con `npm run audit:prospective-shadow`.
