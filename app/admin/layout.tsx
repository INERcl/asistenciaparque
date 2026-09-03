import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Gate de /admin: exige sesión + claim app_metadata.rol==='admin' (seteado a
// mano vía Auth Admin API — ver scripts/README.md). No depende de RLS: las
// páginas de /admin usan el cliente service role (lib/supabase/admin.ts), que
// salta RLS por completo, así que la autorización se valida acá, server-side.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.app_metadata?.rol !== "admin") {
    redirect("/");
  }

  return (
    <div className="mx-auto min-h-full w-full max-w-5xl p-4">
      <header className="mb-4 flex items-center justify-between border-b border-black/10 pb-3">
        <div>
          <Link
            href="/"
            className="text-xs font-semibold text-iner-gray underline hover:text-iner-green"
          >
            ← Volver a Check-in
          </Link>
          <h1 className="mt-1 text-lg font-bold text-iner-green">Panel de administrador</h1>
        </div>
      </header>
      {children}
    </div>
  );
}
