// useSWR
import useSWR from "./use-swr";
export default useSWR;

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SWRGlobalConfig {
  // suspense: true
}

// Types
export type {
  SWRConfiguration,
  Revalidator,
  RevalidatorOptions,
  Key,
  // KeyLoader,
  KeyedMutator,
  SWRHook,
  SWRResponse,
  Cache,
  BareFetcher,
  Fetcher,
  MutatorCallback,
  MutatorOptions,
  Middleware,
  Arguments,
  State,
  ScopedMutator,
} from "../_internal";
