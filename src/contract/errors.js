export class ContractError extends Error {
  constructor(message, code = "CONTRACT_ERROR") {
    super(message);
    this.name = "ContractError";
    this.code = code;
  }
}

export function fail(message, code) {
  throw new ContractError(message, code);
}

export function toErrorResponse(error) {
  if (error instanceof ContractError) {
    return { ok: false, error: error.message, code: error.code };
  }
  return { ok: false, error: "Unexpected contract error.", code: "UNEXPECTED_ERROR" };
}

