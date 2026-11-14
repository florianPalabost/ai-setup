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
let shownRoot = null
let reposSignature = ''
/** @type {Map<string, { count: HTMLElement, empty: HTMLElement, body: HTMLElement }>} */
const shownLanes = new Map()
/** @type {Map<number, { element: HTMLElement, signature: string }>} */
const shownCards = new Map()
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
const openLog = (root, ticket) => request('factory.openLog', { root, issueNumber: ticket.number })
const openTerminal = (root, ticket, command) => request('factory.openTerminal', { root, worktree: ticket.worktree, issueNumber: ticket.number, command })


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

function fillTicketCard(card, ticket, { root, isChild, isNext }) {
    card.className = `ticket${ticket.blockedBy.length ? ' blocked' : ''}${isChild ? ' child' : ''}`
    card.title = ticket.worktree ? `Open the worktree of #${ticket.number}` : ticket.url
    const title = element('div', 'title')
    title.append(element('span', 'number', `#${ticket.number}`), element('span', '', ticket.title))
    card.replaceChildren(title)

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
    if (ticket.run) {
        actions.append(actionButton('Log', () => openLog(root, ticket)))
    }
    card.append(actions)
    card.onclick = () => void (ticket.worktree ? openWorktree(ticket) : openExternal(ticket.url))
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
    const signature = JSON.stringify([repos, current?.root])
    if (signature === reposSignature) {
        return
    }
    reposSignature = signature
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

/** The lane sections, built once; only their count, empty note and cards change after. */
function laneViews() {
    if (shownLanes.size === 0) {
        lanesElement.replaceChildren(
            ...LANES.map((lane) => {
                const section = element('section', `lane lane-${lane.key}`)
                const head = element('div', 'lane-head', lane.title)
                const count = element('span', 'count')
                const empty = element('div', 'lane-empty', 'None')
                const body = element('div', 'lane-body')
                head.append(count)
                section.append(head, empty, body)
                shownLanes.set(lane.state, { count, empty, body })

                return section
            }),
        )
    }

    return shownLanes
}

/** Keeps the children of `parent` equal to `wanted`, in order, moving only the nodes that are out of place. */
function syncChildren(parent, wanted) {
    wanted.forEach((node, index) => {
        if (parent.children[index] !== node) {
            parent.insertBefore(node, parent.children[index] ?? null)
        }
    })
    while (parent.children.length > wanted.length) {
        parent.lastElementChild.remove()
    }
}

/** Updates the lanes in place: a card is rebuilt only when its ticket changed, so polls don't redraw the panel. */
function renderLanes({ repo, tickets }) {
    const nextUp = tickets.filter((ticket) => ticket.state === 'ready-for-agent' && ticket.blockedBy.length === 0).sort((left, right) => left.number - right.number)[0]
    const lanes = laneViews()
    const seen = new Set()

    for (const lane of LANES) {
        const view = lanes.get(lane.state)
        const ordered = chainOrder(tickets.filter((ticket) => ticket.state === lane.state))
        view.count.textContent = String(ordered.length)
        view.empty.hidden = ordered.length > 0
        const cards = ordered.map(({ ticket, depth }) => {
            const options = { root: repo.root, isChild: depth > 0, isNext: ticket === nextUp }
            const signature = JSON.stringify([ticket, options])
            const shown = shownCards.get(ticket.number) ?? { element: element('div'), signature: '' }
            if (shown.signature !== signature) {
                fillTicketCard(shown.element, ticket, options)
                shown.signature = signature
            }
            shownCards.set(ticket.number, shown)
            seen.add(ticket.number)

            return shown.element
        })
        syncChildren(view.body, cards)
    }
    for (const number of shownCards.keys()) {
        if (!seen.has(number)) {
            shownCards.delete(number)
        }
    }
}

function clearLanes(message) {
    shownLanes.clear()
    shownCards.clear()
    lanesElement.replaceChildren(element('div', 'lane-empty', message))
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
            shownRoot = null
            clearLanes('No Orca workspace has a .factory.json.')
            setStatus('')
            return
        }
        if (shownRoot !== data.repo.root) {
            shownRoot = data.repo.root
            clearLanes('')
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
