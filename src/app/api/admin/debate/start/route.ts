import { supabaseAdmin } from "@/lib/supabase";
import { runDebate } from "@/lib/debate-runner";
import { AGENTS, AGENT_LIST } from "@/lib/agents";
import { TOPICS } from "@/lib/topics";

// Vercel Pro: allows function to run up to 300s (covers TEST_MODE debates)
export const maxDuration = 300;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));

    if (body.secret !== process.env.ADMIN_SECRET) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = supabaseAdmin();

    // Abort if a debate is already live or in submission
    const { data: active, error: activeErr } = await db
      .from("debates")
      .select("id, status")
      .in("status", ["live", "submission"])
      .maybeSingle();

    if (activeErr) {
      console.error("[start] check active error:", activeErr);
      return Response.json({ error: `DB error: ${activeErr.message}` }, { status: 500 });
    }

    if (active) {
      return Response.json(
        { error: `A debate is already ${active.status}`, id: active.id },
        { status: 409 }
      );
    }

    let debateId: string;
    let topic: string;
    let agentAId: string;
    let agentBId: string;

    // Start an existing scheduled debate by ID
    if (body.debateId) {
      const { data: existing, error: fetchErr } = await db
        .from("debates")
        .select("*")
        .eq("id", body.debateId)
        .eq("status", "scheduled")
        .maybeSingle();

      if (fetchErr) {
        console.error("[start] fetch scheduled error:", fetchErr);
        return Response.json({ error: `DB error: ${fetchErr.message}` }, { status: 500 });
      }

      if (!existing) {
        return Response.json({ error: "Scheduled debate not found" }, { status: 404 });
      }

      debateId = existing.id;
      topic = existing.topic;
      agentAId = existing.agent_a_id;
      agentBId = existing.agent_b_id;
    } else {
      // Create a new debate on the fly
      topic = body.topic ?? TOPICS[Math.floor(Math.random() * TOPICS.length)].title;
      const shuffled = [...AGENT_LIST].sort(() => Math.random() - 0.5);
      agentAId = body.agentA ?? shuffled[0].id;
      agentBId = body.agentB ?? shuffled[1].id;

      if (!AGENTS[agentAId] || !AGENTS[agentBId] || agentAId === agentBId) {
        return Response.json({ error: "Invalid agents" }, { status: 400 });
      }

      const { data: debate, error: insertErr } = await db
        .from("debates")
        .insert({ topic, agent_a_id: agentAId, agent_b_id: agentBId })
        .select()
        .single();

      if (insertErr || !debate) {
        console.error("[start] insert error:", insertErr);
        return Response.json({ error: `DB insert failed: ${insertErr?.message ?? "unknown"}` }, { status: 500 });
      }

      debateId = debate.id;
    }

    console.log(`[start] launching debate ${debateId}: "${topic}"`);

    // Fire-and-forget — response returns immediately, runner continues in background
    runDebate(debateId, topic, agentAId, agentBId).catch((err) => {
      console.error("[debate-runner] crashed:", err);
      supabaseAdmin()
        .from("debates")
        .update({ status: "resolved", winner_reason: "Debate ended unexpectedly." })
        .eq("id", debateId);
    });

    return Response.json({
      id: debateId,
      topic,
      agentA: AGENTS[agentAId].name,
      agentB: AGENTS[agentBId].name,
    });
  } catch (err) {
    console.error("[start] unhandled exception:", err);
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    );
  }
}
