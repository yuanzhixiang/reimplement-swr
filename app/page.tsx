"use client";

import useSWR from "swr"; // , { Middleware, SWRHook }

// 记录请求耗时的中间件
// const timerMiddleware: Middleware = (useSWRNext: SWRHook) => {
//   return (key, fetcher, config) => {
//     const start = Date.now()
//     console.log('⏱️ [Timer] 开始计时')

//     const swr = useSWRNext(key, fetcher, config)

//     console.log(`⏱️ [Timer] 当前耗时: ${Date.now() - start}ms`)

//     return swr
//   }
// }

// 模拟 fetcher
const fetcher = async (url: string) => {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  return { message: "Hello SWR", url };
};

export default function SWRMiddlewareDemo() {
  const { data, isLoading, mutate } = useSWR("/api/demo", fetcher, {
    // use: [timerMiddleware],
    // revalidateOnFocus: false,
  });

  return (
    <div style={{ padding: "20px" }}>
      <h1>SWR 中间件 Demo</h1>
      {isLoading ? (
        <p>加载中...</p>
      ) : (
        <pre>{JSON.stringify(data, null, 2)}</pre>
      )}
      <p>打开控制台查看请求耗时日志</p>
      <button onClick={() => mutate()}>Mutate</button>
    </div>
  );
}
