declare module "sonner" {
  import * as React from "react"
  export const Toaster: React.ComponentType<any>
  export const toast: {
    success: (msg: string) => void
    error: (msg: string) => void
    info: (msg: string) => void
    message: (msg: string) => void
  }
}


