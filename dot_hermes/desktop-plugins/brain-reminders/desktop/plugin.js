/**
 * brain-reminders — widget desktop : tâches ouvertes (Brain/Tasks, Obsidian),
 * groupées par domaine. Clic sur une tâche → ouverture dans Obsidian
 * (note du domaine, ancrée sur la zone/heading qui la contient).
 * Backend : plugin_api.py sous /api/plugins/brain-reminders.
 */
import { cn, haptic, host, Tip, useValue } from '@hermes/plugin-sdk'
import React, { Fragment } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import {
  PANES_AREA,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  STATUSBAR_AREAS,
} from '@hermes/plugin-sdk'

const ID = 'brain-reminders'

const VAULT = 'Brain'

function prioIcon(p) {
  return p === 'haute' ? '⏫ ' : p === 'basse' ? '⏬ ' : ''
}

/** Deep-link Obsidian : note du domaine, ancrée sur la zone (heading) de la tâche. */
function obsidianUrl(t) {
  const file = 'Tasks/' + t.domain + '.md'
  // encode chaque segment, garde les / nus (format validé en réel)
  const f_enc = file.split('/').map(encodeURIComponent).join('/')
  const anchor = t.area && t.area !== 'DEFAULT' ? '%23' + encodeURIComponent(t.area) : ''
  return 'obsidian://open?vault=' + VAULT + '&file=' + f_enc + anchor
}

function openInObsidian(t) {
  const url = obsidianUrl(t)
  // Pont natif Electron (le seul qui laisse passer obsidian://) puis fallbacks.
  try {
    if (window.hermesDesktop && typeof window.hermesDesktop.openExternal === 'function') {
      window.hermesDesktop.openExternal(url)
      return
    }
  } catch { /* fallback ci-dessous */ }
  try {
    if (host && typeof host.openExternal === 'function') { host.openExternal(url); return }
  } catch { /* fallback ci-dessous */ }
  window.open(url, '_blank')
}

/** Groupe une liste plate de tâches par domaine (ordre d'apparition). */
function groupByDomain(tasks) {
  const groups = []
  const byName = new Map()
  for (const t of tasks) {
    let g = byName.get(t.domain)
    if (!g) {
      g = { domain: t.domain, tasks: [], open: 0 }
      byName.set(t.domain, g)
      groups.push(g)
    }
    g.tasks.push(t)
    if (t.status === 'open' || t.status === 'wip') g.open++
  }
  return groups
}

function TaskRow({ t, onToggle, onOpen }) {
  const done = t.status === 'done' || t.status === 'canceled'
  return jsxs('div', {
    className: cn(
      'group flex items-start gap-2 py-1.5 text-sm leading-snug',
      done && 'opacity-50'
    ),
    style: t.indent ? { marginLeft: 14 } : undefined,
    children: [
      jsx('button', {
        type: 'button',
        title: done ? 'Rouvrir' : 'Clôturer',
        className: cn(
          'mt-[2px] flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border',
          'text-[10px] transition-colors',
          done
            ? 'border-transparent bg-(--ui-accent) text-white'
            : 'border-(--ui-stroke-secondary) hover:border-(--ui-accent)'
        ),
        onClick: () => onToggle(t),
        children: done ? (t.status === 'canceled' ? '✕' : '✓') : '',
      }),
      jsxs('div', { className: 'min-w-0 flex-1', children: [
        jsx('button', {
          type: 'button',
          title: 'Ouvrir dans Obsidian — ' + t.domain,
          className: cn(
            'block w-full truncate text-left transition-colors hover:text-(--ui-accent)',
            done && 'line-through'
          ),
          onClick: () => onOpen(t),
          children: prioIcon(t.priority) + t.text,
        }),
        jsxs('div', {
          className: 'flex gap-2 text-[0.6875rem] text-(--ui-text-quaternary)',
          children: [
            t.due ? jsx('span', { children: '📅 ' + t.due }) : null,
            t.tags && t.tags.length
              ? jsx('span', { children: t.tags.map(x => '#' + x).join(' ') })
              : null,
          ],
        }),
      ]}),
      jsx('button', {
        type: 'button',
        title: 'Ouvrir dans Obsidian',
        className: 'shrink-0 self-center text-[0.6875rem] text-(--ui-text-quaternary) opacity-0 transition-opacity group-hover:opacity-100 hover:text-(--ui-accent)',
        onClick: () => onOpen(t),
        children: '↗',
      }),
    ],
  })
}

function DomainGroup({ group, onToggle, onOpen }) {
  const [collapsed, setCollapsed] = React.useState(false)
  const parts = group.domain.split('/')
  return jsxs('div', { className: 'mb-1', children: [
    jsx('button', {
      type: 'button',
      className: cn(
        'flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-[0.6875rem] font-medium',
        'uppercase tracking-wide text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover)'
      ),
      onClick: () => setCollapsed(c => !c),
      children: [
        jsx('span', { className: 'w-2 shrink-0 text-center', children: collapsed ? '▸' : '▾' }),
        jsx('span', { className: 'truncate', children: parts[parts.length - 1] }),
        jsx('span', { className: 'ml-auto shrink-0 tabular-nums text-(--ui-text-quaternary)', children: group.open }),
      ],
    }),
    !collapsed && jsxs(Fragment, { children: [
      jsx('div', { className: 'ml-1 truncate text-[0.625rem] text-(--ui-text-quaternary)', children:
        parts.length > 1 ? parts.slice(0, -1).join(' / ') : group.domain }),
      group.tasks.map(t => jsx(TaskRow, { t, onToggle, onOpen }, t.id)),
    ]}),
  ]})
}

