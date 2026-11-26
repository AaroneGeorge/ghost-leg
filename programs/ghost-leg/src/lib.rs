//! Ghost Leg — a real-time amidakuji (ladder lottery) brawl.
//!
//! Lifecycle
//!   base layer : create_game -> join (xN) -> delegate_game
//!   ER         : start (VRF #1: prize layout) -> add_rung (xMany, free) ->
//!                finish (VRF #2: anti-snipe cut-off) -> settle_and_undelegate
//!   base layer : payout
//!
//! Every lamport stays inside the game PDA until `payout`; the ER only
//! changes accounting, so nothing moves lamports while the account is delegated.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::{
    anchor::{commit, delegate, ephemeral, vrf, vrf_callback},
    cpi::DelegateConfig,
    ephem::MagicIntentBundleBuilder,
    vrf::{
        self as mbvrf,
        consts::program_identity_pubkey,
        instructions::{create_request_randomness_ix_const, RequestRandomnessParams},
        types::SerializableAccountMeta,
    },
};

declare_id!("DhS45bjZe13UqRbdoJZx5WK8rxmhG5VspmAUZU9F2yG8");

pub const GAME_SEED: &[u8] = b"ghostleg";
pub const MAX_PLAYERS: usize = 6;
pub const MAX_RUNGS: usize = 1200;
/// The VRF cut-off lands somewhere inside this many final seconds of the round.
pub const SNIPE_WINDOW_SECS: u16 = 15;
/// Lamports sent to each player's session key so it can sign ER transactions.
pub const SESSION_FUND_LAMPORTS: u64 = 2_000_000;

const PROGRAM_IDENTITY: Pubkey = program_identity_pubkey(&crate::ID);
/// Scoped VRF identity that signs our callbacks, computed at compile time.
/// (SDK 0.18.0's `#[vrf_callback]` evaluates this const fn at runtime, which hashes the PDA in
/// software and exhausts the callback's compute budget, so we declare the field ourselves.)
const VRF_CALLBACK_IDENTITY: Pubkey =
    Pubkey::new_from_array(mbvrf::consts::scoped_vrf_identity_const(&crate::ID).0);

pub mod status {
    pub const LOBBY: u8 = 0;
    pub const DRAWING: u8 = 1; // VRF #1 pending
    pub const LIVE: u8 = 2;
    pub const CUTTING: u8 = 3; // VRF #2 pending
    pub const SETTLED: u8 = 4;
    pub const PAID: u8 = 5;
}

#[ephemeral]
#[program]
pub mod ghost_leg {
    use super::*;

    // ───────────────────────── base layer ─────────────────────────

    pub fn create_game(
        ctx: Context<CreateGame>,
        game_id: u64,
        stake: u64,
        rung_price: u64,
        rung_budget: u16,
        duration_secs: u16,
    ) -> Result<()> {
        require!(stake > 0, GhostLegError::BadConfig);
        require!(rung_budget > 0 && (rung_budget as usize) <= MAX_RUNGS, GhostLegError::BadConfig);
        require!(
            duration_secs > SNIPE_WINDOW_SECS && duration_secs <= 600,
            GhostLegError::BadConfig
        );
        let g = &mut ctx.accounts.game;
        g.host = ctx.accounts.host.key();
        g.game_id = game_id;
        g.status = status::LOBBY;
        g.stake = stake;
        g.rung_price = rung_price;
        g.rung_budget = rung_budget;
        g.duration_secs = duration_secs;
        g.n_players = 0;
        g.players = [PlayerSlot::default(); MAX_PLAYERS];
        g.prize_bps = [0; MAX_PLAYERS];
        g.ends = [0, 1, 2, 3, 4, 5];
        g.start_ts = 0;
        g.end_ts = 0;
        g.cutoff = 0;
        g.start_randomness = [0; 32];
        g.cut_randomness = [0; 32];
        g.pot = 0;
        g.rungs = Vec::new();
        Ok(())
    }

