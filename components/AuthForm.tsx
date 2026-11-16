'use client'

import { useState, type FormEvent } from 'react'
import { signIn, register } from '@/lib/api-client'
import { MIN_PASSWORD_LENGTH } from '@/lib/credentials'

type Mode = 'login' | 'register'

export interface AuthFormProps {
  /** Creating an account needs the invite code (REGISTRATION_CODE). */
  needsCode: boolean
  /** Called once signed in; by default a full load of `/`, so the server renders the chat for the new session. */
  onSignedIn?: () => void
}

const openChat = () => window.location.replace('/')

export function AuthForm({ needsCode, onSignedIn = openChat }: AuthFormProps) {
  const [mode, setMode] = useState<Mode>('login')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const registering = mode === 'register'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const field = (name: string) => String(form.get(name) ?? '')
    setPending(true)
    setError(null)
    try {
      if (registering) await register({ username: field('username'), password: field('password'), code: field('code') })
      else await signIn({ username: field('username'), password: field('password') })
      onSignedIn()
    } catch (e) {
      setError((e as Error).message)
      setPending(false)
    }
  }

  function switchTo(next: Mode) {
    setMode(next)
    setError(null)
  }

  return (
    <main className="auth">
      <form className="auth-card" onSubmit={submit} aria-labelledby="auth-title">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">§</span> secret interface
        </div>
        <h1 id="auth-title" className="auth-title">
          {registering ? 'Create an account' : 'Sign in'}
        </h1>
        <label className="auth-field">
          <span>Username</span>
          <input
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            minLength={registering ? 3 : undefined}
            maxLength={32}
          />
        </label>
        <label className="auth-field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete={registering ? 'new-password' : 'current-password'}
            required
            minLength={registering ? MIN_PASSWORD_LENGTH : undefined}
          />
        </label>
        {registering && needsCode && (
          <label className="auth-field">
            <span>Invite code</span>
            <input name="code" autoComplete="off" required />
          </label>
        )}
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="auth-submit" disabled={pending}>
          {pending ? 'One moment…' : registering ? 'Create account' : 'Sign in'}
        </button>
        <p className="auth-switch">
          {registering ? 'Already have an account?' : 'New here?'}{' '}
          <button type="button" className="link-button" onClick={() => switchTo(registering ? 'login' : 'register')}>
            {registering ? 'Sign in' : 'Create an account'}
          </button>
        </p>
      </form>
    </main>
  )
}
