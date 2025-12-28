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
  IS_REACT_LEGACY,
  IS_SERVER,
  rAF,
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
  subscribeCallback,
  getTimestamp,
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

  // 比较函数，判断前后状态是否"相等"（决定是否需要重新渲染）
  const isEqual = (prev: State<Data, any>, current: State<Data, any>) => {
    // 只遍历组件用到的字段。比如组件只用了 { data } 就只检查 data
    for (const _ in stateDependencies) {
      const t = _ as keyof StateDependencies;
      // 对 data 字段做特殊处理
      if (t === "data") {
        // 深度比较 prev.data 和 current.data。如果不相等，进入下面的逻辑
        if (!compare(prev[t], current[t])) {
          // 之前有数据（prev.data 不是 undefined） → 数据真的变了，返回 false（需要重新渲染）
          if (!isUndefined(prev[t])) {
            return false;
          }
          // 之前没数据（prev.data 是 undefined） → 比较 returnedData（可能是 fallback）和新数据 → 如果不同，返回 false
          // 这里的意图是从 fallback 过渡到真实数据时，如果内容一样就不重新渲染
          if (!compare(returnedData, current[t])) {
            return false;
          }
        }
      } else {
        // 其他字段（error、isLoading、isValidating）直接用 === 比较
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
      // 从 ref 中获取当前最新的 fetcher 函数
      const currentFetcher = fetcherRef.current;

      if (
        // 没有 key → 不请求
        !key ||
        // 没有 fetcher 函数 → 不请求
        !currentFetcher ||
        // 组件已卸载 → 不请求
        unmountedRef.current ||
        // SWR 被暂停 → 不请求
        getConfig().isPaused()
      ) {
        return false;
      }

      let newData: Data;
      let startAt: number;
      let loading = true;
      const opts = revalidateOpts || {};

      // If there is no ongoing concurrent request, or `dedupe` is not set, a
      // new request should be initiated.
      // 请求去重的判断逻辑
      const shouldStartNewRequest =
        // 该 key 没有正在进行的请求
        !FETCH[key] ||
        // 没有开启去重选项
        !opts.dedupe;

      /*
         For React 17
         Do unmount check for calls:
         If key has changed during the revalidation, or the component has been
         unmounted, old dispatch and old event callbacks should not take any
         effect

        For React 18
        only check if key has changed
        https://github.com/reactwg/react-18/discussions/82
      */
      // 回调安全检查函数，防止过期的回调被执行
      // 返回 true 表示安全可以继续，false 表示应该忽略
      const callbackSafeguard = () => {
        if (IS_REACT_LEGACY) {
          return (
            // 组件没有卸载
            !unmountedRef.current &&
            // key 没有变化
            key === keyRef.current &&
            // 组件已经挂载过
            initialMountedRef.current
          );
        }
        // 只需检查 key 是否变化，因为 React 18 会自动处理卸载组件的状态更新
        return key === keyRef.current;
      };

      // The final state object when the request finishes.
      // 请求结束后的状态：不再验证中、不再加载中。
      const finalState: State<Data, Error> = {
        isValidating: false,
        isLoading: false,
      };
      // 请求完成时调用，把最终状态写入缓存
      const finishRequestAndUpdateState = () => {
        setCache(finalState);
      };
      const cleanupState = () => {
        // Check if it's still the same request before deleting it.
        // 从全局 FETCH 对象中删除该请求的记录
        const requestInfo = FETCH[key];
        // 检查 requestInfo[1] === startAt，确保删除的是当前这次请求，而不是后来发起的新请求
        if (requestInfo && requestInfo[1] === startAt) {
          delete FETCH[key];
        }
      };

      // Start fetching. Change the `isValidating` state, update the cache.
      // 请求开始时的状态：正在验证中
      const initialState: State<Data, Error> = { isValidating: true };

      try {
        // 检查是否需要重新发请求
        if (shouldStartNewRequest) {
          // 先设置缓存状态为验证中
          setCache(initialState);
          // If no cache is being rendered currently (it shows a blank page),
          // we trigger the loading slow event.
          // 慢加载提示，如果没有缓存数据且超过 loadingTimeout 还在加载，触发 onLoadingSlow 回调。
          if (config.loadingTimeout && isUndefined(getCache().data)) {
            setTimeout(() => {
              // 超过 loadingTimeout 还在加载，触发 onLoadingSlow 回调。
              if (loading && callbackSafeguard()) {
                getConfig().onLoadingSlow(key, config);
              }
            }, config.loadingTimeout);
          }

          // Start the request and save the timestamp.
          // Key must be truthy if entering here.
          FETCH[key] = [
            // fetcher 返回的 Promise
            currentFetcher(fnArg as DefinitelyTruthy<Key>),
            // 时间戳（用于竞态检测）
            getTimestamp(),
          ];
        }

        // Wait until the ongoing request is done. Deduplication is also
        // considered here.
        // 从 FETCH 取出 Promise 并等待。不管是自己发起的还是复用别人的，都用同一个 Promise。
        [newData, startAt] = FETCH[key];
        newData = await newData;

        // 请求完成后，延迟清理 FETCH[key]
        if (shouldStartNewRequest) {
          // If the request isn't interrupted, clean it up after the
          // deduplication interval.
          // 在 dedupingInterval 期间内的请求要继续复用结果
          setTimeout(cleanupState, config.dedupingInterval);
        }

        // If there're other ongoing request(s), started after the current one,
        // we need to ignore the current one to avoid possible race conditions:
        //   req1------------------>res1        (current one)
        //        req2---------------->res2
        // the request that fired later will always be kept.
        // The timestamp maybe be `undefined` or a number
        // 竞态检测，检查是否被更新的请求覆盖
        // req1 ────────────────> res1 (我)
        //      req2 ─────────────────> res2 (更新的)
        if (!FETCH[key] || FETCH[key][1] !== startAt) {
          // 只有发起新请求的组件才需要触发回调。复用别人请求的组件不触发。
          if (shouldStartNewRequest) {
            // 检查回调是否安全执行（组件没卸载、key 没变）
            if (callbackSafeguard()) {
              // 触发 onDiscarded 回调，通知用户这次请求的结果被丢弃了
              getConfig().onDiscarded(key);
            }
          }
          return false;
        }

        // Clear error.
        // 清除之前的错误状态
        finalState.error = UNDEFINED;

        // If there're other mutations(s), that overlapped with the current revalidation:
        // case 1:
        //   req------------------>res
        //       mutate------>end
        // case 2:
        //         req------------>res
        //   mutate------>end
        // case 3:
        //   req------------------>res
        //       mutate-------...---------->
        // we have to ignore the revalidation result (res) because it's no longer fresh.
        // meanwhile, a new revalidation should be triggered when the mutation ends.
        // Mutation 冲突检测
        const mutationInfo = MUTATION[key];
        if (
          // 先检查是否有 mutation 记录
          !isUndefined(mutationInfo) &&
          // case 1：请求开始于 mutation 开始之前
          (startAt <= mutationInfo[0] ||
            // case 2：请求开始于 mutation 结束之前
            startAt <= mutationInfo[1] ||
            // case 3：Mutation 还在进行中
            mutationInfo[1] === 0)
        ) {
          // 更新 isValidating/isLoading 状态
          finishRequestAndUpdateState();
          if (shouldStartNewRequest) {
            if (callbackSafeguard()) {
              // 通知结果被丢弃
              getConfig().onDiscarded(key);
            }
          }
          return false;
        }
        // Deep compare with the latest state to avoid extra re-renders.
        // For local state, compare and assign.
        // 获取缓存数据
        const cacheData = getCache().data;

        // Since the compare fn could be custom fn
        // cacheData might be different from newData even when compare fn returns True
        // 更新缓存数据
        finalState.data = compare(cacheData, newData)
          ? // 数据相等用 cacheData（旧引用），避免不必要的重新渲染
            cacheData
          : // 数据不等用 newData（新数据），数据真的变了
            newData;

        // Trigger the successful callback if it's the original request.
        if (shouldStartNewRequest) {
          if (callbackSafeguard()) {
            // 成功时触发 onSuccess 回调
            getConfig().onSuccess(newData, key, config);
          }
        }
      } catch (err: any) {
        cleanupState();

        const currentConfig = getConfig();
        const { shouldRetryOnError } = currentConfig;

        // Not paused, we continue handling the error. Otherwise, discard it.
        if (!currentConfig.isPaused()) {
          // Get a new error, don't use deep comparison for errors.
          finalState.error = err as Error;

          // Error event and retry logic. Only for the actual request, not
          // deduped ones.
          if (shouldStartNewRequest && callbackSafeguard()) {
            currentConfig.onError(err, key, currentConfig);
            if (
              shouldRetryOnError === true ||
              (isFunction(shouldRetryOnError) &&
                shouldRetryOnError(err as Error))
            ) {
              if (
                !getConfig().revalidateOnFocus ||
                !getConfig().revalidateOnReconnect ||
                isActive()
              ) {
                // If it's inactive, stop. It will auto-revalidate when
                // refocusing or reconnecting.
                // When retrying, deduplication is always enabled.
                currentConfig.onErrorRetry(
                  err,
                  key,
                  currentConfig,
                  (_opts) => {
                    const revalidators = EVENT_REVALIDATORS[key];
                    if (revalidators && revalidators[0]) {
                      revalidators[0](
                        revalidateEvents.ERROR_REVALIDATE_EVENT,
                        _opts
                      );
                    }
                  },
                  {
                    retryCount: (opts.retryCount || 0) + 1,
                    dedupe: true,
                  }
                );
              }
            }
          }
        }
      }

      // Mark loading as stopped.
      // 标记加载结束
      loading = false;

      // Update the current hook's state.
      // 更新缓存状态，把 finalState 写入缓存
      finishRequestAndUpdateState();

      return true;
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

  // The logic for updating refs.
  useIsomorphicLayoutEffect(() => {
    // 把最新的 fetcher 保存到 ref
    // 这样 revalidate 函数里通过 fetcherRef.current 总能拿到最新的 fetcher，即使 fetcher 变了也不用重新创建 revalidate。
    fetcherRef.current = fetcher;
    // 保存最新的 config 配置
    configRef.current = config;
    // Handle laggy data updates. If there's cached data of the current key,
    // it'll be the correct reference.
    // 如果缓存有数据，更新 laggyDataRef（用于 keepPreviousData 功能）。 只在有数据时更新，保证切换 key 时能保留上一次的数据。
    if (!isUndefined(cachedData)) {
      laggyDataRef.current = cachedData;
    }
  });

  // After mounted or key changed.
  useIsomorphicLayoutEffect(() => {
    // 没有 key 就不执行任何操作
    if (!key) return;

    // 创建一个软重新验证函数，预绑定了去重参数。调用时会自动带上 { dedupe: true }
    // TODO 这里的软重新验证函数是什么意思？
    const softRevalidate = revalidate.bind(UNDEFINED, WITH_DEDUPE);

    // 初始化焦点重新验证的节流时间戳
    let nextFocusRevalidatedAt = 0;

    // 如果开启了 revalidateOnFocus，默认会开启
    if (getConfig().revalidateOnFocus) {
      const initNow = Date.now();
      // 默认 focusThrottleInterval = 5000，那么在接下来 5 秒内再次聚焦不会触发重新验证
      nextFocusRevalidatedAt = initNow + getConfig().focusThrottleInterval;
    }

    // Expose revalidators to global event listeners. So we can trigger
    // revalidation from the outside.
    // 定义统一的重新验证事件处理器，根据事件类型做不同处理
    const onRevalidate = (
      type: RevalidateEvent,
      opts: {
        retryCount?: number;
        dedupe?: boolean;
      } = {}
    ) => {
      // 聚焦事件：用户切回页面时，带节流地重新验证
      if (type == revalidateEvents.FOCUS_EVENT) {
        const now = Date.now();
        if (
          getConfig().revalidateOnFocus &&
          now > nextFocusRevalidatedAt &&
          isActive()
        ) {
          nextFocusRevalidatedAt = now + getConfig().focusThrottleInterval;
          softRevalidate();
        }
      }
      // 网络重连事件：断网恢复后重新验证
      else if (type == revalidateEvents.RECONNECT_EVENT) {
        if (getConfig().revalidateOnReconnect && isActive()) {
          softRevalidate();
        }
      }
      // Mutate 事件：调用 mutate() 后触发重新验证
      else if (type == revalidateEvents.MUTATE_EVENT) {
        return revalidate();
      }
      // 错误重试事件：请求失败后的重试，带上重试次数等参数
      else if (type == revalidateEvents.ERROR_REVALIDATE_EVENT) {
        return revalidate(opts);
      }
      return;
    };

    // 把 onRevalidate 注册到全局事件系统，这样外部事件（聚焦、重连等）就能触发这个组件的重新验证
    const unsubEvents = subscribeCallback(
      key,
      EVENT_REVALIDATORS,
      onRevalidate
    );

    // Mark the component as mounted and update corresponding refs.
    // 标记组件已挂载，保存当前 key
    unmountedRef.current = false;
    keyRef.current = key;
    initialMountedRef.current = true;

    // Keep the original key in the cache.
    // 把原始 key（可能是数组或对象）存到缓存中，用于后续比较
    setCache({ _k: fnArg });

    // Trigger a revalidation
    // 触发初始重新验证
    if (shouldDoInitialRevalidation) {
      // Performance optimization: if a request is already in progress for this key,
      // skip the revalidation to avoid redundant work
      // 没有正在进行的请求
      if (!FETCH[key]) {
        if (isUndefined(data) || IS_SERVER) {
          // Revalidate immediately.
          // 没数据或服务端：立即请求
          softRevalidate();
        } else {
          // Delay the revalidate if we have data to return so we won't block
          // rendering.
          // 有数据：延迟到下一帧，不阻塞渲染
          rAF(softRevalidate);
        }
      }
    }

    return () => {
      // 组件卸载或 key 变化时

      // Mark it as unmounted.
      // 标记已卸载
      unmountedRef.current = true;

      // 取消事件订阅
      unsubEvents();
    };
  }, [key]);

  // Polling
  // 这是 SWR 的轮询（Polling）功能实现
  useIsomorphicLayoutEffect(() => {
    // 定义一个 timer 变量来存储 setTimeout 的返回值
    let timer: any;

    // 安排下一次轮询
    function next() {
      // Use the passed interval
      // ...or invoke the function with the updated data to get the interval
      // 获取轮询间隔 refreshInterval 可以是数字，也可以是函数
      const interval = isFunction(refreshInterval)
        ? // 如果是函数则执行函数获取返回值
          refreshInterval(getCache().data)
        : // 如果是数字则直接使用
          refreshInterval;

      // We only start the next interval if `refreshInterval` is not 0, and:
      // - `force` is true, which is the start of polling
      // - or `timer` is not 0, which means the effect wasn't canceled
      // 如果 interval 有效（不为 0）且没被取消（timer !== -1），安排下一次执行。
      if (interval && timer !== -1) {
        timer = setTimeout(execute, interval);
      }
    }

    function execute() {
      // Check if it's OK to execute:
      // Only revalidate when the page is visible, online, and not errored.
      if (
        // 没有错误
        !getCache().error &&
        // 页面可见（或允许隐藏时刷新）
        (refreshWhenHidden || getConfig().isVisible()) &&
        // 网络在线（或允许离线时刷新）
        (refreshWhenOffline || getConfig().isOnline())
      ) {
        // 发请求，完成后安排下一次
        revalidate(WITH_DEDUPE).then(next);
      } else {
        // Schedule the next interval to check again.
        // 条件不满足，跳过这次，直接安排下一次
        next();
      }
    }

    // effect 执行时立即调用 next() 开始轮询循环
    next();

    return () => {
      // 组件卸载或依赖变化时，清除定时器
      if (timer) {
        clearTimeout(timer);
        // timer = -1 防止 next() 再安排新定时器
        timer = -1;
      }
    };
  }, [refreshInterval, refreshWhenHidden, refreshWhenOffline, key]);

  // Display debug info in React DevTools.
  // 提供一些更有意义的调试信息
  useDebugValue(returnedData);

  // In Suspense mode, we can't return the empty `data` state.
  // If there is an `error`, the `error` needs to be thrown to the error boundary.
  // If there is no `error`, the `revalidation` promise needs to be thrown to
  // the suspense boundary.
  // 只在开启 Suspense 模式时执行
  if (suspense) {
    // SWR should throw when trying to use Suspense on the server with React 18,
    // without providing any fallback data. This causes hydration errors. See:
    // https://github.com/vercel/swr/issues/1832
    // React 18 + 服务端 + 没有数据 → 抛错
    // 因为 SSR 时不能 throw Promise（没有 Suspense boundary），必须提供 fallback 数据
    if (!IS_REACT_LEGACY && IS_SERVER && hasKeyButNoData) {
      throw new Error("Fallback data is required when using Suspense in SSR.");
    }

    // Always update fetcher and config refs even with the Suspense mode.
    // 没数据时（即将 suspend），也要更新 refs，保证 resume 后能用最新的 fetcher 和 config
    if (hasKeyButNoData) {
      fetcherRef.current = fetcher;
      configRef.current = config;
      unmountedRef.current = false;
    }

    // 检查是否有预加载的数据
    const req = PRELOAD[key];

    const mutateReq =
      !isUndefined(req) && hasKeyButNoData
        ? // 有预加载 + 没数据 → 调用 boundMutate(req) 把预加载数据写入缓存
          boundMutate(req)
        : // TODO 所以这里没有预加载数据，为什么要返回这个？resolvedUndef 的作用是什么？
          resolvedUndef;

    // use(mutateReq) → 等待 mutate 完成
    use(mutateReq);

    // 如果有错误，throw 给 ErrorBoundary 处理
    if (!isUndefined(error) && hasKeyButNoData) {
      throw error;
    }
    const revalidation = hasKeyButNoData
      ? // 没数据时发起请求
        revalidate(WITH_DEDUPE)
      : // 有数据就跳过
        resolvedUndef;
    // 特殊情况：有 returnedData（比如 fallback）但 cachedData 是 undefined。
    // 手动把 Promise 标记为已完成，避免不必要的 suspend。
    // 这是一个 hack，直接修改 React 内部的 Promise 状态。
    if (!isUndefined(returnedData) && hasKeyButNoData) {
      // @ts-ignore modify react promise status
      revalidation.status = "fulfilled";
      // @ts-ignore modify react promise value
      revalidation.value = true;
    }
    // 调用 React 的 use() hook
    // - Promise pending → throw Promise，触发 Suspense
    // - Promise fulfilled → 返回结果，继续渲染
    use(revalidation);
  }

  // 这下面的 stateDependencies 之所以要记录是为了做性能优化
  const swrResponse: SWRResponse<Data, Error> = {
    mutate: boundMutate,
    get data() {
      // 记录这个组件用了 data
      stateDependencies.data = true;
      return returnedData;
    },
    get error() {
      // 记录这个组件用了 error
      stateDependencies.error = true;
      return error;
    },
    get isValidating() {
      // 记录这个组件用了 isValidating
      stateDependencies.isValidating = true;
      return isValidating;
    },
    get isLoading() {
      // 记录这个组件用了 isLoading
      stateDependencies.isLoading = true;
      return isLoading;
    },
  };
  return swrResponse;
};

const useSWR = withArgs<SWRHook>(useSWRHandler);

export default useSWR;

const WITH_DEDUPE = { dedupe: true };
// 复用已经完成的 promise
const resolvedUndef = Promise.resolve(UNDEFINED);
type DefinitelyTruthy<T> = false extends T
  ? never
  : 0 extends T
  ? never
  : "" extends T
  ? never
  : null extends T
  ? never
  : undefined extends T
  ? never
  : T;
