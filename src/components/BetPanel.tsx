"use client";

import { FC } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { BET_AMOUNTS, BetAmount, WIN_MULTIPLIER } from "@/lib/solana";
import { Agent } from "@/lib/agents";

interface Props {
  agentA: Agent;
  agentB: Agent;
  selectedAgentId: string | null;
  selectedAmount: BetAmount | null;
  onSelectAgent: (id: string) => void;
  onSelectAmount: (amount: BetAmount) => void;
}

const BetPanel: FC<Props> = ({
  agentA,
  agentB,
  selectedAgentId,
  selectedAmount,
  onSelectAgent,
  onSelectAmount,
}) => {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();

  const payout =
    selectedAmount ? (selectedAmount * WIN_MULTIPLIER).toFixed(3) : null;

  return (
    <div className="bg-white border border-[#e0d9ce] rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold tracking-[2px] uppercase text-[#8a8178]">
          Place a Bet
        </p>
        <span className="text-[10px] px-2 py-1 rounded-full font-mono" style={{ background: "#fef9c3", color: "#854d0e" }}>
          devnet
        </span>
      </div>

      {!connected ? (
        <button
          onClick={() => setVisible(true)}
          className="w-full py-3 text-sm font-medium text-[#8a8178] border border-dashed border-[#e0d9ce] rounded-xl hover:border-[#c0b8ad] transition-all"
        >
          Connect wallet to bet
        </button>
      ) : (
        <>
          {/* Pick agent */}
          <div>
            <p className="text-[10px] text-[#8a8178] mb-2 uppercase tracking-wider">Bet on</p>
            <div className="grid grid-cols-2 gap-2">
              {[agentA, agentB].map((agent, i) => {
                const color = i === 0 ? "#d93b1f" : "#1a52e8";
                const selected = selectedAgentId === agent.id;
                return (
                  <button
                    key={agent.id}
                    onClick={() => onSelectAgent(agent.id)}
                    className="flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all"
                    style={{
                      borderColor: selected ? color : "#e0d9ce",
                      background: selected ? `${color}08` : "#f7f3ec",
                      color: selected ? color : "#1a1714",
                    }}
                  >
                    <span className="text-lg">{agent.emoji}</span>
                    <span className="text-xs font-bold truncate">{agent.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Pick amount */}
          <div>
            <p className="text-[10px] text-[#8a8178] mb-2 uppercase tracking-wider">Amount</p>
            <div className="flex gap-2">
              {BET_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  onClick={() => onSelectAmount(amt)}
                  className="flex-1 py-2 rounded-xl border text-sm font-mono font-medium transition-all"
                  style={{
                    borderColor: selectedAmount === amt ? "#1a1714" : "#e0d9ce",
                    background: selectedAmount === amt ? "#1a1714" : "#f7f3ec",
                    color: selectedAmount === amt ? "#f7f3ec" : "#1a1714",
                  }}
                >
                  {amt} SOL
                </button>
              ))}
            </div>
          </div>

          {/* Payout preview */}
          {selectedAgentId && selectedAmount && (
            <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-[#f7f3ec] border border-[#e0d9ce]">
              <span className="text-xs text-[#8a8178]">Potential win</span>
              <span className="text-sm font-mono font-bold text-[#16a34a]">
                +{payout} SOL
              </span>
            </div>
          )}

          {!selectedAgentId && (
            <p className="text-[10px] text-[#8a8178] text-center">
              Bet is optional — skip to just watch
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default BetPanel;
