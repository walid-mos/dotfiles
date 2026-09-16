// Inco credits: a prepaid account, whose remaining balance the console renders
// in the app layout of every authenticated page. That layout is a React Server
// Component, so the number is read straight out of the page's flight payload.
// Pure - payload text in, numbers out; the network lives in inco-session.ts.
//
// Captured shape (the layout's balance chip, flight and HTML-escaped variants):
//   ["$","$L23",null,{"balance":"$$0.009668","balanceLevel":"ok",
//     "isAdmin":false,"workspaceName":"Personal"}]
//
// React doubles the leading `$` of a string that would otherwise read as a
// flight reference, so the console's own rendering of the amount is
// `$0.009668`. The amount is kept verbatim: a prepaid account can sit at
// fractions of a cent, where rounding to cents would print credit the account
// does not have.

export type IncoQuota = {
	/** Balance as a number, for the shared colour ramp. */
	balance: number
	/** Balance exactly as the console renders it (`$0.009668`). */
	amount: string
}

/**
 * The layout's balance prop, in the flight payload (`"balance":"$$0.009668"`)
 * and in the escaped copy embedded in the rendered HTML
 * (`\"balance\":\"$$0.009668\"`). Only the amount format the console was
 * captured printing is accepted: a format it does not print today reports no
 * data instead of a misread balance.
 */
const BALANCE_PROP = /\\?"balance\\?":\\?"(\$\$?[0-9]+(?:\.[0-9]+)?)\\?"/

/** Console balance of one page, or undefined when the page carries none. */
export function parseIncoBalance(page: string): IncoQuota | undefined {
	const [, escaped] = BALANCE_PROP.exec(page) ?? []
	if (!escaped) return undefined
	const amount = escaped.startsWith('$$') ? escaped.slice(1) : escaped
	const balance = Number(amount.slice(1))
	if (!Number.isFinite(balance)) return undefined
	return { balance, amount }
}
