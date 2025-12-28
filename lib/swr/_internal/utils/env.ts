import React, { useEffect, useLayoutEffect } from "react";
import {
  hasRequestAnimationFrame,
  isLegacyDeno,
  isWindowDefined,
} from "./helper";

export const IS_REACT_LEGACY = !React.useId;
export const IS_SERVER = !isWindowDefined || isLegacyDeno;

// Polyfill requestAnimationFrame
// 这是一个 requestAnimationFrame 的 polyfill（兼容方案）
// 现代浏览器支持 requestAnimationFrame，但 Node.js（SSR）和老旧浏览器环境不支持
export const rAF = (
  // 参数是一个回调函数
  f: (...args: any[]) => void
): // 返回值类型
number | ReturnType<typeof setTimeout> =>
  // 如果浏览器支持 requestAnimationFrame，就用它
  hasRequestAnimationFrame()
    ? // 使用默认的 requestAnimationFrame
      window["requestAnimationFrame"](f)
    : // 否则用 setTimeout 作为替代
      setTimeout(f, 1);
/*
rAF 的作用是将一些动作推到下一帧执行
rAF(() => {
  // 延迟到下一帧执行的操作
  // 比如批量更新状态、触发回调等
})
*/

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
