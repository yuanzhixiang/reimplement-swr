import { stableHash } from './hash'
import { isFunction } from './shared'

import type { Key, Arguments } from '../types'

export const serialize = (key: Key): [string, Arguments] => {
  // 如果传入的是函数，那么获取函数的值
  // 例如 serialize(() => '/api/user')，key 等于 '/api/user'
  if (isFunction(key)) {
    try {
      key = key()
    } catch (err) {
      // dependencies not ready
      key = ''
    }
  }

  // Use the original key as the argument of fetcher. This can be a string or an
  // array of values.
  // 将 key 保存为 args
  const args = key

  // If key is not falsy, or not an empty array, hash it.
  key =
    typeof key == 'string'
      // 如果已经是字符串了，那么直接返回
      ? key
      : (Array.isArray(key) ? key.length : key)
        // 如果 key 是数组，且数组长度 > 0，或者其他 truthy 值，那么返回 stableHash(key)
        // 否则返回 ''
        ? stableHash(key)
        : ''

  // 最后返回 key 和 args
  // 例如 serialize(() => '/api/user') 
  //   则 key = '/api/user'        → 用于缓存查找、请求去重
  //   则 args = '/api/user'       → 传给 fetcher
  // 例如 serialize(['user', 123])
  //   则 key = '@"user",123,'     → 用于缓存查找、请求去重
  //   则 args = ['user', 123]     → 传给 fetcher
  return [key, args]
}
