// usage: node approve.mjs headless|window < URL
// Opens the approval URL printed by `aws sso login --no-browser` in awsc's own Chromium profile and clicks Allow.
// It never types anything: signing in to the identity provider is left to the user.
//   headless  no window; goes through the identity provider when its session is alive (it sends the browser back to
//             AWS by itself), stops when it shows a sign-in field or keeps the browser AWSC_IDP_GRACE seconds
//   window    headless first; if a sign-in is needed, reopens the same URL in a window for the user
// Exit: 0 the approval reached the CLI, 4 the user must sign in (headless), 1 anything else. Messages on stderr.
import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

// Seconds to wait on an AWS page for the Allow button, then for the page to move on; an approval takes a few seconds.
const APPROVE_TIMEOUT = Number(process.env.AWSC_TIMEOUT || 60)
// Seconds the user has to sign in in the window.
const SIGNIN_TIMEOUT = Number(process.env.AWSC_SIGNIN_TIMEOUT || 600)
// Seconds a headless run lets the identity provider send the browser back to AWS: a live session does it in a few
// seconds (Microsoft goes through login.microsoftonline.com and a self-submitting form); staying longer means it
// waits for the user (account picker, "Stay signed in?").
const IDP_GRACE = Number(process.env.AWSC_IDP_GRACE || 15)
// Fields that only a sign-in page shows: a headless run stops at once on them.
const SIGNIN_FIELDS = 'input[type=password]:visible, input[type=email]:visible'
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
        // Where the page is: 'aws' (Allow is clicked there) or 'idp' (any other host: the identity provider, which
        // sends a signed-in browser back to AWS, or waits for the user). Each arrival restarts that place's deadline.
        let place = 'aws'
        let deadline = Date.now() + APPROVE_TIMEOUT * 1000
        for (;;) {
            const here = new URL(page.url())
            if (isCallback(here)) return 0
            const arrivedAt = isAws(here.hostname) ? 'aws' : 'idp'
            if (arrivedAt !== place) {
                place = arrivedAt
                if (place === 'aws') {
                    deadline = Date.now() + APPROVE_TIMEOUT * 1000
                } else if (headless) {
                    deadline = Date.now() + IDP_GRACE * 1000
                } else {
                    deadline = Date.now() + SIGNIN_TIMEOUT * 1000
                    console.error('awsc: sign in to the SSO portal in the Chromium window; awsc clicks Allow afterwards')
                }
            }
            try {
                const allow = page.getByRole('button', { name: /^allow( access)?$/i })
                if (place === 'aws' && (await allow.isVisible())) {
                    const before = page.url()
                    await allow.click()
                    await page.waitForURL((u) => u.href !== before, { timeout: APPROVE_TIMEOUT * 1000 })
                    deadline = Date.now() + APPROVE_TIMEOUT * 1000
                } else if (headless && (await page.locator(SIGNIN_FIELDS).count()) > 0) {
                    console.error(`awsc: ${here.hostname} asks for a sign-in: you must sign in to the SSO portal`)
                    return 4
                }
            } catch (error) {
                if (!NAVIGATING.test(error.message)) throw error
            }
            if (Date.now() > deadline) {
                const title = await page.title()
                if (place === 'aws') {
                    console.error(`awsc: no Allow button on ${here.hostname} ("${title}") after ${APPROVE_TIMEOUT} s`)
                    return 1
                }
                if (headless) {
                    console.error(`awsc: still on ${here.hostname} ("${title}") after ${IDP_GRACE} s: you must sign in to the SSO portal`)
                    return 4
                }
                console.error(`awsc: no sign-in within ${SIGNIN_TIMEOUT} s (window left on ${here.hostname}, "${title}")`)
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
