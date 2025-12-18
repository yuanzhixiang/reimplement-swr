export interface SWRHook {}

export type FullConfiguration = {};

/**
 * Response type that can be returned by fetcher functions.
 *
 * @template Data - The type of data returned by the fetcher
 * @public
 */
// 定义 Fetcher 的 response 类型，要么是具体的类型，那么就是 promise
export type FetcherResponse<Data = unknown> = Data | Promise<Data>;

/**
 * Typed fetcher function that is constrained by the SWR key type.
 *
 * Provides type safety by ensuring the fetcher argument matches the key type.
 * The conditional type logic ensures that:
 * - If the key is a function returning a value, the fetcher receives that value
 * - If the key is falsy (null, undefined, false), the fetcher is never called
 * - Otherwise, the fetcher receives the key directly as its argument
 *
 * @template Data - The type of data returned by the fetcher
 * @template SWRKey - The type of the SWR key, used to infer fetcher arguments
 * @public
 */
export type Fetcher<
  // 定义泛型 Data 和 SWRKey
  Data = unknown,
  SWRKey extends Key = Key
> =
  // 开始进行类型推理，根据 SWRKey 的类型不断用三目表达式去推理出 Fetcher 的具体类型
  // 这里的 () => infer Arg | null | undefined | false 表示的是下面
  // (() => (infer Arg | null | undefined | false)) 这样一个具体的函数类型
  // 他这个写法表示这是一个入参为空，返回参数为 Arg | null | undefined | false 的函数
  // infer Arg 在这里的作用是捕获非 falsy 的部分，例如函数返回 number | string | null
  // 那么 null 会匹配到后面的 null 而 number | string 就会被当作 Arg 类型
  // 此时 Arg = number | string，然后在下面 (arg: Arg) 这样写的时候就等于 (arg: number | string)
  // 他这个类型推断就跑通了
  SWRKey extends () => infer Arg | null | undefined | false
    ? // 满足前面的条件则说明是函数类型，下面定义的就是函数
      (arg: Arg) => FetcherResponse<Data>
    : // 如果不满足前面的条件，那么就再次进行判断，这里和前面的区别是这里不是函数
    SWRKey extends null | undefined | false
    ? // 如果是 null | undefined | false 这些类型，那么就返回 never 类型
      never
    : // 如果不是 null | undefined | false 这些类型，那么将类型全部归为 Arg，这里和前面的区别是这里不是函数
    SWRKey extends infer Arg
    ? // 定义函数类型
      (arg: Arg) => FetcherResponse<Data>
    : // 如果不满足前面的类型，则返回 never 类型
      never;

/**
 * Represents a tuple of arguments that can be passed to a fetcher.
 *
 * The first element is typically the primary key (like a URL), followed
 * by additional parameters that affect the request (like query parameters,
 * headers, or request options).
 *
 */
// 这个类型的含义首先是 readonly 表示必须只读，防止被修改，
// 然后第一个 any 表示第一个参数必须存在，
// ...unknown[]	剩余元素，可以是 0 个或多个
// 这里用 unknown 而不是 any 更可能是一种风格偏好，表示这里接受任何值，但我不假设他的类型的感觉
type ArgumentsTuple = readonly [any, ...unknown[]];

/**
 * Valid types for SWR keys.
 *
 * SWR keys identify unique requests and can be:
 * - `string`: Simple URL or identifier
 * - `ArgumentsTuple`: Array with URL and additional parameters
 * - `Record<any, any>`: Object that will be serialized
 * - `null | undefined | false`: Falsy values disable the request
 *
 * When a key is falsy, SWR will not make the request, allowing for
 * conditional fetching based on application state.
 *
 * @public
 *
 * @example
 * ```ts
 * // String key
 * useSWR('/api/users', fetcher)
 *
 * // Array key with parameters
 * useSWR(['/api/user', userId], ([url, id]) => fetcher(`${url}/${id}`))
 *
 * // Object key
 * useSWR({ url: '/api/data', params: { page: 1 } }, fetcher)
 *
 * // Conditional key
 * useSWR(userId ? `/api/user/${userId}` : null, fetcher)
 * ```
 */
// Arguments 定义了 SWR 缓存键 Key 可以接受的所有有效类型
export type Arguments =
  // 简单字符串
  // useSWR('/api/users', fetcher)
  | string
  // 数组元组
  // useSWR(['/api/user', userId], ([url, id]) => fetcher(`${url}/${id}`))
  | ArgumentsTuple
  // 对象
  // useSWR({ url: '/api/data', params: { page: 1, filter: 'active' } }, fetcher)
  | Record<any, any>
  // 空值
  // 如果 key 是 null 不会发起请求
  | null
  // 未定义
  // 如果 key 是 undefined 不会发起请求
  | undefined
  // 布尔假值
  // 如果 key 是 false 不会发起请求
  | false;

/**
 * SWR key that can be static or a function that returns arguments.
 *
 * When a function is provided, it's called on each render to determine
 * the current key. This allows for dynamic keys based on component state
 * or props.
 *
 * @public
 *
 * @example
 * ```ts
 * // Static key
 * useSWR('/api/data', fetcher)
 *
 * // Dynamic key function
 * useSWR(() => user ? `/api/user/${user.id}` : null, fetcher)
 * ```
 */
// Key 传入数值和函数都是支持的
export type Key = Arguments | (() => Arguments);
