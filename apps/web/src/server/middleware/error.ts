import type { NextFunction, Request, Response } from "../router";
import { ZodError } from "zod";
import { Prisma } from "@movement-hub/database";
import { HttpError } from "../lib/http-error";

export function notFoundRoute(req: Request, res: Response) {
  res.status(404).json({ success: false, error: { code: "ROUTE_NOT_FOUND", message: `${req.method} ${req.path} not found` } });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ success: false, error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002")
      return res.status(409).json({ success: false, error: { code: "ALREADY_EXISTS", message: "A record with these details already exists", details: err.meta } });
    if (err.code === "P2025") return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Record not found" } });
    if (err.code === "P2003") return res.status(400).json({ success: false, error: { code: "INVALID_REFERENCE", message: "Referenced record does not exist" } });
  }
  console.error(err);
  res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong" } });
}
