import React, {
  useCallback,
  useRef,
  useDebugValue,
  useMemo,
  useSyncExternalStore,
  use,
} from "react";

import {
  defaultConfig,
  // IS_REACT_LEGACY,
  IS_SERVER,
  // rAF,
  useIsomorphicLayoutEffect,
  SWRGlobalState,
  serialize,
  isUndefined,
  UNDEFINED,
  OBJECT,
  isFunction,
  createCacheHelper,
  SWRConfig as ConfigProvider,
  withArgs,
  // subscribeCallback,
  // getTimestamp,
  internalMutate,
  revalidateEvents,
  mergeObjects,
  isPromiseLike,
  noop,
} from "../_internal";
import type {
  State,
  Fetcher,
  Key,
  SWRResponse,
  RevalidatorOptions,
  FullConfiguration,
  SWRConfiguration,
  SWRHook,
  RevalidateEvent,
  StateDependencies,
  GlobalState,
} from "../_internal";

/**
 * The core implementation of the useSWR hook.
 *
 * This is the main handler function that implements all SWR functionality including
 * data fetching, caching, revalidation, error handling, and state management.
 * It manages the complete lifecycle of SWR requests from initialization through
 * cleanup.
 *
 * Key responsibilities:
 * - Key serialization and normalization
 * - Cache state management and synchronization
 * - Automatic and manual revalidation
 * - Error handling and retry logic
 * - Suspense integration
 * - Loading state management
 * - Effect cleanup and memory management
 *
 * @template Data - The type of data returned by the fetcher
 * @template Error - The type of error that can be thrown
 *
 * @param _key - The SWR key (string, array, object, function, or falsy)
 * @param fetcher - The fetcher function to retrieve data, or null to disable fetching
 * @param config - Complete SWR configuration object with both public and internal options
 *
 * @returns SWRResponse object containing data, error, mutate function, and loading states
 *
 * @internal This is the internal implementation. Use `useSWR` instead.
 */
