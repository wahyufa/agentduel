import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import idl from "../../idl.json";

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID!
);

function getProgram(connection: Connection, wallet: WalletContextState) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provider = new AnchorProvider(connection, wallet as any, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new Program(idl as any, PROGRAM_ID, provider);
}

export function debatePDA(debateId: string): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("debate"), Buffer.from(debateId)],
    PROGRAM_ID
  );
  return pda;
}

export function vaultPDA(debateId: string): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), Buffer.from(debateId)],
    PROGRAM_ID
  );
  return pda;
}

export function betPDA(debate: PublicKey, bettor: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bet"), debate.toBuffer(), bettor.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function generateDebateId(): string {
  // Max 32 chars, unique per session
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export async function txCreateDebate(
  connection: Connection,
  wallet: WalletContextState,
  debateId: string,
  agentAId: string,
  agentBId: string
): Promise<string> {
  const program = getProgram(connection, wallet);
  return program.methods
    .createDebate(debateId, agentAId, agentBId)
    .accounts({
      debate: debatePDA(debateId),
      vault: vaultPDA(debateId),
      authority: wallet.publicKey!,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function txPlaceBet(
  connection: Connection,
  wallet: WalletContextState,
  debateId: string,
  side: 1 | 2,
  amountSol: number
): Promise<string> {
  const program = getProgram(connection, wallet);
  const debate = debatePDA(debateId);
  return program.methods
    .placeBet(side, new BN(Math.round(amountSol * LAMPORTS_PER_SOL)))
    .accounts({
      debate,
      vault: vaultPDA(debateId),
      bet: betPDA(debate, wallet.publicKey!),
      bettor: wallet.publicKey!,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function txResolveDebate(
  connection: Connection,
  wallet: WalletContextState,
  debateId: string,
  winnerSide: 1 | 2
): Promise<string> {
  const program = getProgram(connection, wallet);
  return program.methods
    .resolveDebate(winnerSide)
    .accounts({
      debate: debatePDA(debateId),
      vault: vaultPDA(debateId),
      authority: wallet.publicKey!,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function txClaimPayout(
  connection: Connection,
  wallet: WalletContextState,
  debateId: string
): Promise<string> {
  const program = getProgram(connection, wallet);
  const debate = debatePDA(debateId);
  return program.methods
    .claimPayout()
    .accounts({
      debate,
      vault: vaultPDA(debateId),
      bet: betPDA(debate, wallet.publicKey!),
      bettor: wallet.publicKey!,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
}
