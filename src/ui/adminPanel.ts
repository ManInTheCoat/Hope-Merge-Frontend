import { clientRow } from '../admin/clientsTable'
import { draftToSettings, guideToDraft, validateGuideDraft, type GuideDraft } from '../admin/guideForm'
import { draftToConfig, roomToDraft, validateRoomDraft, type RoomDraft } from '../admin/roomForm'
import { saveOrReload, type SaveResult } from '../admin/saveFlow'
import {
  fetchAdminClients,
  fetchAdminGuide,
  fetchAdminGuides,
  fetchAdminRoom,
  fetchAdminRooms,
  putAdminGuide,
  putAdminRoom,
} from '../network/adminApi'
import type { SundayAdminGuide, SundayConfigLighting, SundayRoomRuntime } from '../network/sunday'
import { el } from './dom'
import { userErrorText } from './errorText'
import { inputMeta } from './text'
import { NPC_MAX } from '../npc/limits'

const POLL_MS = 2000
const TABS = [
  { id: 'clients', title: 'Клиенты' },
  { id: 'room', title: 'Зал' },
  { id: 'guide', title: 'Гид' },
] as const
type TabId = (typeof TABS)[number]['id']

const LIGHTING: Array<[SundayConfigLighting, string]> = [
  ['neutral', 'Нейтральный'],
  ['warm', 'Тёплый'],
  ['cool', 'Холодный'],
]

export type AdminPanel = {
  open(): void
  /** Закрыть без `onClose`: вызывающий сам решает, что делать с управлением. */
  close(): void
  readonly isOpen: boolean
}

type FormKit = {
  row(label: string, control: HTMLElement, key?: string): HTMLElement
  /** Ошибки по ключам полей; ключи без поля возвращаются, чтобы показать их общим сообщением. */
  setErrors(errors: Record<string, string>): Record<string, string>
  notice(text: string, kind: 'ok' | 'warn' | 'error'): void
}

/** Строки формы с подписями, ошибками под полями и общим сообщением сверху. */
function makeForm(parent: HTMLElement): FormKit {
  const noticeEl = el('div', 'admin-notice', parent)
  noticeEl.hidden = true
  const errorEls = new Map<string, HTMLElement>()
  return {
    row(label, control, key) {
      const row = el('label', 'admin-row', parent)
      el('span', 'admin-label', row).textContent = label
      row.appendChild(control)
      if (key) errorEls.set(key, el('span', 'admin-error', row))
      return row
    },
    setErrors(errors) {
      errorEls.forEach((e) => (e.textContent = ''))
      const rest: Record<string, string> = {}
      for (const [key, text] of Object.entries(errors)) {
        const target = errorEls.get(key)
        if (target) target.textContent = text
        else rest[key] = text
      }
      return rest
    },
    notice(text, kind) {
      noticeEl.hidden = text === ''
      noticeEl.textContent = text
      noticeEl.dataset.kind = kind
    },
  }
}

const textInput = (value: string, className = 'admin-input'): HTMLInputElement => {
  const input = document.createElement('input')
  input.className = className
  input.value = value
  input.autocomplete = 'off'
  return input
}

const textArea = (value: string, rows: number): HTMLTextAreaElement => {
  const area = document.createElement('textarea')
  area.className = 'admin-input'
  area.rows = rows
  area.value = value
  return area
}

