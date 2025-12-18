import { mergeConfigs } from "./merge-config";
import { useSWRConfig } from "./use-swr-config";
import { normalize } from "./normalize-args";

export const withArgs = <SWRType>(hook: any) => {
  return function useSWRArgs(...args: any) {
    // Get the default and inherited configuration.
    const fallbackConfig = useSWRConfig();

    // Normalize arguments.
    const [key, fn, _config] = normalize<any, any>(args);

    // Merge configurations.
    const config = mergeConfigs(fallbackConfig, _config);

    throw new Error("withArgs is not implemented yet");
  };
};
