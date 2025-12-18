import { isUndefined, noop, mergeObjects } from "./shared";
import { slowConnection } from "./env";
import { FullConfiguration } from "../types";

export const defaultConfig: FullConfiguration = {
  // events
  onLoadingSlow: noop,
  onSuccess: noop,
  onError: noop,
  onErrorRetry: () => {
    throw new Error();
  },
  onDiscarded: noop,

  // switches
  revalidateOnFocus: true,
  revalidateOnReconnect: true,
  revalidateIfStale: true,
  shouldRetryOnError: true,

  // timeouts
  errorRetryInterval: slowConnection ? 10000 : 5000,
  focusThrottleInterval: 5 * 1000,
  dedupingInterval: 2 * 1000,
  loadingTimeout: slowConnection ? 5000 : 3000,

  // providers
  compare: (a, b) => {
    throw new Error();
  },
  isPaused: () => false,
  // TODO 这个实现是错的，要改
  cache: new Map(),
  mutate: () => {
    throw new Error();
  },
  fallback: {},
};
