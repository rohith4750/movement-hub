import type { NextApiRequest, NextApiResponse } from "next";
import { createApiHandler } from "@/server/app";

// Built once per server instance and reused across requests.
const handle = createApiHandler();

export const config = {
  api: {
    bodyParser: false, // the router reads the body itself (webhooks need the raw bytes)
    externalResolver: true,
    responseLimit: false,
  },
};

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return handle(req, res);
}
