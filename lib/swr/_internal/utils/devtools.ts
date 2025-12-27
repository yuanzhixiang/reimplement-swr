import React from "react";
import { isWindowDefined } from "./helper";

// @ts-expect-error
// 检查是否启用 devtools，条件是存在 window 对象，并且 window 对象上放了 devtools 的 swr use
const enableDevtools = isWindowDefined && window.__SWR_DEVTOOLS_USE__;

export const use = enableDevtools
  ? // @ts-expect-error
  // 只在启用的情况下才导出，否则导出空数组，这个 __SWR_DEVTOOLS_USE__ 应该是插件自己的实现
  window.__SWR_DEVTOOLS_USE__
  : [];

// 如果要启用 devtools，那么把 SWR 内部使用的 React 实例暴露给 DevTools 浏览器插件
// SWR 被 import 时就会执行下面这段代码
export const setupDevTools = () => {
  if (enableDevtools) {
    // @ts-expect-error
    window.__SWR_DEVTOOLS_REACT__ = React;
  }
};
