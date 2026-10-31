import { expect, test } from 'bun:test'
import { linkView } from '../src/ui/linkView'

test('ожидание: баннер с обратным отсчётом и «Повторить сейчас»', () => {
  const v = linkView({ kind: 'waiting', attempt: 1, retryAt: 10_000 }, 7_100)
  expect(v.banner).toEqual({ text: 'Связь потеряна. Переподключение через 3 с…', retry: true })
  expect(v.screen).toBeNull()
})

test('попытка идёт: баннер без кнопки', () => {
  expect(linkView({ kind: 'connecting', attempt: 2 }, 0).banner).toEqual({ text: 'Переподключение…', retry: false })
})

test('первая попытка входа не называется переподключением', () => {
  expect(linkView({ kind: 'connecting', attempt: 0 }, 0, true).banner).toBeNull()
})

test('4009, 4006 и стоп — экраны без автоповторов', () => {
  expect(linkView({ kind: 'replaced' }, 0).screen).toEqual({ text: 'Игра открыта в другой вкладке', button: 'enter' })
  expect(linkView({ kind: 'update' }, 0).screen).toEqual({ text: 'Версия клиента устарела — обновите страницу', button: 'reload' })
  expect(linkView({ kind: 'stopped', code: 1000 }, 0).screen).toEqual({ text: 'Соединение закрыто', button: 'enter' })
  for (const code of [1003, 1008, 1009]) {
    expect(linkView({ kind: 'stopped', code }, 0).screen).toEqual({ text: 'Ошибка протокола', button: 'enter' })
  }
})

test('в игре и на входе ничего не показывается', () => {
  for (const kind of ['online', 'login'] as const) expect(linkView({ kind }, 0)).toEqual({ banner: null, screen: null })
})
