<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Market V2: reglas durables

- El repositorio legacy `/home/yvaforma/odds/ou25-consensus-lab` es estrictamente de solo lectura.
- Está prohibido abrir, copiar, consultar o reutilizar `prisma/dev.db`; Market V2 usa un schema, cliente y base SQLite aislados.
- Los timestamps de Market V2 se expresan en UTC normalizado con sufijo `Z`.
- Artefactos, snapshots, decisiones, outcomes, probabilidades derivadas y settlements son append-only; las correcciones crean nuevas filas.
- El dominio de decisión no puede leer outcomes, settlements ni evaluaciones. La evaluación sí puede leer decisiones y outcomes.
- `ABSTAINED` es un resultado de decisión válido, no un error que deba ocultarse.
- No se autorizan capturas reales ni apuestas sin autorización explícita del usuario.
- No se debe afirmar rentabilidad sin validación temporal fuera de muestra.
- Nunca se pueden usar resultados posteriores para generar decisiones históricas.
