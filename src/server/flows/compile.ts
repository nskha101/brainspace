import { parse, type Node } from 'acorn'
import { transform } from 'sucrase'
import type { FlowDiagramNode } from '../db'

type AnyNode = Node & Record<string, any>

export type CompiledFlow = {
  js: string
  diagram: FlowDiagramNode[]
  /** Flows the code runs with flows.run("name"), when the name is a plain string. */
  calls: string[]
}

/**
 * Turn flow.ts (or flow.js) into the module a Dynamic Worker runs: strip types,
 * point the `brainspace` import at the injected SDK, and refuse anything else
 * that would need a bundler or the network. Also works out the diagram.
 */
export function compileFlow(source: string, filename: string): CompiledFlow {
  let js = source
  if (/\.ts$/i.test(filename)) {
    try {
      js = transform(source, { transforms: ['typescript'], disableESTransforms: true, filePath: filename }).code
    } catch (err) {
      throw new Error(`${filename} has a syntax error: ${(err as Error).message}`)
    }
  }
  let ast: AnyNode
  try {
    ast = parse(js, { ecmaVersion: 'latest', sourceType: 'module', locations: true }) as AnyNode
  } catch (err) {
    throw new Error(`${filename} has a syntax error: ${(err as Error).message}`)
  }

  const edits: { start: number; end: number; text: string }[] = []
  let hasDefault = false
  for (const stmt of ast.body as AnyNode[]) {
    if (stmt.type === 'ImportDeclaration') {
      if (stmt.source.value !== 'brainspace') {
        throw new Error(
          `${filename} imports "${stmt.source.value}". Flows can only import from "brainspace"; there is no npm or network access at load time.`,
        )
      }
      edits.push({ start: stmt.source.start, end: stmt.source.end, text: "'./sdk.js'" })
    }
    if (stmt.type === 'ExportDefaultDeclaration') hasDefault = true
    if ((stmt.type === 'ExportNamedDeclaration' || stmt.type === 'ExportAllDeclaration') && stmt.source) {
      throw new Error(`${filename} re-exports from another module. Keep the whole flow in one file.`)
    }
  }
  if (!hasDefault) throw new Error(`${filename} needs \`export default defineFlow(async ({ inputs, step }) => { ... })\`.`)
  walkAll(ast, (n) => {
    if (n.type === 'ImportExpression') throw new Error(`${filename} uses import(). Keep the whole flow in one file.`)
  })
  const diagram = buildDiagram(ast, js)
  const calls = new Set<string>()
  walkAll(ast, (n) => {
    if (n.type !== 'CallExpression' || !isFlowRunCallee(n.callee)) return
    const a = n.arguments[0]
    if (a?.type === 'Literal' && typeof a.value === 'string') calls.add(a.value)
    else if (a?.type === 'TemplateLiteral' && !a.expressions.length) calls.add(a.quasis[0].value.cooked)
  })
  for (const e of edits.sort((a, b) => b.start - a.start)) js = js.slice(0, e.start) + e.text + js.slice(e.end)
  return { js, diagram, calls: [...calls] }
}

/** flows.run(...) or ctx.flows.run(...). */
function isFlowRunCallee(callee: AnyNode) {
  if (callee.type !== 'MemberExpression' || callee.computed || callee.property.name !== 'run') return false
  const o = callee.object
  return (o.type === 'Identifier' && o.name === 'flows') || (o.type === 'MemberExpression' && !o.computed && o.property.name === 'flows')
}

function walkAll(node: AnyNode, fn: (n: AnyNode) => void) {
  fn(node)
  for (const child of childNodes(node)) walkAll(child, fn)
}

function childNodes(node: AnyNode): AnyNode[] {
  const out: AnyNode[] = []
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue
    const v = node[key]
    if (Array.isArray(v)) {
      for (const item of v) if (item && typeof item.type === 'string') out.push(item)
    } else if (v && typeof v === 'object' && typeof v.type === 'string') out.push(v)
  }
  return out.sort((a, b) => a.start - b.start)
}

// ---------------------------------------------------------------- diagram

const STEP_METHODS = new Set(['do', 'sleep', 'sleepUntil', 'waitForEvent'])

