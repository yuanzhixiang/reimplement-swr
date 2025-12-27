import { mergeConfigs } from "./merge-config";
import { useSWRConfig } from "./use-swr-config";
import { normalize } from "./normalize-args";
import { BUILT_IN_MIDDLEWARE } from "./middleware-preset";

// 这里定义 withArgs 高阶函数，实际就是返回一个新的函数
export const withArgs = <SWRType>(hook: any) => {
  // 这里传入的 ...args 其实就是 useSWR('/api/user', fetcher, options)
  // 内存中是 args = ['/api/user', fetcher, options]
  return function useSWRArgs(...args: any) {
    // Get the default and inherited configuration.
    // 获取全局的配置
    const fallbackConfig = useSWRConfig();

    // Normalize arguments.
    // 对参数进行标准化，因为 useSWR 支持多种参数模式，下面是支持的参数模式
    // useSWR('/api/user')                            // 只有 key
    // useSWR('/api/user', fetcher)                   // key + fetcher
    // useSWR('/api/user', { refreshInterval: 1000 }) // key + options
    // useSWR('/api/user', fetcher, options)          // key + fetcher + options
    // 他的参数本质是 [key, fn, config] 三元组
    const [key, fn, _config] = normalize<any, any>(args);

    // Merge configurations.
    // 合并配置，用户传入的配置 _config 会覆盖 fallbackConfig
    const config = mergeConfigs(fallbackConfig, _config);

    // Apply middleware
    // 传入的 hook 在这里赋值给 next，下面将使用 config 中的 use 构造调用链
    let next = hook;

    // 取出 config 中的 use，use 是一个数组，例如 [timerMiddleware]
    const { use } = config;
    // 这里他额外往里面塞两个中间件，devtools 只会在浏览器安装了 https://chromewebstore.google.com/detail/swr-devtools/liidbicegefhheghhjbomajjaehnjned 的时候才会被注入这里
    // middleware = [timerMiddleware, devtools, preload]
    // 下面有 devtools 和 preload 的源码解读
    const middleware = (use || []).concat(BUILT_IN_MIDDLEWARE);
    // 构造调用链，最终的调用链是 timerMiddleware-> devtools-> preload
    for (let i = middleware.length; i--; ) {
      // 保存调用结果
      next = middleware[i](next);
    }

    // 开始执行调用链 timerMiddleware-> devtools-> preload
    return next(key, fn || config.fetcher || null, config);
    // TODO 他这里的 SWRType 是什么意思？
  } as unknown as SWRType;
};
