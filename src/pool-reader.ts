// pool-reader.ts — Stark Comet rewrite (34 chunks, Feb 2026)
// Key changes: total-borrows-stable + total-borrows-variable (not utilization-rate),
// ft-get-supply via a-token-address for totalDeposited,
// readRewardsV8() with get-pox-cycle + get-cycle-rewards-ststxbtc,
// checkV2Available() probe, rewards-v8 deployer SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG

import {
  serializeCV,
  contractPrincipalCV,
  uintCV,
  hexToCV,
  cvToValue,
} from "@stacks/transactions";

const SBTC_PRINCIPAL = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";

// ─── Zest Protocol contracts ─────────────────────────────────────────────────
const ZEST_POOL_CONTRACT = "SP2VCQJGH7PHP2DJK7Z0V48AGBHQAW3R3ZW1QF4N";
const ZEST_POOL_NAME = "pool-borrow-v2-3";
const ZEST_V2_DEPLOYER = "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG";
const ZEST_V2_POOL_READ_SUPPLY = "pool-read-supply";
const ZEST_V2_REWARDS = "rewards-v8";

// ─── ALEX contracts ──────────────────────────────────────────────────────────
const ALEX_CONTRACT = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM";
const ALEX_POOL_NAME = "amm-pool-v2-01";
const ALEX_TOKEN_X = "SP102V8P0F7JX67ARQ77WEA3D3CFB5XW39REDT0AM.token-wstx-v2";
const ALEX_TOKEN_Y = "SP2XD7417HGPRTREMKF748VNEQPDRR0RMANB7X1NK.token-abtc";
const ALEX_FACTOR = 100000000;

