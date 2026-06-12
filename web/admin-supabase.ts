import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ADMIN_TOKEN: z.string().min(16).optional(),
  NODE_ENV: z.string().optional(),
});

export const dashboardEnv = envSchema.parse({
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  ADMIN_TOKEN: process.env.ADMIN_TOKEN,
  NODE_ENV: process.env.NODE_ENV,
});

export const adminSupabase = createClient(dashboardEnv.SUPABASE_URL, dashboardEnv.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

export function assertAdminToken(request: Request): Response | null {
  if (!dashboardEnv.ADMIN_TOKEN) {
    if (dashboardEnv.NODE_ENV === "production") {
      return Response.json({ error: "ADMIN_TOKEN is not configured" }, { status: 503 });
    }
    return null;
  }

  const headerToken = request.headers.get("x-admin-token")?.trim();
  if (headerToken === dashboardEnv.ADMIN_TOKEN) {
    return null;
  }

  return Response.json({ error: "unauthorized" }, { status: 401 });
}
