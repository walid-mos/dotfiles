/**
 * bookmarks-readlist — widget desktop : Read List des bookmarks X
 * (Brain/1. Flux/Read List, Obsidian). Clic sur un article → ouverture
 * dans Obsidian (note mensuelle) ou dans le navigateur (article).
 * Read-only : le keep/drop se fait dans Obsidian, jamais ici.
 * Backend : plugin_api.py sous /api/plugins/bookmarks-readlist.
 */
import { cn, haptic, host, Tip, useValue } from '@hermes/plugin-sdk'
import React from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import {
  PANES_AREA,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  STATUSBAR_AREAS,
} from '@hermes/plugin-sdk'

const ID = 'bookmarks-readlist'
const VAULT = 'Brain'
const NOTE = '1. Flux/Read List'

function obsidianUrl(month) {
  const file = NOTE + '/' + month + '.md'
  return 'obsidian://open?vault=' + VAULT + '&file=' + encodeURIComponent(file)
}

function openInObsidian(month) {
  const url = obsidianUrl(month)
  try {
    if (host && typeof host.openExternal === 'function') host.openExternal(url)
    else window.open(url, '_blank')
  } catch {
    window.open(url, '_blank')
  }
}

function EntryRow({ e, month }) {
  return jsxs('div', {
    className: cn('group flex items-start gap-2 py-1.5 text-sm leading-snug', e.read && 'opacity-50'),
    children: [
      jsx('span', {
        className: cn(
          'mt-[2px] flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border text-[10px]',
          e.read
            ? 'border-transparent bg-(--ui-accent) text-white'
            : 'border-(--ui-stroke-secondary)'
        ),
        children: e.read ? '✓' : '',
      }),
      jsxs('div', { className: 'min-w-0 flex-1', children: [
        jsx('button', {
          type: 'button',
          title: 'Ouvrir l’article — cocher se fait dans Obsidian',
          className: cn(
            'block w-full truncate text-left transition-colors hover:text-(--ui-accent)',
            e.read && 'line-through'
          ),
          onClick: () => {
            haptic('tap')
            try {
              if (host && typeof host.openExternal === 'function') host.openExternal(e.url)
              else window.open(e.url, '_blank')
            } catch { window.open(e.url, '_blank') }
          },
          children: e.title,
        }),
        jsxs('div', {
          className: 'flex gap-2 text-[0.6875rem] text-(--ui-text-quaternary)',
          children: [
            e.via ? jsx('span', { children: 'via ' + e.via }) : null,
            e.minutes ? jsx('span', { children: '~' + e.minutes + ' min' }) : null,
          ],
        }),
      ]}),
      jsx('button', {
        type: 'button',
        title: 'Ouvrir la note ' + month + ' dans Obsidian',
        className: 'shrink-0 self-center text-[0.6875rem] text-(--ui-text-quaternary) opacity-0 transition-opacity group-hover:opacity-100 hover:text-(--ui-accent)',
        onClick: () => { haptic('tap'); openInObsidian(month) },
        children: '↗',
      }),
    ],
  })
}

