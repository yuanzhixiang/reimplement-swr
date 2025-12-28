import React, { useEffect, useLayoutEffect } from "react";
import {
  hasRequestAnimationFrame,
  isLegacyDeno,
  isWindowDefined,
} from "./helper";

export const IS_REACT_LEGACY = !React.useId;
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

// React currently throws a warning when using useLayoutEffect on the server.
// To get around it, we can conditionally useEffect on the server (no-op) and
// useLayoutEffect in the browser.
// useIsomorphicLayoutEffect 是一个兼容 SSR 的 hook
export const useIsomorphicLayoutEffect = IS_SERVER
  ? // 服务端：用 useEffect（避免 SSR 警告）
    useEffect
  : // 客户端：用 useLayoutEffect（DOM 更新后、浏览器绘制前同步执行）
    useLayoutEffect;

// Adjust the config based on slow connection status (<= 70Kbps).
export const slowConnection =
  !IS_SERVER &&
  navigatorConnection &&
  (["slow-2g", "2g"].includes(navigatorConnection.effectiveType) ||
    navigatorConnection.saveData);
