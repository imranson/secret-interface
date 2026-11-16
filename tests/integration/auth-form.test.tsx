// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthForm } from '@/components/AuthForm'
import { getUserStore } from '@/lib/users'
import { appFetch } from '../helpers/app-fetch'
import { signIn, TEST_PASSWORD } from '../helpers/auth'
import { warmUpDatabase } from '../helpers/database'

beforeAll(warmUpDatabase)

beforeEach(() => {
  vi.stubGlobal('fetch', appFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderForm(needsCode = false) {
  const user = userEvent.setup()
  const onSignedIn = vi.fn()
  render(<AuthForm needsCode={needsCode} onSignedIn={onSignedIn} />)
  return { user, onSignedIn }
}

async function fill(user: ReturnType<typeof userEvent.setup>, username: string, password: string) {
  await user.type(screen.getByLabelText('Username'), username)
  await user.type(screen.getByLabelText('Password'), password)
}

describe('AuthForm (UI → auth routes → database)', () => {
  it('signs in', async () => {
    await signIn('ada')
    const { user, onSignedIn } = renderForm()
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    await fill(user, 'ada', TEST_PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce())
  })

  it('says when the password is wrong, and stays put', async () => {
    await signIn('ada')
    const { user, onSignedIn } = renderForm()
    await fill(user, 'ada', 'not my password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong username or password.')
    expect(onSignedIn).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('creates an account', async () => {
    const { user, onSignedIn } = renderForm()
    await user.click(screen.getByRole('button', { name: 'Create an account' }))
    expect(screen.getByRole('heading', { name: 'Create an account' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Invite code')).not.toBeInTheDocument()
    await fill(user, 'grace', 'long enough')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce())
    expect(await getUserStore().verify('grace', 'long enough')).toMatchObject({ username: 'grace' })
  })

  it('asks for the invite code when one is set', async () => {
    vi.stubEnv('REGISTRATION_CODE', 'friends')
    const { user, onSignedIn } = renderForm(true)
    await user.click(screen.getByRole('button', { name: 'Create an account' }))
    await fill(user, 'grace', 'long enough')
    await user.type(screen.getByLabelText('Invite code'), 'guess')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('That invite code is not right.')

    await user.clear(screen.getByLabelText('Invite code'))
    await user.type(screen.getByLabelText('Invite code'), 'friends')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce())
  })
})
