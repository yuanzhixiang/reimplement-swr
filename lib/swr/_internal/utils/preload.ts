import type {
  Middleware,
  Key,
  BareFetcher,
  GlobalState,
  FetcherResponse,
} from "../types";
import { serialize } from "./serialize";
import { cache } from "./config";
import { SWRGlobalState } from "./global-state";
import { isUndefined } from "./shared";
import { INFINITE_PREFIX } from "../constants";

// devtoolsUse.concat(preload) 中注册的 preload 其实就是这里的 middleware
export const middleware: Middleware =
  // 这里是一个函数，实际上等价于另一种写法，看不懂的话看下面柯里化函数的解释
  (useSWRNext) => (key_, fetcher_, config) => {
    // fetcher might be a sync function, so this should not be an async function
    // 对 fetcher_ 进行包装，fetcher_ 是用户传入的函数
    const fetcher =
      // 当 fetcher_ 存在时才会包装它
      fetcher_ &&
      // 例如 HelloWorld 里面的例子，args = ['/api/user']
      ((...args: any[]) => {
        // 将传入的 key_ 序列化变成一个可以用来去重的 key
        const [key] = serialize(key_);
        // 从下面可以看到，PRELOAD 的数据结构是 Record<string, FetcherResponse<any>>
        // PRELOAD 本身是一个对象，存储预加载的请求：
        // PRELOAD = {
        //   '/api/user': Promise<...>,
        //   '/api/posts': Promise<...>,
        // }
        // TODO 这里拿出 PRELOAD 我没完全理解
        const [, , , PRELOAD] = SWRGlobalState.get(cache) as GlobalState;

        // INFINITE_PREFIX 的实现是 export const INFINITE_PREFIX = '$inf$'
        // 包含 $inf$ 的 key 说明是 useSWRInfinite
        // 对于无限加载场景，preload 逻辑在 useSWRInfinite 内部单独处理
        // 这里直接调用原始 fetcher，不走 preload 缓存逻辑
        if (key.startsWith(INFINITE_PREFIX)) {
          // we want the infinite fetcher to be called.
          // handling of the PRELOAD cache happens there.
          return fetcher_(...args);
        }

        // 如果之前调用过 preload('/api/user', fetcher)
        // 那么这里就可以直接根据 key 找到缓存
        const req = PRELOAD[key];
        // 如果这里的 req 是 underfine 那么说明没有缓存，正常请求就行了
        if (isUndefined(req)) return fetcher_(...args);
        // 如果已经预加载过了，那么这里删除掉缓存
        delete PRELOAD[key];
        // 返回缓存
        return req;
      });

    // 沿着调用链继续调用中间件
    return useSWRNext(key_, fetcher, config);
  };
