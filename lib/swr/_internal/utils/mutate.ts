import { serialize } from "./serialize";
import { createCacheHelper } from "./helper";
import {
  isFunction,
  isUndefined,
  UNDEFINED,
  mergeObjects,
  isPromiseLike,
} from "./shared";
import { SWRGlobalState } from "./global-state";
import { getTimestamp } from "./timestamp";
import * as revalidateEvents from "../events";
import type {
  Cache,
  MutatorCallback,
  MutatorOptions,
  GlobalState,
  State,
  Arguments,
  Key,
} from "../types";

type KeyFilter = (key?: Arguments) => boolean;
type MutateState<Data> = State<Data, any> & {
  // The previously committed data.
  _c?: Data;
};

export async function internalMutate<Data>(
  cache: Cache,
  _key: KeyFilter,
  _data?: Data | Promise<Data | undefined> | MutatorCallback<Data>,
  _opts?: boolean | MutatorOptions<Data>
): Promise<Array<Data | undefined>>;
export async function internalMutate<Data>(
  cache: Cache,
  _key: Arguments,
  _data?: Data | Promise<Data | undefined> | MutatorCallback<Data>,
  _opts?: boolean | MutatorOptions<Data>
): Promise<Data | undefined>;
export async function internalMutate<Data>(
  ...args: [
    cache: Cache,
    _key: KeyFilter | Arguments,
    _data?: Data | Promise<Data | undefined> | MutatorCallback<Data>,
    _opts?: boolean | MutatorOptions<Data>
  ]
): Promise<any> {
  // 因为他有函数重载签名，所以这里他用剩余参数收集所有参数，然后解构出来
  const [cache, _key, _data, _opts] = args;

  // When passing as a boolean, it's explicitly used to disable/enable
  // revalidation.
  // populateCache: true：更新缓存
  // throwOnError: true：出错时抛出异常
  // 这里是为了处理简写：mutate(key, data, true) 让他等价于等价于 mutate(key, data, { revalidate: true })
  const options = mergeObjects(
    { populateCache: true, throwOnError: true },
    typeof _opts === "boolean" ? { revalidate: _opts } : _opts || {}
  );

  // 是否将数据写入缓存
  let populateCache = options.populateCache;

  const rollbackOnErrorOption = options.rollbackOnError;
  // 乐观更新的数据
  let optimisticData = options.optimisticData;

  // 出错时是否回滚乐观更新（默认 true）
  const rollbackOnError = (error: unknown): boolean => {
    return typeof rollbackOnErrorOption === "function"
      ? rollbackOnErrorOption(error)
      : rollbackOnErrorOption !== false;
  };
  // 是否抛出错误
  const throwOnError = options.throwOnError;

  // If the second argument is a key filter, return the mutation results for all
  // filtered keys.
  // 先检查 _key 是不是一个函数，这里 _key 可能是字符串，也可能是个函数
  // mutate('/api/user', newData)
  // mutate(key => key.startsWith('/api/'), newData)
  if (isFunction(_key)) {
    // 把 _key 重命名为 keyFilter，语义更清晰
    const keyFilter = _key;
    // 用于存储所有符合条件的 key
    const matchedKeys: Key[] = [];
    // 从缓存中取出所有的 key
    const it = cache.keys();
    // 开始遍历所有的 key
    for (const key of it) {
      // 跳过特殊前缀的 key，以 $inf$ 和 $sub$ 开头的都不匹配
      if (
        // Skip the special useSWRInfinite and useSWRSubscription keys.
        !/^\$(inf|sub)\$/.test(key) &&
        // 这里取出缓存的状态对象，这里面的 _k 是用户传入的原始的 key
        // { data: {...}, error: null, _k: '/api/user' }
        // _k 是用户传入的原始的数据
        keyFilter((cache.get(key) as { _k: Arguments })._k)
      ) {
        // 如果匹配那么则收集这些 key
        matchedKeys.push(key);
      }
    }
    // 批量执行匹配上的 key，调用 mutateByKey 方法
    return Promise.all(matchedKeys.map(mutateByKey));
  }

  // 对于字符串 key，则直接执行 mutateByKey
  return mutateByKey(_key);

  async function mutateByKey(_k: Key): Promise<Data | undefined> {
    // Serialize key
    const [key] = serialize(_k);
    if (!key) return;
    const [get, set] = createCacheHelper<Data, MutateState<Data>>(cache, key);
    const [EVENT_REVALIDATORS, MUTATION, FETCH, PRELOAD] = SWRGlobalState.get(
      cache
    ) as GlobalState;

    const startRevalidate = () => {
      const revalidators = EVENT_REVALIDATORS[key];
      const revalidate = isFunction(options.revalidate)
        ? options.revalidate(get().data, _k)
        : options.revalidate !== false;
      if (revalidate) {
        // Invalidate the key by deleting the concurrent request markers so new
        // requests will not be deduped.
        delete FETCH[key];
        delete PRELOAD[key];
        if (revalidators && revalidators[0]) {
          // 在这里触发新的加载请求
          return revalidators[0](revalidateEvents.MUTATE_EVENT).then(
            () => get().data
          );
        }
      }
      return get().data;
    };

    // If there is no new data provided, revalidate the key with current state.
    if (args.length < 3) {
      // Revalidate and broadcast state.
      return startRevalidate();
    }

    let data: any = _data;
    let error: unknown;
    let isError = false;

    // Update global timestamps.
    const beforeMutationTs = getTimestamp();
    MUTATION[key] = [beforeMutationTs, 0];

    const hasOptimisticData = !isUndefined(optimisticData);
    const state = get();

    // `displayedData` is the current value on screen. It could be the optimistic value
    // that is going to be overridden by a `committedData`, or get reverted back.
    // `committedData` is the validated value that comes from a fetch or mutation.
    const displayedData = state.data;
    const currentData = state._c;
    const committedData = isUndefined(currentData)
      ? displayedData
      : currentData;

    // Do optimistic data update.
    if (hasOptimisticData) {
      optimisticData = isFunction(optimisticData)
        ? optimisticData(committedData, displayedData)
        : optimisticData;

      // When we set optimistic data, backup the current committedData data in `_c`.
      set({ data: optimisticData, _c: committedData });
    }

    if (isFunction(data)) {
      // `data` is a function, call it passing current cache value.
      try {
        data = (data as MutatorCallback<Data>)(committedData);
      } catch (err) {
        // If it throws an error synchronously, we shouldn't update the cache.
        error = err;
        isError = true;
      }
    }

    // `data` is a promise/thenable, resolve the final data first.
    if (data && isPromiseLike(data)) {
      // This means that the mutation is async, we need to check timestamps to
      // avoid race conditions.
      data = await (data as Promise<Data>).catch((err) => {
        error = err;
        isError = true;
      });

      // Check if other mutations have occurred since we've started this mutation.
      // If there's a race we don't update cache or broadcast the change,
      // just return the data.
      if (beforeMutationTs !== MUTATION[key][0]) {
        if (isError) throw error;
        return data;
      } else if (isError && hasOptimisticData && rollbackOnError(error)) {
        // Rollback. Always populate the cache in this case but without
        // transforming the data.
        populateCache = true;

        // Reset data to be the latest committed data, and clear the `_c` value.
        set({ data: committedData, _c: UNDEFINED });
      }
    }

    // If we should write back the cache after request.
    if (populateCache) {
      if (!isError) {
        // Transform the result into data.
        if (isFunction(populateCache)) {
          const populateCachedData = populateCache(data, committedData);
          set({ data: populateCachedData, error: UNDEFINED, _c: UNDEFINED });
        } else {
          // Only update cached data and reset the error if there's no error. Data can be `undefined` here.
          set({ data, error: UNDEFINED, _c: UNDEFINED });
        }
      }
    }

    // Reset the timestamp to mark the mutation has ended.
    MUTATION[key][1] = getTimestamp();

    // Update existing SWR Hooks' internal states:
    Promise.resolve(startRevalidate()).then(() => {
      // The mutation and revalidation are ended, we can clear it since the data is
      // not an optimistic value anymore.
      set({ _c: UNDEFINED });
    });

    // Throw error or return data
    if (isError) {
      if (throwOnError) throw error;
      return;
    }
    return data;
  }
}