/** Панель администратора поверх игры: клиенты, настройки зала и гида (api-sunday.md §3). */
export function createAdminPanel(root: HTMLElement, opts: { onClose(): void }): AdminPanel {
  const box = el('div', 'admin-panel', root)
  box.hidden = true
  const head = el('div', 'admin-head', box)
  el('div', 'admin-title', head).textContent = 'Админка'
  const tabBar = el('div', 'admin-tabs', head)
  const closeBtn = el('button', 'admin-close', head)
  closeBtn.type = 'button'
  closeBtn.textContent = '✕'
  closeBtn.title = 'Закрыть'
  closeBtn.setAttribute('aria-label', 'Закрыть')
  const body = el('div', 'admin-body', box)

  const tabButtons = new Map<TabId, HTMLButtonElement>()
  const sections = new Map<TabId, HTMLElement>()
  for (const t of TABS) {
    const b = el('button', 'admin-tab', tabBar)
    b.type = 'button'
    b.textContent = t.title
    b.addEventListener('click', () => showTab(t.id))
    tabButtons.set(t.id, b)
    sections.set(t.id, el('div', 'admin-section', body))
  }

  let isOpen = false
  let tab: TabId = 'clients'

  // --- Клиенты: опрос раз в 2 с, пока панель открыта и вкладка активна ---

  const clientsBox = sections.get('clients')!
  const clientsNote = el('div', 'admin-note', clientsBox)
  const table = el('table', 'admin-table', clientsBox)
  const headRow = el('tr', '', el('thead', '', table))
  for (const h of ['Имя', 'Зал', 'FPS', 'Ping']) el('th', '', headRow).textContent = h
  const tbody = el('tbody', '', table)
  let pollGen = 0
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let pollAbort: AbortController | null = null

  function stopPoll() {
    pollGen++
    clearTimeout(pollTimer)
    pollAbort?.abort()
    pollAbort = null
  }

  function startPoll() {
    stopPoll()
    const gen = pollGen
    const tick = async () => {
      const ac = (pollAbort = new AbortController())
      try {
        const rows = (await fetchAdminClients(ac.signal)).map(clientRow)
        if (gen !== pollGen) return // панель закрыта или вкладка сменилась: поздний ответ не рисуем
        clientsNote.textContent = rows.length === 0 ? 'Сейчас никого нет в галерее' : ''
        tbody.replaceChildren(
          ...rows.map((r) => {
            const tr = document.createElement('tr')
            for (const v of [r.name, r.room, r.fps, r.ping]) el('td', '', tr).textContent = v
            return tr
          }),
        )
      } catch (e) {
        if (gen !== pollGen) return
        clientsNote.textContent = userErrorText(e)
        tbody.replaceChildren()
      }
      if (gen === pollGen) pollTimer = setTimeout(() => void tick(), POLL_MS)
    }
    void tick()
  }

  // --- Зал ---

  const roomBox = sections.get('room')!
  const roomSelect = el('select', 'admin-input admin-select', roomBox)
  const roomForm = el('div', 'admin-form', roomBox)
  let roomToken = 0

  function renderRoom(rt: SundayRoomRuntime, message?: { text: string; kind: 'ok' | 'warn' | 'error' }) {
    roomForm.replaceChildren()
    const kit = makeForm(roomForm)
    const draft = roomToDraft(rt)

    const color = textInput(draft.accent_color)
    const swatch = document.createElement('input')
    swatch.type = 'color'
    swatch.className = 'admin-color'
    swatch.value = /^#[0-9a-f]{6}$/i.test(draft.accent_color) ? draft.accent_color.toLowerCase() : '#d9d2c3'
    swatch.addEventListener('input', () => (color.value = swatch.value.toUpperCase()))
    color.addEventListener('input', () => {
      if (/^#[0-9a-f]{6}$/i.test(color.value)) swatch.value = color.value.toLowerCase()
    })
    const colorBox = el('div', 'admin-inline', roomForm)
    colorBox.append(color, swatch)
    kit.row('Цвет оформления', colorBox, 'accent_color')

    const lighting = document.createElement('select')
    lighting.className = 'admin-input'
    for (const [value, title] of LIGHTING) {
      const o = el('option', '', lighting)
      o.value = value
      o.textContent = title
    }
    lighting.value = draft.lighting
    kit.row('Освещение', lighting, 'lighting')

    const npc = textInput(draft.npc_count)
    npc.inputMode = 'numeric'
    kit.row(`Посетителей (0–${NPC_MAX})`, npc, 'npc_count')

    const installation = document.createElement('input')
    installation.type = 'checkbox'
    installation.checked = draft.installation_visible
    kit.row('Стенд «Цвет и свет» виден', installation)

    const guideInputs = draft.guides.map((g) => {
      const fieldset = el('fieldset', 'admin-fieldset', roomForm)
      el('legend', '', fieldset).textContent = `Гид ${rt.guides.find((x) => x.guide_id === g.guide_id)?.display_name ?? g.guide_id}`
      const inputs = { x: textInput(g.x), z: textInput(g.z), rot: textInput(g.rotation_deg) }
      for (const i of Object.values(inputs)) i.inputMode = 'decimal'
      const inner = makeForm(fieldset)
      inner.row('X, м', inputs.x, 'x')
      inner.row('Z, м', inputs.z, 'z')
      inner.row('Поворот, °', inputs.rot, 'rotation_deg')
      return { id: g.guide_id, inputs, inner }
    })

    const save = el('button', 'admin-save', roomForm)
    save.type = 'button'
    save.textContent = 'Сохранить'
    if (message) kit.notice(message.text, message.kind)

    const collect = (): RoomDraft => ({
      accent_color: color.value.trim(),
      lighting: lighting.value as SundayConfigLighting,
      npc_count: npc.value.trim(),
      installation_visible: installation.checked,
      guides: guideInputs.map((g) => ({
        guide_id: g.id,
        x: g.inputs.x.value,
        z: g.inputs.z.value,
        rotation_deg: g.inputs.rot.value,
      })),
    })
    const showErrors = (errors: Record<string, string>) => {
      const rest = kit.setErrors(errors)
      for (const g of guideInputs) {
        g.inner.setErrors({
          x: errors[`guide.${g.id}.x`] ?? '',
          z: errors[`guide.${g.id}.z`] ?? '',
          rotation_deg: errors[`guide.${g.id}.rotation_deg`] ?? '',
        })
        for (const k of ['x', 'z', 'rotation_deg']) delete rest[`guide.${g.id}.${k}`]
      }
      return rest
    }

    save.addEventListener('click', async () => {
      const errors = validateRoomDraft(collect())
      if (Object.keys(errors).length) {
        showErrors(errors)
        return kit.notice('Исправьте отмеченные поля', 'error')
      }
      showErrors({})
      const token = roomToken
      save.disabled = true
      const result = await saveOrReload(
        () =>
          putAdminRoom(rt.room_id, {
            world_version: rt.world_version,
            expected_revision: rt.revision,
            config: draftToConfig(collect(), rt.config),
          }),
        () => fetchAdminRoom(rt.room_id),
      )
      if (token !== roomToken) return // выбран другой зал или панель закрыта
      applyResult(result, {
        render: renderRoom,
        conflictText: (code) =>
          code === 'OBJECT_BUSY'
            ? 'Лампу сейчас держит посетитель, правки не применены. Показано актуальное состояние.'
            : 'Зал уже изменён кем-то ещё, ваши правки не применены. Показано актуальное состояние.',
        savedText: (v) => `Сохранено (версия ${v.revision})`,
        fail: (text, fields) => {
          save.disabled = false
          const rest = showErrors(fields ?? {})
          kit.notice([text, ...Object.entries(rest).map(([k, v]) => `${k}: ${v}`)].join(' · '), 'error')
        },
      })
    })
  }

  async function loadRoom(id: string) {
    const token = ++roomToken
    roomForm.replaceChildren()
    try {
      const rt = await fetchAdminRoom(id)
      if (token === roomToken) renderRoom(rt)
    } catch (e) {
      if (token === roomToken) el('div', 'admin-notice', roomForm).textContent = userErrorText(e)
    }
  }

  roomSelect.addEventListener('change', () => void loadRoom(roomSelect.value))

  async function loadRoomList() {
    try {
      const rooms = await fetchAdminRooms()
      if (!isOpen) return
      roomSelect.replaceChildren(
        ...rooms.map((r) => {
          const o = document.createElement('option')
          o.value = r.room_id
          o.textContent = r.title
          return o
        }),
      )
      if (rooms.length) void loadRoom(roomSelect.value)
    } catch (e) {
      roomForm.replaceChildren()
      el('div', 'admin-notice', roomForm).textContent = userErrorText(e)
    }
  }

  // --- Гид ---

  const guideBox = sections.get('guide')!
  const guideSelect = el('select', 'admin-input admin-select', guideBox)
  const guideForm = el('div', 'admin-form', guideBox)
  let guideToken = 0

  function renderGuide(g: SundayAdminGuide, message?: { text: string; kind: 'ok' | 'warn' | 'error' }) {
    guideForm.replaceChildren()
    const kit = makeForm(guideForm)
    const d = guideToDraft(g)
    const available = g.available_materials.map((m) => m.id)

    const name = textInput(d.display_name)
    const subtitle = textInput(d.subtitle)
    const personality = textArea(d.personality, 4)
    const style = textArea(d.style, 3)
    const topic = textArea(d.topic, 3)
    const constraints = textArea(d.constraints, 5)
    kit.row('Имя (до 64)', name, 'display_name')
    kit.row('Подзаголовок (до 200)', subtitle, 'subtitle')
    kit.row('Личность (до 2000)', personality, 'personality')
    kit.row('Стиль (до 1000)', style, 'style')
    kit.row('Тема (до 1000)', topic, 'topic')
    kit.row('Ограничения (по одному на строку, до 20)', constraints, 'constraints')

    const counter = el('div', 'admin-note', guideForm)
    const materialsBox = el('div', 'admin-materials', guideForm)
    el('div', 'admin-label', materialsBox).textContent = 'Материалы'
    const materialsError = el('span', 'admin-error', materialsBox)
    const checks = g.available_materials.map((m) => {
      const label = el('label', 'admin-material', materialsBox)
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.checked = d.material_ids.includes(m.id)
      label.appendChild(cb)
      el('span', '', label).textContent = m.excerpt
      return { id: m.id, cb }
    })

    const save = el('button', 'admin-save', guideForm)
    save.type = 'button'
    save.textContent = 'Сохранить'
    if (message) kit.notice(message.text, message.kind)

    const collect = (): GuideDraft => ({
      display_name: name.value,
      subtitle: subtitle.value,
      personality: personality.value,
      style: style.value,
      topic: topic.value,
      constraints: constraints.value,
      material_ids: checks.filter((c) => c.cb.checked).map((c) => c.id),
    })
    const updateCounter = () => {
      const c = collect()
      const total = [c.personality, c.style, c.topic, c.constraints].join('')
      counter.textContent = inputMeta(total, 4000, 3000)
    }
    for (const i of [personality, style, topic, constraints]) i.addEventListener('input', updateCounter)
    updateCounter()
    const showErrors = (errors: Record<string, string>) => {
      materialsError.textContent = errors.material_ids ?? ''
      const { material_ids: _skip, ...rest } = errors
      return kit.setErrors(rest)
    }

    save.addEventListener('click', async () => {
      const draft = collect()
      const errors = validateGuideDraft(draft, available)
      if (Object.keys(errors).length) {
        showErrors(errors)
        return kit.notice('Исправьте отмеченные поля', 'error')
      }
      showErrors({})
      const token = guideToken
      save.disabled = true
      const result = await saveOrReload(
        () =>
          putAdminGuide(g.guide_id, {
            world_version: g.world_version,
            expected_revision: g.revision,
            settings: draftToSettings(draft),
          }),
        () => fetchAdminGuide(g.guide_id),
      )
      if (token !== guideToken) return
      applyResult(result, {
        render: renderGuide,
        conflictText: () => 'Гид уже изменён кем-то ещё, ваши правки не применены. Показано актуальное состояние.',
        savedText: (v) => `Сохранено (версия ${v.revision})`,
        fail: (text, fields) => {
          save.disabled = false
          const rest = showErrors(fields ?? {})
          kit.notice([text, ...Object.entries(rest).map(([k, v]) => `${k}: ${v}`)].join(' · '), 'error')
        },
      })
    })
  }

  async function loadGuide(id: string) {
    const token = ++guideToken
    guideForm.replaceChildren()
    try {
      const g = await fetchAdminGuide(id)
      if (token === guideToken) renderGuide(g)
    } catch (e) {
      if (token === guideToken) el('div', 'admin-notice', guideForm).textContent = userErrorText(e)
    }
  }

  guideSelect.addEventListener('change', () => void loadGuide(guideSelect.value))

  async function loadGuideList() {
    try {
      const guides = await fetchAdminGuides()
      if (!isOpen) return
      guideSelect.replaceChildren(
        ...guides.map((g) => {
          const o = document.createElement('option')
          o.value = g.guide_id
          o.textContent = g.display_name
          return o
        }),
      )
      if (guides.length) void loadGuide(guideSelect.value)
    } catch (e) {
      guideForm.replaceChildren()
      el('div', 'admin-notice', guideForm).textContent = userErrorText(e)
    }
  }

  // --- Общее ---

  /** Результат сохранения: успех и конфликт перерисовывают форму свежими данными, ошибка остаётся над формой. */
  function applyResult<T extends { revision: number }>(
    result: SaveResult<T>,
    h: {
      render(value: T, message: { text: string; kind: 'ok' | 'warn' | 'error' }): void
      conflictText(code: 'REVISION_CONFLICT' | 'OBJECT_BUSY'): string
      savedText(value: T): string
      fail(text: string, fields?: Record<string, string>): void
    },
  ) {
    if (result.kind === 'saved') h.render(result.value, { text: h.savedText(result.value), kind: 'ok' })
    else if (result.kind === 'conflict') h.render(result.value, { text: h.conflictText(result.code), kind: 'warn' })
    else h.fail(result.text, result.fields)
  }

  function showTab(id: TabId) {
    tab = id
    for (const t of TABS) {
      sections.get(t.id)!.hidden = t.id !== id
      tabButtons.get(t.id)!.classList.toggle('admin-tab--on', t.id === id)
    }
    stopPoll()
    if (id === 'clients') startPoll()
    else if (id === 'room' && roomSelect.options.length === 0) void loadRoomList()
    else if (id === 'guide' && guideSelect.options.length === 0) void loadGuideList()
  }

  function close() {
    if (!isOpen) return
    isOpen = false
    box.hidden = true
    stopPoll()
    roomToken++ // поздние ответы закрытой панели ничего не рисуют
    guideToken++
    document.removeEventListener('keydown', onKey, true)
  }

  function onKey(e: KeyboardEvent) {
    if (e.code !== 'Escape') return
    e.preventDefault()
    close()
    opts.onClose()
  }

  closeBtn.addEventListener('click', () => {
    close()
    opts.onClose()
  })

  return {
    open() {
      if (isOpen) return
      isOpen = true
      box.hidden = false
      roomSelect.replaceChildren() // списки читаются заново: за время закрытия всё могло измениться
      guideSelect.replaceChildren()
      roomForm.replaceChildren()
      guideForm.replaceChildren()
      document.addEventListener('keydown', onKey, true)
      showTab(tab)
    },
    close,
    get isOpen() {
      return isOpen
    },
  }
}
