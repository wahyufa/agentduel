import { supabaseAdmin } from "@/lib/supabase";

export async function POST(req: Request) {
  const { debate_id, wallet_address, predicted_agent_id } =
    await req.json().catch(() => ({}));

  if (!debate_id || !wallet_address || !predicted_agent_id) {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }

  const db = supabaseAdmin();

  // Verify debate exists and is still open for predictions
  const { data: debate } = await db
    .from("debates")
    .select("status")
    .eq("id", debate_id)
    .single();

  if (!debate) {
    return Response.json({ error: "Debate not found" }, { status: 404 });
  }

  if (debate.status === "resolved") {
    return Response.json({ error: "Debate already resolved" }, { status: 409 });
  }

  // Upsert prediction (create or update)
  const { error } = await db.from("predictions").upsert(
    {
      debate_id,
      wallet_address: wallet_address.toLowerCase(),
      predicted_agent_id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "debate_id,wallet_address" }
  );

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const debate_id = searchParams.get("debate_id");
  const wallet = searchParams.get("wallet");
  const allMode = searchParams.get("all") === "true";

  const db = supabaseAdmin();

  // Return all predictions for a wallet across all debates
  if (allMode && wallet) {
    const { data } = await db
      .from("predictions")
      .select("debate_id, predicted_agent_id")
      .eq("wallet_address", wallet.toLowerCase());

    const predictions: Record<string, string> = {};
    for (const row of data ?? []) {
      predictions[row.debate_id] = row.predicted_agent_id;
    }
    return Response.json({ predictions });
  }

  if (!debate_id) {
    return Response.json({ error: "Missing debate_id" }, { status: 400 });
  }

  // Get prediction counts
  const { data: counts } = await db
    .from("predictions")
    .select("predicted_agent_id")
    .eq("debate_id", debate_id);

  const tally: Record<string, number> = {};
  for (const row of counts ?? []) {
    tally[row.predicted_agent_id] = (tally[row.predicted_agent_id] ?? 0) + 1;
  }

  // Get user's prediction if wallet provided
  let userPrediction: string | null = null;
  if (wallet) {
    const { data } = await db
      .from("predictions")
      .select("predicted_agent_id")
      .eq("debate_id", debate_id)
      .eq("wallet_address", wallet.toLowerCase())
      .maybeSingle();
    userPrediction = data?.predicted_agent_id ?? null;
  }

  return Response.json({ counts: tally, userPrediction });
}
