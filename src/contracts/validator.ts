import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import addFormats from "ajv-formats";

export type ContractValidation = { valid: boolean; errors: ErrorObject[] };

export function validateContract(schema: object, value: unknown): ContractValidation {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  const valid = validate(value);
  return { valid: Boolean(valid), errors: validate.errors ?? [] };
}
