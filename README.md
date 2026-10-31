# Hope-Merge-Frontend
Frontend для проекта в хакатоне от команды Hope&amp;Merge

Виртуальная галерея на Three.js, TypeScript и Vite. Контракт с бэкендом описан в [api.md](api.md), план работ в [frontend-plan.md](frontend-plan.md).

## Запуск

Нужен [bun](https://bun.sh) 1.4 или новее.

1. Установить зависимости: `bun install`
2. Запустить dev-сервер: `bun run dev` (`http://127.0.0.1:5173`)
3. Открыть страницу в браузере.

## Моки или реальный бэкенд

Переключатель в `.env.development`:

- `VITE_USE_MOCK=true` — запросы к `/api/v1` и WebSocket обслуживает мок из `src/network/mock/`, бэкенд не нужен.
- `VITE_USE_MOCK=false` — запросы идут через прокси Vite на бэкенд `http://127.0.0.1:8080` (порт задаётся в `vite.config.ts`). Бэкенд должен разрешать origin `http://127.0.0.1:5173`.

## Сборка

- `bun run build` — проверка типов и production-сборка в `dist/` (моки в неё не попадают).
- `bun run preview` — локальный просмотр собранной версии.
