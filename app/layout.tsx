import type { Metadata, Viewport } from 'next'
import { Source_Serif_4 } from 'next/font/google'
import type { ReactNode } from 'react'
import './globals.css'

// Assistant replies are set in Source Serif 4 with optical sizing for comfortable long-form reading.
const serif = Source_Serif_4({
  subsets: ['latin'],
  style: ['normal', 'italic'],
  axes: ['opsz'],
  variable: '--font-serif',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'secret interface',
  description: 'A chat client for Ollama cloud models with web search, web fetch and thinking.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f5f0' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1917' },
  ],
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={serif.variable}>
      <body>{children}</body>
    </html>
  )
}
