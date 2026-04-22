export type Topic = {
  id: string
  title: string
  category: string
}

export const TOPICS: Topic[] = [
  // Crypto & Markets
  { id: 't1',  title: 'Bitcoin will hit $1M before 2028',                    category: 'Price' },
  { id: 't2',  title: 'Solana will flip Ethereum in market cap by 2027',      category: 'L1' },
  { id: 't3',  title: 'The next crypto bull run peaks before end of 2025',    category: 'Market' },
  { id: 't4',  title: 'Altcoins are dead — BTC dominance goes above 70%',     category: 'Market' },
  { id: 't5',  title: 'Stablecoins will replace dollar in emerging markets',  category: 'DeFi' },

  // AI & Tech
  { id: 't6',  title: 'AI agents will replace crypto traders by 2026',        category: 'AI' },
  { id: 't7',  title: 'AGI will be achieved before Bitcoin halving 2028',     category: 'AI' },
  { id: 't8',  title: 'On-chain AI is the next 100x narrative',               category: 'AI' },
  { id: 't9',  title: 'Vibe coding will make traditional devs obsolete',      category: 'Tech' },

  // DeFi & Regulation
  { id: 't10', title: 'DeFi will be fully regulated within 2 years',          category: 'Regulation' },
  { id: 't11', title: 'Crypto regulation is the best thing for the space',    category: 'Regulation' },
  { id: 't12', title: 'DeFi TVL will surpass traditional finance by 2030',    category: 'DeFi' },
  { id: 't13', title: 'Layer 2s are just band-aids on a broken base layer',   category: 'Tech' },

  // Culture & Memes
  { id: 't14', title: 'Meme coins have more real utility than most L1s',      category: 'Meme' },
  { id: 't15', title: 'NFTs will make a massive comeback in 2025',            category: 'NFT' },
  { id: 't16', title: 'Crypto Twitter influences markets more than macro',    category: 'Culture' },
  { id: 't17', title: 'The next generation of users will enter via gaming',   category: 'Culture' },

  // Macro & Geopolitics
  { id: 't18', title: 'A nation-state will adopt Bitcoin as reserve asset in 2025', category: 'Macro' },
  { id: 't19', title: 'The US will launch a strategic Bitcoin reserve',        category: 'Macro' },
  { id: 't20', title: 'A global recession will trigger crypto adoption surge', category: 'Macro' },
]

export function getRandomTopic(): Topic {
  return TOPICS[Math.floor(Math.random() * TOPICS.length)]
}

export function getTopicById(id: string): Topic | undefined {
  return TOPICS.find(t => t.id === id)
}
