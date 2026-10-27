export type OfflineSnapshot = {
  version: 1;
  scope: string;
  savedAt: number;
  expiresAt: number;
  timeZone: string;
  date: string;
  items: {
    name: string;
    category: string;
    quantity: number;
    unit: string;
    location: string;
    status: string;
    deadline: string | null;
  }[];
  shopping: {
    name: string;
    quantity: number;
    unit: string;
    checked: boolean;
  }[];
  recipes: { name: string; steps: string[] }[];
  cooking: { name: string; step: string } | null;
};
export function offlineEnabled(): boolean;
export function pendingLogout(): boolean;
export function offlineSessionVersion(): string;
export function clearOffline(): void;
export function enableOffline(): void;
export function beginLogout(): void;
export function completeLogout(): void;
export function flushLogout(force?: boolean): Promise<void>;
export function validSnapshot(
  value: unknown,
  now?: number,
): value is OfflineSnapshot;
export function saveSnapshot(value: OfflineSnapshot): boolean;
export function readSnapshot(now?: number): OfflineSnapshot | null;
