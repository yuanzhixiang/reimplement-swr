import { isWindowDefined, isLegacyDeno } from "./helper";

export const IS_SERVER = !isWindowDefined || isLegacyDeno;

// This assignment is to extend the Navigator type to use effectiveType.
const navigatorConnection =
  typeof navigator !== "undefined" &&
  (
    navigator as Navigator & {
      connection?: {
        effectiveType: string;
        saveData: boolean;
      };
    }
  ).connection;

// Adjust the config based on slow connection status (<= 70Kbps).
export const slowConnection =
  !IS_SERVER &&
  navigatorConnection &&
  (["slow-2g", "2g"].includes(navigatorConnection.effectiveType) ||
    navigatorConnection.saveData);
