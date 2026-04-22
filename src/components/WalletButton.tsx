"use client";

import { FC, useEffect, useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

const WalletButton: FC = () => {
  const { publicKey, disconnect, connected } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const [balance, setBalance] = useState<number | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!publicKey || !connection) {
      setBalance(null);
      return;
    }

    const fetchBalance = async () => {
      try {
        const lamports = await connection.getBalance(publicKey);
        setBalance(lamports / LAMPORTS_PER_SOL);
      } catch {
        setBalance(null);
      }
    };

    fetchBalance();
    const id = setInterval(fetchBalance, 30000);
    return () => clearInterval(id);
  }, [publicKey, connection]);

  if (!connected) {
    return (
      <button
        onClick={() => setVisible(true)}
        className="wallet-btn wallet-btn--connect"
      >
        Connect Wallet
      </button>
    );
  }

  const short = `${publicKey!.toBase58().slice(0, 4)}...${publicKey!.toBase58().slice(-4)}`;

  return (
    <div className="wallet-dropdown">
      <button
        onClick={() => setIsOpen((v) => !v)}
        className="wallet-btn wallet-btn--connected"
      >
        <span className="wallet-dot" />
        {short}
        {balance !== null && (
          <span className="wallet-balance">{balance.toFixed(3)} SOL</span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="wallet-overlay" onClick={() => setIsOpen(false)} />
          <div className="wallet-menu">
            <div className="wallet-menu-address">{publicKey!.toBase58()}</div>
            {balance !== null && (
              <div className="wallet-menu-balance">
                {balance.toFixed(4)} SOL
                <span className="wallet-menu-network">devnet</span>
              </div>
            )}
            <button
              onClick={() => { disconnect(); setIsOpen(false); }}
              className="wallet-menu-disconnect"
            >
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default WalletButton;
