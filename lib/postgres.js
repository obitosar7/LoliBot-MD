import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..')
const DB_FILE = path.join(PROJECT_ROOT, 'database.json')

const TABLE_META = {
  group_settings: { primaryKey: 'group_id' },
  usuarios: { primaryKey: 'id' },
  chats: { primaryKey: 'id' },
  messages: { primaryKey: ['user_id', 'group_id'] },
  characters: { primaryKey: 'id', autoIncrement: true },
  subbots: { primaryKey: 'id' },
  reportes: { primaryKey: 'id', autoIncrement: true },
  chat_memory: { primaryKey: 'chat_id' },
  stats: { primaryKey: 'command' }
}

const SPECIAL_TABLES = new Set(Object.keys(TABLE_META))

const TABLE_DEFAULTS = {
  group_settings: {
    welcome: true,
    detect: true,
    antifake: false,
    antilink: false,
    antilink2: false,
    modohorny: false,
    audios: false,
    antiStatus: false,
    modoadmin: false,
    photowelcome: false,
    photobye: false,
    autolevelup: true,
    banned: false,
    expired: 0,
    memory_ttl: 86400
  },
  usuarios: {
    registered: false,
    banned: false,
    warn_pv: false,
    warn: 0,
    warn_antiporn: 0,
    warn_estado: 0,
    money: 100,
    limite: 10,
    exp: 0,
    banco: 0,
    level: 0,
    role: 'novato',
    ry_time: 0,
    lastwork: 0,
    lastmiming: 0,
    lastclaim: 0,
    dailystreak: 0,
    lastcofre: 0,
    lastrob: 0,
    lastslut: 0,
    timevot: 0,
    wait: 0,
    crime: 0,
    avisos_ban: 0,
    marry: null,
    marry_request: null
  },
  chats: {
    is_group: true,
    is_active: true,
    joined: true
  },
  messages: {
    message_count: 0
  },
  characters: {
    for_sale: false,
    votes: 0
  },
  subbots: {
    prefix: ['/', '.', '#'],
    mode: 'public',
    owners: [],
    anti_private: false,
    anti_call: true,
    privacy: false,
    prestar: false
  },
  reportes: {
    enviado: false,
    tipo: 'reporte',
    fecha: () => new Date().toISOString()
  },
  chat_memory: {
    updated_at: () => new Date().toISOString()
  }
}

class LocalPool {
  constructor(filePath) {
    this.filePath = filePath
    this.data = {}
    this.autoIds = {}
    this.saveTimer = null
    this.load()
  }

