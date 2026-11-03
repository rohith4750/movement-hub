/**
 * Lightweight router that runs the API directly inside Next.js — no Express, cors, helmet,
 * morgan or express-rate-limit. Routes are flattened once into regexes at first request,
 * and each request runs its middleware chain straight on Node's req/res.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthUser } from "./middleware/auth";

export type NextFunction = (err?: unknown) => void;

export interface Request extends IncomingMessage {
  method: string;
  url: string;
  path: string;
  query: Record<string, any>;
  params: Record<string, string>;
  body: any;
  rawBody?: Buffer;
  user?: AuthUser;
  ip?: string;
  get(header: string): string | undefined;
}

export interface Response extends ServerResponse {
  status(code: number): this;
  json(data: unknown): this;
  send(body: unknown): this;
  sendStatus(code: number): this;
  type(type: string): this;
}

export type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
export type ErrorHandler = (err: unknown, req: Request, res: Response, next: NextFunction) => unknown;

type Layer =
  | { type: "route"; method: string; path: string; handlers: Handler[] }
  | { type: "mount"; prefix: string; router: RouterInstance }
  | { type: "middleware"; handler: Handler };

interface CompiledRoute {
  method: string;
  regex: RegExp;
  paramNames: string[];
  handlers: Handler[];
}

function joinPaths(a: string, b: string): string {
  const pA = a.replace(/\/+$/, "");
  const pB = b.replace(/^\/+/, "");
  if (!pA && !pB) return "/";
  if (!pA) return `/${pB}`;
  if (!pB) return pA;
  return `${pA}/${pB}`;
}

function pathToRegex(path: string) {
  const clean = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  const paramNames: string[] = [];
  const pattern = clean
    .replace(/[.+*?^${}()|[\]\\]/g, "\\$&")
    .replace(/:([a-zA-Z0-9_]+)/g, (_, name: string) => {
      paramNames.push(name);
      return "([^/]+)";
    });
  return { regex: new RegExp(`^${pattern}/?$`, "i"), paramNames };
}

export class RouterInstance {
  private layers: Layer[] = [];

  private add(method: string, path: string, handlers: Handler[]) {
    this.layers.push({ type: "route", method, path, handlers });
    return this;
  }
  get(path: string, ...h: Handler[]) {
    return this.add("GET", path, h);
  }
  post(path: string, ...h: Handler[]) {
    return this.add("POST", path, h);
  }
  put(path: string, ...h: Handler[]) {
    return this.add("PUT", path, h);
  }
  patch(path: string, ...h: Handler[]) {
    return this.add("PATCH", path, h);
  }
  delete(path: string, ...h: Handler[]) {
    return this.add("DELETE", path, h);
  }

  /** use(handler) | use(router) | use("/prefix", router | handler, ...) */
  use(...args: (string | Handler | RouterInstance)[]) {
    const prefix = typeof args[0] === "string" ? (args.shift() as string) : "";
    for (const item of args) {
      if (item instanceof RouterInstance) this.layers.push({ type: "mount", prefix, router: item });
      else if (typeof item === "function") {
        if (prefix) this.layers.push({ type: "mount", prefix, router: new RouterInstance().use(item) });
        else this.layers.push({ type: "middleware", handler: item });
      }
    }
    return this;
  }

  /** Flattens the tree: each route carries every middleware registered before it on its path. */
  compile(base = "", inherited: Handler[] = []): CompiledRoute[] {
    const out: CompiledRoute[] = [];
    const mw = [...inherited];
    for (const layer of this.layers) {
      if (layer.type === "middleware") mw.push(layer.handler);
      else if (layer.type === "mount") out.push(...layer.router.compile(joinPaths(base, layer.prefix), mw));
      else {
        const { regex, paramNames } = pathToRegex(joinPaths(base, layer.path));
        out.push({ method: layer.method, regex, paramNames, handlers: [...mw, ...layer.handlers] });
      }
    }
    return out;
  }
}

export const Router = () => new RouterInstance();

/** For webhook routes that verify signatures: exposes the unparsed request body as a Buffer. */
export const raw =
  (_opts?: unknown): Handler =>
  (req, _res, next) => {
    req.body = req.rawBody ?? Buffer.alloc(0);
    next();
  };

/* ─────────────── Request / response helpers ─────────────── */

