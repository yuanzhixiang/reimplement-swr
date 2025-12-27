import { isUndefined, noop, mergeObjects } from "./shared";
import { slowConnection } from "./env";
import type {
  PublicConfiguration,
  FullConfiguration,
  RevalidatorOptions,
  Revalidator,
  ScopedMutator,
  Cache
} from '../types'
import { initCache } from './cache'
import { dequal } from 'dequal/lite'

/*

import { dequal } from 'dequal/lite'

// 普通的 === 比较（比较引用）
const obj1 = { name: 'Tom', age: 18 }
const obj2 = { name: 'Tom', age: 18 }
console.log(obj1 === obj2)        // false ❌ （虽然内容一样，但是不同对象）

// dequal 比较（比较内容）
console.log(dequal(obj1, obj2))   // true ✅ （内容一样就返回 true）

*/
const compare = dequal

// Default cache provider
const [cache, mutate] = initCache(new Map()) as [Cache<any>, ScopedMutator]
export { cache, mutate, compare }

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
