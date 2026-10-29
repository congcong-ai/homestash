import type { NetworkInterfaceInfo } from "node:os";
export function isPrivateAddress(value: unknown): boolean;
export function lanAddresses(
  interfaces?: Record<string, NetworkInterfaceInfo[] | undefined>,
): { name: string; address: string }[];
export function selectLanAddress(
  requested?: string,
  addresses?: { name: string; address: string }[],
): string;
export function validateLanAuth(env: NodeJS.ProcessEnv): void;
export function ensureLanAuth(
  directory: string,
  env: NodeJS.ProcessEnv,
): { config: Record<string, string>; accessPath: string | null };
export function listenerPids(port: number): number[];
export function portAvailable(port: number, host: string): Promise<boolean>;
export function preparePort(
  preferred: number,
  host: string,
  root: string,
  options?: { fixed?: boolean },
): Promise<number>;
