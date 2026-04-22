use anchor_lang::prelude::*;

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

// ── Program ──────────────────────────────────────────────────

#[program]
pub mod agent_duel {
    use super::*;

    /// Create a new debate + vault escrow on-chain.
    pub fn create_debate(
        ctx: Context<CreateDebate>,
        debate_id: String,
        agent_a_id: String,
        agent_b_id: String,
    ) -> Result<()> {
        require!(debate_id.len() <= 32, DuelError::StringTooLong);
        require!(agent_a_id.len() <= 32, DuelError::StringTooLong);
        require!(agent_b_id.len() <= 32, DuelError::StringTooLong);

        let debate = &mut ctx.accounts.debate;
        debate.authority    = ctx.accounts.authority.key();
        debate.debate_id    = debate_id;
        debate.agent_a_id   = agent_a_id;
        debate.agent_b_id   = agent_b_id;
        debate.pool_a       = 0;
        debate.pool_b       = 0;
        debate.distributable = 0;
        debate.winner       = 0; // 0=open  1=A wins  2=B wins
        debate.resolved     = false;
        debate.bump         = ctx.bumps.debate;

        let vault = &mut ctx.accounts.vault;
        vault.bump = ctx.bumps.vault;

        Ok(())
    }

    /// User places a SOL bet into the escrow vault.
    /// side: 1 = Agent A, 2 = Agent B
    pub fn place_bet(
        ctx: Context<PlaceBet>,
        side: u8,
        amount: u64,
    ) -> Result<()> {
        require!(side == 1 || side == 2, DuelError::InvalidSide);
        require!(amount >= 10_000_000, DuelError::BetTooSmall); // min 0.01 SOL
        require!(!ctx.accounts.debate.resolved, DuelError::DebateResolved);

        // Move SOL bettor → vault
        anchor_lang::system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.bettor.to_account_info(),
                    to:   ctx.accounts.vault.to_account_info(),
                },
            ),
            amount,
        )?;

        let debate = &mut ctx.accounts.debate;
        if side == 1 {
            debate.pool_a = debate.pool_a.checked_add(amount).unwrap();
        } else {
            debate.pool_b = debate.pool_b.checked_add(amount).unwrap();
        }

        let bet = &mut ctx.accounts.bet;
        bet.bettor  = ctx.accounts.bettor.key();
        bet.debate  = ctx.accounts.debate.key();
        bet.side    = side;
        bet.amount  = amount;
        bet.claimed = false;
        bet.bump    = ctx.bumps.bet;

        Ok(())
    }

    /// Authority (app) sets the winner after voting is done.
    /// Takes 5% house cut from vault immediately.
    pub fn resolve_debate(
        ctx: Context<ResolveDebate>,
        winner_side: u8,
    ) -> Result<()> {
        require!(winner_side == 1 || winner_side == 2, DuelError::InvalidSide);
        require!(!ctx.accounts.debate.resolved, DuelError::DebateResolved);

        let debate    = &mut ctx.accounts.debate;
        let debate_id = debate.debate_id.clone();
        let total_pool = debate.pool_a.checked_add(debate.pool_b).unwrap();

        // 5% house cut → authority wallet
        let house_cut    = total_pool / 20;
        let distributable = total_pool.checked_sub(house_cut).unwrap();

        if house_cut > 0 {
            let vault_bump = ctx.accounts.vault.bump;
            let signer_seeds: &[&[&[u8]]] = &[&[b"vault", debate_id.as_bytes(), &[vault_bump]]];

            anchor_lang::system_program::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.system_program.to_account_info(),
                    anchor_lang::system_program::Transfer {
                        from: ctx.accounts.vault.to_account_info(),
                        to:   ctx.accounts.authority.to_account_info(),
                    },
                    signer_seeds,
                ),
                house_cut,
            )?;
        }

        debate.winner        = winner_side;
        debate.distributable = distributable;
        debate.resolved      = true;

        Ok(())
    }

    /// Winner claims their proportional share of the pool.
    /// Payout = (user_bet / winner_pool) * distributable
    pub fn claim_payout(ctx: Context<ClaimPayout>) -> Result<()> {
        let debate = &ctx.accounts.debate;
        let bet    = &ctx.accounts.bet;

        require!(debate.resolved,           DuelError::NotResolved);
        require!(!bet.claimed,              DuelError::AlreadyClaimed);
        require!(bet.side == debate.winner, DuelError::NotWinner);

        let winner_pool = if debate.winner == 1 {
            debate.pool_a
        } else {
            debate.pool_b
        };

        // Proportional payout (u128 to avoid overflow)
        let payout = (bet.amount as u128)
            .checked_mul(debate.distributable as u128)
            .unwrap()
            .checked_div(winner_pool as u128)
            .unwrap() as u64;

        let debate_id  = debate.debate_id.clone();
        let vault_bump = ctx.accounts.vault.bump;
        let signer_seeds: &[&[&[u8]]] = &[&[b"vault", debate_id.as_bytes(), &[vault_bump]]];

        anchor_lang::system_program::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.vault.to_account_info(),
                    to:   ctx.accounts.bettor.to_account_info(),
                },
                signer_seeds,
            ),
            payout,
        )?;

        ctx.accounts.bet.claimed = true;

        Ok(())
    }
}

