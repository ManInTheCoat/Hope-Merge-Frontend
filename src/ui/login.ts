import { login, register } from '../network/api'
import { authErrorText, validateLogin, validateRegister, type FieldErrors, type FieldName } from './authForm'
import { trimWs } from './text'

type Mode = 'login' | 'register'

export type LoginScreen = { show(): void; readonly visible: boolean }

/** Экран входа и регистрации поверх canvas: одна форма, две вкладки. */
export function createLoginScreen(root: HTMLElement, onSuccess: () => void): LoginScreen {
  const screen = document.createElement('div')
  screen.className = 'login'
  screen.hidden = true
  root.appendChild(screen)

  const form = document.createElement('form')
  form.className = 'login-form'
  form.noValidate = true
  screen.appendChild(form)

  const title = document.createElement('h1')
  title.className = 'login-title'
  title.textContent = 'Виртуальная галерея'
  form.appendChild(title)

  const tabs = document.createElement('div')
  tabs.className = 'login-tabs'
  form.appendChild(tabs)
  const tabButtons = new Map<Mode, HTMLButtonElement>()
  for (const [mode, text] of [
    ['login', 'Вход'],
    ['register', 'Регистрация'],
  ] as const) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'login-tab'
    b.textContent = text
    b.addEventListener('click', () => setMode(mode))
    tabs.appendChild(b)
    tabButtons.set(mode, b)
  }

  const fields = new Map<FieldName, { wrap: HTMLElement; input: HTMLInputElement; error: HTMLElement }>()
  for (const [name, placeholder, type, autocomplete] of [
    ['username', 'Логин', 'text', 'username'],
    ['display_name', 'Имя в галерее', 'text', 'nickname'],
    ['password', 'Пароль', 'password', 'current-password'],
  ] as const) {
    const wrap = document.createElement('label')
    wrap.className = 'login-field'
    const input = document.createElement('input')
    input.type = type
    input.placeholder = placeholder
    input.setAttribute('autocomplete', autocomplete)
    input.className = 'login-input'
    const error = document.createElement('div')
    error.className = 'login-error'
    wrap.append(input, error)
    form.appendChild(wrap)
    fields.set(name, { wrap, input, error })
  }

  const submit = document.createElement('button')
  submit.type = 'submit'
  submit.className = 'login-submit'
  form.appendChild(submit)
  const formError = document.createElement('div')
  formError.className = 'login-error login-error--form'
  form.appendChild(formError)

  let mode: Mode = 'login'
  let busy = false

  function showErrors(errs: FieldErrors, form = '') {
    for (const [name, f] of fields) f.error.textContent = errs[name] ?? ''
    formError.textContent = form
  }

  function setMode(m: Mode) {
    mode = m
    tabButtons.forEach((b, k) => b.classList.toggle('login-tab--active', k === m))
    fields.get('display_name')!.wrap.hidden = m === 'login'
    fields.get('password')!.input.setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password')
    submit.textContent = m === 'login' ? 'Войти' : 'Зарегистрироваться'
    showErrors({})
  }

  const value = (name: FieldName) => fields.get(name)!.input.value

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (busy) return
    const username = trimWs(value('username'))
    const password = value('password')
    const display_name = trimWs(value('display_name'))
    const errs = mode === 'login' ? validateLogin({ username, password }) : validateRegister({ username, display_name, password })
    if (Object.keys(errs).length) return showErrors(errs)
    showErrors({})
    busy = true
    submit.disabled = true
    try {
      await (mode === 'login' ? login({ username, password }) : register({ username, display_name, password }))
      fields.get('password')!.input.value = ''
      hide()
      onSuccess()
    } catch (err) {
      const { form, fields } = authErrorText(err)
      showErrors(fields, form)
    } finally {
      busy = false
      submit.disabled = false
    }
  })

  function hide() {
    // Фокус в скрытом поле считался бы вводом текста, и Enter не открыл бы чат.
    if (document.activeElement instanceof HTMLElement && screen.contains(document.activeElement)) document.activeElement.blur()
    screen.hidden = true
  }

  setMode('login')

  return {
    show() {
      screen.hidden = false
      setMode('login')
      fields.get('username')!.input.focus()
    },
    get visible() {
      return !screen.hidden
    },
  }
}
