import { useContext, useMemo } from "react";
import { FullConfiguration } from "../types";
import { SWRConfigContext } from "./config-context";
import { mergeObjects } from "./shared";
import { defaultConfig } from "./config";

export const useSWRConfig = (): FullConfiguration => {
  // 从 react 的 context 当中读取 parent 配置
  const parentConfig = useContext(SWRConfigContext);
  // 将默认配置和 parent 配置合并在一起
  const mergedConfig = useMemo(
    () => mergeObjects(defaultConfig, parentConfig),
    [parentConfig]
  );
  return mergedConfig;
};
