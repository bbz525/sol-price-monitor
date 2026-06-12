import "dotenv/config";

import { createHmac, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import http from "node:http";
import { promisify } from "node:util";
import { z } from "zod";
import { logger } from "./logger.js";

const execFileAsync = promisify(execFile);

const envSchema = z.object({
  DEPLOY_WEBHOOK_HOST: z.string().default("127.0.0.1"),
  DEPLOY_WEBHOOK_PORT: z.coerce.number().int().positive().default(3100),
  DEPLOY_WEBHOOK_PATH: z.string().default("/github/sol-monitor/deploy"),
  GITHUB_WEBHOOK_SECRET: z.string().min(20),
  DEPLOY_BRANCH_REF: z.string().default("refs/heads/main"),
  DEPLOY_COMMAND: z.string().default("/opt/sol-price-monitor/scripts/deploy-from-github.sh"),
});

const config = envSchema.parse(process.env);
let deploying = false;

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== "POST" || req.url !== config.DEPLOY_WEBHOOK_PATH) {
      send(res, 404, { ok: false, error: "not_found" });
      return;
    }

    const body = await readBody(req);
    if (!isValidSignature(body, req.headers["x-hub-signature-256"])) {
      send(res, 401, { ok: false, error: "invalid_signature" });
      return;
    }

    const event = String(req.headers["x-github-event"] ?? "");
    if (event === "ping") {
      send(res, 200, { ok: true, event: "ping" });
      return;
    }

    if (event !== "push") {
      send(res, 202, { ok: true, skipped: "unsupported_event", event });
      return;
    }

    const payload = JSON.parse(body.toString("utf8")) as { ref?: string; after?: string };
    if (payload.ref !== config.DEPLOY_BRANCH_REF) {
      send(res, 202, { ok: true, skipped: "non_deploy_branch", ref: payload.ref });
      return;
    }

    if (deploying) {
      send(res, 202, { ok: true, skipped: "deployment_already_running" });
      return;
    }

    deploying = true;
    send(res, 202, { ok: true, accepted: true, after: payload.after });
    void runDeploy(payload.after).finally(() => {
      deploying = false;
    });
  } catch (error) {
    logger.error({ err: error }, "deploy webhook request failed");
    if (!res.headersSent) {
      send(res, 500, { ok: false, error: "internal_error" });
    }
  }
});

server.listen(config.DEPLOY_WEBHOOK_PORT, config.DEPLOY_WEBHOOK_HOST, () => {
  logger.info(
    {
      host: config.DEPLOY_WEBHOOK_HOST,
      port: config.DEPLOY_WEBHOOK_PORT,
      path: config.DEPLOY_WEBHOOK_PATH,
      branchRef: config.DEPLOY_BRANCH_REF,
    },
    "deploy webhook listening",
  );
});

async function runDeploy(after?: string): Promise<void> {
  logger.info({ after }, "deploy command starting");
  try {
    const { stdout, stderr } = await execFileAsync(config.DEPLOY_COMMAND, [], {
      timeout: 5 * 60 * 1000,
      maxBuffer: 1024 * 1024,
    });
    logger.info({ stdout: stdout.trim(), stderr: stderr.trim() }, "deploy command completed");
  } catch (error) {
    logger.error({ err: error }, "deploy command failed");
  }
}

function isValidSignature(body: Buffer, header: string | string[] | undefined): boolean {
  const signature = Array.isArray(header) ? header[0] : header;
  if (!signature?.startsWith("sha256=")) {
    return false;
  }

  const expected = `sha256=${createHmac("sha256", config.GITHUB_WEBHOOK_SECRET).update(body).digest("hex")}`;
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function send(res: http.ServerResponse, statusCode: number, payload: Record<string, unknown>): void {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(`${JSON.stringify(payload)}\n`);
}
