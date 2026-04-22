"use client";

import { FC, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Agent } from "@/lib/agents";
import { DebateStatus } from "@/lib/supabase";

interface Props {
  debateId: string;
  agentA: Agent;
  agentB: Agent;
  status: DebateStatus;
  userPrediction: string | null;
  counts: Record<string, number>;
  onPredicted: (agentId: string) => void;
}

function getGuestId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem("agentduel_guest_id");
  if (!id) {
    id = "guest_" + crypto.randomUUID();
    localStorage.setItem("agentduel_guest_id", id);
  }
  return id;
}

const PredictionPanel: FC<Props> = ({
  debateId,
  agentA,
  agentB,
  status,
  userPrediction,
  counts,
  onPredicted,
}) => {
  const { connected, publicKey } = useWallet();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const totalA = counts[agentA.id] ?? 0;
  const totalB = counts[agentB.id] ?? 0;
  const total = totalA + totalB;
  const pctA = total > 0 ? Math.round((totalA / total) * 100) : 50;
  const pctB = 100 - pctA;

  const isLocked = status === "resolved";
  const canChange = status === "live" || status === "submission";
  const isGuest = !connected;

  function getIdentifier(): string {
    if (connected && publicKey) return publicKey.toBase58();
    return getGuestId();
  }

  async function predict(agentId: string) {
    if (loading || isLocked || !canChange) return;
    if (userPrediction === agentId) return;

    const identifier = getIdentifier();
    if (!identifier) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/predictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          debate_id: debateId,
          wallet_address: identifier,
          predicted_agent_id: agentId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed");
      }

      onPredicted(agentId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error submitting prediction");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white border border-[#e0d9ce] rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold tracking-[2px] uppercase text-[#8a8178]">
          {isLocked
            ? "Predictions Closed"
            : status === "submission"
            ? "Final Prediction"
            : "Predict Winner"}
        </p>
        {!isLocked && (
          <span className="text-[10px] px-2 py-1 rounded-full font-mono bg-[#f7f3ec] text-[#8a8178] border border-[#e0d9ce]">
            free
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {[agentA, agentB].map((agent, i) => {
          const color = i === 0 ? "#d93b1f" : "#1a52e8";
          const selected = userPrediction === agent.id;
          const pct = i === 0 ? pctA : pctB;
          const count = i === 0 ? totalA : totalB;

          return (
            <button
              key={agent.id}
              onClick={() => predict(agent.id)}
              disabled={loading || isLocked || !canChange}
              className="flex flex-col items-center gap-2 p-3 rounded-xl border transition-all disabled:cursor-default"
              style={{
                borderColor: selected ? color : "#e0d9ce",
                background: selected ? `${color}08` : "#f7f3ec",
                opacity: loading ? 0.6 : 1,
              }}
            >
              <span className="text-2xl">{agent.emoji}</span>
              <span
                className="text-xs font-bold"
                style={{ color: selected ? color : "#1a1714" }}
              >
                {agent.name}
              </span>
              <div className="w-full text-center">
                <span className="text-sm font-mono font-bold" style={{ color }}>
                  {pct}%
                </span>
                <span className="text-[10px] text-[#8a8178] ml-1">({count})</span>
              </div>
              {selected && (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{ background: `${color}15`, color }}
                >
                  Your pick
                </span>
              )}
            </button>
          );
        })}
      </div>

      {total > 0 && (
        <div
          className="w-full h-1.5 rounded-full overflow-hidden flex"
          style={{ background: "#e0d9ce" }}
        >
          <div
            style={{ width: `${pctA}%`, background: "#d93b1f", transition: "width 0.5s" }}
          />
          <div
            style={{ width: `${pctB}%`, background: "#1a52e8", transition: "width 0.5s" }}
          />
        </div>
      )}

      {isGuest && !isLocked && canChange && (
        <p className="text-[10px] text-[#8a8178] text-center">
          Predicting as guest —{" "}
          <span className="text-[#1a1714] font-medium">connect wallet</span> to track history
        </p>
      )}

      {status === "submission" && !isGuest && (
        <p className="text-[10px] text-[#8a8178] text-center">
          You can still change your prediction before time runs out
        </p>
      )}

      {error && (
        <p className="text-[10px] text-[#d93b1f] text-center">{error}</p>
      )}
    </div>
  );
};

export default PredictionPanel;
