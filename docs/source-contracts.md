# Contratos de fuentes

Los cinco schemas de `src/contracts/schemas` usan JSON Schema 2020-12, `schemaVersion: "1.0"` y `additionalProperties: false`. AJV con `ajv-formats` los valida. Cada schema tiene un fixture válido y uno inválido.

En B001 representan límites de intercambio, no reportes reales. No se accede a Forebet ni Statarea y no se generan capturas.
