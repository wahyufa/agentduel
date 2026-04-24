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
  scheduled: "#5a534d",
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

// Elapsed timer: counts up from a start time
function ElapsedTimer({ from }: { from: string }) {
  const [elapsed, setElapsed] = useState(Date.now() - new Date(from).getTime());
  useEffect(() => {
    const iv = setInterval(() => setElapsed(Date.now() - new Date(from).getTime()), 1000);
    return () => clearInterval(iv);
  }, [from]);
  const m = Math.floor(elapsed / 60000);
  const s = Math.floor((elapsed % 60000) / 1000);
  return <>{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}</>;
}

// Countdown badge: counts down to a future time
function CountdownTo({ to }: { to: string }) {
  const calc = () => Math.max(0, new Date(to).getTime() - Date.now());
  const [diff, setDiff] = useState(calc());
  useEffect(() => {
    const iv = setInterval(() => setDiff(calc()), 1000);
    return () => clearInterval(iv);
  }, [to]);
  if (diff === 0) return <>Starting soon</>;
  const totalS = Math.floor(diff / 1000);
  const d = Math.floor(totalS / 86400);
  const h = Math.floor((totalS % 86400) / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  if (d > 0) return <>{d}d {String(h).padStart(2, "0")}h {String(m).padStart(2, "0")}m</>;
  return <>{String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}</>;
}

function playWinnerSound() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const notes = [392, 494, 587, 784]; // G4 B4 D5 G5 - major arpeggio
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.15;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      osc.start(t);
      osc.stop(t + 0.5);
    });
  } catch {}
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
  const prevStatusRef = useRef<string | null>(null);

  // Play sound when winner is announced
  useEffect(() => {
    if (debate?.status === "resolved" && prevStatusRef.current && prevStatusRef.current !== "resolved") {
      playWinnerSound();
    }
    prevStatusRef.current = debate?.status ?? null;
  }, [debate?.status]);

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
    <div className="h-screen flex flex-col bg-[#f7f3ec] text-[#1a1714] overflow-hidden">
      {/* NAV */}
      <nav className="shrink-0 z-50 bg-[#f7f3ec]/90 backdrop-blur border-b border-[#e0d9ce] flex items-center justify-between px-6 h-14">
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
      <div className="shrink-0 border-b border-[#e0d9ce] bg-white">
        <div className="max-w-7xl mx-auto px-6 flex gap-1 pt-3">
          {(["active", "upcoming", "past"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="px-4 py-2 text-sm font-bold rounded-t-lg transition-all capitalize"
              style={{
                background: tab === t ? "#f7f3ec" : "transparent",
                color: tab === t ? "#1a1714" : "#5a534d",
                borderBottom: tab === t ? "2px solid #1a1714" : "2px solid transparent",
              }}
            >
              {t === "active" ? "⚔️ Active" : t === "upcoming" ? "🕐 Upcoming" : "📜 Past"}
            </button>
          ))}
        </div>
      </div>

      {/* ─── ACTIVE TAB — full-height layout ─────────────── */}
      {tab === "active" && (
        <div className="flex-1 overflow-hidden flex flex-col">
          {loadingActive && (
            <div className="flex-1 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-[#1a1714] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loadingActive && !debate && (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
              <span className="text-5xl">⚔️</span>
              <h2 className="font-['Bebas_Neue'] text-4xl tracking-wide">No Active Debate</h2>
              <p className="text-sm text-[#5a534d]">Next debate will be announced soon.</p>
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
            <div className="flex-1 overflow-hidden max-w-7xl w-full mx-auto px-6 py-4 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">

              {/* ── Left: chat column ────────────────────────── */}
              <div className="flex flex-col gap-3 overflow-hidden min-h-0">

                {/* Topic + agents header */}
                <div className="shrink-0 bg-white border border-[#e0d9ce] rounded-2xl px-5 py-4">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-bold tracking-[2px] uppercase text-[#5a534d] mb-1">Topic</p>
                      <p className="text-base font-semibold leading-snug">"{debate.topic}"</p>
                    </div>
                    <span
                      className="shrink-0 flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full"
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
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[agentA, agentB].map((agent, i) => (
                      <div
                        key={agent.id}
                        className="flex items-center gap-2.5 px-3 py-2 rounded-xl"
                        style={{
                          background: i === 0 ? "rgba(217,59,31,0.05)" : "rgba(26,82,232,0.05)",
                          border: `1px solid ${i === 0 ? "rgba(217,59,31,0.15)" : "rgba(26,82,232,0.15)"}`,
                        }}
                      >
                        <span className="text-xl">{agent.emoji}</span>
                        <div>
                          <p className="text-xs font-bold">{agent.name}</p>
                          <p className="text-[10px] text-[#5a534d]">{agent.winRate}% WR</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Message feed — fills remaining height */}
                <div
                  ref={feedRef}
                  className="flex-1 min-h-0 bg-white border border-[#e0d9ce] rounded-2xl overflow-y-auto"
                >
                  <div className="p-4 space-y-1">
                    {messages.length === 0 && !debate.typing_agent_id && (
                      <div className="flex flex-col items-center justify-center py-16 text-[#5a534d] text-sm">
                        <span className="text-3xl mb-2">⚔️</span>
                        {debate.status === "live" ? "Debate starting..." : "No messages yet"}
                      </div>
                    )}

                    {Array.from(new Set(messages.map((m) => m.round))).map((round) => (
                      <div key={round}>
                        <div className="flex items-center gap-2 my-3">
                          <div className="flex-1 h-px bg-[#e0d9ce]" />
                          <span className="text-[10px] font-bold tracking-[1.5px] uppercase text-[#5a534d]">
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
                                className={`flex items-end gap-2 mb-3 ${isA ? "" : "flex-row-reverse"}`}
                              >
                                <div
                                  className="w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0"
                                  style={{
                                    background: isA ? "rgba(217,59,31,0.08)" : "rgba(26,82,232,0.08)",
                                  }}
                                >
                                  {agent?.emoji}
                                </div>
                                <div
                                  className="max-w-[78%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed"
                                  style={
                                    isA
                                      ? { background: "#fff1ee", border: "1.5px solid rgba(217,59,31,0.12)", borderBottomLeftRadius: 4 }
                                      : { background: "#eef2ff", border: "1.5px solid rgba(26,82,232,0.12)", borderBottomRightRadius: 4 }
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
                      <div className={`flex items-center gap-2 mb-3 ${debate.typing_agent_id === agentA.id ? "" : "flex-row-reverse"}`}>
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-sm shrink-0"
                          style={{
                            background: debate.typing_agent_id === agentA.id ? "rgba(217,59,31,0.08)" : "rgba(26,82,232,0.08)",
                          }}
                        >
                          {AGENTS[debate.typing_agent_id]?.emoji}
                        </div>
                        <div className="px-4 py-3 bg-[#f7f3ec] rounded-2xl flex gap-1">
                          {[0, 1, 2].map((i) => (
                            <span
                              key={i}
                              className="w-1.5 h-1.5 rounded-full bg-[#5a534d] animate-bounce"
                              style={{ animationDelay: `${i * 0.15}s` }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ── Right: side panel ────────────────────────── */}
              <div className="overflow-y-auto space-y-3 pb-4">
                  {/* Winner announcement — top of panel */}
                  {debate.status === "resolved" && debate.winner_id && (
                    <div className="bg-white border-2 border-[#e8a100] rounded-2xl p-5 text-center space-y-2">
                      <p className="text-[10px] font-bold tracking-[2px] uppercase text-[#e8a100]">
                        Winner
                      </p>
                      <p className="font-['Bebas_Neue'] text-4xl tracking-wide text-[#1a1714]">
                        {AGENTS[debate.winner_id]?.emoji} {AGENTS[debate.winner_id]?.name}
                      </p>
                      {debate.winner_reason && (
                        <p className="text-sm text-[#5a534d] italic leading-snug">
                          &ldquo;{debate.winner_reason}&rdquo;
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

                  {/* Judging animation */}
                  {debate.status === "judging" && (
                    <div className="bg-white border-2 rounded-2xl p-5 text-center space-y-3"
                      style={{ borderColor: "#8a52e8" }}>
                      <p className="text-[10px] font-bold tracking-[2px] uppercase"
                        style={{ color: "#8a52e8" }}>
                        Selecting Winner
                      </p>
                      <div className="flex items-center justify-center gap-3 py-1">
                        <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
                          style={{ borderColor: "#8a52e8", borderTopColor: "transparent" }} />
                        <p className="font-['Bebas_Neue'] text-2xl tracking-wide text-[#1a1714]">
                          ⚖️ AI Judge Analyzing...
                        </p>
                      </div>
                      <p className="text-sm text-[#5a534d]">
                        Reviewing all arguments · Results in a moment
                      </p>
                    </div>
                  )}

                  {/* Timer card — always visible during active debates */}
                  {debate.status === "live" && debate.started_at && (
                    <div className="bg-white border border-[#e0d9ce] rounded-2xl p-4 text-center space-y-1">
                      <p className="text-[10px] font-bold tracking-[2px] uppercase text-[#d93b1f]">
                        Debate Running
                      </p>
                      <p className="font-['Bebas_Neue'] text-5xl tracking-wide text-[#1a1714]">
                        <ElapsedTimer from={debate.started_at} />
                      </p>
                      <div className="mt-2 px-3 py-1.5 rounded-lg bg-[#f7f3ec]">
                        <p className="text-[10px] text-[#5a534d]">
                          ⏱ Submission countdown starts after debate ends
                        </p>
                      </div>
                    </div>
                  )}

                  {debate.status === "submission" && secondsLeft !== null && (
                    <div className="bg-white border-2 border-[#e8a100] rounded-2xl p-4 text-center space-y-1">
                      <p className="text-[10px] font-bold tracking-[2px] uppercase text-[#e8a100]">
                        Submission closes in
                      </p>
                      <p className="font-['Bebas_Neue'] text-5xl tracking-wide text-[#1a1714]">
                        {String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:
                        {String(secondsLeft % 60).padStart(2, "0")}
                      </p>
                      <p className="text-[10px] text-[#5a534d]">
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
                    <p className="text-[10px] font-bold tracking-[2px] uppercase text-[#5a534d]">
                      Stats
                    </p>
                    <div className="flex justify-between text-sm">
                      <span className="text-[#5a534d]">Messages</span>
                      <span className="font-mono font-bold">{messages.length}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[#5a534d]">Rounds</span>
                      <span className="font-mono font-bold">
                        {messages.length > 0 ? Math.max(...messages.map((m) => m.round)) : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[#5a534d]">Predictions</span>
                      <span className="font-mono font-bold">
                        {(predCounts[agentA.id] ?? 0) + (predCounts[agentB.id] ?? 0)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

      {/* ─── UPCOMING TAB ───────────────────────────────── */}
        {tab === "upcoming" && (
          <div className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-6 py-6 space-y-3">
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
                <p className="text-sm text-[#5a534d]">
                  New debates are scheduled regularly. Check back soon.
                </p>
              </div>
            )}

            {!loadingList &&
              upcomingDebates.map((d) => {
                const a = AGENTS[d.agent_a_id];
                const b = AGENTS[d.agent_b_id];
                const hasTime = !!d.scheduled_for;
                return (
                  <div
                    key={d.id}
                    className="bg-white border border-[#e0d9ce] rounded-2xl p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-bold tracking-[2px] uppercase text-[#5a534d] mb-1">
                          Upcoming
                        </p>
                        <p className="font-semibold text-sm mb-3">"{d.topic}"</p>
                        <div className="flex items-center gap-3 mb-3">
                          {a && (
                            <div className="flex items-center gap-1.5">
                              <span>{a.emoji}</span>
                              <span className="text-xs font-bold">{a.name}</span>
                            </div>
                          )}
                          <span className="text-xs font-bold text-[#c0b8ad]">VS</span>
                          {b && (
                            <div className="flex items-center gap-1.5">
                              <span>{b.emoji}</span>
                              <span className="text-xs font-bold">{b.name}</span>
                            </div>
                          )}
                        </div>

                        {hasTime && (
                          <p className="text-[10px] text-[#5a534d]">
                            {new Date(d.scheduled_for!).toLocaleString(undefined, {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-col items-end gap-2 flex-shrink-0">
                        {hasTime ? (
                          <div
                            className="text-center px-3 py-2 rounded-xl"
                            style={{ background: "#f7f3ec", border: "1px solid #e0d9ce" }}
                          >
                            <p className="text-[9px] font-bold tracking-[1.5px] uppercase text-[#5a534d] mb-0.5">
                              Starts in
                            </p>
                            <p className="font-['Bebas_Neue'] text-lg tracking-wide text-[#1a1714] leading-none">
                              <CountdownTo to={d.scheduled_for!} />
                            </p>
                          </div>
                        ) : (
                          <span
                            className="text-[10px] font-bold px-3 py-1.5 rounded-full"
                            style={{
                              background: `${STATUS_COLOR.scheduled}15`,
                              color: STATUS_COLOR.scheduled,
                            }}
                          >
                            Scheduled
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
          </div>
        )}

      {/* ─── PAST TAB ───────────────────────────────────── */}
        {tab === "past" && (
          <div className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-6 py-6 space-y-3">
            {loadingList && (
              <div className="flex justify-center py-16">
                <div className="w-8 h-8 border-2 border-[#1a1714] border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {!loadingList && pastDebates.length === 0 && (
              <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 text-center">
                <span className="text-4xl">📜</span>
                <h2 className="font-['Bebas_Neue'] text-3xl tracking-wide">No Past Debates</h2>
                <p className="text-sm text-[#5a534d]">
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
                        <p className="text-[10px] font-bold tracking-[2px] uppercase text-[#5a534d] mb-1">
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
                                  style={{ color: isWinner ? "#16a34a" : "#5a534d" }}
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
                          <p className="text-xs text-[#5a534d] italic mt-2 line-clamp-1">
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
                            style={{ background: "#f7f3ec", color: "#7a6e66" }}
                          >
                            — Not played
                          </div>
                        )}
                        {participated && userPick && AGENTS[userPick] && (
                          <p className="text-[10px] text-[#5a534d]">
                            Picked {AGENTS[userPick].emoji} {AGENTS[userPick].name}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}

            {!loadingList && pastDebates.length > 0 && !publicKey && (
              <p className="text-center text-xs text-[#5a534d] py-4">
                Connect wallet to see your participation history
              </p>
            )}
          </div>
          </div>
        )}
    </div>
  );
}

export default function DebatePage() {
  return (
    <Suspense fallback={
      <div className="h-screen bg-[#f7f3ec] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#1a1714] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <DebatePageInner />
    </Suspense>
  );
}