const MAX_BODY = 1024 * 1024; // 1 MB

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("Payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseQuery(sp: URLSearchParams) {
  const q: Record<string, string | string[]> = {};
  for (const [k, v] of sp) {
    const cur = q[k];
    q[k] = cur === undefined ? v : Array.isArray(cur) ? [...cur, v] : [cur, v];
  }
  return q;
}

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8",
  json: "application/json; charset=utf-8",
  text: "text/plain; charset=utf-8",
};

function decorate(rawReq: IncomingMessage, rawRes: ServerResponse) {
  const req = rawReq as Request;
  const res = rawRes as Response;
  const url = new URL(req.url || "/", "http://localhost");
  req.path = url.pathname;
  req.query = parseQuery(url.searchParams);
  req.params = {};
  req.get = (h) => {
    const v = req.headers[h.toLowerCase()];
    return Array.isArray(v) ? v[0] : v;
  };
  const fwd = req.get("x-forwarded-for");
  req.ip = fwd ? fwd.split(",")[0].trim() : req.socket?.remoteAddress;

  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.type = (t) => {
    res.setHeader("Content-Type", MIME[t] ?? (t.includes("/") && !t.includes("charset") ? `${t}; charset=utf-8` : t));
    return res;
  };
  res.json = (data) => {
    if (!res.getHeader("Content-Type")) res.type("json");
    res.end(JSON.stringify(data));
    return res;
  };
  res.send = (body) => {
    if (body !== null && typeof body === "object" && !Buffer.isBuffer(body)) return res.json(body);
    if (!res.getHeader("Content-Type")) res.type(Buffer.isBuffer(body) ? "application/octet-stream" : "html");
    res.end(body === undefined ? undefined : Buffer.isBuffer(body) ? body : String(body));
    return res;
  };
  res.sendStatus = (code) => {
    res.statusCode = code;
    res.type("text").end(String(code));
    return res;
  };
  return { req, res };
}

/* ─────────────── CORS + security headers ─────────────── */

function originAllowed(origin: string, allowed: string[]) {
  if (allowed.includes("*") || allowed.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname;
    return host.endsWith(".vercel.app") || host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

function applyHeaders(req: Request, res: Response, allowedOrigins: string[]) {
  const origin = req.get("origin");
  if (origin && originAllowed(origin, allowedOrigins)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
}

/* ─────────────── Dispatcher ─────────────── */

export function createHandler(root: RouterInstance, opts: { corsOrigins: string[]; onError: ErrorHandler; notFound: Handler }) {
  let routes: CompiledRoute[] | null = null;

  return async function handle(rawReq: IncomingMessage, rawRes: ServerResponse) {
    const { req, res } = decorate(rawReq, rawRes);
    routes ??= root.compile();
    applyHeaders(req, res, opts.corsOrigins);

    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE");
      const reqHeaders = req.get("access-control-request-headers");
      if (reqHeaders) res.setHeader("Access-Control-Allow-Headers", reqHeaders);
      res.statusCode = 204;
      res.end();
      return;
    }

    try {
      if (req.method === "GET" || req.method === "HEAD") req.body = {};
      else {
        req.rawBody = await readBody(req);
        const isJson = (req.get("content-type") ?? "").includes("json");
        req.body = isJson && req.rawBody.length ? JSON.parse(req.rawBody.toString("utf8")) : {};
      }
    } catch (e) {
      const status = (e as { status?: number }).status ?? 400;
      res.status(status).json({
        success: false,
        error: { code: status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON", message: status === 413 ? "Request body too large" : "Malformed JSON body" },
      });
      return;
    }

    const method = req.method === "HEAD" ? "GET" : req.method;
    let route: CompiledRoute | undefined;
    let match: RegExpExecArray | null = null;
    for (const r of routes) {
      if (r.method !== method) continue;
      match = r.regex.exec(req.path);
      if (match) {
        route = r;
        break;
      }
    }
    if (route && match) {
      const m = match;
      route.paramNames.forEach((n, i) => (req.params[n] = decodeURIComponent(m[i + 1])));
    }
    const chain: Handler[] = route ? route.handlers : [opts.notFound];

    await new Promise<void>((resolve) => {
      let i = 0;
      let failed = false;
      res.once("finish", () => resolve());
      res.once("close", () => resolve());
      const next: NextFunction = (err) => {
        if (err !== undefined && err !== null) {
          if (failed || res.writableEnded) return resolve();
          failed = true;
          try {
            void Promise.resolve(opts.onError(err, req, res, () => resolve())).finally(() => {
              if (res.writableEnded) resolve();
            });
          } catch {
            resolve();
          }
          return;
        }
        const fn = chain[i++];
        if (!fn) {
          if (!res.writableEnded) opts.notFound(req, res, () => resolve());
          return resolve();
        }
        try {
          const out = fn(req, res, next);
          if (out instanceof Promise) out.catch(next);
        } catch (e) {
          next(e);
        }
      };
      next();
    });
  };
}

/* ─────────────── Rate limiter ─────────────── */

/**
 * Where counters live. The default in-memory store is per server instance (fine as a coarse
 * abuse guard); security-sensitive limiters pass a shared store so every instance sees the same
 * counts (see lib/rate-limit-store.ts).
 */
export interface RateLimitStore {
  /** Atomically count one request; starts a fresh window when the old one has expired. */
  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> | { count: number; resetAt: number };
  /** Take back one counted request (rejected, or successful with skipSuccessfulRequests). */
  undo(key: string): Promise<void> | void;
}

export function memoryStore(): RateLimitStore {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now > v.resetAt) hits.delete(k);
  }, 60_000);
  timer.unref?.();
  return {
    hit(key, windowMs) {
      const now = Date.now();
      let cur = hits.get(key);
      if (!cur || now > cur.resetAt) {
        cur = { count: 0, resetAt: now + windowMs };
        hits.set(key, cur);
      }
      cur.count++;
      return { count: cur.count, resetAt: cur.resetAt };
    },
    undo(key) {
      const cur = hits.get(key);
      if (cur && cur.count > 0) cur.count--;
    },
  };
}