function ReadListPane() {
  const [data, setData] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [collapsedDays, setCollapsedDays] = React.useState({})

  const load = React.useCallback(async () => {
    try {
      const d = await ctx.rest('/readlist')
      setData(d)
      setError(null)
    } catch (e) {
      setError(String(e && e.message ? e.message : e))
    }
  }, [])

  React.useEffect(() => { load() }, [load])
  // rafraîchissement léger toutes les 60 s (le cron tourne à 6h45)
  React.useEffect(() => {
    const iv = setInterval(load, 60000)
    return () => clearInterval(iv)
  }, [load])

  if (error) {
    return jsx('div', {
      className: 'flex h-full flex-col gap-2 p-3 text-sm text-(--ui-text-secondary)',
      children: jsxs(Fragment, { children: [
        jsx('div', { className: 'font-medium', children: 'Read List' }),
        jsx('div', { className: 'text-(--ui-text-quaternary)', children:
          'Backend indisponible (' + error + '). Vérifie que le plugin est dans plugins.enabled puis redémarre le gateway.' }),
        jsx('button', { type: 'button', className: 'self-start text-(--ui-accent) underline',
          onClick: load, children: 'Réessayer' }),
      ]}),
    })
  }

  const month = data && data.current
  const days = data && data.data ? data.data.days : []
  const entries = days.flatMap(d => d.entries)
  const unread = entries.filter(e => !e.read).length

  return jsxs('div', { className: 'flex h-full flex-col text-sm', children: [
    jsxs('div', { className: 'flex items-center justify-between px-3 py-2', children: [
      jsx('div', { className: 'font-medium', children: 'Read List' }),
      month ? jsx('button', {
        type: 'button',
        title: 'Ouvrir ' + month + '.md dans Obsidian',
        className: 'text-[0.6875rem] text-(--ui-text-tertiary) hover:text-(--ui-accent)',
        onClick: () => { haptic('tap'); openInObsidian(month) },
        children: month,
      }) : null,
    ]}),
    jsx('div', { className: 'min-h-0 flex-1 overflow-y-auto px-3 pb-2', children:
      data === null
        ? jsx('div', { className: 'text-(--ui-text-quaternary)', children: 'Chargement…' })
        : !data.exists
          ? jsx('div', { className: 'text-(--ui-text-quaternary)', children:
              'Pas encore de Read List — le cron “Bookmarks Read List” crée 1. Flux/Read List/<mois>.md quand il trouve des articles.' })
          : days.length === 0
            ? jsx('div', { className: 'text-(--ui-text-quaternary)', children: 'Aucun article ce mois.' })
            : days.map(d => jsxs('div', { className: 'mb-1', children: [
                jsx('button', {
                  type: 'button',
                  className: cn(
                    'flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-[0.6875rem] font-medium',
                    'uppercase tracking-wide text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover)'
                  ),
                  onClick: () => setCollapsedDays(c => ({ ...c, [d.date]: !c[d.date] })),
                  children: [
                    jsx('span', { className: 'w-2 shrink-0 text-center', children: collapsedDays[d.date] ? '▸' : '▾' }),
                    jsx('span', { className: 'truncate', children: d.date }),
                    jsx('span', { className: 'ml-auto shrink-0 tabular-nums text-(--ui-text-quaternary)',
                      children: d.entries.filter(e => !e.read).length }),
                  ],
                }),
                !collapsedDays[d.date] && d.entries.map((e, i) =>
                  jsx(EntryRow, { e, month }, e.url + i)),
              ]}, d.date))
    }),
    jsxs('div', { className: 'flex justify-between border-t border-(--ui-stroke-secondary) px-3 py-1.5 text-[0.6875rem] text-(--ui-text-quaternary)', children: [
      jsx('span', { children: unread + ' à lire / ' + entries.length }),
      jsx('button', { type: 'button', className: 'hover:text-(--ui-accent)', onClick: load, children: '↻ actualiser' }),
    ]}),
  ]})
}

function ReadListChip() {
  const [c, setC] = React.useState(null)
  const load = React.useCallback(async () => {
    try {
      const d = await ctx.rest('/counts')
      setC(d)
    } catch { setC(null) }
  }, [])
  React.useEffect(() => { load(); const iv = setInterval(load, 60000); return () => clearInterval(iv) }, [load])
  return jsx(Tip, {
    label: 'Read List bookmarks — cliquer pour ouvrir',
    children: jsx('button', {
      type: 'button',
      className: cn(
        'inline-flex h-full items-center gap-1 px-1.5 text-[0.6875rem] transition-colors',
        'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
      ),
      onClick: () => { haptic('tap'); host.navigate('/bookmarks-readlist') },
      children: '📖 ' + (c === null ? '…' : (c.exists ? c.unread : '0')),
    }),
  })
}

function ReadListPage() {
  return jsx('div', { className: 'h-full overflow-hidden', children: jsx(ReadListPane, {}) })
}

let ctx = null

export default {
  id: ID,
  name: 'Bookmarks Read List',
  register(pluginCtx) {
    ctx = pluginCtx
    ctx.registerMany([
      {
        id: 'pane',
        area: PANES_AREA,
        title: 'Read List',
        data: { placement: 'right', width: '280px' },
        render: () => jsx(ReadListPane, {}),
      },
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/bookmarks-readlist' },
        render: () => jsx(ReadListPage, {}),
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        data: { path: '/bookmarks-readlist', label: 'Read List', codicon: 'book' },
      },
      {
        id: 'chip',
        area: STATUSBAR_AREAS.right,
        order: 126,
        render: () => jsx(ReadListChip, {}),
      },
    ])
  },
}
