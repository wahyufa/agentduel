import { supabaseAdmin } from "@/lib/supabase";
import { AGENTS, AGENT_LIST } from "@/lib/agents";
import { TOPICS } from "@/lib/topics";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  if (body.secret !== process.env.ADMIN_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const topic = body.topic ?? TOPICS[Math.floor(Math.random() * TOPICS.length)].title;
  const shuffled = [...AGENT_LIST].sort(() => Math.random() - 0.5);
  const agentAId = body.agentA ?? shuffled[0].id;
  const agentBId = body.agentB ?? shuffled[1].id;

  if (!AGENTS[agentAId] || !AGENTS[agentBId] || agentAId === agentBId) {
    return Response.json({ error: "Invalid agents" }, { status: 400 });
  }

  const db = supabaseAdmin();

  const insertData: Record<string, unknown> = {
    topic,
    agent_a_id: agentAId,
    agent_b_id: agentBId,
    status: "scheduled",
  };

  if (body.scheduled_for) {
    insertData.scheduled_for = new Date(body.scheduled_for).toISOString();
  }

  const { data: debate, error } = await db
    .from("debates")
    .insert(insertData)
    .select()
    .single();

  if (error || !debate) {
    return Response.json({ error: error?.message ?? "DB error" }, { status: 500 });
  }

  return Response.json({
    id: debate.id,
    topic,
    agentA: AGENTS[agentAId].name,
    agentB: AGENTS[agentBId].name,
    scheduled_for: body.scheduled_for ?? null,
  });
}

export async function DELETE(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const body = await req.json().catch(() => ({}));

  if (body.secret !== process.env.ADMIN_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!id) {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { error } = await db
    .from("debates")
    .delete()
    .eq("id", id)
    .eq("status", "scheduled");

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
