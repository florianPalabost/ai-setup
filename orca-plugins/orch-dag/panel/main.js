const POLL_INTERVAL_MS = 5000
const AGE_INTERVAL_MS = 30000
const CARD_WIDTH = 240
const GATE_WIDTH = 200
const MIN_SCALE = 0.3
const MAX_SCALE = 2
const TERMINAL_STATUSES = new Set(['completed', 'failed'])

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
let runsSignature = ''
let layoutSignature = ''
let shownTasks = []
let inFlight = false
/** @type {Map<string, { element: HTMLElement, signature: string }>} */
const shownNodes = new Map()

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
    const signature = JSON.stringify([runs, currentRunId])
    if (signature === runsSignature) {
        return
    }
    runsSignature = signature
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

function clearGraph() {
    shownNodes.clear()
    shownTasks = []
    layoutSignature = ''
    edgePaths.replaceChildren()
}

function renderEmpty(message) {
    clearGraph()
    cards.replaceChildren(element('div', 'empty', message))
    cards.firstChild.style.width = `${viewport.clientWidth - 32}px`
    view.x = 16
    view.y = 16
    view.scale = 1
    applyView()
}

/**
 * Turns a run into graph nodes and edges. Besides the tasks, the run itself is
 * the root, every gate is a node pointing at the task it blocks, and a task's
 * parent points at it with a dashed "contains" edge.
 */
function buildGraph({ run, tasks, gates }) {
    const runNodeId = `run:${run.id}`
    const taskIds = new Set(tasks.map((task) => task.id))
    const doneCount = tasks.filter((task) => task.status === 'completed').length
    const nodes = [{ id: runNodeId, kind: 'run', width: CARD_WIDTH, run, doneCount, taskCount: tasks.length }]
    const edges = []

    for (const task of tasks) {
        nodes.push({ id: task.id, kind: 'task', width: CARD_WIDTH, task })
        const deps = task.deps.filter((depId) => taskIds.has(depId))
        const hasParent = task.parentId && taskIds.has(task.parentId)
        for (const depId of deps) {
            edges.push({ from: depId, to: task.id, kind: 'dep' })
        }
        if (hasParent) {
            edges.push({ from: task.parentId, to: task.id, kind: 'child' })
        }
        if (deps.length === 0 && !hasParent) {
            edges.push({ from: runNodeId, to: task.id, kind: 'root' })
        }
    }
    for (const gate of gates) {
        if (!taskIds.has(gate.taskId)) {
            continue
        }
        const gateNodeId = `gate:${gate.id}`
        nodes.push({ id: gateNodeId, kind: 'gate', width: GATE_WIDTH, gate })
        edges.push({ from: gateNodeId, to: gate.taskId, kind: 'gate' })
    }

    return { nodes, edges }
}

function nodeSignature(node) {
    if (node.kind === 'task') {
        const { createdAt, ...stable } = node.task

        return JSON.stringify(['task', stable])
    }
    if (node.kind === 'gate') {
        return JSON.stringify(['gate', node.gate])
    }

    return JSON.stringify(['run', node.run.objective, node.doneCount, node.taskCount])
}

function fillTaskCard(card, task) {
    card.className = `card status-${task.status}`
    card.title = task.spec || task.name
    const meta = element('div', 'meta')
    meta.append(element('span', 'chip', task.status))
    if (task.outcome && task.outcome !== 'succeeded') {
        meta.append(element('span', 'agent', task.outcome))
    }
    if (task.agent) {
        meta.append(element('span', 'agent', task.agent))
    }
    meta.append(element('span', 'age', ageLabel(task)))
    card.replaceChildren(element('div', 'name', task.name), meta)
    card.onclick = () => openTask(task)
}

function fillGateCard(card, gate) {
    const isOpen = gate.status === 'pending'
    card.className = `card gate-node ${isOpen ? 'gate-open' : 'gate-resolved'}`
    card.title = gate.question
    const children = [element('div', 'gate-label', isOpen ? '⚠ Gate · waiting for you' : '✓ Gate · resolved'), element('div', 'name', gate.question)]
    if (gate.resolution) {
        children.push(element('div', 'resolution', `→ ${gate.resolution}`))
    }
    card.replaceChildren(...children)
    card.onclick = null
}

