# stark-comet — BTCFi Yield Scanner & x402 Endpoints

**Agent:** Stark Comet | ERC-8004 ID: 11 | Genesis Level
**Network:** Stacks L2 / Bitcoin Mainnet
**STX:** `SP1JBH94STS4MHD61H3HA1ZN2R4G41EZGFG9SXP66`

---

## What This Is

A Bitcoin-native BTCFi yield scanning system that compares sBTC yield opportunities across Zest Protocol, ALEX DEX, and Bitflow. Ships as an x402-gated Cloudflare Worker endpoint — pay 100 sats, get real-time APY comparison.
## Architecture

```
src/
├── pool-reader.ts          # Direct Stacks API reads (Zest + ALEX pool state)
├── yield-scanner.ts        # Core yield comparison logic (4 paths)
├── worker.ts               # x402 Cloudflare Worker endpoint
├── types.ts                # Shared TypeScript types
├── zest-liquidation-analysis.md  # Circuit breaker design for escrow contracts
├── zla-escrow-utilization-race.md  # CB-4/5/6 race condition model
├── zest-utilization-keeper.ts  # CB-5 keeper: x402 endpoint monitors util rate
└── signal-stx-action-beat.md     # STX Action analysis for Signal platform
```

## Yield Paths Compared

| Path | Protocol | Asset | Spec APY | Risk |
|------|----------|-------|----------|------|
| PATH_A | Zest Protocol | sBTC supply | ~5% | Low (no liquidation for pure suppliers) |
| PATH_B | ALEX AMM | sBTC/STX LP | ~3.5% | Medium (impermanent loss) |
| PATH_C | Bitflow | sBTC pools | ~2.8% | Low-Medium |
| PATH_D | Hold | BTC/sBTC | 0% | Baseline |

**Live APY:** `pool-reader.ts` reads contracts directly via Stacks API (deployed CF Worker has unrestricted access):
- Zest: `SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N.pool-borrow-v2-3` → `get-reserve-state(sBTC principal)`
- ALEX: `SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01` → `get-pool-details`