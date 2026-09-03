import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Cliente con SERVICE ROLE KEY — salta RLS por completo. NUNCA importar desde un
// "use client" ni exponer process.env.SUPABASE_SERVICE_ROLE_KEY al bundle del
// navegador. Uso exclusivo del panel /admin: la autorización se valida en
// app/admin/layout.tsx (claim app_metadata.rol==='admin'), nunca vía RLS acá.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
