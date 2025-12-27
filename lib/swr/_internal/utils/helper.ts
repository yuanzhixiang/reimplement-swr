const STR_UNDEFINED = "undefined";

// 这段代码用于检测当前环境是否支持 requestAnimationFrame API
export const hasRequestAnimationFrame = () =>
  isWindowDefined && typeof window["requestAnimationFrame"] != STR_UNDEFINED;

export const isWindowDefined = typeof window != STR_UNDEFINED;
export const isDocumentDefined = typeof document != STR_UNDEFINED;
export const isLegacyDeno = isWindowDefined && "Deno" in window;
