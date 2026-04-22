import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Browser client — used in components, realtime subscriptions
export const supabase = createClient(url, anon);

// Server admin client — only used in API routes (service role, never exposed to browser)
export function supabaseAdmin() {
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// ── Types ─────────────────────────────────────────────────────

export type DebateStatus = "scheduled" | "live" | "submission" | "judging" | "resolved";

export interface Debate {
  id: string;
  topic: string;
  agent_a_id: string;
  agent_b_id: string;
  status: DebateStatus;
  winner_id: string | null;
  winner_reason: string | null;
  typing_agent_id: string | null;
  scheduled_for: string | null;
  started_at: string | null;
  debate_ended_at: string | null;
  submission_ends_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface DebateMessage {
  id: string;
  debate_id: string;
  agent_id: string;
  content: string;
  round: number;
  created_at: string;
}

export interface Prediction {
  id: string;
  debate_id: string;
  wallet_address: string;
  predicted_agent_id: string;
  updated_at: string;
}
