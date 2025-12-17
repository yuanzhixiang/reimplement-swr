import { useSWRConfig } from "./use-swr-config";

export const withArgs = <SWRType>(hook: any) => {
  return function useSWRArgs(...args: any) {
    // Get the default and inherited configuration.
    const fallbackConfig = useSWRConfig();

    // Normalize arguments.
    // const [key, fn, _config] = normalize<any, any>(args);

    throw new Error("withArgs is not implemented yet");
  };
};