// ── Account Contexts ─────────────────────────────────────────

#[derive(Accounts)]
#[instruction(debate_id: String)]
pub struct CreateDebate<'info> {
    #[account(
        init,
        payer = authority,
        space = Debate::SIZE,
        seeds = [b"debate", debate_id.as_bytes()],
        bump
    )]
    pub debate: Account<'info, Debate>,

    // Separate vault PDA that holds all SOL
    #[account(
        init,
        payer = authority,
        space = Vault::SIZE,
        seeds = [b"vault", debate_id.as_bytes()],
        bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(
        mut,
        seeds = [b"debate", debate.debate_id.as_bytes()],
        bump  = debate.bump
    )]
    pub debate: Account<'info, Debate>,

    #[account(
        mut,
        seeds = [b"vault", debate.debate_id.as_bytes()],
        bump  = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        init,
        payer = bettor,
        space = Bet::SIZE,
        seeds = [b"bet", debate.key().as_ref(), bettor.key().as_ref()],
        bump
    )]
    pub bet: Account<'info, Bet>,

    #[account(mut)]
    pub bettor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveDebate<'info> {
    #[account(
        mut,
        seeds    = [b"debate", debate.debate_id.as_bytes()],
        bump     = debate.bump,
        has_one  = authority
    )]
    pub debate: Account<'info, Debate>,

    #[account(
        mut,
        seeds = [b"vault", debate.debate_id.as_bytes()],
        bump  = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimPayout<'info> {
    #[account(
        seeds = [b"debate", debate.debate_id.as_bytes()],
        bump  = debate.bump
    )]
    pub debate: Account<'info, Debate>,

    #[account(
        mut,
        seeds = [b"vault", debate.debate_id.as_bytes()],
        bump  = vault.bump
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        seeds   = [b"bet", debate.key().as_ref(), bettor.key().as_ref()],
        bump    = bet.bump,
        has_one = bettor
    )]
    pub bet: Account<'info, Bet>,

    #[account(mut)]
    pub bettor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// ── State Accounts ────────────────────────────────────────────

#[account]
pub struct Debate {
    pub authority:     Pubkey,  // 32 — who can resolve
    pub debate_id:     String,  // 4+32
    pub agent_a_id:    String,  // 4+32
    pub agent_b_id:    String,  // 4+32
    pub pool_a:        u64,     // 8 — total SOL bet on A (lamports)
    pub pool_b:        u64,     // 8 — total SOL bet on B (lamports)
    pub distributable: u64,     // 8 — pool after house cut (set on resolve)
    pub winner:        u8,      // 1 — 0=open 1=A 2=B
    pub resolved:      bool,    // 1
    pub bump:          u8,      // 1
}

impl Debate {
    // 8 discriminator + fields + 64 padding
    pub const SIZE: usize = 8 + 32 + (4+32) + (4+32) + (4+32) + 8 + 8 + 8 + 1 + 1 + 1 + 64;
}

#[account]
pub struct Vault {
    pub bump: u8, // 1
}

impl Vault {
    pub const SIZE: usize = 8 + 1 + 64;
}

#[account]
pub struct Bet {
    pub bettor:  Pubkey, // 32
    pub debate:  Pubkey, // 32
    pub side:    u8,     // 1
    pub amount:  u64,    // 8
    pub claimed: bool,   // 1
    pub bump:    u8,     // 1
}

impl Bet {
    pub const SIZE: usize = 8 + 32 + 32 + 1 + 8 + 1 + 1 + 32;
}

// ── Errors ────────────────────────────────────────────────────

#[error_code]
pub enum DuelError {
    #[msg("Side must be 1 (Agent A) or 2 (Agent B)")]
    InvalidSide,
    #[msg("Minimum bet is 0.01 SOL")]
    BetTooSmall,
    #[msg("Debate is already resolved")]
    DebateResolved,
    #[msg("Debate has not been resolved yet")]
    NotResolved,
    #[msg("Payout already claimed")]
    AlreadyClaimed,
    #[msg("Your bet did not win")]
    NotWinner,
    #[msg("String must be 32 characters or less")]
    StringTooLong,
}