export const useSWRHandler = <Data = any, Error = any>(
  _key: Key,
  fetcher: Fetcher<Data> | null,
  config: FullConfiguration & SWRConfiguration<Data, Error>
) => {
  const {
    cache,
    compare,
    suspense,
    fallbackData,
    revalidateOnMount,
    revalidateIfStale,
    refreshInterval,
    refreshWhenHidden,
    refreshWhenOffline,
    keepPreviousData,
    strictServerPrefetchWarning,
  } = config;

  const [EVENT_REVALIDATORS, MUTATION, FETCH, PRELOAD] = SWRGlobalState.get(
    cache
  ) as GlobalState;

  // `key` is the identifier of the SWR internal state,
  // `fnArg` is the argument/arguments parsed from the key, which will be passed
  // to the fetcher.
  // All of them are derived from `_key`.
  const [key, fnArg] = serialize(_key);

  // If it's the initial render of this hook.
  const initialMountedRef = useRef(false);

  // If the hook is unmounted already. This will be used to prevent some effects
  // to be called after unmounting.
  const unmountedRef = useRef(false);

  // Refs to keep the key and config.
  const keyRef = useRef(key);
  const fetcherRef = useRef(fetcher);
  const configRef = useRef(config);
  const getConfig = () => configRef.current;
  const isActive = () => getConfig().isVisible() && getConfig().isOnline();

  const [getCache, setCache, subscribeCache, getInitialCache] =
    createCacheHelper<
      Data,
      State<Data, any> & {
        // The original key arguments.
        _k?: Key;
      }
    >(cache, key);

  // 这是一个用于追踪状态依赖的对象。用来记录组件实际使用了哪些状态字段（如 data、error、isLoading），
  // 这样当未使用的字段变化时，就不会触发重新渲染，是一种性能优化。
  const stateDependencies = useRef<StateDependencies>({}).current;

  // Resolve the fallback data from either the inline option, or the global provider.
  // If it's a promise, we simply let React suspend and resolve it for us.
  // 首先看看 config.fallbackData 的数据有没有，有的话就直接用 fallbackData
  // 没有的话则从 config 里面找 fallback
  const fallback = isUndefined(fallbackData)
    ? isUndefined(config.fallback)
      ? UNDEFINED
      : config.fallback[key]
    : fallbackData;

  const isEqual = (prev: State<Data, any>, current: State<Data, any>) => {
    // TODO 这里怪怪的，先跳过
    for (const _ in stateDependencies) {
      const t = _ as keyof StateDependencies;
      if (t === "data") {
        if (!compare(prev[t], current[t])) {
          if (!isUndefined(prev[t])) {
            return false;
          }
          // if (!compare(returnedData, current[t])) {
          //   return false;
          // }
          throw new Error("compare not implemented yet");
        }
      } else {
        if (current[t] !== prev[t]) {
          return false;
        }
      }
    }
    return true;
  };

  const getSnapshot = useMemo(() => {
    // 判断是否应该立刻请求
    const shouldStartRequest = (() => {
      if (!key) return false;
      if (!fetcher) return false;
      // If `revalidateOnMount` is set, we take the value directly.
      if (!isUndefined(revalidateOnMount)) return revalidateOnMount;
      // If it's paused, we skip revalidation.
      if (getConfig().isPaused()) return false;
      if (suspense) return false;
      return revalidateIfStale !== false;
    })();

    // Get the cache and merge it with expected states.
    const getSelectedCache = (state: ReturnType<typeof getCache>) => {
      // We only select the needed fields from the state.
      const snapshot = mergeObjects(state);
      // TODO 这里为什么要删除 _k，这个 _k 是什么东西呢？
      delete snapshot._k;

      if (!shouldStartRequest) {
        return snapshot;
      }

      return {
        isValidating: true,
        isLoading: true,
        ...snapshot,
      };
    };

    const cachedData = getCache();
    const initialData = getInitialCache();
    const clientSnapshot = getSelectedCache(cachedData);
    const serverSnapshot =
      cachedData === initialData
        ? clientSnapshot
        : // TODO 为啥 cachedData !== initialData 的时候就要重新拿一次呢，并且这个居然是 serverSnapshot
          getSelectedCache(initialData);

    // To make sure that we are returning the same object reference to avoid
    // unnecessary re-renders, we keep the previous snapshot and use deep
    // comparison to check if we need to return a new one.
    let memorizedSnapshot = clientSnapshot;

    return [
      () => {
        const newSnapshot = getSelectedCache(getCache());
        const compareResult = isEqual(newSnapshot, memorizedSnapshot);

        // 如果快照数据没有变化，那么就更新指定的字段
        if (compareResult) {
          // Mentally, we should always return the `memorizedSnapshot` here
          // as there's no change between the new and old snapshots.
          // However, since the `isEqual` function only compares selected fields,
          // the values of the unselected fields might be changed. That's
          // simply because we didn't track them.
          // To support the case in https://github.com/vercel/swr/pull/2576,
          // we need to update these fields in the `memorizedSnapshot` too
          // with direct mutations to ensure the snapshot is always up-to-date
          // even for the unselected fields, but only trigger re-renders when
          // the selected fields are changed.
          memorizedSnapshot.data = newSnapshot.data;
          memorizedSnapshot.isLoading = newSnapshot.isLoading;
          memorizedSnapshot.isValidating = newSnapshot.isValidating;
          memorizedSnapshot.error = newSnapshot.error;
          return memorizedSnapshot;
        }
        // 如果快照数据变化了，那么就用新快照数据作为完整数据
        else {
          memorizedSnapshot = newSnapshot;
          return newSnapshot;
        }
      },
      () => serverSnapshot,
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, key]);

  // Get the current state that SWR should return.
  // TODO 这里需要加深对 useSyncExternalStore 这个函数的理解才能继续往下了，我现在对他的理解深度不够，
  // 我之前的理解第一个参数只是 listener，并没有传入参数，同时我的理解里面没有第三个参数，所以需要重新理解
  // 现在是 00:15 不是一个理解这么复杂的东西的好时候，明天再看吧
  const cached = useSyncExternalStore(
    useCallback(
      // 这里传入的 callback 是 react 内部的用来监听数据是否变化的回调
      (callback: () => void) =>
        subscribeCache(
          key,
          (current: State<Data, any>, prev: State<Data, any>) => {
            // 当数据出现变化的时候通知 react 数据变更，也就是调用 callback
            if (!isEqual(prev, current)) callback();
          }
        ),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [cache, key]
    ),
    getSnapshot[0],
    getSnapshot[1]
  );

  // 检查是否是第一次被挂载，后续组件会把 initialMountedRef.current 设为 true，再次渲染时 !true 那么 isInitialMount 就是 false
  const isInitialMount = !initialMountedRef.current;

  // 判断这个 key 是否已经有其他组件在监听重新验证事件
  const hasRevalidator =
    EVENT_REVALIDATORS[key] && EVENT_REVALIDATORS[key].length > 0;

  // 从缓存中取出 data 字段，可能是 undefined（还没请求过）或实际数据。
  const cachedData = cached.data;

  const data = isUndefined(cachedData)
    ? // 缓存没数据，看 fallback
      fallback && isPromiseLike(fallback)
      ? // fallback 是 Promise，用 React 的 use() 处理等待请求返回
        use(fallback)
      : // fallback 有数据，直接用 fallback
        fallback
    : // 缓存有数据，直接用缓存
      cachedData;
  // 直接从缓存取出错误信息，如果请求失败了就有值，否则是 undefined
  const error = cached.error;

  // Use a ref to store previously returned data. Use the initial data as its initial value.
  // 用 ref 保存上一次的数据。"laggy" 意思是"滞后的"，用于实现 keepPreviousData 功能。
  const laggyDataRef = useRef(data);

  const returnedData = keepPreviousData
    ? isUndefined(cachedData)
      ? // checking undefined to avoid null being fallback as well
        isUndefined(laggyDataRef.current)
        ? // 连上一次数据都没有，用当前 data
          data
        : // 缓存没数据用上一次的（保持旧数据）
          laggyDataRef.current
      : // 开启了 keepPreviousData，且有缓存数据，用缓存
        cachedData
    : // 没开启 keepPreviousData 那么直接返回 data
      data;

  // 有 key 但没数据，表示正在加载中。用于后续判断 loading 状态。
  const hasKeyButNoData = key && isUndefined(data);

  // Note: the conditionally hook call is fine because the environment
  // `IS_SERVER` never changes.
  // 判断是否处于 hydration 阶段（服务端渲染后，客户端接管的那一刻）
  const isHydration =
    !IS_SERVER &&
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useSyncExternalStore(
      () => noop,
      // 客户端渲染则为 false
      () => false,
      // 服务端渲染直接为 true
      // 客户端 hydration
      () => true
    );

  // During the initial SSR render, warn if the key has no data pre-fetched via:
  // - fallback data
  // - preload calls
  // - initial data from the cache provider
  // We only warn once for each key during SSR.
  // 在服务端渲染(SSR) hydration 阶段，检测是否忘记预取数据，如果忘了就在控制台发出警告。只有当下面四个条件同时满足时才发出报警
  if (
    // 1. 开启了严格警告模式
    strictServerPrefetchWarning &&
    // 2. 正处于 hydration 阶段
    isHydration &&
    // 3. 没有使用 Suspense 模式
    !suspense &&
    // 4. 有 key 但没有数据
    hasKeyButNoData
  ) {
    console.warn(
      `Missing pre-initiated data for serialized key "${key}" during server-side rendering. Data fethcing should be initiated on the server and provided to SWR via fallback data. You can set "strictServerPrefetchWarning: false" to disable this warning.`
    );
  }

  // - Suspense mode and there's stale data for the initial render.
  // - Not suspense mode and there is no fallback data and `revalidateIfStale` is enabled.
  // - `revalidateIfStale` is enabled but `data` is not defined.
  // 这是决定组件挂载时是否要重新请求数据的逻辑
  // 用立即执行函数（IIFE）计算是否需要初始 revalidation
  const shouldDoInitialRevalidation = (() => {
    // if a key already has revalidators and also has error, we should not trigger revalidation
    // 如果这个 key 已经有其他组件在处理 且 之前请求出错了，就不重新请求。 避免多个组件同时触发错误重试。
    if (hasRevalidator && !isUndefined(error)) return false;

    // If `revalidateOnMount` is set, we take the value directly.
    // 如果是首次挂载，且用户明确设置了 revalidateOnMount，直接用用户的设置
    if (isInitialMount && !isUndefined(revalidateOnMount))
      return revalidateOnMount;

    // If it's paused, we skip revalidation.
    // 如果 SWR 被暂停了（比如用户离线、省电模式），不请求
    if (getConfig().isPaused()) return false;

    // Under suspense mode, it will always fetch on render if there is no
    // stale data so no need to revalidate immediately mount it again.
    // If data exists, only revalidate if `revalidateIfStale` is true.
    // Suspense 模式下
    // - 没数据：返回 false，因为 Suspense 会自动触发 fetch，不需要额外 revalidate
    // - 有数据：看 revalidateIfStale 配置，决定是否刷新过期数据
    if (suspense) return isUndefined(data) ? false : revalidateIfStale;

    // If there is no stale data, we need to revalidate when mount;
    // If `revalidateIfStale` is set to true, we will always revalidate.
    // 默认逻辑（非 Suspense）
    // - 没数据：必须请求（true）
    // - 有数据：看 revalidateIfStale 配置，决定是否刷新过期数据
    return isUndefined(data) || revalidateIfStale;
  })();

  // Resolve the default validating state:
  // If it's able to validate, and it should revalidate when mount, this will be true.
  // 四个条件同时满足时，默认验证状态为 true。 !! 是把结果转成布尔值。
  // 意思是如果首次挂载且即将发起请求，那默认状态就是"正在验证中"。
  const defaultValidatingState = !!(
    // 有 key
    (
      key &&
      // 有 fetcher 函数
      fetcher &&
      // 是首次挂载
      isInitialMount &&
      // 需要初始 revalidation
      shouldDoInitialRevalidation
    )
  );
  // 缓存里没有这个状态，用默认值
  const isValidating = isUndefined(cached.isValidating)
    ? // 缓存里没有这个状态，用默认值
      defaultValidatingState
    : // 缓存里有，用缓存的
      cached.isValidating;
  const isLoading = isUndefined(cached.isLoading)
    ? // 缓存里没有这个状态，用默认值
      defaultValidatingState
    : // 缓存里有，用缓存的
      cached.isLoading;

  // The revalidation function is a carefully crafted wrapper of the original
  // `fetcher`, to correctly handle the many edge cases.
  // revalidate 是 SWR 的核心请求函数，负责调用 fetcher 获取数据并更新缓存
  const revalidate = useCallback(
    async (revalidateOpts?: RevalidatorOptions): Promise<boolean> => {
      throw new Error("revalidate is not implemented yet");
    },
    // `setState` is immutable, and `eventsCallback`, `fnArg`, and
    // `keyValidating` are depending on `key`, so we can exclude them from
    // the deps array.
    //
    // FIXME:
    // `fn` and `config` might be changed during the lifecycle,
    // but they might be changed every render like this.
    // `useSWR('key', () => fetch('/api/'), { suspense: true })`
    // So we omit the values from the deps array
    // even though it might cause unexpected behaviors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, cache]
  );

  // Similar to the global mutate but bound to the current cache and key.
  // `cache` isn't allowed to change during the lifecycle.
  // 返回一个绑定当前 key 的 mutate 函数
  const boundMutate: SWRResponse<Data, Error>["mutate"] = useCallback(
    // Use callback to make sure `keyRef.current` returns latest result every time
    (...args: any[]) => {
      return internalMutate(cache, keyRef.current, ...args);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  throw new Error("useSWRHandler is not implemented yet");
};

const useSWR = withArgs<SWRHook>(useSWRHandler);

export default useSWR;
