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
  throw new Error("");
}
