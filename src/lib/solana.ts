import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { WalletContextState } from "@solana/wallet-adapter-react";

export const BET_AMOUNTS = [0.01, 0.05, 0.1] as const;
export type BetAmount = (typeof BET_AMOUNTS)[number];

// Multiplier applied to winner's bet (simulated until smart contract)
export const WIN_MULTIPLIER = 1.8;

export async function sendBetTransaction(
  connection: Connection,
  wallet: WalletContextState,
  amountSol: BetAmount
): Promise<string> {
  const treasury = process.env.NEXT_PUBLIC_TREASURY_WALLET;
  if (!treasury) throw new Error("Treasury wallet not configured");
  if (!wallet.publicKey || !wallet.sendTransaction)
    throw new Error("Wallet not connected");

  const toPubkey = new PublicKey(treasury);
  const lamports = Math.round(amountSol * LAMPORTS_PER_SOL);

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey,
      lamports,
    })
  );

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = wallet.publicKey;

  const signature = await wallet.sendTransaction(transaction, connection);

  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed"
  );

  return signature;
}

export function explorerUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}
