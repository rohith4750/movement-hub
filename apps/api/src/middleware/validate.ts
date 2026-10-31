import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";

/** Validates and replaces req.body / req.query / req.params with parsed values. */
export function validate(s: { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny }) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (s.body) req.body = s.body.parse(req.body);
      if (s.query) Object.defineProperty(req, "query", { value: s.query.parse(req.query), writable: true, configurable: true });
      if (s.params) req.params = s.params.parse(req.params);
      next();
    } catch (e) {
      next(e);
    }
  };
}