    pub fn join(ctx: Context<Join>, session: Pubkey) -> Result<()> {
        require_keys_eq!(ctx.accounts.session_key.key(), session, GhostLegError::BadSession);
        let game_info = ctx.accounts.game.to_account_info();
        let player_info = ctx.accounts.player.to_account_info();
        let session_info = ctx.accounts.session_key.to_account_info();
        let system_key = ctx.accounts.system_program.key();
        let g = &mut ctx.accounts.game;
        require!(g.status == status::LOBBY, GhostLegError::WrongStatus);
        let n = g.n_players as usize;
        require!(n < MAX_PLAYERS, GhostLegError::GameFull);
        let wallet = ctx.accounts.player.key();
        for p in g.players[..n].iter() {
            require!(p.wallet != wallet, GhostLegError::AlreadyJoined);
            require!(p.session != session, GhostLegError::AlreadyJoined);
        }
        let deposit = g
            .stake
            .checked_add(
                g.rung_price
                    .checked_mul(g.rung_budget as u64)
                    .ok_or(GhostLegError::Overflow)?,
            )
            .ok_or(GhostLegError::Overflow)?;

        g.players[n] = PlayerSlot {
            wallet,
            session,
            rungs_used: 0,
            payout: 0,
        };
        g.n_players += 1;

        // deposit -> game PDA
        anchor_lang::system_program::transfer(
            CpiContext::new(
                system_key,
                anchor_lang::system_program::Transfer {
                    from: player_info.clone(),
                    to: game_info,
                },
            ),
            deposit,
        )?;
        // small float so the session key can sign on the ER
        anchor_lang::system_program::transfer(
            CpiContext::new(
                system_key,
                anchor_lang::system_program::Transfer {
                    from: player_info,
                    to: session_info,
                },
            ),
            SESSION_FUND_LAMPORTS,
        )?;
        Ok(())
    }

