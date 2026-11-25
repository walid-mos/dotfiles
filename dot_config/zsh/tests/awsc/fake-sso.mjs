// usage: node fake-sso.mjs MODE LOG
// Fake AWS SSO portal and identity provider for awsc.bats, on one local port printed on stdout. Chromium reaches it
// under real-looking names through awsc's AWSC_TEST_HOST_RULES. Every sign-in and button press is appended to LOG.
// MODE: allow        the SSO session is alive: /authorize leads straight to the Allow page
//       signin       the SSO session is dead: /authorize leads to the identity provider, which waits for the user
//       signin-auto  as signin, but the sign-in page submits itself after a delay, standing in for the user
//       foreign      the Allow page is served by a host that is not AWS
//       nobutton     the AWS page never shows an Allow button
import fs from 'node:fs'
import http from 'node:http'

const [mode, log] = process.argv.slice(2)
const note = (event) => fs.appendFileSync(log, `${event}\n`)
let port
const portal = () => `http://d-test.awsapps.com:${port}`
const idp = () => `http://login.idp.test:${port}`
const foreign = () => `http://portal.evil.test:${port}`
const page = (title, body) => `<!doctype html><title>${title}</title><body>${body}</body>`

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const back = `redirect_uri=${encodeURIComponent(url.searchParams.get('redirect_uri') ?? '')}`
    const go = (to) => {
        res.statusCode = 302
        res.setHeader('Location', to)
        res.end()
    }
    switch (url.pathname) {
        case '/authorize': {
            const signedIn = (req.headers.cookie ?? '').includes('sso=1')
            if (mode.startsWith('signin') && !signedIn) return go(`${idp()}/login?${back}`)
            return go(`${mode === 'foreign' ? foreign() : portal()}/consent?${back}`)
        }
        case '/login':
            if (req.method === 'POST') {
                note('login')
                return go(`${portal()}/session?${back}`)
            }
            return res.end(page('Sign in', `<form method="post" action="/login?${back}"><input name="user">` +
                '<input type="password" name="password"><button>Sign in</button></form>' +
                (mode === 'signin-auto' ? '<script>setTimeout(() => document.forms[0].submit(), 1500)</script>' : '')))
        case '/session':
            res.setHeader('Set-Cookie', 'sso=1; Path=/')
            return go(`${portal()}/consent?${back}`)
        case '/consent':
            return res.end(page('Authorization requested', mode === 'nobutton'
                ? '<p>Nothing to approve here</p>'
                : `<form method="post" action="/deny?${back}"><button>Deny access</button></form>` +
                  `<form method="post" action="/allow?${back}"><button>Allow access</button></form>`))
        case '/allow':
            note(`allow ${url.hostname}`)
            return go(`${url.searchParams.get('redirect_uri')}?code=c&state=fake-state-value`)
        case '/deny':
            note(`deny ${url.hostname}`)
            return res.end(page('Denied', 'Denied'))
        default:
            res.statusCode = 404
            return res.end()
    }
})
server.listen(0, '127.0.0.1', () => {
    port = server.address().port
    console.log(port)
})
