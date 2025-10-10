import './globals.css'
export const metadata = { title: 'Product Testing OS', description: 'Generate angles, creatives, landing & ads' }
export default function RootLayout({children}:{children:React.ReactNode}){
  return (
    <html lang="en">
      <head>
        <script src="https://cdn.platform.openai.com/deployments/chatkit/chatkit.js" async></script>
      </head>
      <body>{children}</body>
    </html>
  )
}
