import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z } from "zod";

/** Wraps async route handlers so thrown errors reach the error middleware. */
export const handler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function ok(res: Response, data: unknown, meta?: Record<string, unknown>, status = 200) {
  return res.status(status).json({ success: true, data, ...(meta ? { meta } : {}) });
}

export const created = (res: Response, data: unknown) => ok(res, data, undefined, 201);

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  sort: z.string().optional(),
});

export function paging(q: { page: number; limit: number }) {
  return { skip: (q.page - 1) * q.limit, take: q.limit };
}

export function orderBy(sort: string | undefined, allowed: string[], fallback = "createdAt") {
  const [field, dir] = (sort ?? `${fallback}:desc`).split(":");
  const f = allowed.includes(field) ? field : fallback;
  return { [f]: dir === "asc" ? "asc" : "desc" } as Record<string, "asc" | "desc">;
}

export function meta(q: { page: number; limit: number }, total: number) {
  return { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) };
}

export const idParam = z.object({ id: z.string().uuid() });

/** Typed access to validated query (validate() replaces req.query with parsed values). */
export const q = <T>(req: Request) => req.query as unknown as T;
