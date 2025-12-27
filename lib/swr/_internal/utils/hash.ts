import { OBJECT, isUndefined } from './shared'


// use WeakMap to store the object->key mapping
// so the objects can be garbage collected.
// WeakMap uses a hashtable under the hood, so the lookup
// complexity is almost O(1).
// 创建一个 WeakMap 用于存储对象到哈希值的映射
// 使用 WeakMap 的好处是：当对象不再被引用时可以被垃圾回收，且查找复杂度接近 O(1)
const table = new WeakMap<object, number | string>()

// 获取值的精确类型名，如 [object Array]、[object Date] 等
const getTypeName = (value: any) => OBJECT.prototype.toString.call(value)

// 检查类型名是否匹配指定类型
const isObjectTypeName = (typeName: string, type: string) =>
  typeName === `[object ${type}]`

// counter of the key
// 用于生成唯一的哈希 ID，每次遇到新对象时递增
let counter = 0

// A stable hash implementation that supports:
// - Fast and ensures unique hash properties
// - Handles unserializable values
// - Handles object key ordering
// - Generates short results
//
// This is not a serialization function, and the result is not guaranteed to be
// parsable.
export const stableHash = (arg: any): string => {
  // 获取参数的基本类型和精确类型
  const type = typeof arg
  const typeName = getTypeName(arg)

  // 分别检查是否是 Date、RegExp、普通对象
  const isDate = isObjectTypeName(typeName, 'Date')
  const isRegex = isObjectTypeName(typeName, 'RegExp')
  const isPlainObject = isObjectTypeName(typeName, 'Object')
  let result: any
  let index: any

  // 判断是否是非 null 的对象/函数，且不是 Date 或 RegExp
  if (OBJECT(arg) === arg && !isDate && !isRegex) {
    // Object/function, not null/date/regexp. Use WeakMap to store the id first.
    // If it's already hashed, directly return the result.
    // 如果对象已经被哈希过，直接返回缓存结果（避免重复计算）
    result = table.get(arg)
    if (result) return result

    // Store the hash first for circular reference detection before entering the
    // recursive `stableHash` calls.
    // For other objects like set and map, we use this id directly as the hash.
    // 先存储一个临时哈希值，用于检测循环引用（如 obj.self = obj）
    result = ++counter + '~'
    table.set(arg, result)

    // 数组处理：以 @ 开头，递归哈希每个元素，用逗号分隔
    if (Array.isArray(arg)) {
      // Array.
      result = '@'
      for (index = 0; index < arg.length; index++) {
        result += stableHash(arg[index]) + ','
      }
      table.set(arg, result)
    }
    // 普通对象处理：以 # 开头
    if (isPlainObject) {
      // Object, sort keys.
      result = '#'
      // 对 keys 排序，确保 {a:1, b:2} 和 {b:2, a:1} 生成相同哈希
      const keys = OBJECT.keys(arg).sort()
      // 递归处理每个属性值
      while (!isUndefined((index = keys.pop() as string))) {
        if (!isUndefined(arg[index])) {
          result += index + ':' + stableHash(arg[index]) + ','
        }
      }
      table.set(arg, result)
    }
  } else {
    // 原始值处理：根据类型转换为字符串表示
    result = isDate
      // Date -> ISO 字符串
      ? arg.toJSON()
      : type == 'symbol'
        // Symbol -> "Symbol(xxx)"
        ? arg.toString()
        : type == 'string'
          // 字符串加引号，区分 "1" 和 1
          ? JSON.stringify(arg)
          // 其他（number, boolean, null）直接转字符串
          : '' + arg
  }

  return result
}