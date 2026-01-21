// / <reference types="vite/client" />

// Type declarations for Vite worker imports with ?worker&url suffix
declare module '*?worker&url' {
  const workerUrl: string
  export default workerUrl
}
