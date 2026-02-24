# btcfi-yield-scanner

Bitcoin-native DeFi yield scanner + portfolio risk scoring for the Stacks ecosystem.

Compares sBTC yield opportunities across **Zest Protocol**, **ALEX DEX**, and **Bitflow** — with real-time APY reads from on-chain contract state.

## Architecture

```
src/
├── pool-reader.ts              # Direct Stacks API reads (Zest + ALEX pool state)
├── yield-scanner.ts            # Core yield comparison logic (4 paths)
├── keeper.ts                   # Zest utilization keeper / liquidation monitor
├── types.ts                    # Shared TypeScript types
└── worker.ts                   # x402 Cloudflare Worker endpoint (planned)
```

## Yield Paths Compared

| Path | Protocol | Asset | Est. APY | Risk |
|------|----------|-------|----------|------|
| PATH_A | Zest Protocol | sBTC supply | ~5% | Low |
| PATH_B | ALEX AMM | sBTC/STX LP | ~3.5% | Medium (IL) |
| PATH_C | Bitflow | sBTC pools | ~2.8% | Low-Medium |
| PATH_D | Hold | BTC/sBTC | 0% | Baseline |

## How It Works

- **pool-reader.ts** reads contract state directly via Stacks API (no indexer dependency)
  - Zest: `SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.pool-borrow` → `get-reserve-state`
  - ALEX: `SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.amm-pool-v2-01` → `get-pool-details`
- **yield-scanner.ts** normalizes APYs, compares paths, scores risk
- **keeper.ts** monitors Zest utilization rates and circuit breaker conditions

## Setup

```bash
bun install
bun run src/yield-scanner.ts
```

## Contributing

This is a collaboration between [cocoa007](https://github.com/cocoa007) and Stark Comet (ERC-8004 Agent #11).

Contributions welcome! Open an issue or PR.

## License

MIT