function RemindersPane() {
  const [tasks, setTasks] = React.useState(null)
  const [error, setError] = React.useState(null)
  const [filter, setFilter] = React.useState('open')

  const load = React.useCallback(async () => {
    try {
      const data = await ctx.rest(
        '/tasks?status=' + filter + '&limit=100'
      )
      setTasks(data.tasks || [])
      setError(null)
    } catch (e) {
      setError(String(e && e.message ? e.message : e))
    }
  }, [filter])

  React.useEffect(() => { load() }, [load])
  // rafraîchissement léger toutes les 30 s
  React.useEffect(() => {
    const iv = setInterval(load, 30000)
    return () => clearInterval(iv)
  }, [load])

  const toggle = async (t) => {
    const next = t.status === 'done' ? 'open'
      : t.status === 'canceled' ? 'open'
      : 'done'
    haptic('tap')
    try {
      await ctx.rest('/status', { method: 'POST', body: { ref: t.id, status: next } })
      load()
    } catch (e) { setError(String(e)) }
  }

  const open = (t) => {
    haptic('tap')
    openInObsidian(t)
  }

  if (error) {
    return jsx('div', {
      className: 'flex h-full flex-col gap-2 p-3 text-sm text-(--ui-text-secondary)',
      children: jsxs(Fragment, { children: [
        jsx('div', { className: 'font-medium', children: 'Rappels' }),
        jsx('div', { className: 'text-(--ui-text-quaternary)', children:
          'Backend indisponible (' + error + '). Vérifie que le plugin est dans plugins.enabled puis redémarre le gateway.' }),
        jsx('button', { type: 'button', className: 'self-start text-(--ui-accent) underline',
          onClick: load, children: 'Réessayer' }),
      ]}),
    })
  }

  const openCount = (tasks || []).filter(t => t.status === 'open' || t.status === 'wip').length
  const groups = tasks === null ? [] : groupByDomain(tasks)

  return jsxs('div', { className: 'flex h-full flex-col text-sm', children: [
    jsxs('div', { className: 'flex items-center justify-between px-3 py-2', children: [
      jsx('div', { className: 'font-medium', children: 'Rappels' }),
      jsxs('div', { className: 'flex gap-1', children: [
        jsx('button', { type: 'button',
          className: cn('px-1.5 text-[0.6875rem] rounded', filter === 'open'
            ? 'bg-(--ui-accent) text-white' : 'text-(--ui-text-tertiary)'),
          onClick: () => setFilter('open'), children: 'ouvertes' }),
        jsx('button', { type: 'button',
          className: cn('px-1.5 text-[0.6875rem] rounded', filter === 'all'
            ? 'bg-(--ui-accent) text-white' : 'text-(--ui-text-tertiary)'),
          onClick: () => setFilter('all'), children: 'tout' }),
      ]}),
    ]}),
    jsx('div', { className: 'min-h-0 flex-1 overflow-y-auto px-3 pb-2', children:
      tasks === null
        ? jsx('div', { className: 'text-(--ui-text-quaternary)', children: 'Chargement…' })
        : groups.length === 0
          ? jsx('div', { className: 'text-(--ui-text-quaternary)', children: 'Aucune tâche — dis-le simplement en chat.' })
          : jsxs(Fragment, { children: groups.map(g =>
              jsx(DomainGroup, { group: g, onToggle: toggle, onOpen: open }, g.domain))
            })
    }),
    jsxs('div', { className: 'flex justify-between border-t border-(--ui-stroke-secondary) px-3 py-1.5 text-[0.6875rem] text-(--ui-text-quaternary)', children: [
      jsx('span', { children: openCount + ' ouverte' + (openCount === 1 ? '' : 's') }),
      jsx('button', { type: 'button', className: 'hover:text-(--ui-accent)', onClick: load, children: '↻ actualiser' }),
    ]}),
  ]})
}

function RemindersChip() {
  const [n, setN] = React.useState(null)
  const load = React.useCallback(async () => {
    try {
      const d = await ctx.rest('/counts')
      setN(d.open)
    } catch { setN(null) }
  }, [])
  React.useEffect(() => { load(); const iv = setInterval(load, 60000); return () => clearInterval(iv) }, [load])
  return jsx(Tip, {
    label: 'Rappels Brain — cliquer pour ouvrir',
    children: jsx('button', {
      type: 'button',
      className: cn(
        'inline-flex h-full items-center gap-1 px-1.5 text-[0.6875rem] transition-colors',
        'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
      ),
      onClick: () => { haptic('tap'); host.navigate('/brain-reminders') },
      children: '☐ ' + (n === null ? '…' : n),
    }),
  })
}

// Page pleine (route) pour le chip / la sidebar
function RemindersPage() {
  return jsx('div', { className: 'h-full overflow-hidden', children: jsx(RemindersPane, {}) })
}

let ctx = null

export default {
  id: ID,
  name: 'Brain Reminders',
  register(pluginCtx) {
    ctx = pluginCtx
    ctx.registerMany([
      {
        id: 'pane',
        area: PANES_AREA,
        title: 'Rappels',
        data: { placement: 'right', width: '280px' },
        render: () => jsx(RemindersPane, {}),
      },
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/brain-reminders' },
        render: () => jsx(RemindersPage, {}),
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        data: { path: '/brain-reminders', label: 'Rappels', codicon: 'checklist' },
      },
      {
        id: 'chip',
        area: STATUSBAR_AREAS.right,
        order: 125,
        render: () => jsx(RemindersChip, {}),
      },
    ])
  },
}
