import { useContext, useMemo } from "react";
import { FullConfiguration } from "../types";
import { SWRConfigContext } from "./config-context";
import { mergeObjects } from "./shared";
import { defaultConfig } from "./config";

export const useSWRConfig = (): FullConfiguration => {
  const parentConfig = useContext(SWRConfigContext);
  const mergedConfig = useMemo(
    () => mergeObjects(defaultConfig, parentConfig),
    [parentConfig]
  );
  return mergedConfig;
};
