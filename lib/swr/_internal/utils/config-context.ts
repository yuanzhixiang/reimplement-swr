import type { FC, PropsWithChildren } from "react";
import {
  createContext,
  createElement,
  useContext,
  useMemo,
  useRef,
} from "react";
import { cache as defaultCache } from "./config";
import { initCache } from "./cache";
import { mergeConfigs } from "./merge-config";
import { UNDEFINED, mergeObjects, isFunction } from "./shared";
import { useIsomorphicLayoutEffect } from "./env";
import type { SWRConfiguration, FullConfiguration } from "../types";

// 创建一个 React Context，用于在组件树中共享 SWR 配置，默认值是空对象。
export const SWRConfigContext = createContext<Partial<FullConfiguration>>({});

// 带 children 的函数组件
const SWRConfig: FC<
  PropsWithChildren<{
    // value 可以是两种形式，一种是传入 SWRConfiguration，另一种是传入函数，
    // 但返回值是 SWRConfiguration
    value?:
      | SWRConfiguration
      | ((parentConfig?: SWRConfiguration) => SWRConfiguration);
  }>
> = (props) => {
  // 解构出用户传的 value
  const { value } = props;
  // 通过 useContext 获取父级 SWRConfig 的配置（支持嵌套）
  const parentConfig = useContext(SWRConfigContext);
  // 判断 value 是不是函数
  const isFunctionalConfig = isFunction(value);
  // 获取 config 具体的值，并加上缓存
  const config = useMemo(
    () =>
      isFunctionalConfig
        ? // 如果是函数，调用它并传入父配置
          value(parentConfig)
        : // 如果是对象，直接用
          value,
    [isFunctionalConfig, parentConfig, value]
  );

  // Extend parent context values and middleware.
  // 合并配置
  const extendedConfig = useMemo(
    () =>
      isFunctionalConfig
        ? // 函数配置：用户自己处理合并了，直接用
          config
        : // 对象配置：自动和父配置合并
          mergeConfigs(parentConfig, config),
    [isFunctionalConfig, parentConfig, config]
  );

  // Should not use the inherited provider.
  // 自定义缓存 Provider，获取 provider（自定义缓存提供者）
  const provider = config && config.provider;

  // initialize the cache only on first access.
  // 用 useRef 确保只初始化一次
  const cacheContextRef = useRef<ReturnType<typeof initCache>>(UNDEFINED);
  if (provider && !cacheContextRef.current) {
    // 调用 initCache 创建缓存上下文
    cacheContextRef.current = initCache(
      provider((extendedConfig as any).cache || defaultCache),
      config
    );
  }
  const cacheContext = cacheContextRef.current;

  // Override the cache if a new provider is given.
  // 注入缓存到配置，cacheContext 是元组 [cache, mutate, subscribe, unsubscribe]
  if (cacheContext) {
    (extendedConfig as any).cache = cacheContext[0];
    (extendedConfig as any).mutate = cacheContext[1];
  }

  // Unsubscribe events.
  // 组件挂载时订阅，卸载时取消订阅。
  useIsomorphicLayoutEffect(() => {
    if (cacheContext) {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      // 调用 subscribe
      cacheContext[2] && cacheContext[2]();
      // 返回 unsubscribe 作为清理函数
      return cacheContext[3];
    }
  }, []);

  // 渲染 Context.Provider，把合并后的配置传给所有子组件。
  return createElement(
    SWRConfigContext.Provider,
    mergeObjects(props, {
      value: extendedConfig,
    })
  );
};

export default SWRConfig;
