'use client'

import { useState } from 'react'
import useSWR, { preload } from 'swr'

// 模拟 fetcher，延迟 1 秒
const fetcher = async (url: string) => {
  console.log(`[Fetcher] 开始请求: ${url}`)
  await new Promise(resolve => setTimeout(resolve, 1000))
  console.log(`[Fetcher] 请求完成: ${url}`)
  return { message: `数据来自 ${url}`, time: new Date().toLocaleTimeString() }
}

// 用户详情组件
function UserDetail() {
  const { data, isLoading } = useSWR('/api/user', fetcher)

  if (isLoading) return <p>加载中...</p>
  return <pre>{JSON.stringify(data, null, 2)}</pre>
}

export default function PreloadDemo() {
  const [showDetail, setShowDetail] = useState(false)

  return (
    <div style={{ padding: '20px' }}>
      <h1>SWR Preload Demo</h1>

      <div style={{ marginBottom: '20px' }}>
        <button
          onMouseEnter={() => {
            console.log('[Preload] 鼠标悬停，开始预加载')
            preload('/api/user', fetcher)
          }}
          onClick={() => setShowDetail(true)}
          style={{ padding: '10px 20px', fontSize: '16px', cursor: 'pointer' }}
        >
          查看用户详情（悬停预加载）
        </button>
      </div>

      {showDetail && <UserDetail />}

      <p style={{ color: '#666', marginTop: '20px' }}>
        打开控制台，鼠标悬停按钮时会触发预加载，点击后数据直接显示
      </p>
    </div>
  )
}