  load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf8')
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          this.data = parsed.tables || {}
          this.autoIds = parsed.autoIds || {}
        }
      } catch (err) {
        console.error('[❌] No se pudo cargar database.json:', err)
        this.data = {}
        this.autoIds = {}
      }
    }

    for (const table of Object.keys(TABLE_META)) {
      if (!Array.isArray(this.data[table])) this.data[table] = []
      if (TABLE_META[table].autoIncrement) {
        const currentMax = Math.max(0, ...this.data[table].map(row => Number(row.id) || 0))
        this.autoIds[table] = Math.max(this.autoIds[table] || 0, currentMax)
      }
    }
  }

  connect() {
    console.log('✅ Base de datos local (database.json) cargada.')
    return Promise.resolve(this)
  }

  scheduleSave() {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.save()
    }, 200)
  }

  save() {
    const payload = {
      tables: this.data,
      autoIds: this.autoIds
    }

    try {
      fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf8')
    } catch (err) {
      console.error('[❌] Error al escribir database.json:', err)
    }
  }

  async query(sql, params = []) {
    if (!sql) return { rows: [], rowCount: 0 }
    const trimmed = sql.trim().replace(/;$/, '')
    const upper = trimmed.toUpperCase()

    if (upper === 'VACUUM FULL' || upper === 'VACUUM FULL;') {
      this.scheduleSave()
      return { rows: [], rowCount: 0 }
    }

    if (upper.startsWith('CREATE TABLE')) {
      this.handleCreateTable(trimmed)
      return { rows: [], rowCount: 0 }
    }

    if (upper.startsWith('ALTER TABLE')) {
      this.handleAlterTable(trimmed)
      this.scheduleSave()
      return { rows: [], rowCount: 0 }
    }

    if (upper.startsWith('INSERT INTO')) {
      const result = this.handleInsert(trimmed, params)
      this.scheduleSave()
      return result
    }

    if (upper.startsWith('UPDATE')) {
      const result = this.handleUpdate(trimmed, params)
      this.scheduleSave()
      return result
    }

    if (upper.startsWith('DELETE FROM')) {
      const result = this.handleDelete(trimmed, params)
      this.scheduleSave()
      return result
    }

    if (upper.startsWith('SELECT')) {
      return this.handleSelect(trimmed, params)
    }

    console.warn('[⚠️] Consulta no soportada:', sql)
    return { rows: [], rowCount: 0 }
  }

  handleCreateTable(sql) {
    const match = sql.match(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/i)
    if (!match) return
    const table = match[1]
    if (!this.data[table]) this.data[table] = []
  }

  handleAlterTable(sql) {
    const match = sql.match(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+(\w+)/i)
    if (!match) return
    const [, table, column] = match
    if (!this.data[table]) this.data[table] = []
    const defaultValue = parseDefaultFromAlter(sql)
    for (const row of this.data[table]) {
      if (!(column in row)) row[column] = cloneValue(defaultValue)
    }
  }

  handleInsert(sql, params) {
    const returningMatch = sql.match(/RETURNING\s+(.+)$/i)
    const returningClause = returningMatch ? returningMatch[1].trim() : null
    const beforeReturning = returningMatch ? sql.slice(0, returningMatch.index).trim() : sql

    const conflictMatch = beforeReturning.match(/ON\s+CONFLICT\s*(?:\(([^)]+)\))?\s+DO\s+(.+)$/i)
    const conflictClause = conflictMatch ? conflictMatch[0] : null
    const conflictTarget = conflictMatch ? (conflictMatch[1] ? conflictMatch[1].split(',').map(v => v.trim()) : null) : null
    const conflictAction = conflictMatch ? conflictMatch[2].trim() : null

    const insertSQL = conflictClause ? beforeReturning.replace(conflictClause, '').trim() : beforeReturning
    const match = insertSQL.match(/^INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\((.+)\)$/i)
    if (!match) throw new Error('Consulta INSERT no soportada: ' + sql)
    const [, table, columnsRaw, valuesRaw] = match
    if (!this.data[table]) this.data[table] = []

    const columns = splitComma(columnsRaw)
    const values = splitComma(valuesRaw)
    const row = {}

    columns.forEach((col, idx) => {
      row[col] = resolveValue(values[idx], params)
    })

    applyDefaults(table, row)

    const meta = TABLE_META[table]
    if (meta?.autoIncrement) {
      if (row[meta.primaryKey] == null) {
        this.autoIds[table] = (this.autoIds[table] || 0) + 1
        row[meta.primaryKey] = this.autoIds[table]
      } else {
        this.autoIds[table] = Math.max(this.autoIds[table] || 0, Number(row[meta.primaryKey]))
      }
    }

    const existingIndex = this.findExistingIndex(table, row, conflictTarget)
    let finalRow

    if (existingIndex >= 0) {
      if (conflictAction) {
        if (conflictAction.toUpperCase() === 'NOTHING') {
          finalRow = { ...this.data[table][existingIndex] }
        } else if (conflictAction.toUpperCase().startsWith('UPDATE SET')) {
          const setClause = conflictAction.slice('UPDATE SET'.length).trim()
          const assignments = splitComma(setClause)
          const current = { ...this.data[table][existingIndex] }
          for (const assign of assignments) {
            const [lhs, rhs] = assign.split('=').map(s => s.trim())
            current[lhs] = evaluateExpression(current, rhs, params)
          }
          this.data[table][existingIndex] = current
          finalRow = { ...current }
        }
      } else {
        finalRow = { ...this.data[table][existingIndex] }
      }
    } else {
      this.data[table].push(row)
      finalRow = { ...row }
    }

    const rows = returningClause ? [projectRow(finalRow, returningClause)] : [finalRow]
    return { rows, rowCount: rows.length }
  }

  findExistingIndex(table, row, conflictTarget) {
    const meta = TABLE_META[table]
    if (!this.data[table]) return -1
    const rows = this.data[table]
    if (conflictTarget && conflictTarget.length) {
      return rows.findIndex(r => conflictTarget.every(key => r[key] === row[key]))
    }
    if (meta?.primaryKey) {
      const keys = Array.isArray(meta.primaryKey) ? meta.primaryKey : [meta.primaryKey]
      return rows.findIndex(r => keys.every(key => r[key] === row[key]))
    }
    return -1
  }

  handleUpdate(sql, params) {
    const returningMatch = sql.match(/RETURNING\s+(.+)$/i)
    const returningClause = returningMatch ? returningMatch[1].trim() : null
    const baseSQL = returningMatch ? sql.slice(0, returningMatch.index).trim() : sql

    const match = baseSQL.match(/^UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(.+)$/i)
    if (!match) throw new Error('Consulta UPDATE no soportada: ' + sql)
    const [, table, setClause, whereClause] = match
    const assignments = splitComma(setClause)
    const filter = buildFilter(whereClause, params)
    const rows = this.data[table] || []
    const updated = []

    rows.forEach((row, idx) => {
      if (filter(row)) {
        const current = { ...row }
        for (const assign of assignments) {
          const [lhs, rhs] = assign.split('=').map(s => s.trim())
          current[lhs] = evaluateExpression(current, rhs, params)
        }
        this.data[table][idx] = current
        updated.push(current)
      }
    })

    const rowsOut = returningClause ? updated.map(row => projectRow(row, returningClause)) : []
    return { rows: rowsOut.length ? rowsOut : updated, rowCount: updated.length }
  }

  handleDelete(sql, params) {
    const match = sql.match(/^DELETE\s+FROM\s+(\w+)\s+WHERE\s+(.+)$/i)
    if (!match) throw new Error('Consulta DELETE no soportada: ' + sql)
    const [, table, whereClause] = match
    const filter = buildFilter(whereClause, params)
    const rows = this.data[table] || []
    const remaining = []
    let count = 0
    for (const row of rows) {
      if (filter(row)) {
        count++
      } else {
        remaining.push(row)
      }
    }
    this.data[table] = remaining
    return { rows: [], rowCount: count }
  }

  handleSelect(sql, params) {
    const normalized = sql.replace(/\s+/g, ' ').trim()
    if (normalized.toLowerCase().includes('pg_stat_user_tables')) {
      return this.handlePgStatQueries(normalized)
    }

    if (/pg_size_pretty/i.test(normalized)) {
      return this.handlePgSizeQuery(normalized)
    }

    if (/count\(\*\)::int/i.test(normalized) && normalized.includes('FILTER')) {
      return this.handleCountFilter(normalized)
    }

    if (normalized.toLowerCase().includes('from chat_memory') && normalized.toLowerCase().includes('join group_settings')) {
      return this.handleChatMemoryJoin()
    }

    const match = normalized.match(/^SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER BY\s+(.+?))?(?:\s+LIMIT\s+(\d+))?$/i)
    if (!match) throw new Error('Consulta SELECT no soportada: ' + sql)
    const [, selectClause, table, whereClause, orderClause, limitClause] = match

    const rows = [...(this.data[table] || [])]
    const filter = buildFilter(whereClause, params)
    let filtered = rows.filter(row => filter(row))

    const aggregateResult = handleAggregates(filtered, selectClause)
    if (aggregateResult) return aggregateResult

    if (orderClause) {
      const [column, direction] = orderClause.trim().split(/\s+/)
      filtered.sort((a, b) => {
        const dir = (direction || 'ASC').toUpperCase() === 'DESC' ? -1 : 1
        const aVal = a[column]
        const bVal = b[column]
        if (typeof aVal === 'string' && typeof bVal === 'string') {
          return aVal.localeCompare(bVal) * dir
        }
        if ((aVal || 0) < (bVal || 0)) return -1 * dir
        if ((aVal || 0) > (bVal || 0)) return 1 * dir
        return 0
      })
    }

    const limit = limitClause ? Number(limitClause) : null
    if (limit != null) filtered = filtered.slice(0, limit)

    const rowsOut = filtered.map(row => projectSelect(row, selectClause))
    return { rows: rowsOut, rowCount: rowsOut.length }
  }

  handlePgStatQueries(sql) {
    if (sql.toLowerCase().includes('pg_stat_user_tables')) {
      const rows = []
      const entries = []
      for (const [table, data] of Object.entries(this.data)) {
        if (!SPECIAL_TABLES.has(table)) continue
        const bytes = estimateTableSize(data)
        entries.push({
          tabla: table,
          filas: data.length,
          tamaño: humanFileSize(bytes),
          __bytes: bytes
        })
      }
      entries.sort((a, b) => b.__bytes - a.__bytes)
      const cleaned = entries.map(({ __bytes, ...rest }) => rest)
      return { rows: cleaned, rowCount: cleaned.length }
    }
    return { rows: [], rowCount: 0 }
  }

  handlePgSizeQuery(sql) {
    const totalSize = humanFileSize(fs.existsSync(this.filePath) ? fs.statSync(this.filePath).size : 0)
    if (/SUM\(pg_total_relation_size/i.test(sql)) {
      return { rows: [{ total: totalSize }], rowCount: 1 }
    }
    return { rows: [{ pg_size_pretty: totalSize }], rowCount: 1 }
  }

  handleCountFilter(sql) {
    const tableMatch = sql.match(/FROM\s+(\w+)/i)
    if (!tableMatch) return { rows: [], rowCount: 0 }
    const table = tableMatch[1]
    const rows = this.data[table] || []
    const total = rows.length
    const registered = rows.filter(row => row.registered === true).length
    return { rows: [{ total, registrados: registered }], rowCount: 1 }
  }

  handleChatMemoryJoin() {
    const memories = this.data.chat_memory || []
    const groups = this.data.group_settings || []
    const rows = memories.map(mem => {
      const group = groups.find(g => g.group_id === mem.chat_id) || {}
      const ttl = group.memory_ttl != null ? group.memory_ttl : 86400
      return {
        chat_id: mem.chat_id,
        updated_at: mem.updated_at,
        memory_ttl: ttl
      }
    }).filter(row => row.memory_ttl > 0)

    return { rows, rowCount: rows.length }
  }
}

