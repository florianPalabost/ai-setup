const POLL_INTERVAL_MS = 5000
const CARD_WIDTH = 240
const MIN_SCALE = 0.3
const MAX_SCALE = 2

const runSelect = document.getElementById('run-select')
const statusLine = document.getElementById('status-line')
const viewport = document.getElementById('viewport')
const stage = document.getElementById('stage')
const edgesSvg = document.getElementById('edges')
const edgePaths = document.getElementById('edge-paths')
const cards = document.getElementById('cards')

const view = { x: 16, y: 16, scale: 1 }
let selectedRunId = null
let shownRunId = null
let lastSignature = ''
let inFlight = false

function setStatus(text, isError = false) {
    statusLine.textContent = text
    statusLine.classList.toggle('error', isError)
}

function parseTimestamp(value) {
    if (!value) {
        return null
    }

    return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`).getTime()
}

function shortDuration(milliseconds) {
    const minutes = Math.max(0, Math.round(milliseconds / 60000))
    if (minutes < 60) {
        return `${minutes}m`
    }
    const hours = Math.floor(minutes / 60)
    if (hours < 48) {
        return `${hours}h ${minutes % 60}m`
    }

    return `${Math.floor(hours / 24)}d`
}

function ageLabel(task) {
    const createdAt = parseTimestamp(task.createdAt)
    if (!createdAt) {
        return ''
    }
    const completedAt = parseTimestamp(task.completedAt)

    return completedAt ? `took ${shortDuration(completedAt - createdAt)}` : `${shortDuration(Date.now() - createdAt)} old`
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

function applyView() {
    stage.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
}

function fitToWidth(graphWidth) {
    const available = viewport.clientWidth - 32
    view.scale = Math.min(1, Math.max(MIN_SCALE, available / graphWidth))
    view.x = Math.max(16, (viewport.clientWidth - graphWidth * view.scale) / 2)
    view.y = 16
    applyView()
}

function renderRunOptions(runs, currentRunId) {
    runSelect.replaceChildren(
        ...runs.map((run) => {
            const option = element('option', '', run.objective || run.id)
            option.value = run.id
            option.selected = run.id === currentRunId

            return option
        }),
    )
    runSelect.disabled = runs.length === 0
}

function renderEmpty(message) {
    edgePaths.replaceChildren()
    cards.replaceChildren(element('div', 'empty', message))
    cards.firstChild.style.width = `${viewport.clientWidth - 32}px`
    view.x = 16
    view.y = 16
    view.scale = 1
    applyView()
}

function layout(tasks, heightByTaskId) {
    const graph = new dagre.graphlib.Graph()
    graph.setGraph({ rankdir: 'TB', nodesep: 28, ranksep: 56, marginx: 0, marginy: 0 })
    graph.setDefaultEdgeLabel(() => ({}))
    for (const task of tasks) {
        graph.setNode(task.id, { width: CARD_WIDTH, height: heightByTaskId.get(task.id) })
    }
    const taskIds = new Set(tasks.map((task) => task.id))
    for (const task of tasks) {
        for (const depId of task.deps) {
            if (taskIds.has(depId)) {
                graph.setEdge(depId, task.id)
            }
        }
    }
    dagre.layout(graph)

    return graph
}

function edgePath(points) {
    const [first, ...rest] = points
    if (rest.length === 1) {
        return `M${first.x},${first.y} L${rest[0].x},${rest[0].y}`
    }
    let path = `M${first.x},${first.y}`
    for (let index = 0; index < rest.length - 1; index++) {
        const control = rest[index]
        const next = rest[index + 1]
        const end = index === rest.length - 2 ? next : { x: (control.x + next.x) / 2, y: (control.y + next.y) / 2 }
        path += ` Q${control.x},${control.y} ${end.x},${end.y}`
    }

    return path
}

function taskCard(task, gate) {
    const card = element('div', `card status-${task.status}`)
    card.title = task.spec || task.name
    card.append(element('div', 'name', task.name))
    const meta = element('div', 'meta')
    meta.append(element('span', 'chip', task.status))
    if (task.agent) {
        meta.append(element('span', 'agent', task.agent))
    }
    meta.append(element('span', 'age', ageLabel(task)))
    card.append(meta)
    if (gate) {
        card.append(element('div', 'gate', `⚠ gate: ${gate.question}`))
    }
    card.addEventListener('click', () => openTask(task))

    return card
}

function renderGraph(data) {
    const { tasks, gates } = data
    if (tasks.length === 0) {
        renderEmpty('This run has no tasks yet.')
        return
    }
    const gateByTaskId = new Map(gates.map((gate) => [gate.taskId, gate]))
    const cardByTaskId = new Map(tasks.map((task) => [task.id, taskCard(task, gateByTaskId.get(task.id))]))
    for (const card of cardByTaskId.values()) {
        card.style.width = `${CARD_WIDTH}px`
    }
    cards.replaceChildren(...cardByTaskId.values())
    const heightByTaskId = new Map([...cardByTaskId].map(([taskId, card]) => [taskId, card.offsetHeight]))
    const graph = layout(tasks, heightByTaskId)

    edgePaths.replaceChildren(
        ...graph.edges().map((edge) => {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
            path.setAttribute('d', edgePath(graph.edge(edge).points))
            path.setAttribute('marker-end', 'url(#arrow)')

            return path
        }),
    )
    for (const [taskId, card] of cardByTaskId) {
        const node = graph.node(taskId)
        card.style.left = `${node.x - node.width / 2}px`
        card.style.top = `${node.y - node.height / 2}px`
    }

    const { width, height } = graph.graph()
    edgesSvg.setAttribute('width', width)
    edgesSvg.setAttribute('height', height)
    if (shownRunId !== data.run.id) {
        shownRunId = data.run.id
        fitToWidth(width)
    }
}

async function refresh({ force = false } = {}) {
    if (inFlight || (!force && document.visibilityState !== 'visible')) {
        return
    }
    inFlight = true
    try {
        const data = await orca.plugin.request('graph.get', { runId: selectedRunId }, { timeoutMs: 60000 })
        renderRunOptions(data.runs, data.run?.id)
        const signature = JSON.stringify([data.run?.id, data.tasks, data.gates, Math.floor(Date.now() / 60000)])
        if (signature !== lastSignature) {
            lastSignature = signature
            if (data.run) {
                renderGraph(data)
            } else {
                shownRunId = null
                renderEmpty('No orchestration runs yet.')
            }
        }
        setStatus(data.run ? `${data.tasks.length} tasks · updated ${new Date().toLocaleTimeString()}` : '')
    } catch (error) {
        setStatus(`${error.code ?? 'error'}: ${error.message}`, true)
    } finally {
        inFlight = false
    }
}

async function openTask(task) {
    if (!task.terminal && !task.worktreeId) {
        setStatus(`No worker has started on “${task.name}” yet.`)
        return
    }
    try {
        const result = await orca.plugin.request('task.open', { terminal: task.terminal, worktreeId: task.worktreeId })
        if (!result.opened) {
            setStatus(`Nothing to open for “${task.name}”.`)
        }
    } catch (error) {
        setStatus(`Could not open “${task.name}”: ${error.message}`, true)
    }
}

runSelect.addEventListener('change', () => {
    selectedRunId = runSelect.value
    lastSignature = ''
    void refresh({ force: true })
})

viewport.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.card')) {
        return
    }
    const start = { x: event.clientX - view.x, y: event.clientY - view.y }
    viewport.classList.add('panning')
    viewport.setPointerCapture(event.pointerId)
    const move = (moveEvent) => {
        view.x = moveEvent.clientX - start.x
        view.y = moveEvent.clientY - start.y
        applyView()
    }
    const stop = () => {
        viewport.classList.remove('panning')
        viewport.removeEventListener('pointermove', move)
        viewport.removeEventListener('pointerup', stop)
    }
    viewport.addEventListener('pointermove', move)
    viewport.addEventListener('pointerup', stop)
})

viewport.addEventListener(
    'wheel',
    (event) => {
        event.preventDefault()
        if (!event.ctrlKey && !event.metaKey) {
            view.x -= event.deltaX
            view.y -= event.deltaY
            applyView()
            return
        }
        const rect = viewport.getBoundingClientRect()
        const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top }
        const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * Math.exp(-event.deltaY * 0.002)))
        view.x = pointer.x - ((pointer.x - view.x) * nextScale) / view.scale
        view.y = pointer.y - ((pointer.y - view.y) * nextScale) / view.scale
        view.scale = nextScale
        applyView()
    },
    { passive: false },
)

const DOCUMENT_WAIT_MS = 1500

function runIdFromDocument() {
    if (!orca.document) {
        return Promise.resolve(null)
    }

    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), DOCUMENT_WAIT_MS)
        orca.document.onDidChange((current) => {
            clearTimeout(timer)
            try {
                const content = current?.content
                resolve(content?.kind === 'text' ? (JSON.parse(content.text || '{}').runId ?? null) : null)
            } catch {
                resolve(null)
            }
        })
    })
}

orca.on('agent.status.changed', () => void refresh())
document.addEventListener('visibilitychange', () => void refresh())
setInterval(() => void refresh(), POLL_INTERVAL_MS)
runIdFromDocument().then((runId) => {
    selectedRunId = runId
    void refresh({ force: true })
})
