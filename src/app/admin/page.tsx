"use client";

import { useState, useEffect, useRef } from "react";
import { TOPICS } from "@/lib/topics";
import { AGENT_LIST } from "@/lib/agents";
import { supabase, Debate } from "@/lib/supabase";
import { AGENTS } from "@/lib/agents";
import type { PolyMarket } from "@/app/api/polymarket/route";

const SECRET = "agentduel-admin-2024";

function PolyPicker({ onSelect }: { onSelect: (question: string, yesPrice: number) => void }) {
  const [markets, setMarkets] = useState<PolyMarket[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/polymarket");
      if (!res.ok) throw new Error("Failed to load");
      const data: PolyMarket[] = await res.json();
      setMarkets(data);
      setOpen(true);
      setTimeout(() => searchRef.current?.focus(), 50);
    } catch {
      setError("Could not reach Polymarket. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const filtered = markets.filter((m) =>
    m.question.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={open ? () => setOpen(false) : load}
        disabled={loading}
        className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all disabled:opacity-50"
        style={{ background: "#f0f4ff", color: "#1a52e8", border: "1px solid #c7d7ff" }}
      >
        {loading ? "Loading..." : open ? "✕ Close" : "🔮 From Polymarket"}
      </button>

      {error && <p className="text-xs text-[#d93b1f] mt-1">{error}</p>}

      {open && (
        <div
          className="absolute left-0 z-50 mt-2 rounded-2xl border border-[#e0d9ce] bg-white shadow-xl overflow-hidden"
          style={{ width: 480, maxHeight: 400 }}
        >
          {/* Search header */}
          <div className="px-3 py-2.5 border-b border-[#e0d9ce] sticky top-0 bg-white">
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search markets..."
              className="w-full text-sm outline-none bg-transparent placeholder-[#aaa]"
            />
          </div>

          {/* Market list */}
          <div className="overflow-y-auto" style={{ maxHeight: 340 }}>
            {filtered.length === 0 && (
              <p className="text-center text-sm text-[#5a534d] py-6">No markets found</p>
            )}
            {filtered.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onSelect(m.question, m.yesPrice);
                  setOpen(false);
                  setSearch("");
                }}
                className="w-full text-left px-4 py-3 border-b border-[#f0ece4] hover:bg-[#f7f3ec] transition-colors"
              >
                <p className="text-sm font-medium text-[#1a1714] leading-snug mb-1.5">
                  {m.question}
                </p>
                <div className="flex items-center gap-3">
                  {/* Probability bar */}
                  <div className="flex-1 h-1.5 rounded-full bg-[#e0d9ce] overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${m.yesPrice}%`,
                        background: m.yesPrice >= 60 ? "#16a34a" : m.yesPrice >= 40 ? "#e8a100" : "#d93b1f",
                      }}
                    />
                  </div>
                  <span
                    className="text-[10px] font-bold shrink-0"
                    style={{ color: m.yesPrice >= 60 ? "#16a34a" : m.yesPrice >= 40 ? "#e8a100" : "#d93b1f" }}
                  >
                    {m.yesPrice}% YES
                  </span>
                  {m.volume > 0 && (
                    <span className="text-[10px] text-[#5a534d] shrink-0">
                      ${(m.volume / 1000).toFixed(0)}k vol
                    </span>
                  )}
                  {m.endDate && (
                    <span className="text-[10px] text-[#5a534d] shrink-0">
                      ends {new Date(m.endDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type AdminTab = "start" | "schedule" | "queue";

export default function AdminPage() {
  const [tab, setTab] = useState<AdminTab>("start");

  // Start Now
  const [topic, setTopic] = useState(TOPICS[0].title);
  const [customTopic, setCustomTopic] = useState("");
  const [polyOdds, setPolyOdds] = useState<number | null>(null);
  const [agentA, setAgentA] = useState(AGENT_LIST[0].id);
  const [agentB, setAgentB] = useState(AGENT_LIST[1].id);
  const [random, setRandom] = useState(true);
  const [loadingStart, setLoadingStart] = useState(false);
  const [startResult, setStartResult] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  // Schedule
  const [sTopic, setSTopic] = useState(TOPICS[0].title);
  const [sCustomTopic, setSCustomTopic] = useState("");
  const [sPolyOdds, setSPolyOdds] = useState<number | null>(null);
  const [sAgentA, setSAgentA] = useState(AGENT_LIST[0].id);
  const [sAgentB, setSAgentB] = useState(AGENT_LIST[1].id);
  const [sRandom, setSRandom] = useState(false);
  const [sScheduledFor, setSScheduledFor] = useState("");
  const [loadingSchedule, setLoadingSchedule] = useState(false);
  const [scheduleResult, setScheduleResult] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // Active debate
  type ActiveDebate = { id: string; topic: string; status: string; agent_a_id: string; agent_b_id: string; started_at: string | null } | null;
  const [activeDebate, setActiveDebate] = useState<ActiveDebate>(undefined as any);
  const [loadingActive, setLoadingActive] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Queue
  const [queue, setQueue] = useState<Debate[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(false);
  const [queueAction, setQueueAction] = useState<string | null>(null);

  useEffect(() => {
    fetchActive();
  }, []);

  useEffect(() => {
    if (tab === "queue") loadQueue();
  }, [tab]);

  async function fetchActive() {
    setLoadingActive(true);
    try {
      const res = await fetch(`/api/admin/debate/active?secret=${SECRET}`);
      const data = await res.json();
      setActiveDebate(data.debate ?? null);
    } catch {
      setActiveDebate(null);
    } finally {
      setLoadingActive(false);
    }
  }

  async function deleteActive() {
    setDeleteError(null);
    setLoadingActive(true);
    try {
      const res = await fetch("/api/admin/debate/active", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: SECRET }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setActiveDebate(null);
      setConfirmDelete(false);
      setStartResult(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoadingActive(false);
    }
  }

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
      fetchActive();
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
      fetchActive();
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

        {/* ── ACTIVE DEBATE CARD ── */}
        {tab === "start" && (
          <div className="rounded-2xl border overflow-hidden"
            style={{
              borderColor: activeDebate ? "#fca5a5" : "#e0d9ce",
              background: activeDebate ? "#fff5f5" : "white",
            }}>
            <div className="px-5 py-4 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold tracking-[2px] uppercase mb-1"
                  style={{ color: activeDebate ? "#d93b1f" : "#5a534d" }}>
                  {loadingActive ? "Checking..." : activeDebate ? `🔴 Active — ${activeDebate.status.toUpperCase()}` : "No active debate"}
                </p>
                {activeDebate && (
                  <p className="text-sm font-semibold text-[#1a1714] truncate">
                    "{activeDebate.topic}"
                  </p>
                )}
                {activeDebate && (
                  <p className="text-xs text-[#5a534d] mt-0.5">
                    {AGENTS[activeDebate.agent_a_id]?.emoji} {AGENTS[activeDebate.agent_a_id]?.name}
                    {" "}vs{" "}
                    {AGENTS[activeDebate.agent_b_id]?.emoji} {AGENTS[activeDebate.agent_b_id]?.name}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={fetchActive}
                  disabled={loadingActive}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-[#e0d9ce] text-[#5a534d] hover:text-[#1a1714] transition-colors disabled:opacity-40"
                >
                  ↻
                </button>
                {activeDebate && !confirmDelete && (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all"
                    style={{ background: "#fee2e2", color: "#d93b1f" }}
                  >
                    Hapus Debat
                  </button>
                )}
                {activeDebate && confirmDelete && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#d93b1f] font-medium">Yakin?</span>
                    <button
                      onClick={deleteActive}
                      disabled={loadingActive}
                      className="text-xs font-bold px-3 py-1.5 rounded-lg disabled:opacity-50"
                      style={{ background: "#d93b1f", color: "#fff" }}
                    >
                      {loadingActive ? "..." : "Ya, Hapus"}
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="text-xs px-2.5 py-1.5 rounded-lg border border-[#e0d9ce] text-[#5a534d]"
                    >
                      Batal
                    </button>
                  </div>
                )}
              </div>
            </div>
            {deleteError && (
              <div className="px-5 pb-3 text-xs text-[#d93b1f]">Error: {deleteError}</div>
            )}
          </div>
        )}

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
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-[#8a8178]">Or custom topic</p>
                    <PolyPicker onSelect={(q, odds) => { setCustomTopic(q); setPolyOdds(odds); }} />
                  </div>
                  <input
                    type="text"
                    value={customTopic}
                    onChange={(e) => { setCustomTopic(e.target.value); setPolyOdds(null); }}
                    placeholder="e.g. ETH will hit $10k in 2025"
                    className={inputClass}
                  />
                  {polyOdds !== null && customTopic && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1 rounded-full bg-[#e0d9ce] overflow-hidden">
                        <div className="h-full rounded-full bg-[#16a34a]" style={{ width: `${polyOdds}%` }} />
                      </div>
                      <span className="text-[10px] font-bold text-[#16a34a]">{polyOdds}% YES on Polymarket</span>
                    </div>
                  )}
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
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-[#8a8178]">Or custom topic</p>
                    <PolyPicker onSelect={(q, odds) => { setSCustomTopic(q); setSPolyOdds(odds); }} />
                  </div>
                  <input
                    type="text"
                    value={sCustomTopic}
                    onChange={(e) => { setSCustomTopic(e.target.value); setSPolyOdds(null); }}
                    placeholder="e.g. ETH will hit $10k in 2025"
                    className={inputClass}
                  />
                  {sPolyOdds !== null && sCustomTopic && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1 rounded-full bg-[#e0d9ce] overflow-hidden">
                        <div className="h-full rounded-full bg-[#16a34a]" style={{ width: `${sPolyOdds}%` }} />
                      </div>
                      <span className="text-[10px] font-bold text-[#16a34a]">{sPolyOdds}% YES on Polymarket</span>
                    </div>
                  )}
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
