import React, {
  useCallback,
  useRef,
  useDebugValue,
  useMemo,
  useSyncExternalStore,
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

  throw new Error("useSWRHandler is not implemented yet");
};

const useSWR = withArgs<SWRHook>(useSWRHandler);

export default useSWR;