function fillRunCard(card, node) {
    const isDone = node.taskCount > 0 && node.doneCount === node.taskCount
    card.className = `card run-node ${isDone ? 'status-completed' : 'status-run'}`
    card.title = node.run.objective || node.run.id
    const meta = element('div', 'meta')
    meta.append(element('span', 'chip', isDone ? 'done' : 'run'), element('span', 'age', `${node.doneCount}/${node.taskCount} tasks done`))
    card.replaceChildren(element('div', 'name', node.run.objective || node.run.id), meta)
    card.onclick = null
}

function fillCard(card, node) {
    if (node.kind === 'task') {
        fillTaskCard(card, node.task)
    } else if (node.kind === 'gate') {
        fillGateCard(card, node.gate)
    } else {
        fillRunCard(card, node)
    }
}

/** Updates cards in place: unchanged cards keep their DOM, so a poll that changes nothing repaints nothing. */
function syncCards(nodes) {
    const wantedIds = new Set(nodes.map((node) => node.id))
    for (const [id, shown] of shownNodes) {
        if (!wantedIds.has(id)) {
            shown.element.remove()
            shownNodes.delete(id)
        }
    }
    cards.querySelector('.empty')?.remove()
    for (const node of nodes) {
        const signature = nodeSignature(node)
        const shown = shownNodes.get(node.id)
        if (shown?.signature === signature) {
            continue
        }
        const card = shown?.element ?? element('div')
        fillCard(card, node)
        card.style.width = `${node.width}px`
        if (!shown) {
            cards.append(card)
        }
        shownNodes.set(node.id, { element: card, signature })
    }
}

function layout(nodes, edges) {
    const graph = new dagre.graphlib.Graph({ multigraph: true })
    graph.setGraph({ rankdir: 'TB', nodesep: 28, ranksep: 56, marginx: 0, marginy: 0 })
    graph.setDefaultEdgeLabel(() => ({}))
    for (const node of nodes) {
        graph.setNode(node.id, { width: node.width, height: shownNodes.get(node.id).element.offsetHeight })
    }
    for (const edge of edges) {
        graph.setEdge(edge.from, edge.to, { kind: edge.kind }, `${edge.kind}:${edge.from}:${edge.to}`)
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

function placeGraph(graph) {
    edgePaths.replaceChildren(
        ...graph.edges().map((edge) => {
            const { points, kind } = graph.edge(edge)
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
            path.setAttribute('d', edgePath(points))
            path.setAttribute('class', `edge-${kind}`)
            path.setAttribute('marker-end', kind === 'gate' ? 'url(#arrow-gate)' : 'url(#arrow)')

            return path
        }),
    )
    for (const nodeId of graph.nodes()) {
        const node = graph.node(nodeId)
        const card = shownNodes.get(nodeId).element
        card.style.left = `${node.x - node.width / 2}px`
        card.style.top = `${node.y - node.height / 2}px`
    }
    const { width, height } = graph.graph()
    edgesSvg.setAttribute('width', width)
    edgesSvg.setAttribute('height', height)

    return width
}

function renderGraph(data) {
    if (data.tasks.length === 0) {
        renderEmpty('This run has no tasks yet.')
        return
    }
    if (shownRunId !== data.run.id) {
        clearGraph()
        cards.replaceChildren()
    }
    const { nodes, edges } = buildGraph(data)
    syncCards(nodes)
    shownTasks = data.tasks

    const signature = JSON.stringify([edges, [...shownNodes].map(([id, shown]) => [id, shown.signature])])
    if (signature === layoutSignature) {
        return
    }
    layoutSignature = signature
    const width = placeGraph(layout(nodes, edges))
    if (shownRunId !== data.run.id) {
        shownRunId = data.run.id
        fitToWidth(width)
    }
}

/** Ages are the only part of a card that changes with time alone; once every task has ended they are fixed. */
function refreshAges() {
    if (shownTasks.every((task) => TERMINAL_STATUSES.has(task.status))) {
        return
    }
    for (const task of shownTasks) {
        const age = shownNodes.get(task.id)?.element.querySelector('.age')
        if (age) {
            age.textContent = ageLabel(task)
        }
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
        if (data.run) {
            renderGraph(data)
        } else if (shownRunId !== null || !cards.querySelector('.empty')) {
            shownRunId = null
            renderEmpty('No orchestration runs yet.')
        }
        setStatus(data.run ? `${data.tasks.length} tasks · checked ${new Date().toLocaleTimeString()}` : '')
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
setInterval(refreshAges, AGE_INTERVAL_MS)
runIdFromDocument().then((runId) => {
    selectedRunId = runId
    void refresh({ force: true })
})
