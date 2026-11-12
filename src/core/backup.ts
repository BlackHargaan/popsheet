/** Portable JSON backup encoding, including PDFs, scan images and bubble crops. */
export type BackupEntry = [string, unknown]
const keyPattern = /^(?:ws:[A-Z0-9]+|class:[A-Z0-9]+|grades:[A-Z0-9]+|readings:[A-Z0-9]+|scan:[A-Z0-9]+:[A-Z0-9]+:\d+)$/
export const isBackupKey = (key: unknown): key is string => typeof key === 'string' && keyPattern.test(key)

async function encode(value: unknown): Promise<unknown> {
  if (value instanceof Uint8Array || value instanceof Uint8ClampedArray || value instanceof Blob) {
    const bytes = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : value
    let binary = ''
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
    return { $binary: value instanceof Blob ? 'Blob' : value instanceof Uint8ClampedArray ? 'Uint8ClampedArray' : 'Uint8Array', data: btoa(binary), type: value instanceof Blob ? value.type : '' }
  }
  if (Array.isArray(value)) return Promise.all(value.map(encode))
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await encode(v)])))
  return value
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if ('$binary' in obj) {
      if (typeof obj.data !== 'string' || !['Blob', 'Uint8Array', 'Uint8ClampedArray'].includes(String(obj.$binary))) throw new Error('Invalid binary data in backup.')
      const bytes = Uint8Array.from(atob(obj.data), ch => ch.charCodeAt(0))
      if (obj.$binary === 'Blob') return new Blob([bytes], { type: typeof obj.type === 'string' ? obj.type : '' })
      return obj.$binary === 'Uint8ClampedArray' ? new Uint8ClampedArray(bytes) : bytes
    }
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, decode(v)]))
  }
  return value
}

export async function encodeBackup(entries: BackupEntry[]) {
  return JSON.stringify({ format: 'popsheet-backup', version: 1, createdAt: new Date().toISOString(), entries: await encode(entries.filter(([key]) => isBackupKey(key))) })
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value)

