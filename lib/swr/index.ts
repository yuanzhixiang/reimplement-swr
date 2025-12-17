import { SWRHook } from "./_internal/types"
import { withArgs } from "./_internal/utils/resolve-args";

export const useSWRHandler = () => {
  throw new Error("useSWRHandler is not implemented yet");
}

const useSWR = withArgs<SWRHook>(useSWRHandler)

export default useSWR