function splitComma(value) {
  if (!value) return []
  const result = []
  let current = ''
  let depth = 0
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if (char === '(' || char === '[') depth++
    if (char === ')' || char === ']') depth--
    if (char === ',' && depth === 0) {
      result.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }
  if (current.trim()) result.push(current.trim())
  return result
}

function parseDefaultFromAlter(sql) {
  const match = sql.match(/DEFAULT\s+(.+)/i)
  if (!match) return null
  return resolveLiteral(match[1])
}

function resolveLiteral(token) {
  if (!token) return null
  const trimmed = token.trim()
  if (/^'.*'$/.test(trimmed)) return trimmed.slice(1, -1).replace(/''/g, "'")
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  if (/^\d+\.\d+$/.test(trimmed)) return Number(trimmed)
  if (/^true$/i.test(trimmed)) return true
  if (/^false$/i.test(trimmed)) return false
  if (/^null$/i.test(trimmed)) return null
  if (/^ARRAY\[(.*)\]$/i.test(trimmed)) {
    const inner = trimmed.replace(/^ARRAY\[/i, '').replace(/]$/, '')
    return splitComma(inner).map(resolveLiteral)
  }
  return trimmed
}

function resolveValue(token, params) {
  if (!token) return null
  const trimmed = token.trim()
  if (/^\$\d+$/.test(trimmed)) {
    const idx = Number(trimmed.slice(1)) - 1
    return params[idx]
  }
  if (/^NOW\(\)$/i.test(trimmed)) return new Date().toISOString()
  if (/^CURRENT_TIMESTAMP$/i.test(trimmed)) return new Date().toISOString()
  return resolveLiteral(trimmed)
}

