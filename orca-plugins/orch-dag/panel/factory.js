const POLL_INTERVAL_MS = 5000
const LANES = [
    { state: 'ready-for-human', key: 'human', title: 'Needs you' },
    { state: 'agent-working', key: 'working', title: 'Working' },
    { state: 'agent-done', key: 'done', title: 'Done · draft PR' },
    { state: 'ready-for-agent', key: 'ready', title: 'Ready' },
]
const RUN_OUTCOMES = { 'agent-done': 'done', 'ready-for-human': 'handed to you', error: 'stopped on an error' }
const STEP_MARKS = { done: '✓', pass: '✓', fail: '✗', error: '✗', running: '▸' }

const lanesElement = document.getElementById('lanes')
const statusLine = document.getElementById('status-line')
const repoSelect = document.getElementById('repo-select')
let selectedRoot = null
let lastSignature = ''
let inFlight = false

function setStatus(text, isError = false) {
    statusLine.textContent = text
    statusLine.classList.toggle('error', isError)
}

function element(tag, className, text) {
    const node = document.createElement(tag)
    if (className) {
        node.className = className
    }
    if (text !== undefined) {
        node.textContent = text
    }

    return node
}

function sinceLabel(isoTime) {
    const minutes = Math.max(0, Math.round((Date.now() - new Date(isoTime).getTime()) / 60000))
    if (minutes < 60) {
        return `${minutes}m ago`
    }

    return minutes < 48 * 60 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`
}

async function request(name, data) {
    try {
        return await orca.plugin.request(name, data, { timeoutMs: 90000 })
    } catch (error) {
        setStatus(`${error.code ?? 'error'}: ${error.message}`, true)

        return null
    }
}

const openExternal = (url) => orca.shell.openExternal(url)
const openWorktree = (ticket) => request('factory.openWorktree', { worktree: ticket.worktree })
const openLog = (root, log) => request('factory.openLog', { root, log })
const openTerminal = (root, ticket, command) => request('factory.openTerminal', { root, worktree: ticket.worktree, issueNumber: ticket.number, command })

/** The log worth opening: the running step's, else the newest step that wrote one. */
const currentLog = (run) => run?.steps.findLast((step) => step.status === 'running' && step.log)?.log ?? run?.steps.findLast((step) => step.log)?.log ?? null

function actionButton(label, onClick) {
    const button = element('button', 'action', label)
    button.addEventListener('click', (event) => {
        event.stopPropagation()
        void onClick()
    })

    return button
}

function runSteps(run) {
    const list = element('ol', 'steps')
    for (const step of run.steps) {
        const item = element('li', step.status)
        item.append(element('span', 'mark', STEP_MARKS[step.status] ?? '·'), element('span', '', step.name))
        list.append(item)
    }
    if (run.activity) {
        list.append(element('li', 'activity', `${sinceLabel(run.updatedAt)} · ${run.activity}`))
    }

    return list
}

function ticketCard(ticket, { root, isChild, isNext }) {
    const card = element('div', `ticket${ticket.blockedBy.length ? ' blocked' : ''}${isChild ? ' child' : ''}`)
    card.title = ticket.worktree ? `Open the worktree of #${ticket.number}` : ticket.url
    const title = element('div', 'title')
    title.append(element('span', 'number', `#${ticket.number}`), element('span', '', ticket.title))
    card.append(title)

    const tags = element('div', 'tags')
    if (isNext) {
        tags.append(element('span', 'tag next', 'next up'))
    }
    if (ticket.blockedBy.length) {
        tags.append(element('span', 'tag', `blocked by ${ticket.blockedBy.map((number) => `#${number}`).join(', ')}`))
    }
    if (ticket.run?.outcome && ticket.state !== 'agent-working') {
        tags.append(element('span', 'tag', `last run: ${RUN_OUTCOMES[ticket.run.outcome] ?? ticket.run.outcome} · ${sinceLabel(ticket.run.finishedAt)}`))
    }
    if (tags.childElementCount) {
        card.append(tags)
    }
    if (ticket.state === 'agent-working' && ticket.run) {
        card.append(runSteps(ticket.run))
    }

    const actions = element('div', 'actions')
    if (ticket.worktree) {
        actions.append(actionButton('Worktree', () => openWorktree(ticket)))
        if (ticket.run && !ticket.run.finishedAt) {
            actions.append(actionButton('Watch', () => openTerminal(root, ticket, 'watch')))
        }
        if (ticket.run?.finishedAt && ticket.run.steps.some((step) => step.sessionId)) {
            actions.append(actionButton('Resume', () => openTerminal(root, ticket, 'resume')))
        }
    }
    actions.append(actionButton('Issue', () => openExternal(ticket.url)))
    if (ticket.pr) {
        actions.append(actionButton(`PR #${ticket.pr.number}${ticket.pr.isDraft ? ' draft' : ''}`, () => openExternal(ticket.pr.url)))
    }
    const log = currentLog(ticket.run)
    if (log) {
        actions.append(actionButton('Log', () => openLog(root, log)))
    }
    card.append(actions)
    card.addEventListener('click', () => void (ticket.worktree ? openWorktree(ticket) : openExternal(ticket.url)))

    return card
}

/** Orders a lane so each ticket sits right under the ticket blocking it (chains read top to bottom). */
function chainOrder(tickets) {
    const inLane = new Map(tickets.map((ticket) => [ticket.number, ticket]))
    const childrenOf = new Map()
    const roots = []
    for (const ticket of tickets) {
        const parent = ticket.blockedBy.find((number) => inLane.has(number))
        if (parent) {
            childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), ticket])
        } else {
            roots.push(ticket)
        }
    }
    const ordered = []
    const visit = (ticket, depth) => {
        ordered.push({ ticket, depth })
        for (const child of childrenOf.get(ticket.number) ?? []) {
            visit(child, depth + 1)
        }
    }
    roots.forEach((ticket) => visit(ticket, 0))

    return ordered
}