function buildDiagram(ast: AnyNode, src: string): FlowDiagramNode[] {
  const text = (n: AnyNode) => src.slice(n.start, n.end)
  const short = (s: string, max = 60) => {
    const one = s.replace(/\s+/g, ' ').trim()
    return one.length > max ? one.slice(0, max - 1) + '…' : one
  }
  const label = (n: AnyNode | undefined): string => {
    if (!n) return 'step'
    if (n.type === 'Literal') return String(n.value)
    if (n.type === 'TemplateLiteral') {
      let s = ''
      n.quasis.forEach((q: AnyNode, i: number) => {
        s += q.value.cooked
        if (n.expressions[i]) s += `{${short(text(n.expressions[i]), 30)}}`
      })
      return s
    }
    return short(text(n))
  }

  // Helper functions anywhere in the module can hold steps; calls to them are inlined.
  const helpers = new Map<string, AnyNode>()
  walkAll(ast, (n) => {
    if (n.type === 'FunctionDeclaration' && n.id) helpers.set(n.id.name, n.body)
    if (
      n.type === 'VariableDeclarator' &&
      n.id.type === 'Identifier' &&
      n.init &&
      (n.init.type === 'ArrowFunctionExpression' || n.init.type === 'FunctionExpression')
    ) {
      helpers.set(n.id.name, n.init.body)
    }
  })

  const calleeTail = (callee: AnyNode): { obj?: string; prop?: string; name?: string } => {
    if (callee.type === 'Identifier') return { name: callee.name }
    if (callee.type === 'MemberExpression' && !callee.computed) {
      const obj = callee.object.type === 'Identifier' ? callee.object.name : callee.object.type === 'MemberExpression' && !callee.object.computed ? callee.object.property.name : undefined
      return { obj, prop: callee.property.name }
    }
    return {}
  }
  const isStepCall = (n: AnyNode) => {
    if (n.type !== 'CallExpression') return false
    const t = calleeTail(n.callee)
    return t.obj === 'step' && !!t.prop && STEP_METHODS.has(t.prop)
  }
  const isApprove = (n: AnyNode) => n.type === 'CallExpression' && (calleeTail(n.callee).name === 'approve' || calleeTail(n.callee).prop === 'approve')

  /** What a step's callback touches, for the little tags under each box. */
  const usesIn = (fn: AnyNode | undefined) => {
    const tags = new Set<string>()
    if (!fn) return []
    walkAll(fn, (n) => {
      if (n.type !== 'CallExpression') return
      const t = calleeTail(n.callee)
      const arg = (i: number) => (n.arguments[i]?.type === 'Literal' ? String(n.arguments[i].value) : n.arguments[i] ? label(n.arguments[i]) : '')
      if (t.obj === 'connections' && t.prop === 'call') tags.add(`${arg(0)} · ${arg(1)}`)
      else if (t.obj === 'brain' && ['write', 'edit', 'append', 'upload'].includes(t.prop!)) tags.add(`writes ${arg(0)}`)
      else if (t.obj === 'brain' && ['read', 'search', 'list', 'readMany'].includes(t.prop!)) tags.add(t.prop === 'search' ? 'searches the brain' : `reads ${arg(0)}`)
      else if (t.obj === 'ai') tags.add(`AI ${t.prop}`)
      else if (t.name === 'fetch') {
        const u = arg(0)
        try {
          tags.add(`fetch ${new URL(u.replace(/\{[^}]*\}/g, 'x')).host}`)
        } catch {
          tags.add('fetch')
        }
      }
    })
    return [...tags].slice(0, 6)
  }

  const seenHelpers = new Set<string>()

  const fromExpr = (expr: AnyNode | null | undefined): FlowDiagramNode[] => {
    if (!expr) return []
    const out: FlowDiagramNode[] = []
    const visit = (n: AnyNode) => {
      if (isStepCall(n)) {
        const t = calleeTail(n.callee)
        // Arguments can hold more steps (rare), but never descend into the step's own callback.
        if (t.prop === 'do') {
          const fn = n.arguments.find((a: AnyNode) => a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression')
          out.push({ kind: 'step', label: label(n.arguments[0]), uses: usesIn(fn) })
        } else if (t.prop === 'sleep' || t.prop === 'sleepUntil') {
          const d = n.arguments[1]
          out.push({ kind: 'sleep', label: label(n.arguments[0]), duration: d ? (d.type === 'Literal' ? String(d.value) : short(text(d), 30)) : undefined })
        } else {
          out.push({ kind: 'approval', label: `Wait for ${label(n.arguments[0])}` })
        }
        return
      }
      if (n.type === 'CallExpression' && isFlowRunCallee(n.callee)) {
        for (const a of n.arguments.slice(1)) visit(a)
        out.push({ kind: 'flow', label: label(n.arguments[0]) })
        return
      }
      if (isApprove(n)) {
        const opts = n.arguments[0]
        const title = opts?.type === 'ObjectExpression' ? opts.properties.find((p: AnyNode) => p.key?.name === 'title')?.value : undefined
        out.push({ kind: 'approval', label: title ? label(title) : 'Approval' })
        return
      }
      if (n.type === 'CallExpression') {
        const t = calleeTail(n.callee)
        // Promise.all([...]) and Promise.all(items.map(...)) run in parallel.
        if (t.obj === 'Promise' && (t.prop === 'all' || t.prop === 'allSettled' || t.prop === 'race' || t.prop === 'any')) {
          const arg = n.arguments[0]
          if (arg?.type === 'ArrayExpression') {
            const body = arg.elements.flatMap((el: AnyNode) => fromExpr(el))
            if (body.length) out.push({ kind: 'parallel', label: 'In parallel', body })
            return
          }
          if (arg?.type === 'CallExpression' && arg.callee.type === 'MemberExpression' && arg.callee.property.name === 'map') {
            const cb = arg.arguments[0]
            const body = cb ? fromFn(cb) : []
            if (body.length) out.push({ kind: 'parallel', label: `For each of ${short(text(arg.callee.object), 40)}, in parallel`, body })
            return
          }
        }
        if ((t.prop === 'map' || t.prop === 'forEach' || t.prop === 'flatMap') && n.callee.type === 'MemberExpression') {
          const cb = n.arguments[0]
          const body = cb ? fromFn(cb) : []
          if (body.length) {
            out.push({ kind: 'loop', label: `For each of ${short(text(n.callee.object), 40)}`, body })
            return
          }
        }
        if (t.name && helpers.has(t.name) && !seenHelpers.has(t.name)) {
          seenHelpers.add(t.name)
          for (const a of n.arguments) visit(a)
          const body = helpers.get(t.name)!
          out.push(...(body.type === 'BlockStatement' ? fromBlock(body.body) : fromExpr(body)))
          seenHelpers.delete(t.name)
          return
        }
      }
      if (n.type === 'ConditionalExpression') {
        visit(n.test)
        const a = fromExpr(n.consequent)
        const b = fromExpr(n.alternate)
        if (a.length || b.length) out.push({ kind: 'branch', label: `If ${short(text(n.test))}`, then: a, else: b })
        return
      }
      if (n.type === 'FunctionDeclaration') return
      for (const c of childNodes(n)) visit(c)
    }
    visit(expr)
    return out
  }

  const fromFn = (fn: AnyNode): FlowDiagramNode[] => {
    if (fn.type !== 'ArrowFunctionExpression' && fn.type !== 'FunctionExpression') return fromExpr(fn)
    return fn.body.type === 'BlockStatement' ? fromBlock(fn.body.body) : fromExpr(fn.body)
  }

  const fromStmt = (s: AnyNode | null | undefined): FlowDiagramNode[] => {
    if (!s) return []
    switch (s.type) {
      case 'BlockStatement':
        return fromBlock(s.body)
      case 'ForOfStatement':
      case 'ForInStatement': {
        const body = fromStmt(s.body)
        const left = s.left.type === 'VariableDeclaration' ? text(s.left.declarations[0].id) : text(s.left)
        const head = fromExpr(s.right)
        return body.length ? [...head, { kind: 'loop', label: `For each ${short(left, 30)} in ${short(text(s.right), 40)}`, body }] : head
      }
      case 'ForStatement':
      case 'WhileStatement':
      case 'DoWhileStatement': {
        const body = fromStmt(s.body)
        const cond = s.test ? short(text(s.test), 50) : 'forever'
        return body.length ? [{ kind: 'loop', label: s.type === 'ForStatement' ? `Repeat while ${cond}` : `While ${cond}`, body }] : []
      }
      case 'IfStatement': {
        const head = fromExpr(s.test)
        const a = fromStmt(s.consequent)
        const b = fromStmt(s.alternate)
        return a.length || b.length ? [...head, { kind: 'branch', label: `If ${short(text(s.test))}`, then: a, else: b }] : head
      }
      case 'TryStatement':
        return [...fromStmt(s.block), ...fromStmt(s.handler?.body), ...fromStmt(s.finalizer)]
      case 'SwitchStatement':
        return [...fromExpr(s.discriminant), ...s.cases.flatMap((c: AnyNode) => fromBlock(c.consequent))]
      case 'LabeledStatement':
        return fromStmt(s.body)
      case 'FunctionDeclaration':
        return []
      default:
        return fromExpr(s)
    }
  }

  const fromBlock = (stmts: AnyNode[]): FlowDiagramNode[] => stmts.flatMap((s) => fromStmt(s))

  // Find the flow body: export default defineFlow(fn), or export default fn.
  const def = (ast.body as AnyNode[]).find((s) => s.type === 'ExportDefaultDeclaration')?.declaration as AnyNode | undefined
  if (!def) return []
  let fn: AnyNode | undefined
  if (def.type === 'CallExpression') fn = def.arguments.find((a: AnyNode) => a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression')
  else if (def.type === 'ArrowFunctionExpression' || def.type === 'FunctionExpression' || def.type === 'FunctionDeclaration') fn = def
  else if (def.type === 'Identifier' && helpers.has(def.name)) return fromBlock(helpers.get(def.name)!.body ?? [])
  if (!fn) return []
  return fn.body.type === 'BlockStatement' ? fromBlock(fn.body.body) : fromExpr(fn.body)
}
