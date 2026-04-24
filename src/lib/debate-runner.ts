import { supabaseAdmin } from "./supabase";
import { AGENTS, Agent } from "./agents";

const GROQ_API_KEY = process.env.GROQ_API_KEY!;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// Models confirmed active on Groq — ordered small→large (small = higher rate limit)
const MODELS = [
  "llama-3.1-8b-instant",     // fast, high rate limit
  "llama-3.3-70b-versatile",  // best quality, lower rate limit
  "llama-3.1-70b-versatile",  // fallback 70b
];
const IS_TEST = process.env.TEST_MODE === "true";

const MAX_DEBATE_MS = IS_TEST ? 90_000  : 5 * 60_000; // test: 90s | prod: 5min
const SUBMISSION_MS = IS_TEST ? 30_000  : 5 * 60_000; // test: 30s | prod: 5min

type HistoryEntry = { speaker: string; text: string };

async function callGroq(model: string, body: object): Promise<Response> {
  return fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, ...body }),
  });
}

// Tries each Groq model in order; if all fail, waits then retries the whole chain
async function fetchWithFallback(body: object, attempt = 0): Promise<Response> {
  let lastStatus = 0;
  for (let i = 0; i < MODELS.length; i++) {
    const res = await callGroq(MODELS[i], body);
    if (res.ok) return res;
    lastStatus = res.status;
    const retryable = res.status === 429 || res.status === 503 || res.status === 502 || res.status === 400 || res.status === 404;
    console.warn(`[debate-runner] ${MODELS[i]} → ${res.status}${retryable ? ", trying next..." : ""}`);
    if (!retryable) throw new Error(`Groq error: ${res.status}`);
    if (i < MODELS.length - 1) await sleep(1500);
  }

  // All models exhausted — exponential backoff then retry (max 4 full attempts)
  if (attempt >= 4) throw new Error(`All Groq models failed after ${attempt + 1} attempts (last: ${lastStatus})`);
  const backoff = Math.min(15_000 * Math.pow(2, attempt), 120_000); // 15s → 30s → 60s → 120s
  console.warn(`[debate-runner] all models rate-limited, retrying in ${backoff / 1000}s (attempt ${attempt + 1})`);
  await sleep(backoff);
  return fetchWithFallback(body, attempt + 1);
}

async function streamAgentResponse(
  agent: Agent,
  topic: string,
  history: HistoryEntry[]
): Promise<string> {
  const res = await fetchWithFallback({
    temperature: 0.85,
    max_tokens: 150,
    messages: [
      { role: "system", content: agent.systemPrompt },
      ...history.map((h) => ({
        role: "user" as const,
        content: `[${h.speaker}]: ${h.text}`,
      })),
      {
        role: "user",
        content: `Topic: "${topic}". Make your next argument. Be sharp and stay in character.`,
      },
    ],
  });

  if (!res.ok) throw new Error(`Groq error: ${res.status}`);

  const data = await res.json();
  return (data.choices?.[0]?.message?.content ?? "").trim();
}

async function judgeConclusive(history: HistoryEntry[]): Promise<boolean> {
  if (history.length < 4) return false; // minimum 2 rounds each

  const transcript = history.map((h) => `${h.speaker}: ${h.text}`).join("\n\n");
  const res = await fetchWithFallback({
    max_tokens: 10,
    messages: [
      {
        role: "system",
        content:
          'You are a debate judge. Reply only "YES" or "NO". Has this debate reached a clear, decisive conclusion where one side has definitively made stronger arguments? Only say YES if it is very obvious.',
      },
      { role: "user", content: transcript },
    ],
  });

  const data = await res.json();
  const answer = data.choices?.[0]?.message?.content?.trim().toUpperCase() ?? "";
  return answer.includes("YES");
}

async function judgeWinner(
  history: HistoryEntry[],
  agentA: Agent,
  agentB: Agent
): Promise<{ winnerId: string; reason: string }> {
  const transcript = history.map((h) => `${h.speaker}: ${h.text}`).join("\n\n");

  const res = await fetchWithFallback({
    max_tokens: 120,
    messages: [
      {
        role: "system",
        content: `You are an impartial debate judge. The debaters are "${agentA.name}" and "${agentB.name}". Evaluate argument quality, logic, and persuasiveness. Respond in JSON: {"winner": "<exact name>", "reason": "<1-2 sentences>"}`,
      },
      { role: "user", content: transcript },
    ],
  });

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content ?? "{}";

  try {
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
    const winnerId =
      parsed.winner?.toLowerCase().includes(agentA.name.toLowerCase())
        ? agentA.id
        : agentB.id;
    return { winnerId, reason: parsed.reason ?? "The debate has concluded." };
  } catch {
    // Fallback: pick based on keyword match
    const mentionsA = (raw.match(new RegExp(agentA.name, "gi")) ?? []).length;
    const mentionsB = (raw.match(new RegExp(agentB.name, "gi")) ?? []).length;
    return {
      winnerId: mentionsA >= mentionsB ? agentA.id : agentB.id,
      reason: "Determined by argument quality.",
    };
  }
}

export async function runDebate(
  debateId: string,
  topic: string,
  agentAId: string,
  agentBId: string
) {
  const db = supabaseAdmin();
  const agentA = AGENTS[agentAId];
  const agentB = AGENTS[agentBId];

  if (!agentA || !agentB) throw new Error("Invalid agent IDs");

  const history: HistoryEntry[] = [];
  const startTime = Date.now();
  let round = 1;

  // Mark debate as live
  await db
    .from("debates")
    .update({ status: "live", started_at: new Date().toISOString() })
    .eq("id", debateId);

  while (Date.now() - startTime < MAX_DEBATE_MS) {
    for (const agent of [agentA, agentB]) {
      // Bail if debate was deleted externally
      const { data: still } = await db
        .from("debates")
        .select("id")
        .eq("id", debateId)
        .maybeSingle();
      if (!still) return;

      // Show typing indicator
      await db
        .from("debates")
        .update({ typing_agent_id: agent.id })
        .eq("id", debateId);

      const text = await streamAgentResponse(agent, topic, history);
      history.push({ speaker: agent.name, text });

      // Insert message (triggers realtime broadcast)
      await db.from("debate_messages").insert({
        debate_id: debateId,
        agent_id: agent.id,
        content: text,
        round,
      });

      // Clear typing indicator
      await db
        .from("debates")
        .update({ typing_agent_id: null })
        .eq("id", debateId);

      await sleep(600);
    }

    // Check conclusiveness every 2 rounds (min 5 rounds total)
    if (round >= 5 && round % 2 === 1) {
      const conclusive = await judgeConclusive(history);
      if (conclusive) break;
    }

    round++;
  }

  // ── Submission phase ──────────────────────────────────────
  const submissionEnds = new Date(Date.now() + SUBMISSION_MS).toISOString();
  await db.from("debates").update({
    status: "submission",
    debate_ended_at: new Date().toISOString(),
    submission_ends_at: submissionEnds,
    typing_agent_id: null,
  }).eq("id", debateId);

  // Wait for submission window
  await sleep(SUBMISSION_MS);

  // ── Judging phase (shown to users while AI picks winner) ──
  await db.from("debates").update({
    status: "judging",
    typing_agent_id: null,
  }).eq("id", debateId);

  // ── Auto-resolve ──────────────────────────────────────────
  const { winnerId, reason } = await judgeWinner(history, agentA, agentB);

  await db.from("debates").update({
    status: "resolved",
    winner_id: winnerId,
    winner_reason: reason,
    resolved_at: new Date().toISOString(),
  }).eq("id", debateId);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