    /// Host hands the game to the ephemeral rollup. Optional remaining account: validator identity.
    pub fn delegate_game(ctx: Context<DelegateGame>, game_id: u64) -> Result<()> {
        {
            let data = ctx.accounts.game.try_borrow_data()?;
            let g = Game::try_deserialize(&mut &data[..])?;
            require_keys_eq!(g.host, ctx.accounts.host.key(), GhostLegError::NotHost);
            require!(g.status == status::LOBBY, GhostLegError::WrongStatus);
            require!(g.n_players >= 2, GhostLegError::NotEnoughPlayers);
        }
        ctx.accounts.delegate_game(
            &ctx.accounts.host,
            &[GAME_SEED, ctx.accounts.host.key().as_ref(), &game_id.to_le_bytes()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|a| a.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    /// Host closes an unstarted table: every player gets their full deposit back.
    /// remaining_accounts = player wallets, in join order.
    pub fn cancel(ctx: Context<Cancel>) -> Result<()> {
        let game_info = ctx.accounts.game.to_account_info();
        let g = &mut ctx.accounts.game;
        require!(g.status == status::LOBBY, GhostLegError::WrongStatus);
        let n = g.n_players as usize;
        require!(ctx.remaining_accounts.len() == n, GhostLegError::BadAccounts);
        let deposit = g.stake + g.rung_price * g.rung_budget as u64;
        for (i, acc) in ctx.remaining_accounts.iter().enumerate() {
            require_keys_eq!(acc.key(), g.players[i].wallet, GhostLegError::BadAccounts);
            **game_info.try_borrow_mut_lamports()? -= deposit;
            **acc.try_borrow_mut_lamports()? += deposit;
        }
        g.status = status::PAID;
        Ok(())
    }

    // ───────────────────────── ephemeral rollup ─────────────────────────

    /// Any player (wallet or session key) asks VRF for the prize layout.
    pub fn start(ctx: Context<RequestVrf>, client_seed: u8) -> Result<()> {
        {
            let payer = ctx.accounts.payer.key();
            let g = &mut ctx.accounts.game;
            // DRAWING is allowed again so a lost VRF request can be re-sent; the first callback wins.
            require!(g.status == status::LOBBY || g.status == status::DRAWING, GhostLegError::WrongStatus);
            require!(g.is_member(&payer), GhostLegError::NotPlayer);
            g.status = status::DRAWING;
        }
        let disc = instruction::StartCallback::DISCRIMINATOR.to_vec();
        request_vrf(&ctx, disc, client_seed)
    }

    pub fn start_callback(ctx: Context<VrfCallback>, randomness: [u8; 32]) -> Result<()> {
        let g = &mut ctx.accounts.game;
        require!(g.status == status::DRAWING, GhostLegError::WrongStatus); // idempotent
        let n = g.n_players as usize;
        let mut shares = prize_table(n);
        // Fisher–Yates over the prize slots, driven by VRF bytes.
        for i in (1..n).rev() {
            let j = (u16::from_le_bytes([randomness[i * 2], randomness[i * 2 + 1]]) as usize) % (i + 1);
            shares.swap(i, j);
        }
        g.prize_bps = shares;
        g.start_randomness = randomness;
        let now = Clock::get()?.unix_timestamp;
        g.start_ts = now;
        // Musical chairs: the music stops at a VRF-chosen second inside the danger zone (the last
        // SNIPE_WINDOW_SECS of the advertised duration). Bytes 20..22 are unused by the prize shuffle.
        let jitter = (u16::from_le_bytes([randomness[20], randomness[21]]) % (SNIPE_WINDOW_SECS + 1)) as i64;
        g.end_ts = now + (g.duration_secs - SNIPE_WINDOW_SECS) as i64 + jitter;
        g.status = status::LIVE;
        msg!("ghostleg: music stops at {} (+{}s into the danger zone)", g.end_ts, jitter);
        Ok(())
    }

    /// The frenzy: a rung between column `gap` and `gap + 1`, appended at the bottom.
    pub fn add_rung(ctx: Context<AddRung>, gap: u8) -> Result<()> {
        let g = &mut ctx.accounts.game;
        require!(g.status == status::LIVE, GhostLegError::WrongStatus);
        let now = Clock::get()?.unix_timestamp;
        require!(now <= g.end_ts, GhostLegError::RoundOver);
        let n = g.n_players as usize;
        require!((gap as usize) + 1 < n, GhostLegError::BadGap);
        require!(g.rungs.len() < MAX_RUNGS, GhostLegError::LadderFull);
        let signer = ctx.accounts.signer.key();
        let idx = g.players[..n]
            .iter()
            .position(|p| p.session == signer || p.wallet == signer)
            .ok_or(GhostLegError::NotPlayer)?;
        require!(
            g.players[idx].rungs_used < g.rung_budget,
            GhostLegError::OutOfRungs
        );
        g.players[idx].rungs_used += 1;
        let t = (now - g.start_ts).clamp(0, u16::MAX as i64) as u16;
        g.rungs.push(Rung {
            gap,
            player: idx as u8,
            t,
        });
        g.ends.swap(gap as usize, gap as usize + 1);
        Ok(())
    }

    /// After the bell, anyone in the game asks VRF where the ladder gets cut.
    pub fn finish(ctx: Context<RequestVrf>, client_seed: u8) -> Result<()> {
        {
            let payer = ctx.accounts.payer.key();
            let g = &mut ctx.accounts.game;
            // CUTTING is allowed again so a lost VRF request can be re-sent; the first callback wins.
            require!(g.status == status::LIVE || g.status == status::CUTTING, GhostLegError::WrongStatus);
            require!(g.is_member(&payer), GhostLegError::NotPlayer);
            let now = Clock::get()?.unix_timestamp;
            require!(now > g.end_ts, GhostLegError::RoundNotOver);
            g.status = status::CUTTING;
        }
        let disc = instruction::FinishCallback::DISCRIMINATOR.to_vec();
        request_vrf(&ctx, disc, client_seed)
    }

    pub fn finish_callback(ctx: Context<VrfCallback>, randomness: [u8; 32]) -> Result<()> {
        let g = &mut ctx.accounts.game;
        require!(g.status == status::CUTTING, GhostLegError::WrongStatus); // idempotent
        let n = g.n_players as usize;
        let window_start = g.duration_secs.saturating_sub(SNIPE_WINDOW_SECS);
        let k0 = g.rungs.iter().position(|r| r.t >= window_start).unwrap_or(g.rungs.len());
        let k1 = g.rungs.len();
        let r = u64::from_le_bytes(randomness[..8].try_into().unwrap());
        let cutoff = k0 + (r % ((k1 - k0 + 1) as u64)) as usize;

        // Replay only the rungs that survive the cut.
        let mut ends: [u8; MAX_PLAYERS] = [0, 1, 2, 3, 4, 5];
        for rung in g.rungs[..cutoff].iter() {
            ends.swap(rung.gap as usize, rung.gap as usize + 1);
        }

        // pot = stakes + every rung bought (voided ones included: you paid for them)
        let mut pot: u64 = g.stake.checked_mul(n as u64).ok_or(GhostLegError::Overflow)?;
        for p in g.players[..n].iter() {
            pot = pot
                .checked_add(g.rung_price.checked_mul(p.rungs_used as u64).ok_or(GhostLegError::Overflow)?)
                .ok_or(GhostLegError::Overflow)?;
        }
        let mut paid: u64 = 0;
        let mut winner_slot_player: usize = 0;
        let mut best_bps: u16 = 0;
        for slot in 0..n {
            let player = ends[slot] as usize;
            let share = (pot as u128 * g.prize_bps[slot] as u128 / 10_000) as u64;
            let refund = g.rung_price * (g.rung_budget - g.players[player].rungs_used) as u64;
            g.players[player].payout = share + refund;
            paid += share;
            if g.prize_bps[slot] > best_bps {
                best_bps = g.prize_bps[slot];
                winner_slot_player = player;
            }
        }
        // rounding dust goes to the top prize
        g.players[winner_slot_player].payout += pot - paid;

        g.ends = ends;
        g.cutoff = cutoff as u16;
        g.cut_randomness = randomness;
        g.pot = pot;
        g.status = status::SETTLED;
        msg!("ghostleg: cut at rung {} of {} (window from {})", cutoff, k1, k0);
        Ok(())
    }

    /// Commit the settled game back to Solana and release the delegation.
    pub fn settle_and_undelegate(ctx: Context<SettleAndUndelegate>) -> Result<()> {
        require!(ctx.accounts.game.status == status::SETTLED, GhostLegError::WrongStatus);
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.game.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    // ───────────────────────── base layer again ─────────────────────────

    /// Pays every player from the game PDA. remaining_accounts = player wallets, in join order.
    pub fn payout(ctx: Context<Payout>) -> Result<()> {
        let game_info = ctx.accounts.game.to_account_info();
        let g = &mut ctx.accounts.game;
        require!(g.status == status::SETTLED, GhostLegError::WrongStatus);
        let n = g.n_players as usize;
        require!(ctx.remaining_accounts.len() == n, GhostLegError::BadAccounts);
        for (i, acc) in ctx.remaining_accounts.iter().enumerate() {
            require_keys_eq!(acc.key(), g.players[i].wallet, GhostLegError::BadAccounts);
            let amt = g.players[i].payout;
            if amt > 0 {
                **game_info.try_borrow_mut_lamports()? -= amt;
                **acc.try_borrow_mut_lamports()? += amt;
            }
        }
        g.status = status::PAID;
        Ok(())
    }
}

fn request_vrf(ctx: &Context<RequestVrf>, callback_discriminator: Vec<u8>, client_seed: u8) -> Result<()> {
    let mut caller_seed = ctx.accounts.game.key().to_bytes();
    caller_seed[0] ^= client_seed;
    caller_seed[31] ^= ctx.accounts.game.status;
    let ix = create_request_randomness_ix_const(
        RequestRandomnessParams {
            payer: ctx.accounts.payer.key(),
            oracle_queue: ctx.accounts.oracle_queue.key(),
            callback_program_id: crate::ID,
            callback_discriminator,
            caller_seed,
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey: ctx.accounts.game.key(),
                is_signer: false,
                is_writable: true,
            }]),
            ..Default::default()
        },
        PROGRAM_IDENTITY,
    );
    ctx.accounts
        .invoke_signed_vrf(&ctx.accounts.payer.to_account_info(), &ix)?;
    Ok(())
}

/// Prize shares in basis points by player count (slot order is shuffled by VRF).
fn prize_table(n: usize) -> [u16; MAX_PLAYERS] {
    match n {
        2 => [10_000, 0, 0, 0, 0, 0],
        3 => [7_000, 3_000, 0, 0, 0, 0],
        4 => [6_000, 3_000, 1_000, 0, 0, 0],
        _ => [5_000, 3_000, 2_000, 0, 0, 0],
    }
}

// ───────────────────────── accounts ─────────────────────────

#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct CreateGame<'info> {
    #[account(mut)]
    pub host: Signer<'info>,
    #[account(
        init,
        payer = host,
        space = Game::SPACE,
        seeds = [GAME_SEED, host.key().as_ref(), &game_id.to_le_bytes()],
        bump
    )]
    pub game: Account<'info, Game>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Join<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(mut, seeds = [GAME_SEED, game.host.as_ref(), &game.game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
    /// CHECK: the session key being funded; must equal the `session` argument.
    #[account(mut)]
    pub session_key: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(game_id: u64)]