export function parseBackup(text: string): BackupEntry[] {
  const backup = JSON.parse(text)
  if (backup?.format !== 'popsheet-backup' || backup.version !== 1 || !Array.isArray(backup.entries)) throw new Error('Choose a Popsheet backup (version 1).')
  const seen = new Set<string>()
  return backup.entries.map((entry: unknown) => {
    if (!Array.isArray(entry) || entry.length !== 2 || !isBackupKey(entry[0]) || seen.has(entry[0])) throw new Error('Invalid or duplicate backup record.')
    const key = entry[0], value = decode(entry[1]) as Record<string, unknown>
    seen.add(key)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid backup record.')
    const [kind, id, student, page] = key.split(':')
    if (kind === 'ws') {
      if (value.id !== id || typeof value.name !== 'string' || !(value.pdf instanceof Uint8Array) || !value.pdf.length || !Array.isArray(value.pages) || !value.pages.length || !Array.isArray(value.questions) || !Array.isArray(value.extras) || !finite(value.createdAt) || !finite(value.scale) || Number(value.scale) <= 0 || Number(value.scale) > 1) throw new Error('Invalid worksheet in backup.')
      for (const size of value.pages) if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) throw new Error('Invalid page size in backup.')
      for (const field of ['boxes', 'grids', 'printed', 'pageCodes']) if (value[field] !== undefined && !Array.isArray(value[field])) throw new Error('Invalid worksheet layout in backup.')
      if (value.extras.some(code => typeof code !== 'string')) throw new Error('Invalid spare codes in backup.')
      for (const position of (value.pageCodes ?? []) as unknown[]) if (position !== null && (!record(position) || !finite(position.x) || !finite(position.y))) throw new Error('Invalid page-code position in backup.')
      for (const layout of (value.printed ?? []) as Record<string, unknown>[]) {
        if (!record(layout) || !Number.isInteger(layout.version) || Number(layout.version) < 1 || !finite(layout.scale) || !Array.isArray(layout.questions)) throw new Error('Invalid printed version in backup.')
        for (const q of layout.questions) if (!record(q) || typeof q.id !== 'string' || !Number.isInteger(q.page) || !finite(q.x) || !finite(q.y) || !Number.isInteger(q.choices) || !['h', 'v'].includes(String(q.dir))) throw new Error('Invalid printed bubbles in backup.')
        if (layout.grids !== undefined && !Array.isArray(layout.grids)) throw new Error('Invalid printed grids in backup.')
        if (layout.pageCodes !== undefined && (!Array.isArray(layout.pageCodes) || layout.pageCodes.some(p => p !== null && (!record(p) || !finite(p.x) || !finite(p.y))))) throw new Error('Invalid printed page codes in backup.')
      }
      for (const field of ['questions', 'boxes', 'grids']) for (const item of (value[field] ?? []) as Record<string, unknown>[]) {
        if (!item || typeof item.id !== 'string' || !Number.isInteger(item.page) || Number(item.page) < 0 || Number(item.page) >= value.pages.length || !Number.isFinite(item.x) || !Number.isFinite(item.y) || !Number.isFinite(item.points)) throw new Error('Invalid answer item in backup.')
        if (field === 'questions' && (!Number.isInteger(item.choices) || Number(item.choices) < 2 || Number(item.choices) > 6 || !['h', 'v'].includes(String(item.dir)))) throw new Error('Invalid bubbles in backup.')
        if (field === 'boxes' && (!(Number(item.width) > 0) || !(Number(item.height) > 0) || typeof item.label !== 'string')) throw new Error('Invalid answer box in backup.')
        if (field === 'grids' && (!Number.isInteger(item.columns) || Number(item.columns) < 1 || Number(item.columns) > 6 || typeof item.label !== 'string')) throw new Error('Invalid number grid in backup.')
      }
    }
    if (kind === 'class' && (value.id !== id || typeof value.name !== 'string' || !Array.isArray(value.students) || value.students.some(s => !s || typeof s.name !== 'string' || typeof s.code !== 'string'))) throw new Error('Invalid class in backup.')
    if (kind === 'scan' && (value.worksheetId !== id || value.studentCode !== student || value.page !== Number(page) || !value.marks || typeof value.marks !== 'object' || !Number.isFinite(value.scannedAt))) throw new Error('Invalid scan in backup.')
    if (kind === 'grades' || kind === 'readings') {
      for (const student of Object.values(value)) {
        if (!record(student)) throw new Error('Invalid saved grades or readings in backup.')
        for (const item of Object.values(student)) {
          if (kind === 'grades' ? !finite(item) : !record(item) || typeof item.text !== 'string' || typeof item.auto !== 'boolean' || !finite(item.scannedAt) || typeof item.box !== 'string') throw new Error('Invalid saved grade or reading in backup.')
        }
      }
    }
    if (kind === 'scan') {
      if (value.image !== undefined && !(value.image instanceof Blob)) throw new Error('Invalid scan image in backup.')
      for (const mark of Object.values(value.marks as object)) {
        if (!record(mark) || !['ok', 'blank', 'multi', 'unsure'].includes(String(mark.status)) || !Array.isArray(mark.scores) || !mark.scores.every(finite) || (mark.choice !== null && !Number.isInteger(mark.choice))) throw new Error('Invalid scan mark in backup.')
        if (mark.crop !== undefined && (!record(mark.crop) || !(mark.crop.data instanceof Uint8Array) || !Number.isInteger(mark.crop.width) || !Number.isInteger(mark.crop.height) || Number(mark.crop.width) * Number(mark.crop.height) !== mark.crop.data.length)) throw new Error('Invalid scan crop in backup.')
      }
    }
    return [key, value] as BackupEntry
  })
}

/** Keep whole worksheet bundles together when skipping conflicts, so scans never mix layouts. */
export function planRestore(incoming: BackupEntry[], existingKeys: string[], replace: boolean) {
  const conflicts = new Set(existingKeys.filter(k => k.startsWith('ws:')).map(k => k.slice(3)))
  const incomingIds = new Set(incoming.filter(([k]) => k.startsWith('ws:')).map(([k]) => k.slice(3)))
  const existing = new Set(existingKeys)
  return incoming.filter(([key]) => {
    const [kind, id] = key.split(':')
    if (kind === 'class') return replace || !existing.has(key)
    if (!incomingIds.has(id)) throw new Error('Backup contains worksheet data without its worksheet.')
    return replace || !conflicts.has(id)
  })
}
