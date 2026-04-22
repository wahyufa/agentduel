"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { supabase, Debate, DebateMessage } from "@/lib/supabase";
import { AGENTS } from "@/lib/agents";
import { useWallet } from "@solana/wallet-adapter-react";

const WalletButton = dynamic(() => import("@/components/WalletButton"), { ssr: false });
const PredictionPanel = dynamic(() => import("@/components/PredictionPanel"), { ssr: false });

type Tab = "active" | "upcoming" | "past";

const STATUS_LABEL: Record<string, string> = {
  scheduled: "Upcoming",
  live: "Live",
  submission: "Submission",
  judging: "Judging",
  resolved: "Resolved",
};

const STATUS_COLOR: Record<string, string> = {
  scheduled: "#8a8178",
  live: "#d93b1f",
  submission: "#e8a100",
  judging: "#8a52e8",
  resolved: "#16a34a",
};

function getUserIdentifier(publicKey: { toBase58(): string } | null): string | null {
  if (publicKey) return publicKey.toBase58();
  if (typeof window === "undefined") return null;
  return localStorage.getItem("agentduel_guest_id");
}

function DebatePageInner() {
  const { publicKey } = useWallet();
  const feedRef = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();

  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get("tab");
    return (t === "upcoming" || t === "past") ? t : "active";
  });

  // Active tab state
  const [debate, setDebate] = useState<Debate | null>(null);
  const [messages, setMessages] = useState<DebateMessage[]>([]);
  const [loadingActive, setLoadingActive] = useState(true);
  const [userPrediction, setUserPrediction] = useState<string | null>(null);
  const [predCounts, setPredCounts] = useState<Record<string, number>>({});
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // Upcoming / Past tab state
  const [upcomingDebates, setUpcomingDebates] = useState<Debate[]>([]);
  const [pastDebates, setPastDebates] = useState<Debate[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  // wallet/guest → predicted_agent_id for past debates
  const [userHistory, setUserHistory] = useState<Record<string, string>>({});

  // Auto-scroll feed
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages, debate?.typing_agent_id]);

  // Load active debate + messages
  useEffect(() => {
    async function load() {
      setLoadingActive(true);

      const { data: d } = await supabase
        .from("debates")
        .select("*")
        .in("status", ["live", "submission", "resolved"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!d) {
        setLoadingActive(false);
        return;
      }

      setDebate(d as Debate);

      const { data: msgs } = await supabase
        .from("debate_messages")
        .select("*")
        .eq("debate_id", d.id)
        .order("created_at", { ascending: true });

      setMessages((msgs as DebateMessage[]) ?? []);
      setLoadingActive(false);

      const identifier = getUserIdentifier(publicKey);
      fetchPredCounts(d.id, identifier ?? undefined);
    }

    load();
  }, []);

  // Load upcoming + past debates
  useEffect(() => {
    async function loadLists() {
      setLoadingList(true);

      const [upcomingRes, pastRes] = await Promise.all([
        supabase
          .from("debates")
          .select("*")
          .eq("status", "scheduled")
          .order("created_at", { ascending: true }),
        supabase
          .from("debates")
          .select("*")
          .eq("status", "resolved")
          .order("resolved_at", { ascending: false })
          .limit(30),
      ]);

      setUpcomingDebates((upcomingRes.data as Debate[]) ?? []);
      setPastDebates((pastRes.data as Debate[]) ?? []);
      setLoadingList(false);
    }

    loadLists();
  }, []);

  // Load user prediction history when past tab opened or wallet connects
  useEffect(() => {
    const identifier = getUserIdentifier(publicKey);
    if (!identifier || pastDebates.length === 0) return;

    fetch(`/api/predictions?all=true&wallet=${identifier}`)
      .then((r) => r.json())
      .then((data) => setUserHistory(data.predictions ?? {}));
  }, [publicKey, pastDebates.length]);

  // Fetch prediction counts + user prediction for active debate
  async function fetchPredCounts(debateId: string, identifier?: string) {
    const url = `/api/predictions?debate_id=${debateId}${identifier ? `&wallet=${identifier}` : ""}`;
    const res = await fetch(url);
    const data = await res.json();
    setPredCounts(data.counts ?? {});
    setUserPrediction(data.userPrediction ?? null);
  }

  // Re-fetch predictions when wallet connects
  useEffect(() => {
    if (debate?.id) {
      const identifier = getUserIdentifier(publicKey);
      fetchPredCounts(debate.id, identifier ?? undefined);
    }
  }, [publicKey, debate?.id]);

  // Realtime subscriptions for active debate
  useEffect(() => {
    if (!debate?.id) return;

    const msgChannel = supabase
      .channel(`messages:${debate.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "debate_messages",
          filter: `debate_id=eq.${debate.id}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as DebateMessage]);
        }
      )
      .subscribe();

    const debateChannel = supabase
      .channel(`debate:${debate.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "debates",
          filter: `id=eq.${debate.id}`,
        },
        (payload) => setDebate(payload.new as Debate)
      )
      .subscribe();

    const predChannel = supabase
      .channel(`predictions:${debate.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "predictions",
          filter: `debate_id=eq.${debate.id}`,
        },
        () => {
          const identifier = getUserIdentifier(publicKey);
          fetchPredCounts(debate.id, identifier ?? undefined);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(msgChannel);
      supabase.removeChannel(debateChannel);
      supabase.removeChannel(predChannel);
    };
  }, [debate?.id]);

  // Submission countdown timer
  useEffect(() => {
    if (debate?.status !== "submission" || !debate.submission_ends_at) {
      setSecondsLeft(null);
      return;
    }

    const tick = () => {
      const diff = Math.max(
        0,
        Math.floor((new Date(debate.submission_ends_at!).getTime() - Date.now()) / 1000)
      );
      setSecondsLeft(diff);
    };

    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [debate?.status, debate?.submission_ends_at]);

  const agentA = debate ? AGENTS[debate.agent_a_id] : null;
  const agentB = debate ? AGENTS[debate.agent_b_id] : null;

  return (
    <div className="min-h-screen bg-[#f7f3ec]">
      {/* NAV */}
      <nav className="sticky top-0 z-50 bg-[#f7f3ec]/90 backdrop-blur border-b border-[#e0d9ce] flex items-center justify-between px-6 h-14">
        <a href="/" className="font-['Bebas_Neue'] text-xl tracking-widest">
          Agent<span className="text-[#d93b1f]">Duel</span>
        </a>
        <div className="flex items-center gap-3">
          {debate && tab === "active" && (
            <span
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full"
              style={{
                background: `${STATUS_COLOR[debate.status]}15`,
                color: STATUS_COLOR[debate.status],
              }}
            >
              {debate.status === "live" && (
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
              )}
              {STATUS_LABEL[debate.status]}
            </span>
          )}
          <WalletButton />
        </div>
      </nav>

      {/* TABS */}
      <div className="border-b border-[#e0d9ce] bg-white">
        <div className="max-w-4xl mx-auto px-4 flex gap-1 pt-3">
          {(["active", "upcoming", "past"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-4 py-2 text-sm font-bold rounded-t-lg transition-all capitalize"
              style={{
                background: tab === t ? "#f7f3ec" : "transparent",
                color: tab === t ? "#1a1714" : "#8a8178",
                borderBottom: tab === t ? "2px solid #1a1714" : "2px solid transparent",
              }}
            >
              {t === "active" ? "⚔️ Active" : t === "upcoming" ? "🕐 Upcoming" : "📜 Past"}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* ─── ACTIVE TAB ─────────────────────────────────── */}
        {tab === "active" && (
          <>
            {loadingActive && (
              <div className="flex items-center justify-center min-h-[60vh]">
                <div className="w-8 h-8 border-2 border-[#1a1714] border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {!loadingActive && !debate && (
              <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-center">
                <span className="text-5xl">⚔️</span>
                <h2 className="font-['Bebas_Neue'] text-4xl tracking-wide">No Active Debate</h2>
                <p className="text-sm text-[#8a8178]">Next debate will be announced soon.</p>
                <button
                  onClick={() => setTab("upcoming")}
                  className="mt-2 text-sm font-bold px-5 py-2.5 rounded-xl"
                  style={{ background: "#1a1714", color: "#f7f3ec" }}
                >
                  See Upcoming →
                </button>
              </div>
            )}

            {!loadingActive && debate && agentA && agentB && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Main debate column */}
                <div className="lg:col-span-2 space-y-4">
                  {/* Topic + agents header */}
                  <div className="bg-white border border-[#e0d9ce] rounded-2xl p-5">
                    <p className="text-[10px] font-bold tracking-[2px] uppercase text-[#8a8178] mb-2">
                      Topic
                    </p>
                    <p className="text-base font-semibold mb-4">"{debate.topic}"</p>
                    <div className="grid grid-cols-2 gap-3">
                      {[agentA, agentB].map((agent, i) => (
                        <div
                          key={agent.id}
                          className="flex items-center gap-2.5 p-2.5 rounded-xl"
                          style={{
                            background:
                              i === 0 ? "rgba(217,59,31,0.05)" : "rgba(26,82,232,0.05)",
                            border: `1px solid ${i === 0 ? "rgba(217,59,31,0.15)" : "rgba(26,82,232,0.15)"}`,
                          }}
                        >
                          <span className="text-2xl">{agent.emoji}</span>
                          <div>
                            <p className="text-xs font-bold">{agent.name}</p>
                            <p className="text-[10px] text-[#8a8178]">{agent.winRate}% WR</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Message feed */}
                  <div
                    ref={feedRef}
                    className="bg-white border border-[#e0d9ce] rounded-2xl p-4 space-y-3 overflow-y-auto"
                    style={{ minHeight: 400, maxHeight: 560 }}
                  >
                    {messages.length === 0 && !debate.typing_agent_id && (
                      <div className="flex flex-col items-center justify-center h-40 text-[#8a8178] text-sm">
                        <span className="text-3xl mb-2">⚔️</span>
                        {debate.status === "live" ? "Debate starting..." : "No messages yet"}
                      </div>
                    )}

                    {Array.from(new Set(messages.map((m) => m.round))).map((round) => (
                      <div key={round}>
                        <div className="flex items-center gap-2 my-2">
                          <div className="flex-1 h-px bg-[#e0d9ce]" />
                          <span className="text-[10px] font-bold tracking-[1.5px] uppercase text-[#8a8178]">
                            Round {round}
                          </span>
                          <div className="flex-1 h-px bg-[#e0d9ce]" />
                        </div>
                        {messages
                          .filter((m) => m.round === round)
                          .map((msg, i) => {
                            const isA = msg.agent_id === agentA.id;
                            const agent = AGENTS[msg.agent_id];
                            return (
                              <div
                                key={i}
                                className={`flex items-end gap-2 mb-2 ${isA ? "" : "flex-row-reverse"}`}
                              >
                                <div
                                  className="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
                                  style={{
                                    background: isA
                                      ? "rgba(217,59,31,0.08)"
                                      : "rgba(26,82,232,0.08)",
                                  }}
                                >
                                  {agent?.emoji}
                                </div>
                                <div
                                  className="max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed"
                                  style={
                                    isA
                                      ? {
                                          background: "#fff1ee",
                                          border: "1.5px solid rgba(217,59,31,0.12)",
                                          borderBottomLeftRadius: 4,
                                        }
                                      : {
                                          background: "#eef2ff",
                                          border: "1.5px solid rgba(26,82,232,0.12)",
                                          borderBottomRightRadius: 4,
                                        }
                                  }
                                >
                                  {msg.content}
                                </div>
                              </div>
                            );
                          })}
                      </div>
                    ))}

                    {debate.typing_agent_id && (
                      <div
                        className={`flex items-center gap-2 ${debate.typing_agent_id === agentA.id ? "" : "flex-row-reverse"}`}
                      >
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
                          style={{
                            background:
                              debate.typing_agent_id === agentA.id
                                ? "rgba(217,59,31,0.08)"
                                : "rgba(26,82,232,0.08)",
                          }}
                        >
                          {AGENTS[debate.typing_agent_id]?.emoji}
                        </div>
                        <div className="px-4 py-3 bg-[#f7f3ec] rounded-2xl flex gap-1">
                          {[0, 1, 2].map((i) => (
                            <span
                              key={i}
                              className="w-1.5 h-1.5 rounded-full bg-[#8a8178] animate-bounce"
                              style={{ animationDelay: `${i * 0.15}s` }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Judging animation */}
                  {debate.status === "judging" && (
                    <div className="bg-white border-2 rounded-2xl p-6 text-center space-y-3"
                      style={{ borderColor: "#8a52e8" }}>
                      <p className="text-[10px] font-bold tracking-[2px] uppercase"
                        style={{ color: "#8a52e8" }}>
                        Selecting Winner
                      </p>
                      <div className="flex items-center justify-center gap-3 py-2">
                        <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
                          style={{ borderColor: "#8a52e8", borderTopColor: "transparent" }} />
                        <p className="font-['Bebas_Neue'] text-3xl tracking-wide">
                          ⚖️ AI Judge Analyzing...
                        </p>
                      </div>
                      <p className="text-sm text-[#8a8178]">
                        Reviewing all arguments · Results in a moment
                      </p>
                    </div>
                  )}

                  {/* Winner announcement */}
                  {debate.status === "resolved" && debate.winner_id && (
                    <div className="bg-white border-2 border-[#e8a100] rounded-2xl p-5 text-center space-y-2">
                      <p className="text-[10px] font-bold tracking-[2px] uppercase text-[#e8a100]">
                        Winner
                      </p>
                      <p className="font-['Bebas_Neue'] text-4xl tracking-wide">
                        {AGENTS[debate.winner_id]?.emoji} {AGENTS[debate.winner_id]?.name}
                      </p>
                      {debate.winner_reason && (
                        <p className="text-sm text-[#8a8178] italic">
                          "{debate.winner_reason}"
                        </p>
                      )}
                      {userPrediction === debate.winner_id && (
                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#dcfce7] text-[#16a34a] text-sm font-bold">
                          🎉 You predicted correctly!
                        </div>
                      )}
                      {userPrediction && userPrediction !== debate.winner_id && (
                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#fee2e2] text-[#d93b1f] text-sm font-bold">
                          Better luck next time
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Side panel */}
                <div className="space-y-4">
                  {debate.status === "submission" && secondsLeft !== null && (
                    <div className="bg-white border-2 border-[#e8a100] rounded-2xl p-4 text-center space-y-1">
                      <p className="text-[10px] font-bold tracking-[2px] uppercase text-[#e8a100]">
                        Submission closes in
                      </p>
                      <p className="font-['Bebas_Neue'] text-5xl tracking-wide text-[#1a1714]">
                        {String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:
                        {String(secondsLeft % 60).padStart(2, "0")}
                      </p>
                      <p className="text-[10px] text-[#8a8178]">
                        You can still change your pick
                      </p>
                    </div>
                  )}

                  <PredictionPanel
                    debateId={debate.id}
                    agentA={agentA}
                    agentB={agentB}
                    status={debate.status}
                    userPrediction={userPrediction}
                    counts={predCounts}
                    onPredicted={(agentId) => {
                      setUserPrediction(agentId);
                      const identifier = getUserIdentifier(publicKey);
                      fetchPredCounts(debate.id, identifier ?? undefined);
                    }}
                  />

                  <div className="bg-white border border-[#e0d9ce] rounded-2xl p-4 space-y-2">
                    <p className="text-[10px] font-bold tracking-[2px] uppercase text-[#8a8178]">
                      Stats
                    </p>
                    <div className="flex justify-between text-sm">
                      <span className="text-[#8a8178]">Messages</span>
                      <span className="font-mono font-bold">{messages.length}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[#8a8178]">Rounds</span>
                      <span className="font-mono font-bold">
                        {messages.length > 0 ? Math.max(...messages.map((m) => m.round)) : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[#8a8178]">Predictions</span>
                      <span className="font-mono font-bold">
                        {(predCounts[agentA.id] ?? 0) + (predCounts[agentB.id] ?? 0)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ─── UPCOMING TAB ───────────────────────────────── */}
        {tab === "upcoming" && (
          <div className="space-y-3">
            {loadingList && (
              <div className="flex justify-center py-16">
                <div className="w-8 h-8 border-2 border-[#1a1714] border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {!loadingList && upcomingDebates.length === 0 && (
              <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 text-center">
                <span className="text-4xl">🕐</span>
                <h2 className="font-['Bebas_Neue'] text-3xl tracking-wide">
                  No Upcoming Debates
                </h2>
                <p className="text-sm text-[#8a8178]">
                  New debates are scheduled regularly. Check back soon.
                </p>
              </div>
            )}

            {!loadingList &&
              upcomingDebates.map((d) => {
                const a = AGENTS[d.agent_a_id];
                const b = AGENTS[d.agent_b_id];
                return (
                  <div
                    key={d.id}
                    className="bg-white border border-[#e0d9ce] rounded-2xl p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-bold tracking-[2px] uppercase text-[#8a8178] mb-1">
                          Upcoming
                        </p>
                        <p className="font-semibold text-sm mb-3 truncate">"{d.topic}"</p>
                        <div className="flex items-center gap-3">
                          {a && (
                            <div className="flex items-center gap-1.5">
                              <span>{a.emoji}</span>
                              <span className="text-xs font-bold">{a.name}</span>
                            </div>
                          )}
                          <span className="text-xs font-bold text-[#e0d9ce]">VS</span>
                          {b && (
                            <div className="flex items-center gap-1.5">
                              <span>{b.emoji}</span>
                              <span className="text-xs font-bold">{b.name}</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <span
                        className="text-[10px] font-bold px-3 py-1.5 rounded-full flex-shrink-0"
                        style={{
                          background: `${STATUS_COLOR.scheduled}15`,
                          color: STATUS_COLOR.scheduled,
                        }}
                      >
                        Scheduled
                      </span>
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {/* ─── PAST TAB ───────────────────────────────────── */}
        {tab === "past" && (
          <div className="space-y-3">
            {loadingList && (
              <div className="flex justify-center py-16">
                <div className="w-8 h-8 border-2 border-[#1a1714] border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {!loadingList && pastDebates.length === 0 && (
              <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 text-center">
                <span className="text-4xl">📜</span>
                <h2 className="font-['Bebas_Neue'] text-3xl tracking-wide">No Past Debates</h2>
                <p className="text-sm text-[#8a8178]">
                  Completed debates will appear here.
                </p>
              </div>
            )}

            {!loadingList &&
              pastDebates.map((d) => {
                const a = AGENTS[d.agent_a_id];
                const b = AGENTS[d.agent_b_id];
                const winner = d.winner_id ? AGENTS[d.winner_id] : null;
                const userPick = userHistory[d.id] ?? null;
                const participated = !!userPick;
                const correct = participated && userPick === d.winner_id;

                return (
                  <div
                    key={d.id}
                    className="bg-white border border-[#e0d9ce] rounded-2xl p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-bold tracking-[2px] uppercase text-[#8a8178] mb-1">
                          Resolved
                          {d.resolved_at && (
                            <span className="ml-2 font-normal normal-case">
                              {new Date(d.resolved_at).toLocaleDateString()}
                            </span>
                          )}
                        </p>
                        <p className="font-semibold text-sm mb-3">"{d.topic}"</p>

                        <div className="flex items-center gap-3 flex-wrap">
                          {[a, b].map((agent, i) => {
                            if (!agent) return null;
                            const isWinner = agent.id === d.winner_id;
                            return (
                              <div
                                key={agent.id}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
                                style={{
                                  background: isWinner ? "#dcfce7" : "#f7f3ec",
                                  border: isWinner ? "1px solid #86efac" : "1px solid #e0d9ce",
                                }}
                              >
                                <span>{agent.emoji}</span>
                                <span
                                  className="text-xs font-bold"
                                  style={{ color: isWinner ? "#16a34a" : "#8a8178" }}
                                >
                                  {agent.name}
                                </span>
                                {isWinner && (
                                  <span className="text-[10px] text-[#16a34a]">🏆</span>
                                )}
                              </div>
                            );
                          })}
                        </div>

                        {winner && d.winner_reason && (
                          <p className="text-xs text-[#8a8178] italic mt-2 line-clamp-1">
                            "{d.winner_reason}"
                          </p>
                        )}
                      </div>

                      {/* Participation badge */}
                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        {participated ? (
                          <div
                            className="text-[10px] font-bold px-3 py-1.5 rounded-full"
                            style={{
                              background: correct ? "#dcfce7" : "#fee2e2",
                              color: correct ? "#16a34a" : "#d93b1f",
                            }}
                          >
                            {correct ? "✓ Correct" : "✗ Wrong"}
                          </div>
                        ) : (
                          <div
                            className="text-[10px] font-bold px-3 py-1.5 rounded-full"
                            style={{ background: "#f7f3ec", color: "#c0b8ad" }}
                          >
                            — Not played
                          </div>
                        )}
                        {participated && userPick && AGENTS[userPick] && (
                          <p className="text-[10px] text-[#8a8178]">
                            Picked {AGENTS[userPick].emoji} {AGENTS[userPick].name}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

            {!loadingList && pastDebates.length > 0 && !publicKey && (
              <p className="text-center text-xs text-[#8a8178] py-4">
                Connect wallet to see your participation history
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DebatePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#f7f3ec] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#1a1714] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <DebatePageInner />
    </Suspense>
  );
}