function buildFilter(whereClause, params) {
  if (!whereClause) return () => true
  const clauses = splitLogical(whereClause)
  const evaluators = clauses.map(clause => createCondition(clause.trim(), params))
  return row => evaluators.every(fn => fn(row))
}

function splitLogical(whereClause = '') {
  if (!whereClause) return []
  return whereClause.split(/\s+AND\s+/i).map(part => part.trim()).filter(Boolean)
}

function createCondition(clause, params) {
  const lowerClause = clause.toLowerCase()
  if (lowerClause === '1=1') return () => true
  let match = clause.match(/^LOWER\((\w+)\)\s*=\s*\$(\d+)/i)
  if (match) {
    const [, column, index] = match
    const value = params[Number(index) - 1]
    return row => (row[column]?.toLowerCase?.() || '').trim() === (value || '').toLowerCase()
  }

  match = clause.match(/^(\w+)\s+IS\s+NOT\s+NULL$/i)
  if (match) {
    const column = match[1]
    return row => row[column] !== null && row[column] !== undefined
  }

  match = clause.match(/^(\w+)\s+IS\s+NULL$/i)
  if (match) {
    const column = match[1]
    return row => row[column] === null || row[column] === undefined
  }

  match = clause.match(/^(\w+)\s*(=|!=|<>|>=|<=|>|<)\s*\$(\d+)/i)
  if (match) {
    const [, column, operator, index] = match
    const value = params[Number(index) - 1]
    return row => compare(row[column], value, operator)
  }

  match = clause.match(/^(\w+)\s*(=|!=|<>|>=|<=|>|<)\s*(true|false|null|\d+(?:\.\d+)?|'[^']*')/i)
  if (match) {
    const [, column, operator, literal] = match
    const value = resolveLiteral(literal)
    return row => compare(row[column], value, operator)
  }

  match = clause.match(/^(\w+)\s*<\s*NOW\(\)$/i)
  if (match) {
    const column = match[1]
    return row => Number(row[column]) < Date.now()
  }

  match = clause.match(/^(.+)$/)
  if (match) {
    return () => true
  }
  return () => true
}

function compare(a, b, operator) {
  switch (operator) {
    case '=':
      return a === b
    case '!=':
    case '<>':
      return a !== b
    case '>':
      return Number(a) > Number(b)
    case '<':
      return Number(a) < Number(b)
    case '>=':
      return Number(a) >= Number(b)
    case '<=':
      return Number(a) <= Number(b)
    default:
      return false
  }
}

function evaluateExpression(row, expr, params) {
  if (!expr) return null
  const cleaned = expr.replace(/\s+/g, ' ').trim().replace(/\b\w+\./g, '')

  if (/^\$\d+$/.test(cleaned)) return params[Number(cleaned.slice(1)) - 1]
  if (/^'.*'$/.test(cleaned)) return cleaned.slice(1, -1)
  if (/^NULL$/i.test(cleaned)) return null
  if (/^TRUE$/i.test(cleaned)) return true
  if (/^FALSE$/i.test(cleaned)) return false
  if (/^NOW\(\)$/i.test(cleaned)) return new Date().toISOString()
  if (/^\d+$/.test(cleaned) || /^\d+\.\d+$/.test(cleaned)) return Number(cleaned)
  if (/^ARRAY\[/.test(cleaned)) return resolveLiteral(cleaned)

  if (/^GREATEST\((.+)\)$/i.test(cleaned)) {
    const inner = cleaned.replace(/^GREATEST\(/i, '').replace(/\)$/,'')
    const values = splitComma(inner).map(item => evaluateExpression(row, item, params))
    return Math.max(...values.map(Number))
  }

  if (/^COALESCE\((.+)\)$/i.test(cleaned)) {
    const inner = cleaned.replace(/^COALESCE\(/i, '').replace(/\)$/,'')
    const values = splitComma(inner).map(item => evaluateExpression(row, item, params))
    return values.find(value => value !== null && value !== undefined)
  }

  const arithmeticMatch = cleaned.match(/^(\w+)\s*([+\-])\s*(\$\d+|\d+)/)
  if (arithmeticMatch) {
    const [, column, operator, valueToken] = arithmeticMatch
    const value = /^\$/.test(valueToken) ? params[Number(valueToken.slice(1)) - 1] : Number(valueToken)
    const base = Number(row[column] || 0)
    return operator === '+' ? base + Number(value) : base - Number(value)
  }

  if (/^\w+$/.test(cleaned)) {
    return row[cleaned]
  }

  return cleaned
}

function projectRow(row, returningClause) {
  if (!returningClause || returningClause === '*') return { ...row }
  const columns = returningClause.split(',').map(col => col.trim().replace(/"/g, ''))
  const projected = {}
  for (const col of columns) {
    projected[col] = row[col]
  }
  return projected
}

function projectSelect(row, clause) {
  if (clause.trim() === '*') return { ...row }
  const columns = clause.split(',').map(c => c.trim())
  const projected = {}
  for (const col of columns) {
    if (/COUNT\(\*\)/i.test(col)) {
      projected.count = 1
    } else if (/SUM\((\w+)\)/i.test(col)) {
      const [, column] = col.match(/SUM\((\w+)\)/i)
      projected[`sum_${column}`] = Number(row[column] || 0)
    } else {
      const aliasMatch = col.match(/(\w+)\s+AS\s+(\w+)/i)
      if (aliasMatch) {
        const [, field, alias] = aliasMatch
        projected[alias] = row[field]
      } else {
        projected[col] = row[col]
      }
    }
  }
  return projected
}

function applyDefaults(table, row) {
  const defaults = TABLE_DEFAULTS[table]
  if (!defaults) return
  for (const [key, value] of Object.entries(defaults)) {
    if (row[key] !== undefined) continue
    row[key] = typeof value === 'function' ? value() : cloneValue(value)
  }
}

function handleAggregates(rows, selectClause) {
  if (!selectClause) return null
  if (/FILTER\s*\(\s*WHERE/i.test(selectClause)) return null

  const countMatches = [...selectClause.matchAll(/COUNT\(\*\)(?:::\w+)?(?:\s+AS\s+(\w+))?/gi)]
  const sumMatches = [...selectClause.matchAll(/SUM\((\w+)\)(?:\s+AS\s+(\w+))?/gi)]
  if (!countMatches.length && !sumMatches.length) return null

  const result = {}
  countMatches.forEach((match, idx) => {
    const alias = match[1] || (idx === 0 ? 'count' : `count_${idx}`)
    result[alias] = rows.length
  })

  sumMatches.forEach((match, idx) => {
    const column = match[1]
    const alias = match[2] || (idx === 0 ? 'sum' : `sum_${idx}`)
    result[alias] = rows.reduce((acc, row) => acc + (Number(row[column]) || 0), 0)
  })

  return { rows: [result], rowCount: 1 }
}

function humanFileSize(bytes) {
  if (!bytes) return '0 B'
  const thresh = 1024
  const units = ['B', 'KB', 'MB', 'GB']
  let u = 0
  let value = bytes
  while (value >= thresh && u < units.length - 1) {
    value /= thresh
    u++
  }
  return `${value.toFixed(2)} ${units[u]}`
}

function estimateTableSize(rows) {
  return JSON.stringify(rows || []).length
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue)
  if (value && typeof value === 'object') return { ...value }
  return value
}

export const db = new LocalPool(DB_FILE)

db.connect().catch(err => console.error('[❌] Error inicializando DB local:', err))

async function initTables() {
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS group_settings (
        group_id TEXT PRIMARY KEY
      );`)

    const columnasGrupos = [
      ['welcome', 'BOOLEAN DEFAULT true'],
      ['detect', 'BOOLEAN DEFAULT true'],
      ['antifake', 'BOOLEAN DEFAULT false'],
      ['antilink', 'BOOLEAN DEFAULT false'],
      ['antilink2', 'BOOLEAN DEFAULT false'],
      ['modohorny', 'BOOLEAN DEFAULT false'],
      ['audios', 'BOOLEAN DEFAULT false'],
      ['nsfw_horario', 'TEXT'],
      ['antiStatus', 'BOOLEAN DEFAULT false'],
      ['modoadmin', 'BOOLEAN DEFAULT false'],
      ['photowelcome', 'BOOLEAN DEFAULT false'],
      ['photobye', 'BOOLEAN DEFAULT false'],
      ['autolevelup', 'BOOLEAN DEFAULT true'],
      ['sWelcome', 'TEXT'],
      ['sBye', 'TEXT'],
      ['sPromote', 'TEXT'],
      ['sDemote', 'TEXT'],
      ['banned', 'BOOLEAN DEFAULT false'],
      ['expired', 'BIGINT DEFAULT 0'],
      ['memory_ttl', 'INTEGER DEFAULT 86400'],
      ['sAutorespond', 'TEXT'],
      ['primary_bot', 'TEXT']
    ]

    for (const [columna, tipo] of columnasGrupos) {
      await db.query(`ALTER TABLE group_settings ADD COLUMN IF NOT EXISTS ${columna} ${tipo}`)
    }

    await db.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id TEXT PRIMARY KEY
      );
    `)

    const columnasUsuarios = [
      ['nombre', 'TEXT'],
      ['registered', 'BOOLEAN DEFAULT false'],
      ['num', 'TEXT'],
      ['lid', 'TEXT UNIQUE'],
      ['banned', 'BOOLEAN DEFAULT false'],
      ['warn_pv', 'BOOLEAN DEFAULT false'],
      ['warn', 'INTEGER DEFAULT 0'],
      ['warn_antiporn', 'INTEGER DEFAULT 0'],
      ['warn_estado', 'INTEGER DEFAULT 0'],
      ['edad', 'INTEGER'],
      ['money', 'INTEGER DEFAULT 100'],
      ['limite', 'INTEGER DEFAULT 10'],
      ['exp', 'INTEGER DEFAULT 0'],
      ['banco', 'INTEGER DEFAULT 0'],
      ['level', 'INTEGER DEFAULT 0'],
      ['role', "TEXT DEFAULT 'novato'"],
      ['reg_time', 'TIMESTAMP'],
      ['serial_number', 'TEXT'],
      ['sticker_packname', 'TEXT'],
      ['sticker_author', 'TEXT'],
      ['ry_time', 'BIGINT DEFAULT 0'],
      ['lastwork', 'BIGINT DEFAULT 0'],
      ['lastmiming', 'BIGINT DEFAULT 0'],
      ['lastclaim', 'BIGINT DEFAULT 0'],
      ['dailystreak', 'BIGINT DEFAULT 0'],
      ['lastcofre', 'BIGINT DEFAULT 0'],
      ['lastrob', 'BIGINT DEFAULT 0'],
      ['lastslut', 'BIGINT DEFAULT 0'],
      ['timevot', 'BIGINT DEFAULT 0'],
      ['wait', 'BIGINT DEFAULT 0'],
      ['crime', 'BIGINT DEFAULT 0'],
      ['marry', 'TEXT DEFAULT NULL'],
      ['marry_request', 'TEXT DEFAULT NULL'],
      ['razon_ban', 'TEXT'],
      ['avisos_ban', 'INTEGER DEFAULT 0'],
      ['gender', 'TEXT'],
      ['birthday', 'DATE']
    ]

    for (const [columna, tipo] of columnasUsuarios) {
      await db.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ${columna} ${tipo}`)
    }

await db.query(`
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    is_group BOOLEAN DEFAULT true,
    timestamp BIGINT,
    is_active BOOLEAN DEFAULT true,
    bot_id TEXT,
    joined BOOLEAN DEFAULT true
  );
`)

//
    await db.query(`
      CREATE TABLE IF NOT EXISTS messages (
        user_id TEXT,
        group_id TEXT,
        message_count INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, group_id)
      );
    `)

//carácter
    await db.query(`
  CREATE TABLE IF NOT EXISTS characters (
    id SERIAL PRIMARY KEY
  );
`)

const columnasCharacters = [
  ['name', 'TEXT NOT NULL'],
  ['url', 'TEXT NOT NULL'],
  ['tipo', 'TEXT'],
  ['anime', 'TEXT'],
  ['rareza', 'TEXT'],
  ['price', 'INTEGER NOT NULL'],
  ['previous_price', 'INTEGER'],
  ['claimed_by', 'TEXT'],
  ['for_sale', 'BOOLEAN DEFAULT false'],
  ['seller', 'TEXT'],
  ['votes', 'INTEGER DEFAULT 0'],
  ['last_removed_time', 'BIGINT']
]

for (const [columna, tipo] of columnasCharacters) {
  await db.query(`ALTER TABLE characters ADD COLUMN IF NOT EXISTS ${columna} ${tipo}`)
}

//subbot
await db.query(`
  CREATE TABLE IF NOT EXISTS subbots (
    id TEXT PRIMARY KEY
  );
`)

//report
await db.query(`
  CREATE TABLE IF NOT EXISTS reportes (
    id SERIAL PRIMARY KEY,
    sender_id TEXT NOT NULL,
    sender_name TEXT,
    mensaje TEXT NOT NULL,
    fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    enviado BOOLEAN DEFAULT false,
    tipo TEXT DEFAULT 'reporte'
  );
`)

const columnasSubbots = [
  ['tipo', "TEXT DEFAULT 'null'"],
  ['name', 'TEXT'],
  ['logo_url', 'TEXT'],
  ['prefix', "TEXT[] DEFAULT ARRAY['/', '.', '#']"],
  ['mode', "TEXT DEFAULT 'public'"],
  ['owners', 'TEXT[]'],
  ['anti_private', 'BOOLEAN DEFAULT false'],
  ['anti_call', 'BOOLEAN DEFAULT true'],
  ['privacy', 'BOOLEAN DEFAULT false'],
  ['prestar', 'BOOLEAN DEFAULT false']
]

for (const [columna, tipo] of columnasSubbots) {
  await db.query(`ALTER TABLE subbots ADD COLUMN IF NOT EXISTS ${columna} ${tipo}`)
}

    await db.query(`
      CREATE TABLE IF NOT EXISTS chat_memory (
        chat_id TEXT PRIMARY KEY,
        history JSONB,
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `)

    await db.query(`
      CREATE TABLE IF NOT EXISTS stats (
        command TEXT PRIMARY KEY,
        count INTEGER DEFAULT 1
      );
    `)
  } catch (err) {
    console.error('[❌] Error creando tablas o columnas:', err)
  }
}

export async function getSubbotConfig(botId) {
  try {
    const cleanId = botId.replace(/:\\d+/, '')
    const res = await db.query('SELECT * FROM subbots WHERE id = $1', [cleanId])

    if (res.rows.length > 0) return res.rows[0]

    return {
      prefix: ['/', '.', '#'],
      mode: 'public',
      anti_private: true,
      anti_call: false,
      owners: [],
      name: null,
      logo_url: null,
      privacy: null,
      prestar: null,
      tipo: null
    }
  } catch (err) {
    console.error('❌ Error al obtener configuración del subbot desde DB:', err)
    return {
      prefix: ['/', '.', '#'],
      mode: 'public',
      anti_private: true,
      anti_call: false,
      owners: [],
      name: null,
      logo_url: null,
      privacy: null,
      prestar: null,
      tipo: null
    }
  }
}

initTables()
