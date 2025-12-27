import type {
  PublicConfiguration,
  FullConfiguration,
  RevalidatorOptions,
  Revalidator,
  ScopedMutator,
  Cache,
} from "../types";

import { initCache } from "./cache";
import { preset } from "./web-preset";
import { slowConnection } from "./env";
import { isUndefined, noop, mergeObjects } from "./shared";

import { dequal } from "dequal/lite";

// error retry
// 这是一个带抖动的指数退避重试策略
// 函数签名，接收 5 个参数，前两个（错误和 key）在这个实现中未使用
const onErrorRetry = (
  // 错误对象（这里用 _ 表示不使用）
  _: unknown,
  // key（这里用 __ 表示不使用）
  __: string,
  // SWR 配置对象
  config: Readonly<PublicConfiguration>,
  // 重新验证函数
  revalidate: Revalidator,
  // 重试选项
  opts: Required<RevalidatorOptions>
): void => {
  // 从配置中获取最大重试次数
  const maxRetryCount = config.errorRetryCount;
  // 从选项中获取当前已重试次数
  const currentRetryCount = opts.retryCount;

  // Exponential backoff
  // 指数退避算法
  // 第 1 次重试：约 0.5~1.5 * 2 * 5000 = 5~15 秒
  // 第 2 次重试：约 0.5~1.5 * 4 * 5000 = 10~30 秒
  // 第 3 次重试：约 0.5~1.5 * 8 * 5000 = 20~60 秒
  const timeout =
    ~~(
      (Math.random() + 0.5) *
      (1 << (currentRetryCount < 8 ? currentRetryCount : 8))
    ) * config.errorRetryInterval;

  // 如果设置了最大重试次数，且当前已超过，则停止重试
  if (!isUndefined(maxRetryCount) && currentRetryCount > maxRetryCount) {
    return;
  }

  // 使用 setTimeout 在计算出的延迟后调用 revalidate 重新请求
  // 第三个参数 opts 会传给 revalidate 函数
  setTimeout(revalidate, timeout, opts);
};

/*

import { dequal } from 'dequal/lite'

// 普通的 === 比较（比较引用）
const obj1 = { name: 'Tom', age: 18 }
const obj2 = { name: 'Tom', age: 18 }
console.log(obj1 === obj2)        // false ❌ （虽然内容一样，但是不同对象）

// dequal 比较（比较内容）
console.log(dequal(obj1, obj2))   // true ✅ （内容一样就返回 true）

*/
const compare = dequal;

// Default cache provider
const [cache, mutate] = initCache(new Map()) as [Cache<any>, ScopedMutator];
export { cache, mutate, compare };

// Default config
export const defaultConfig: FullConfiguration = mergeObjects(
  {
    // events
    onLoadingSlow: noop,
    onSuccess: noop,
    onError: noop,
    onErrorRetry,
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
    compare,
    isPaused: () => false,
    cache,
    mutate,
    fallback: {},
  },
  // use web preset by default
  preset
);
