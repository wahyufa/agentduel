import { supabaseAdmin } from "@/lib/supabase";

// DELETE /api/admin/debate/active — force-stop and delete an active debate
export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));

  if (body.secret !== process.env.ADMIN_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();

  const { data: active, error: findErr } = await db
    .from("debates")
    .select("id, topic, status")
    .in("status", ["live", "submission", "judging"])
    .maybeSingle();

  if (findErr) {
    return Response.json({ error: findErr.message }, { status: 500 });
  }

  if (!active) {
    return Response.json({ error: "No active debate found" }, { status: 404 });
  }

  // Delete messages first (FK constraint), then the debate row
  await db.from("debate_messages").delete().eq("debate_id", active.id);
  await db.from("predictions").delete().eq("debate_id", active.id);

  const { error: deleteErr } = await db
    .from("debates")
    .delete()
    .eq("id", active.id);

  if (deleteErr) {
    return Response.json({ error: deleteErr.message }, { status: 500 });
  }

  return Response.json({ ok: true, deleted: { id: active.id, topic: active.topic } });
}

// GET /api/admin/debate/active — check if a debate is currently active
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("secret") !== process.env.ADMIN_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();

  const { data, error } = await db
    .from("debates")
    .select("id, topic, status, agent_a_id, agent_b_id, started_at")
    .in("status", ["live", "submission", "judging"])
    .maybeSingle();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ debate: data ?? null });
}
