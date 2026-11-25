// usage: node approve.mjs headless|window < URL
// Opens the approval URL printed by `aws sso login --no-browser` in awsc's own Chromium profile and clicks Allow.
// It never types anything: signing in to the identity provider is left to the user.
//   headless  no window; stops at the first page that is not AWS (the identity provider wants a sign-in)
//   window    headless first; if a sign-in is needed, reopens the same URL in a window for the user
// Exit: 0 the approval reached the CLI, 4 the user must sign in (headless), 1 anything else. Messages on stderr.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

// Seconds to wait on an AWS page for the Allow button, then for the page to move on; an approval takes a few seconds.
const APPROVE_TIMEOUT = Number(process.env.AWSC_TIMEOUT || 60)
// Seconds the user has to sign in in the window.
const SIGNIN_TIMEOUT = 600
// Milliseconds between two looks at the page: fast enough to feel instant, slow enough to cost nothing.
const POLL_MS = 250
// The only hosts where Allow is clicked: the access portal, the SSO OIDC and portal endpoints, AWS sign-in.
const AWS_HOSTS = [/\.awsapps\.com$/, /^(oidc|portal\.sso)\.[a-z0-9-]+\.amazonaws\.com$/, /(^|\.)signin\.aws$/]
// Where the CLI waits for the approval (`aws sso login` listens on the loopback).
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]'])

const mode = process.argv[2]
if (mode !== 'headless' && mode !== 'window') {
    console.error('usage: node approve.mjs headless|window < URL')
    process.exit(2)
}
const url = fs.readFileSync(0, 'utf8').trim()
const profileDir = path.join(process.env.AWSC_STATE_DIR, 'chromium')
const isAws = (host) => AWS_HOSTS.some((re) => re.test(host))
const isCallback = (u) => LOOPBACK.has(u.hostname) && u.pathname === '/oauth/callback'

// A look at a page that is navigating can fail with these; the next look sees the new page.
const NAVIGATING = /Execution context was destroyed|Target page, context or browser has been closed|navigation/i

async function attempt(headless) {
    const args = process.env.AWSC_TEST_HOST_RULES ? [`--host-resolver-rules=${process.env.AWSC_TEST_HOST_RULES}`] : []
    const context = await chromium.launchPersistentContext(profileDir, { channel: 'chromium', headless, args })
    try {
        const page = context.pages()[0] ?? (await context.newPage())
        await page.goto(url, { waitUntil: 'commit' })
        let deadline = Date.now() + APPROVE_TIMEOUT * 1000
        let signingIn = false
        for (;;) {
            const here = new URL(page.url())
            if (isCallback(here)) return 0
            try {
                if (!isAws(here.hostname)) {
                    if (headless) {
                        console.error(`awsc: ${here.hostname} is not an AWS page: you must sign in to the SSO portal`)
                        return 4
                    }
                    if (!signingIn) {
                        signingIn = true
                        deadline = Date.now() + SIGNIN_TIMEOUT * 1000
                        console.error('awsc: sign in to the SSO portal in the Chromium window; awsc clicks Allow afterwards')
                    }
                } else {
                    const allow = page.getByRole('button', { name: /^allow( access)?$/i })
                    if (await allow.isVisible()) {
                        const before = page.url()
                        await allow.click()
                        await page.waitForURL((u) => u.href !== before, { timeout: APPROVE_TIMEOUT * 1000 })
                        deadline = Date.now() + APPROVE_TIMEOUT * 1000
                    } else if (headless && (await page.locator('input[type=password]').isVisible())) {
                        console.error(`awsc: ${here.hostname} asks for a password: you must sign in to the SSO portal`)
                        return 4
                    }
                }
            } catch (error) {
                if (!NAVIGATING.test(error.message)) throw error
            }
            if (Date.now() > deadline) {
                const title = await page.title()
                console.error(`awsc: no Allow button on ${here.hostname} ("${title}") after ${APPROVE_TIMEOUT} s`)
                return 1
            }
            await page.waitForTimeout(POLL_MS)
        }
    } finally {
        await context.close()
    }
}

try {
    let status = await attempt(true)
    if (status === 4 && mode === 'window') status = await attempt(false)
    process.exit(status)
} catch (error) {
    console.error(`awsc: the browser failed: ${error.message.split('\n')[0]}`)
    process.exit(1)
}
