# Desarrollo

Requiere Node.js 22 y npm. Copiar `.env.example` a `.env` para desarrollo local y ejecutar `npm install`, `npx prisma generate`, `npx prisma migrate dev` y `npm run db:seed`.

Controles: `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build` y `npm run validate`. La zona horaria funcional es `America/Asuncion`. Las carpetas `data/raw`, `data/exports` y `evidencias` no se versionan.

La única captura habilitada se ejecuta con `npm run capture:forebet -- --date=2026-07-21`. La URL se construye internamente; no se admiten URL ni fechas arbitrarias. La evidencia queda fuera de Git bajo `var/evidence/forebet`.

Statarea se captura con `npm run capture:statarea -- --date=2026-07-21`. Su evidencia y export raw quedan en `var/evidence/statarea` y `var/exports/statarea`. `npm run verify:statarea-idempotency -- <sha256>` reproduce una evidencia local cuyo hash se verifica, sin realizar acceso de red.
