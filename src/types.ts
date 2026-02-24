// Shared types for btcfi-yield-scanner

export interface PoolState {
  protocol: "zest" | "zest-v2" | "alex" | "bitflow";
  totalSupply: bigint;
  totalBorrow: bigint;
  utilizationRate: number;
  supplyAPY: number;
  borrowAPY: number;
  rewardsAPY?: number; // Zest v2: separate reward distribution
  lastUpdated: number;
}

export interface YieldPath {
  id: "PATH_A" | "PATH_B" | "PATH_C" | "PATH_D";
  protocol: string;
  asset: string;
  estimatedAPY: number;
  riskScore: number; // 0-100
  description: string;
}

export interface YieldComparison {
  timestamp: number;
  paths: YieldPath[];
  recommended: YieldPath;
  zestV2Ready: boolean; // SC c56: feature flag — true when pool-read-supply is live on mainnet
}

export interface KeeperAlert {
  protocol: string;
  metric: string;
  threshold: number;
  currentValue: number;
  severity: "info" | "warning" | "critical";
  message: string;
}