/**
 * The client a limit applies to. IPv6 clients usually control a whole /64, so they are limited
 * per /64 prefix rather than per address (otherwise one network gets unlimited attempts).
 */
export function clientKey(ip: string | undefined): string {
  if (!ip) return "unknown";
  const v4 = ip.match(/^(?:::ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (v4) return v4[1];
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.split("%")[0].toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = ip.includes("::") && tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

export function rateLimit(options: {
  windowMs: number;
  limit: number;
  /** Separates this limiter's counters from others in a shared store. */
  name?: string;
  store?: RateLimitStore;
  standardHeaders?: boolean;
  legacyHeaders?: boolean;
  /** Don't count requests that end with a status below 400. */
  skipSuccessfulRequests?: boolean;
  /** Custom response when the limit is exceeded. */
  handler?: (req: Request, res: Response) => unknown;
  message?: string;
}): Handler {
  const store = options.store ?? memoryStore();
  const prefix = options.name ?? "default";

  return async (req, res, next) => {
    const key = `${prefix}:${clientKey(req.ip)}`;
    // Count first, atomically, so parallel requests can't all slip under the limit.
    const cur = await store.hit(key, options.windowMs);
    if (options.standardHeaders) {
      res.setHeader("RateLimit-Limit", String(options.limit));
      res.setHeader("RateLimit-Remaining", String(Math.max(0, options.limit - cur.count)));
      res.setHeader("RateLimit-Reset", String(Math.max(0, Math.ceil((cur.resetAt - Date.now()) / 1000))));
    }
    if (cur.count > options.limit) {
      await store.undo(key); // a rejected request doesn't extend the block
      if (options.handler) return options.handler(req, res);
      return res.status(429).json({ success: false, error: { code: "TOO_MANY_REQUESTS", message: options.message ?? "Too many requests, please try again later." } });
    }
    if (options.skipSuccessfulRequests) {
      // Give the attempt back BEFORE the response is sent: on serverless, work after the
      // response may never run, which would leave successful sign-ins counted as failures.
      const end = res.end.bind(res) as (...a: unknown[]) => Response;
      res.end = ((...args: unknown[]) => {
        if (res.statusCode >= 400) return end(...args);
        Promise.resolve(store.undo(key))
          .catch((e) => console.warn("[rate-limit] undo failed:", (e as Error)?.message ?? e))
          .finally(() => end(...args));
        return res;
      }) as Response["end"];
    }
    next();
  };
}