pub struct DelegateGame<'info> {
    #[account(mut)]
    pub host: Signer<'info>,
    /// CHECK: the game PDA to delegate; checked against seeds and deserialized in the handler.
    #[account(mut, del, seeds = [GAME_SEED, host.key().as_ref(), &game_id.to_le_bytes()], bump)]
    pub game: UncheckedAccount<'info>,
}

#[vrf]
#[derive(Accounts)]
pub struct RequestVrf<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [GAME_SEED, game.host.as_ref(), &game.game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
    /// CHECK: must be the ephemeral (delegated) VRF queue, since this runs on the ER.
    #[account(mut, address = mbvrf::consts::DEFAULT_EPHEMERAL_QUEUE)]
    pub oracle_queue: UncheckedAccount<'info>,
}

#[vrf_callback]
#[derive(Accounts)]
pub struct VrfCallback<'info> {
    #[account(address = VRF_CALLBACK_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    #[account(mut)]
    pub game: Account<'info, Game>,
}

#[derive(Accounts)]
pub struct AddRung<'info> {
    pub signer: Signer<'info>,
    #[account(mut, seeds = [GAME_SEED, game.host.as_ref(), &game.game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
}

#[commit]
#[derive(Accounts)]
pub struct SettleAndUndelegate<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [GAME_SEED, game.host.as_ref(), &game.game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
}

