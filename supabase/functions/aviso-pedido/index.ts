// Agua Inmaculada · Función "aviso-pedido"
// Manda la notificación de pedido nuevo al celular de Javier, aunque esté bloqueado.
// La app la llama justo después de crear el pedido. Secretos que necesita (Edge Functions → Secrets):
//   VAPID_PUBLICA, VAPID_PRIVADA, VAPID_CORREO
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { id } = await req.json();
    if (!id) return json({ error: "Falta el id del pedido" }, 400);
    // Llave de servicio: nombre clásico o el nuevo formato de llaves secretas de Supabase
    let llave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!llave) { try { const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"); llave = k.default || Object.values(k)[0] || ""; } catch { /* sin llave */ } }
    if (!llave) return json({ error: "Sin llave de servicio en la función" }, 500);
    const db = createClient(Deno.env.get("SUPABASE_URL")!, llave);

    // Solo avisa pedidos reales, pendientes y que no se hayan avisado antes
    const { data: p } = await db.from("pedidos").select("*").eq("id", id).maybeSingle();
    if (!p || p.estado !== "pendiente" || p.avisado_en) return json({ enviados: 0, motivo: "sin aviso pendiente" });

    // Teléfonos de repartidores activos (o solo del asignado, si el pedido tiene uno)
    const { data: reps } = await db.from("perfiles").select("id").eq("rol", "repartidor").eq("activo", true);
    let ids = (reps || []).map((r) => r.id);
    if (p.asignado_a) ids = ids.filter((x) => x === p.asignado_a);
    if (!ids.length) return json({ enviados: 0, motivo: "sin repartidores" });
    const { data: subs } = await db.from("push_subs").select("*").in("usuario_id", ids);

    webpush.setVapidDetails("mailto:" + (Deno.env.get("VAPID_CORREO") || "aguainmaculada.rv@gmail.com"),
      Deno.env.get("VAPID_PUBLICA")!, Deno.env.get("VAPID_PRIVADA")!);
    const marcas = p.marcas ? Object.entries(p.marcas).map(([m, q]) => `${q} ${m}`).join(", ") : `${p.cantidad} garrafones`;
    const aviso = JSON.stringify({
      title: `Nuevo pedido: ${marcas}`,
      body: `${p.nombre} · ${p.domicilio}${p.forma_pago === "transferencia" ? " · Transferencia" : " · Cobrar efectivo"}`,
      tag: "pedido-" + p.id, url: "./",
    });

    let enviados = 0;
    for (const s of subs || []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, aviso, { TTL: 3600, urgency: "high" });
        enviados++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await db.from("push_subs").delete().eq("id", s.id); // teléfono ya no existe
      }
    }
    await db.from("pedidos").update({ avisado_en: new Date().toISOString() }).eq("id", p.id);
    return json({ enviados });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