function renderRepos(repos, current) {
    repoSelect.hidden = repos.length < 2
    repoSelect.replaceChildren(
        ...repos.map((repo) => {
            const option = element('option', '', repo.name)
            option.value = repo.root
            option.selected = repo.root === current?.root

            return option
        }),
    )
}

function renderLanes({ repo, tickets }) {
    const signature = JSON.stringify([repo, tickets])
    if (signature === lastSignature) {
        return
    }
    lastSignature = signature
    const nextUp = tickets.filter((ticket) => ticket.state === 'ready-for-agent' && ticket.blockedBy.length === 0).sort((left, right) => left.number - right.number)[0]

    lanesElement.replaceChildren(
        ...LANES.map((lane) => {
            const laneTickets = tickets.filter((ticket) => ticket.state === lane.state)
            const section = element('section', `lane lane-${lane.key}`)
            const head = element('div', 'lane-head', lane.title)
            head.append(element('span', 'count', String(laneTickets.length)))
            section.append(head)
            if (laneTickets.length === 0) {
                section.append(element('div', 'lane-empty', 'None'))
            }
            for (const { ticket, depth } of chainOrder(laneTickets)) {
                section.append(ticketCard(ticket, { root: repo.root, isChild: depth > 0, isNext: ticket === nextUp }))
            }

            return section
        }),
    )
}

async function refresh({ force = false } = {}) {
    if (inFlight || (!force && document.visibilityState !== 'visible')) {
        return
    }
    inFlight = true
    try {
        const data = await orca.plugin.request('factory.get', { root: selectedRoot }, { timeoutMs: 90000 })
        renderRepos(data.repos, data.repo)
        if (!data.repo) {
            lastSignature = ''
            lanesElement.replaceChildren(element('div', 'lane-empty', 'No Orca workspace has a .factory.json.'))
            setStatus('')
            return
        }
        renderLanes(data)
        setStatus(`${data.tickets.length} tickets · GitHub ${sinceLabel(data.githubCheckedAt)}`)
    } catch (error) {
        setStatus(`${error.code ?? 'error'}: ${error.message}`, true)
    } finally {
        inFlight = false
    }
}

repoSelect.addEventListener('change', () => {
    selectedRoot = repoSelect.value
    void refresh({ force: true })
})

orca.on('agent.status.changed', () => void refresh())
document.addEventListener('visibilitychange', () => void refresh())
setInterval(() => void refresh(), POLL_INTERVAL_MS)
void refresh({ force: true })