#[derive(Accounts)]
pub struct Cancel<'info> {
    #[account(address = game.host @ GhostLegError::NotHost)]
    pub host: Signer<'info>,
    #[account(mut, seeds = [GAME_SEED, game.host.as_ref(), &game.game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
}

#[derive(Accounts)]
pub struct Payout<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [GAME_SEED, game.host.as_ref(), &game.game_id.to_le_bytes()], bump)]
    pub game: Account<'info, Game>,
}

// ───────────────────────── state ─────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct PlayerSlot {
    pub wallet: Pubkey,
    pub session: Pubkey,
    pub rungs_used: u16,
    pub payout: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct Rung {
    pub gap: u8,
    pub player: u8,
    /// seconds since the round started
    pub t: u16,
}

#[account]
pub struct Game {
    pub host: Pubkey,
    pub game_id: u64,
    pub status: u8,
    pub stake: u64,
    pub rung_price: u64,
    pub rung_budget: u16,
    pub duration_secs: u16,
    pub n_players: u8,
    pub players: [PlayerSlot; MAX_PLAYERS],
    /// prize share (bps) sitting at the bottom of each slot
    pub prize_bps: [u16; MAX_PLAYERS],
    /// ends[slot] = player index whose path currently lands on that slot
    pub ends: [u8; MAX_PLAYERS],
    pub start_ts: i64,
    pub end_ts: i64,
    pub cutoff: u16,
    pub start_randomness: [u8; 32],
    pub cut_randomness: [u8; 32],
    pub pot: u64,
    pub rungs: Vec<Rung>,
}

impl Game {
    pub const SPACE: usize = 8 // discriminator
        + 32 + 8 + 1 + 8 + 8 + 2 + 2 + 1
        + MAX_PLAYERS * (32 + 32 + 2 + 8)
        + MAX_PLAYERS * 2
        + MAX_PLAYERS
        + 8 + 8 + 2 + 32 + 32 + 8
        + 4 + MAX_RUNGS * 4;

    pub fn is_member(&self, key: &Pubkey) -> bool {
        self.players[..self.n_players as usize]
            .iter()
            .any(|p| p.wallet == *key || p.session == *key)
    }
}

#[error_code]
pub enum GhostLegError {
    #[msg("Bad game config")]
    BadConfig,
    #[msg("Wrong game status for this action")]
    WrongStatus,
    #[msg("Game is full")]
    GameFull,
    #[msg("Wallet or session already joined")]
    AlreadyJoined,
    #[msg("Session account does not match")]
    BadSession,
    #[msg("Only the host can do this")]
    NotHost,
    #[msg("Need at least two players")]
    NotEnoughPlayers,
    #[msg("Signer is not a player in this game")]
    NotPlayer,
    #[msg("Round is over")]
    RoundOver,
    #[msg("Round is still running")]
    RoundNotOver,
    #[msg("Rung gap out of range")]
    BadGap,
    #[msg("Ladder is full")]
    LadderFull,
    #[msg("No rungs left in your budget")]
    OutOfRungs,
    #[msg("Remaining accounts do not match players")]
    BadAccounts,
    #[msg("Arithmetic overflow")]
    Overflow,
}
