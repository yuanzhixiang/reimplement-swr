import type { Cache, State, GlobalState } from "../types";
import { SWRGlobalState } from "./global-state";
import { isUndefined, mergeObjects } from "./shared";

const EMPTY_CACHE = {};
const INITIAL_CACHE: Record<string, any> = {};

const STR_UNDEFINED = "undefined";

// 这段代码用于检测当前环境是否支持 requestAnimationFrame API
export const hasRequestAnimationFrame = () =>
  isWindowDefined && typeof window["requestAnimationFrame"] != STR_UNDEFINED;

export const isWindowDefined = typeof window != STR_UNDEFINED;
export const isDocumentDefined = typeof document != STR_UNDEFINED;
export const isLegacyDeno = isWindowDefined && "Deno" in window;

export const createCacheHelper = <Data = any, T = State<Data, any>>(
  cache: Cache,
  key: string | undefined
) => {
  // 从全局状态 Map 中获取与这个 cache 关联的状态对象。
  const state = SWRGlobalState.get(cache) as GlobalState;
  return [
    // Getter
    // 如果 key 存在，从 cache 获取值，如果 key 不存在或没有缓存，返回 EMPTY_CACHE（空对象 {}）
    () => ((!isUndefined(key) && cache.get(key)) || EMPTY_CACHE) as T,
    // Setter
    (info: T) => {
      // 只有 key 存在时才执行
      if (!isUndefined(key)) {
        // 先获取之前的缓存值 prev
        const prev = cache.get(key);

        // Before writing to the store, we keep the value in the initial cache
        // if it's not there yet.
        // 首次写入前，把原始值保存到 INITIAL_CACHE，这是为了 SSR/SSG 场景，记住服务端渲染时的初始值
        if (!(key in INITIAL_CACHE)) {
          INITIAL_CACHE[key] = prev;
        }

        // state[5] 是 setState 函数，把旧值和新值合并后写入，第三个参数是之前的状态（用于对比/通知）
        state[5](key, mergeObjects(prev, info), prev || EMPTY_CACHE);
      }
    },
    // Subscriber
    // state[6] 是 subscribeCache 函数，用于 useSyncExternalStore 订阅缓存变化
    state[6],
    // Get server cache snapshot
    // 这是给 useSyncExternalStore 的 getServerSnapshot 用的
    // 避免 SSR hydration mismatch（服务端和客户端初次渲染要一致）
    () => {
      // 如果客户端已经更新过（INITIAL_CACHE 有记录），返回初始值
      if (!isUndefined(key)) {
        // If the cache was updated on the client, we return the stored initial value.
        if (key in INITIAL_CACHE) return INITIAL_CACHE[key];
      }

      // If we haven't done any client-side updates, we return the current value.
      return ((!isUndefined(key) && cache.get(key)) || EMPTY_CACHE) as T;
    },
  ] as const;
};
