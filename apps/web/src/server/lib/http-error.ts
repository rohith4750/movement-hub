export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, code = "BAD_REQUEST", details?: unknown) => new HttpError(400, code, msg, details);
export const unauthorized = (msg = "Not authenticated") => new HttpError(401, "UNAUTHORIZED", msg);
export const forbidden = (msg = "You do not have access to this resource") => new HttpError(403, "FORBIDDEN", msg);
export const notFound = (entity = "Resource") => new HttpError(404, "NOT_FOUND", `${entity} not found`);
export const conflict = (code: string, msg: string) => new HttpError(409, code, msg);
export const unprocessable = (code: string, msg: string) => new HttpError(422, code, msg);
