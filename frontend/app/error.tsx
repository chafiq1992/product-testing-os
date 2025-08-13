'use client'

export default function GlobalError(
  { error, reset }: { error: Error & { digest?: string }; reset: () => void }
){
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1>Something went wrong</h1>
      <p style={{ color: '#94a3b8', marginTop: 8 }}>
        {error?.message || 'Unexpected error'}
      </p>
      <button
        onClick={() => reset()}
        style={{
          marginTop: 12,
          padding: '8px 12px',
          borderRadius: 6,
          background: '#334155',
          color: '#fff'
        }}
      >
        Try again
      </button>
    </div>
  )
}


