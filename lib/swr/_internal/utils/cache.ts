import { defaultConfigOptions } from "./web-preset";
import { IS_SERVER } from "./env";
import { UNDEFINED, mergeObjects, noop } from "./shared";
import { internalMutate } from "./mutate";
import { SWRGlobalState } from "./global-state";
import * as revalidateEvents from "../events";

import type {
  Cache,
  ScopedMutator,
  RevalidateEvent,
  RevalidateCallback,
  ProviderConfiguration,
  GlobalState,
} from "../types";

// 重新请求所有的 key
const revalidateAllKeys = (
  revalidators: Record<string, RevalidateCallback[]>,
  type: RevalidateEvent
) => {
  for (const key in revalidators) {
    if (revalidators[key][0]) revalidators[key][0](type);
  }
};

export const initCache = <Data = any>(
  provider: Cache<Data>,
  options?: Partial<ProviderConfiguration>
):
  | [Cache<Data>, ScopedMutator, () => void, () => void]
  | [Cache<Data>, ScopedMutator]
  | undefined => {
  // The global state for a specific provider will be used to deduplicate
  // requests and store listeners. As well as a mutate function that is bound to
  // the cache.

  // The provider's global state might be already initialized. Let's try to get the
  // global state associated with the provider first.
  // 先检查这个 provider 有没有被初始化过，如果初始化了那么则跳过下面的所有逻辑
  if (!SWRGlobalState.has(provider)) {
    // 将默认配置和传入的配置合并
    const opts = mergeObjects(defaultConfigOptions, options);

    // If there's no global state bound to the provider, create a new one with the
    // new mutate function.
    // 创建一个空对象，用于存储各个 key 的重新验证回调
    // EVENT_REVALIDATORS = {
    //   '/api/user': [onRevalidate1, onRevalidate2],
    //   '/api/posts': [onRevalidate3],
    // }
    const EVENT_REVALIDATORS = Object.create(null);

    // 这里将 internalMutate 这个函数的第一个参数始终绑定为 provider
    const mutate = internalMutate.bind(UNDEFINED, provider) as ScopedMutator;
    // 这里的 noop 是 () => {} 一个空函数
    let unmount = noop;

    // 创建一个空对象 {}
    const subscriptions: Record<string, ((current: any, prev: any) => void)[]> =
      Object.create(null);
    // TODO 这个是函数，先不看
    const subscribe = (
      key: string,
      callback: (current: any, prev: any) => void
    ) => {
      const subs = subscriptions[key] || [];
      subscriptions[key] = subs;

      subs.push(callback);
      return () => subs.splice(subs.indexOf(callback), 1);
    };
    // TODO 这个是函数，先不看
    const setter = (key: string, value: any, prev: any) => {
      provider.set(key, value);
      const subs = subscriptions[key];
      if (subs) {
        for (const fn of subs) {
          fn(value, prev);
        }
      }
    };

    // initProvider 这个函数会被下面立刻执行，先从这里开始看
    const initProvider = () => {
      // 如果这个 provider 没被初始化过则在这里初始化，否则跳过下面的所有逻辑
      if (!SWRGlobalState.has(provider)) {
        // Update the state if it's new, or if the provider has been extended.
        SWRGlobalState.set(provider, [
          EVENT_REVALIDATORS, // 存储各 key 的 revalidate 回调
          Object.create(null), // MUTATION 时间戳
          Object.create(null), // FETCH 进行中的请求（去重）
          Object.create(null), // PRELOAD 预加载缓存
          mutate, // mutate 函数
          setter, // 设置缓存函数 TODO 这是干嘛的
          subscribe, // 订阅函数 TODO 这是干嘛的
        ]);
        // 下面的逻辑只在浏览器端运行，服务端不运行
        // 服务端不需要监听 focus/reconnect
        if (!IS_SERVER) {
          // When listening to the native events for auto revalidations,
          // we intentionally put a delay (setTimeout) here to make sure they are
          // fired after immediate JavaScript executions, which can be
          // React's state updates.
          // This avoids some unnecessary revalidations such as
          // https://github.com/vercel/swr/issues/1680.
          // 获取 focus 的清理函数
          // 用 setTimeout 把 revalidation 推迟到下一个事件循环，让 React 更新先完成
          const releaseFocus = opts.initFocus(
            setTimeout.bind(
              UNDEFINED,
              // 注册 focus 事件
              revalidateAllKeys.bind(
                UNDEFINED,
                EVENT_REVALIDATORS,
                revalidateEvents.FOCUS_EVENT
              )
            )
          );
          // 获取 reconnect 的清理函数
          // 与 focus 类似，监听网络重连事件
          const releaseReconnect = opts.initReconnect(
            setTimeout.bind(
              UNDEFINED,
              revalidateAllKeys.bind(
                UNDEFINED,
                EVENT_REVALIDATORS,
                revalidateEvents.RECONNECT_EVENT
              )
            )
          );
          // 在不挂载的时候将监听器都清除掉，调用 releaseFocus 和 releaseReconnect 删除监听器
          // 如果不删除，重新挂载时 SWRGlobalState.has(provider) 会返回 true，导致事件监听不会重新注册。
          unmount = () => {
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            releaseFocus && releaseFocus();
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            releaseReconnect && releaseReconnect();
            // When un-mounting, we need to remove the cache provider from the state
            // storage too because it's a side-effect. Otherwise, when re-mounting we
            // will not re-register those event listeners.
            SWRGlobalState.delete(provider);
          };
        }
      }
    };
    initProvider();

    // This is a new provider, we need to initialize it and setup DOM events
    // listeners for `focus` and `reconnect` actions.

    // We might want to inject an extra layer on top of `provider` in the future,
    // such as key serialization, auto GC, etc.
    // For now, it's just a `Map` interface without any modifications.
    return [provider, mutate, initProvider, unmount];
  }

  return [provider, (SWRGlobalState.get(provider) as GlobalState)[4]];
};
