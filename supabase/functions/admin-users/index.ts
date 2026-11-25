// Supabase Edge Function: lets an admin create team logins and reset passwords
// from inside the app, without exposing the service key to the browser.
//
// Deploy: Supabase Dashboard > Edge Functions > Deploy a new function > Via editor,
// name it "admin-users", paste this file, Deploy.
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided automatically.

import { createClient } from "npm:@supabase/supabase-js@2.99.3";

const EMAIL_DOMAIN = "team.dmpuram.local";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Who is calling? Must be an active admin.
    const caller = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: "Not signed in" }, 401);
    const { data: me } = await admin.from("profiles").select("role, active").eq("id", user.id).single();
    if (!me || !me.active || !["admin", "superadmin"].includes(me.role)) return json({ error: "Admins only" }, 403);
    const isSuper = me.role === "superadmin";

    const body = await req.json();
    const action = body.action;

    // Admins manage in-charges and workers; only the super admin manages admins.
    if (!isSuper && body.id && body.id !== user.id) {
      const { data: target } = await admin.from("profiles").select("role").eq("id", body.id).single();
      if (!target || !["incharge", "worker"].includes(target.role)) return json({ error: "Only the super admin can change admins" }, 403);
    }

    if (action === "create") {
      const username = String(body.username ?? "").trim().toLowerCase();
      if (!/^[a-z0-9_.-]{3,30}$/.test(username)) return json({ error: "Username: 3-30 letters/numbers" }, 400);
      if (!body.password || String(body.password).length < 6) return json({ error: "Password: at least 6 characters" }, 400);
      const allowed = isSuper ? ["admin", "incharge", "worker"] : ["incharge", "worker"];
      if (body.role && !allowed.includes(body.role)) return json({ error: "Only the super admin can create admins" }, 403);
      const role = allowed.includes(body.role) ? body.role : "worker";
      const { data, error } = await admin.auth.admin.createUser({
        email: `${username}@${EMAIL_DOMAIN}`,
        password: String(body.password),
        email_confirm: true,
      });
      if (error) return json({ error: error.message }, 400);
      const { error: pErr } = await admin.from("profiles").insert({
        id: data.user.id,
        username,
        full_name: body.full_name ?? username,
        phone: body.phone ?? null,
        role,
        hamlet_ids: Array.isArray(body.hamlet_ids) ? body.hamlet_ids.map(Number) : [],
      });
      if (pErr) {
        await admin.auth.admin.deleteUser(data.user.id);
        return json({ error: pErr.message }, 400);
      }
      return json({ ok: true, id: data.user.id });
    }

    if (action === "reset_password") {
      if (!body.password || String(body.password).length < 6) return json({ error: "Password: at least 6 characters" }, 400);
      const { error } = await admin.auth.admin.updateUserById(body.id, { password: String(body.password) });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    if (action === "set_active") {
      if (body.id === user.id) return json({ error: "You cannot deactivate yourself" }, 400);
      const active = !!body.active;
      const { error } = await admin.auth.admin.updateUserById(body.id, { ban_duration: active ? "none" : "876000h" });
      if (error) return json({ error: error.message }, 400);
      await admin.from("profiles").update({ active }).eq("id", body.id);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