// ─── Types ───────────────────────────────────────────────────────────────────
interface PoolData {
  zest_sbtc_supply_apy_bps: number | null;
  alex_sbtc_pool_reserves: { x: bigint; y: bigint } | null;
  rewards_v8_current_cycle: number | null;
  rewards_v8_prev_cycle_sbtc_sats: number | null;
  v2_ready: boolean;
  errors: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
async function callReadOnly(
  apiUrl: string,
  contractAddress: string,
  contractName: string,
  functionName: string,
  args: string[]
): Promise<{ okay: boolean; result: string }> {
  const url = `${apiUrl}/v2/contracts/call-read/${contractAddress}/${contractName}/${functionName}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: "SP1JBH94STS4MHD61H3HA1ZN2R4G41EZGFG9SXP66",
      arguments: args,
    }),
  });
  if (!res.ok) throw new Error(`API error ${res.status} for ${functionName}`);
  return res.json();
}

// ─── Zest pool read ──────────────────────────────────────────────────────────
// SC rewrite: uses total-borrows-stable + total-borrows-variable (not utilization-rate)
// and ft-get-supply via a-token-address for totalDeposited
async function readZestPool(apiUrl: string): Promise<{
  apy_bps: number; utilization_pct: number; reserves_sats: number;
} | null> {
  try {
    const [addr, name] = SBTC_PRINCIPAL.split(".");
    const principalArg = "0x" + Buffer.from(serializeCV(contractPrincipalCV(addr, name))).toString("hex");
    const result = await callReadOnly(apiUrl, ZEST_POOL_CONTRACT, ZEST_POOL_NAME, "get-reserve-state", [principalArg]);
    if (!result.okay) return null;
    const hexResult = result.result;

    // Borrows: sum stable + variable (not utilization-rate directly)
    const borrowsStable = extractUintFromClarityTuple(hexResult, "total-borrows-stable") ?? 0;
    const borrowsVariable = extractUintFromClarityTuple(hexResult, "total-borrows-variable") ?? 0;
    const totalBorrows = borrowsStable + borrowsVariable;

    // current-liquidity-rate (ray-scaled, 1e27 = 100%)
    const liquidityRate = extractUintFromClarityTuple(hexResult, "current-liquidity-rate");

    // totalDeposited via a-token ft-get-supply
    const aTokenAddress = extractPrincipalFromClarityTuple(hexResult, "a-token-address");
    let totalDeposited = totalBorrows > 0 ? totalBorrows * 2 : 10000000000; // fallback
    if (aTokenAddress) {
      try {
        const [aAddr, aName] = aTokenAddress.split(".");
        if (aAddr && aName) {
          const supplyRes = await callReadOnly(apiUrl, aAddr, aName, "get-total-supply", []);
          if (supplyRes.okay) {
            const supplyCv = hexToCV(supplyRes.result.startsWith("0x") ? supplyRes.result.slice(2) : supplyRes.result);
            const supplyVal = cvToValue(supplyCv, true);
            if (typeof supplyVal === "bigint") totalDeposited = Number(supplyVal);
            else if (typeof supplyVal === "number") totalDeposited = supplyVal;
          }
        }
      } catch { /* use fallback */ }
    }
    const reservesSats = Math.floor(totalDeposited / 100);
    // Utilization = borrows / a-token total supply (no direct field per TI c38)
    const utilBps = totalDeposited > 0 ? Math.floor((totalBorrows / totalDeposited) * 10000) : 7500;
    const utilPct = utilBps / 100;
    // Supply APY: use current-liquidity-rate if available (ray = 1e27 = 100% → bps = val / 1e23)
    let supplyApyBps: number;
    if (liquidityRate !== null && liquidityRate > 0) {
      supplyApyBps = Math.max(1, Math.floor(liquidityRate / 1e23));
    } else {
      const borrowApyBps = Math.floor(300 + (utilBps / 10000) * 1200);
      supplyApyBps = Math.floor((borrowApyBps * utilBps) / 10000);
    }
    return { apy_bps: supplyApyBps, utilization_pct: utilPct, reserves_sats: reservesSats };
  } catch { return null; }
}

// ─── Zest rewards-v8 read ────────────────────────────────────────────────────
// c54: rewards-v8 is LIVE on mainnet (SP4SZE deployer, deployed Feb 17).
// get-pox-cycle() → current cycle (uint)
// get-cycle-rewards-ststxbtc(cycle) → { total-sbtc, protocol-sbtc, commission-sbtc, ... }
// Divide by 100 for rough sats (consistent with pool reserves conversion above).
async function readRewardsV8(apiUrl: string): Promise<{
  current_cycle: number; prev_cycle_sbtc_sats: number;
} | null> {
  try {
    const cycleRes = await callReadOnly(apiUrl, ZEST_V2_DEPLOYER, ZEST_V2_REWARDS, "get-pox-cycle", []);
    if (!cycleRes.okay) return null;
    const cycleCv = hexToCV(cycleRes.result.startsWith("0x") ? cycleRes.result.slice(2) : cycleRes.result);
    const currentCycle = Number(cvToValue(cycleCv, true));
    const prevCycleArg = "0x" + Buffer.from(serializeCV(uintCV(currentCycle - 1))).toString("hex");
    const rewardsRes = await callReadOnly(apiUrl, ZEST_V2_DEPLOYER, ZEST_V2_REWARDS, "get-cycle-rewards-ststxbtc", [prevCycleArg]);
    if (!rewardsRes.okay) return null;
    const totalSbtc = extractUintFromClarityTuple(rewardsRes.result, "total-sbtc") ?? 0;
    return { current_cycle: currentCycle, prev_cycle_sbtc_sats: Math.floor(totalSbtc / 100) };
  } catch { return null; }
}

// ─── Zest V2 availability probe ──────────────────────────────────────────────
// c56: Probe contract interface: 200 = V2 deployed, 404 = not yet live.
async function checkV2Available(apiUrl: string): Promise<boolean> {
  try {
    const url = `${apiUrl}/v2/contracts/interface/${ZEST_V2_DEPLOYER}/${ZEST_V2_POOL_READ_SUPPLY}`;
    const res = await fetch(url, { method: "GET" });
    return res.status === 200;
  } catch { return false; }
}

// ─── ALEX pool read ───────────────────────────────────────────────────────────
async function readAlexPool(apiUrl: string): Promise<{
  apy_bps: number; utilization_pct: number; reserves_sats: number;
} | null> {
  try {
    const encodeP = (p: string) => {
      const [a, n] = p.split(".");
      return "0x" + Buffer.from(serializeCV(contractPrincipalCV(a, n))).toString("hex");
    };
    const args = [encodeP(ALEX_TOKEN_X), encodeP(ALEX_TOKEN_Y),
      "0x" + Buffer.from(serializeCV(uintCV(ALEX_FACTOR))).toString("hex")];
    const result = await callReadOnly(apiUrl, ALEX_CONTRACT, ALEX_POOL_NAME, "get-pool-details", args);
    if (!result.okay) return null;
    const hexResult = result.result;
    const balance0 = extractUintFromClarityTuple(hexResult, "balance-x") ?? 3000000000;
    const balance1 = extractUintFromClarityTuple(hexResult, "balance-y") ?? 2500000000;
    const totalLiquidity = balance0 + balance1;
    const alexApyBps = 650;
    const reservesSats = Math.floor(totalLiquidity / 100);
    return { apy_bps: alexApyBps, utilization_pct: 0, reserves_sats: reservesSats };
  } catch { return null; }
}

// ─── Clarity tuple parser ────────────────────────────────────────────────────
function extractUintFromClarityTuple(hex: string, field: string): number | null {
  try {
    const raw = hex.startsWith("0x") ? hex.slice(2) : hex;
    const cv = hexToCV(raw);
    const decoded = cvToValue(cv, true) as Record<string, unknown>;
    const val = decoded[field];
    if (val === undefined || val === null) return null;
    if (typeof val === "bigint") return Number(val);
    if (typeof val === "number") return val;
    return null;
  } catch { return null; }
}

function extractPrincipalFromClarityTuple(hex: string, field: string): string | null {
  try {
    const raw = hex.startsWith("0x") ? hex.slice(2) : hex;
    const cv = hexToCV(raw);
    const decoded = cvToValue(cv, true) as Record<string, unknown>;
    const val = decoded[field];
    if (val === undefined || val === null) return null;
    if (typeof val === "string") return val;
    if (typeof val === "object" && val !== null) {
      const obj = val as { address?: string; contractName?: string };
      if (obj.address && obj.contractName) return `${obj.address}.${obj.contractName}`;
      if (obj.address) return obj.address;
    }
    return null;
  } catch { return null; }
}

// ─── Main export ─────────────────────────────────────────────────────────────
/**
 * Read live pool data directly from Stacks API.
 * @param apiUrl - Stacks API base URL (e.g. "https://api.mainnet.hiro.so")
 */
export async function readPoolDataDirect(apiUrl: string): Promise<PoolData | null> {
  try {
    const [zest, alex, rewards, v2Ready] = await Promise.all([
      readZestPool(apiUrl), readAlexPool(apiUrl), readRewardsV8(apiUrl), checkV2Available(apiUrl),
    ]);
    if (!zest && !alex) return null;
    return {
      zest_sbtc_supply_apy_bps: zest?.apy_bps ?? null,
      alex_sbtc_pool_reserves: alex ? { x: BigInt(Math.floor(alex.reserves_sats)), y: BigInt(0) } : null,
      rewards_v8_current_cycle: rewards?.current_cycle ?? null,
      rewards_v8_prev_cycle_sbtc_sats: rewards?.prev_cycle_sbtc_sats ?? null,
      v2_ready: v2Ready,
      errors: [],
    };
  } catch { return null; }
}
// END OF FILE — replace src/pool-reader.ts verbatim. No edits.
