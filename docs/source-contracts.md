# Contratos de fuentes

Los cinco schemas de `src/contracts/schemas` usan JSON Schema 2020-12, `schemaVersion: "1.0"` y `additionalProperties: false`. AJV con `ajv-formats` los valida. Cada schema tiene un fixture válido y uno inválido.

El contrato `forebet-ou25-capture-report` v1 agrega el resultado controlado de B002 y se valida tanto con Zod como con AJV. Los contratos previos no cambiaron de forma incompatible.
El contrato `statarea-daily-capture` v1 de B003 conserva encabezados y valores raw con orden determinista. Los campos diferidos permanecen `UNVERIFIED`; el export se valida con Zod y AJV antes de escribirse.
