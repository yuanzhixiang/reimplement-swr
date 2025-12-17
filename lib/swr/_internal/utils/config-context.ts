import { createContext } from "react";
import { FullConfiguration } from "../types";

export const SWRConfigContext = createContext<Partial<FullConfiguration>>({});
