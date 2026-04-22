"use client";

import { useState, useEffect } from "react";
import { TOPICS } from "@/lib/topics";
import { AGENT_LIST } from "@/lib/agents";
import { supabase, Debate } from "@/lib/supabase";
import { AGENTS } from "@/lib/agents";

const SECRET = "agentduel-admin-2024";

type AdminTab = "start" | "schedule" | "queue";

export default function AdminPage() {
  const [tab, setTab] = useState<AdminTab>("start");

  // Start Now
  const [topic, setTopic] = useState(TOPICS[0].title);
  const [customTopic, setCustomTopic] = useState("");
  const [agentA, setAgentA] = useState(AGENT_LIST[0].id);
  const [agentB, setAgentB] = useState(AGENT_LIST[1].id);
  const [random, setRandom] = useState(true);
  const [loadingStart, setLoadingStart] = useState(false);
  const [startResult, setStartResult] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  // Schedule
  const [sTopic, setSTopic] = useState(TOPICS[0].title);
  const [sCustomTopic, setSCustomTopic] = useState("");
  const [sAgentA, setSAgentA] = useState(AGENT_LIST[0].id);
  const [sAgentB, setSAgentB] = useState(AGENT_LIST[1].id);
  const [sRandom, setSRandom] = useState(false);
  const [sScheduledFor, setSScheduledFor] = useState("");
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [scheduleResult, setScheduleResult] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // Queue
  const [queue, setQueue] = useState<Debate[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [queueAction, setQueueAction] = useState<string | null>(null);

  useEffect(() => {
    if (tab === "queue") loadQueue();
  }, [tab]);

  async function loadQueue() {
    setLoadingQueue(true);
    const { data } = await supabase
      .from("debates")
      .select("*")
      .eq("status", "scheduled")
      .order("created_at", { ascending: true });
    setQueue((data as Debate[]) ?? []);
    setLoadingQueue(false);
  }

  async function startDebate(debateId?: string) {
    setLoadingStart(true);
    setStartResult(null);
    setStartError(null);

    const body: Record<string, string> = { secret: SECRET };
    if (debateId) {
      body.debateId = debateId;
    } else if (!random) {
      body.topic = customTopic || topic;
      body.agentA = agentA;
      body.agentB = agentB;
    }

    try {
      const res = await fetch("/api/admin/debate/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setStartResult(`Started: "${data.topic}" — ${data.agentA} vs ${data.agentB}`);
      if (debateId) loadQueue();
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoadingStart(false);
    }
  }

  async function scheduleDebate() {
    setLoadingSchedule(true);
    setScheduleResult(null);
    setScheduleError(null);

    const body: Record<string, string> = { secret: SECRET };
    if (!sRandom) {
      body.topic = sCustomTopic || sTopic;
      body.agentA = sAgentA;
      body.agentB = sAgentB;
    }
    if (sScheduledFor) body.scheduled_for = sScheduledFor;

    try {
      const res = await fetch("/api/admin/debate/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setScheduleResult(`Scheduled: "${data.topic}" — ${data.agentA} vs ${data.agentB}`);
      setSCustomTopic("");
    } catch (e) {
      setScheduleError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoadingSchedule(false);
    }
  }

  async function deleteScheduled(id: string) {
    setQueueAction(id);
    try {
      await fetch(`/api/admin/debate/schedule?id=${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: SECRET }),
      });
      loadQueue();
    } finally {
      setQueueAction(null);
    }
  }

  async function startScheduled(id: string) {
    setQueueAction(id);
    setStartResult(null);
    setStartError(null);
    try {
      const res = await fetch("/api/admin/debate/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: SECRET, debateId: id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setStartResult(`Started: "${data.topic}"`);
      loadQueue();
    } catch (e) {
      setStartError(e instanceof Error ? e.message : "Error");
    } finally {
      setQueueAction(null);
    }
  }

  const selectClass = "w-full text-sm border border-[#e0d9ce] rounded-xl px-3 py-2 bg-[#f7f3ec]";
  const inputClass = "w-full text-sm border border-[#e0d9ce] rounded-xl px-3 py-2 bg-[#f7f3ec]";

  return (
    <div className="min-h-screen bg-[#f7f3ec] p-8">
      <div className="max-w-xl mx-auto space-y-5">
        <div>
          <h1 className="font-['Bebas_Neue'] text-5xl tracking-wide">
            Admin<span className="text-[#d93b1f]">Panel</span>
          </h1>
          <p className="text-sm text-[#8a8178] mt-1">
            Test mode: debate ~90s · submission 30s
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white border border-[#e0d9ce] rounded-xl p-1">
          {([
            ["start", "⚔️ Start Now"],
            ["schedule", "📅 Schedule"],
            ["queue", "🕐 Queue"],
          ] as [AdminTab, string][]).map(([t, label]) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex-1 py-2 text-sm font-bold rounded-lg transition-all"
              style={{
                background: tab === t ? "#1a1714" : "transparent",
                color: tab === t ? "#f7f3ec" : "#8a8178",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── START NOW ── */}
        {tab === "start" && (
          <div className="bg-white border border-[#e0d9ce] rounded-2xl p-5 space-y-4">
            <p className="text-xs font-bold tracking-[2px] uppercase text-[#8a8178]">
              Start Immediately
            </p>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={random}
                onChange={(e) => setRandom(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm">Random topic + agents</span>
            </label>

            {!random && (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-[#8a8178] mb-1">Topic (preset)</p>
                  <select value={topic} onChange={(e) => setTopic(e.target.value)} className={selectClass}>
                    {TOPICS.map((t) => (
                      <option key={t.id} value={t.title}>[{t.category}] {t.title}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="text-xs text-[#8a8178] mb-1">Or custom topic</p>
                  <input
                    type="text"
                    value={customTopic}
                    onChange={(e) => setCustomTopic(e.target.value)}
                    placeholder="e.g. ETH will hit $10k in 2025"
                    className={inputClass}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(["Agent A", "Agent B"] as const).map((label, i) => (
                    <div key={label}>
                      <p className="text-xs text-[#8a8178] mb-1">{label}</p>
                      <select
                        value={i === 0 ? agentA : agentB}
                        onChange={(e) => i === 0 ? setAgentA(e.target.value) : setAgentB(e.target.value)}
                        className={selectClass}
                      >
                        {AGENT_LIST.map((a) => (
                          <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => startDebate()}
              disabled={loadingStart}
              className="w-full py-3 rounded-xl font-bold text-sm transition-all"
              style={{
                background: loadingStart ? "#e0d9ce" : "#1a1714",
                color: loadingStart ? "#8a8178" : "#f7f3ec",
              }}
            >
              {loadingStart ? "Starting..." : "⚔️ Start Debate"}
            </button>

            {startResult && (
              <div className="px-3 py-2.5 rounded-xl bg-[#dcfce7] text-[#16a34a] text-sm font-medium">
                ✓ {startResult}
                <br />
                <a href="/debate" className="underline font-bold">→ Watch debate</a>
              </div>
            )}
            {startError && (
              <div className="px-3 py-2.5 rounded-xl bg-[#fee2e2] text-[#d93b1f] text-sm">
                Error: {startError}
              </div>
            )}
          </div>
        )}

        {/* ── SCHEDULE ── */}
        {tab === "schedule" && (
          <div className="bg-white border border-[#e0d9ce] rounded-2xl p-5 space-y-4">
            <p className="text-xs font-bold tracking-[2px] uppercase text-[#8a8178]">
              Schedule Future Debate
            </p>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={sRandom}
                onChange={(e) => setSRandom(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm">Random topic + agents</span>
            </label>

            {!sRandom && (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-[#8a8178] mb-1">Topic (preset)</p>
                  <select value={sTopic} onChange={(e) => setSTopic(e.target.value)} className={selectClass}>
                    {TOPICS.map((t) => (
                      <option key={t.id} value={t.title}>[{t.category}] {t.title}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="text-xs text-[#8a8178] mb-1">Or custom topic</p>
                  <input
                    type="text"
                    value={sCustomTopic}
                    onChange={(e) => setSCustomTopic(e.target.value)}
                    placeholder="e.g. ETH will hit $10k in 2025"
                    className={inputClass}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(["Agent A", "Agent B"] as const).map((label, i) => (
                    <div key={label}>
                      <p className="text-xs text-[#8a8178] mb-1">{label}</p>
                      <select
                        value={i === 0 ? sAgentA : sAgentB}
                        onChange={(e) => i === 0 ? setSAgentA(e.target.value) : setSAgentB(e.target.value)}
                        className={selectClass}
                      >
                        {AGENT_LIST.map((a) => (
                          <option key={a.id} value={a.id}>{a.emoji} {a.name}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-xs text-[#8a8178] mb-1">Scheduled time (optional)</p>
              <input
                type="datetime-local"
                value={sScheduledFor}
                onChange={(e) => setSScheduledFor(e.target.value)}
                className={inputClass}
              />
            </div>

            <button
              onClick={scheduleDebate}
              disabled={loadingSchedule}
              className="w-full py-3 rounded-xl font-bold text-sm transition-all"
              style={{
                background: loadingSchedule ? "#e0d9ce" : "#1a52e8",
                color: loadingSchedule ? "#8a8178" : "#f7f3ec",
              }}
            >
              {loadingSchedule ? "Scheduling..." : "📅 Schedule Debate"}
            </button>

            {scheduleResult && (
              <div className="px-3 py-2.5 rounded-xl bg-[#dcfce7] text-[#16a34a] text-sm font-medium">
                ✓ {scheduleResult}
                <br />
                <button onClick={() => setTab("queue")} className="underline font-bold">
                  → View queue
                </button>
              </div>
            )}
            {scheduleError && (
              <div className="px-3 py-2.5 rounded-xl bg-[#fee2e2] text-[#d93b1f] text-sm">
                Error: {scheduleError}
              </div>
            )}
          </div>
        )}

        {/* ── QUEUE ── */}
        {tab === "queue" && (
          <div className="space-y-3">
            {startResult && (
              <div className="px-3 py-2.5 rounded-xl bg-[#dcfce7] text-[#16a34a] text-sm font-medium">
                ✓ {startResult} —{" "}
                <a href="/debate" className="underline font-bold">Watch →</a>
              </div>
            )}
            {startError && (
              <div className="px-3 py-2.5 rounded-xl bg-[#fee2e2] text-[#d93b1f] text-sm">
                Error: {startError}
              </div>
            )}

            <div className="flex items-center justify-between">
              <p className="text-xs font-bold tracking-[2px] uppercase text-[#8a8178]">
                Scheduled Queue ({queue.length})
              </p>
              <button onClick={loadQueue} className="text-xs text-[#8a8178] hover:text-[#1a1714] transition-colors">
                ↻ Refresh
              </button>
            </div>

            {loadingQueue && (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 border-2 border-[#1a1714] border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {!loadingQueue && queue.length === 0 && (
              <div className="bg-white border border-[#e0d9ce] rounded-2xl p-8 text-center text-[#8a8178]">
                <p className="text-2xl mb-2">🕐</p>
                <p className="text-sm">No scheduled debates.</p>
                <button onClick={() => setTab("schedule")} className="mt-2 text-xs underline text-[#1a52e8]">
                  Schedule one →
                </button>
              </div>
            )}

            {!loadingQueue && queue.map((d) => {
              const a = AGENTS[d.agent_a_id];
              const b = AGENTS[d.agent_b_id];
              const isActing = queueAction === d.id;
              return (
                <div key={d.id} className="bg-white border border-[#e0d9ce] rounded-2xl p-4 space-y-3">
                  <div>
                    <p className="text-xs text-[#8a8178] mb-1">Topic</p>
                    <p className="text-sm font-semibold">"{d.topic}"</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {a && <span className="text-sm">{a.emoji} {a.name}</span>}
                    <span className="text-xs text-[#e0d9ce] font-bold">VS</span>
                    {b && <span className="text-sm">{b.emoji} {b.name}</span>}
                  </div>
                  {d.scheduled_for && (
                    <p className="text-xs text-[#8a8178]">
                      🕐 {new Date(d.scheduled_for).toLocaleString()}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={() => startScheduled(d.id)}
                      disabled={!!queueAction}
                      className="flex-1 py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
                      style={{ background: "#1a1714", color: "#f7f3ec" }}
                    >
                      {isActing ? "..." : "▶ Start Now"}
                    </button>
                    <button
                      onClick={() => deleteScheduled(d.id)}
                      disabled={!!queueAction}
                      className="px-4 py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-50"
                      style={{ background: "#fee2e2", color: "#d93b1f" }}
                    >
                      {isActing ? "..." : "Delete"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <a
          href="/debate"
          className="block text-center text-sm text-[#8a8178] underline hover:text-[#1a1714]"
        >
          ← Back to debate
        </a>
      </div>
    </div>
  );
}
