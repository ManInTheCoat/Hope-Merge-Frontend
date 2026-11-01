# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Браузерный клиент многопользовательской виртуальной галереи (хакатон): Three.js + TypeScript + Vite, HTML-интерфейс поверх canvas. Бэкенд на Go — отдельный репозиторий https://github.com/MrDuckVC/hakaton-gallery-HopeAndMerge.

## Источники истины

- `api.md` — нормативный контракт API v1 (HTTP `/api/v1`, один WebSocket `/api/v1/ws`). Он главнее `frontend-plan.md` и любых других документов: при расхождении прав `api.md`. Коды закрытия WS, лимиты, бюджет кеша, правила движения — оттуда.
- `frontend-plan.md` — план работ по дням и технические решения по бюджету 10%.
- `api-sunday.md` — расширение Sunday v1 (админка, FPS/ping, лампа, NPC, `guide.action`), нормативная часть `api.md`; fixtures — `tests/fixtures/sunday/`. Копии из бэкенда (ветка `issue-1`, `docs/api/`).
- Типы контракта в коде — `src/network/contract.ts` (зеркало `api.md`).

## Команды

Нужен bun ≥ 1.4.

- `bun install`
- `bun run dev` — Vite на `http://127.0.0.1:5173` (хост именно `127.0.0.1`, не `localhost`: на него рассчитан origin бэкенда).
- `bun test` — все тесты (`tests/*.test.ts`, bun:test).
- `bun test tests/collision.test.ts` — один файл; `bun test tests/reconnect.test.ts -t "4009"` — по имени теста.
- `bunx tsc --noEmit` — проверка типов. `tsconfig.json` включает только `src/`: тесты tsc не проверяет, их ловит только `bun test`.
- `bun run build` — `tsc` + production-сборка в `dist/` (моки в сборку не попадают). Линтера нет.

## Моки или реальный бэкенд

`VITE_USE_MOCK` в `.env.development` (коммитится, по умолчанию `true`). Локально переключать через `.env.development.local` (игнорируется git, `*.local`), после смены — перезапустить Vite.

- `true`: `src/main.ts` до старта игры динамически импортирует `src/network/mock` и подменяет `window.fetch` и `window.WebSocket`. Мок хранит аккаунты, позы и сессию в `localStorage`. В консоли есть `__mock.drop(code)` — закрыть игровой WS заданным кодом (ручная проверка переподключения). Роль администратора (`/admin/*`): первый зарегистрированный аккаунт получает её сам, остальным — `__mock.grantAdmin('имя')`; `__mock.clients()` показывает FPS и ping так, как их видит админка.
- `false`: прокси Vite `/api` (с WS) на `http://127.0.0.1:8080` (`vite.config.ts`). Бэкенду нужен `ALLOWED_ORIGINS` с `http://127.0.0.1:5173` и `COOKIE_SECURE=false`.

Мок обязан вести себя как сервер по `api.md`: если клиент проходит на моке, он должен проходить и на сервере. Поэтому правила движения в `src/network/mock/geometry.ts` — дословный перенос серверных `ValidPose`/`Sweep` (бэкенд, `internal/domain/world/geometry.go`), а не переиспользование клиентской коллизии. Меняя поведение клиента, проверяй, что мок отвергает то же, что сервер.

## Архитектура

`src/game.ts` — точка сборки: рендер, цикл кадра, жизненный цикл соединения, связь сцены, сети и UI. Он не покрыт юнит-тестами (нужны DOM и WebGL), поэтому логику выносят в чистые модули с тестами, а в `game.ts` оставляют связывание.

**Сессия и соединение.** `Session` (`src/world/session.ts`) — одно подключение: сокет, манифест, бюджет, построенный зал, позиция, epoch/seq. `ReconnectLoop` (`src/network/reconnect.ts`) решает по коду закрытия, что делать (`closeAction`), и планирует повторы 1/2/4/8/10 с ±20%. `game.ts` даёт ему `connectOnce` (сокет → `world.snapshot` → manifest → загрузка `current_room` → `world.ready`) и `lose(s, code)` для обрыва живой игры. При переподключении по контракту прежний мир освобождается и зал загружается заново из нового snapshot. `linkView` (`src/ui/linkView.ts`) превращает состояние соединения в баннер или экран.

**Порядок входа в мир.** Первое сообщение WS — `world.snapshot`, источник истины о позиции. До подтверждения `world.ready` движение, осмотр, переходы, гид и фото не отправляются. Переход: `world.enter` → `world.entered` → полная выгрузка старого зала → загрузка нового → `world.ready` с новым epoch и `seq` с 1 (`applySelf`, `unloadRoom` в `session.ts`).

**Бюджет кеша 10%.** Загружен ровно один зал. `RoomManager` грузит описание и картинки через `fetch(..., no-store)` → `createImageBitmap` → `THREE.Texture`. `TextureLoader`, `THREE.Cache` и Service Worker не используются. `AssetBudget` резервирует объявленные байты до запроса и заменяет их фактическими (по сырым байтам ответа). При выгрузке закрываются bitmap и освобождаются геометрии, материалы и текстуры. Фото учитываются в том же бюджете (`LastPhoto`).

**Движение и коллизии.** Сервер принимает шаг, только если прямой отрезок между прошлой и новой принятой позицией допустим (`Sweep`, расстояние до блоков не меньше 0,3 м) и не длиннее `4·min(dt, 0,25)` м. Клиент:
- `src/scene/collision.ts` — `moveCylinder` с зазором `COLLISION_EPS_M` и серверные `validPose`/`segmentClear`;
- `src/world/movePath.ts` — отправляет точки своей траектории, а не хорду через угол, и дробит длинные шаги;
- `src/world/moveHistory.ts` — откатывает игрока на позицию сервера, если шаг отклонён;
- `player.move` уходит 10 Гц со скоростью `CLIENT_SPEED_FACTOR` (90%) от максимума.

**Остальное по папкам:** `scene/` — построение зала из `Room`, управление, прицел; `players/` — удалённые игроки с интерполяцией (`RENDER_DELAY_MS`); `ui/` — HTML-интерфейс (HUD, чат, панель гида, вход, карточка фото); `photo/` — съёмка кадра, сжатие до 2 МиБ, загрузка с `Idempotency-Key`; `admin/` — чистая логика админки (формы гида и зала, строки таблицы клиентов, сохранение с разбором `REVISION_CONFLICT`), сама панель — `ui/adminPanel.ts`, HTTP — `network/adminApi.ts`.

**Посетители (NPC) и жест гида** (`api-sunday.md` §5). `npc/` — приём `npc.state` (`NpcSync`: зал, версия, instance, seq), интерполяция 200 мс (`NpcBuffers`), походка и поворот головы (`gait.ts`), раскладка частей (`layout.ts`), `crowd.ts` — по одному `InstancedMesh` на часть тела без теней и текстур, `passRequest.ts` — реплика «Простите, можно пройти?» внизу экрана, когда `idle`-NPC упёрся в игрока (HUD: `showRequest`). Жест гида — `scene/guideGesture.ts` (`GestureTracker`: от `guide.started` до `guide.completed`/`guide.failed`). Мок ведёт посетителей в `network/mock/npc.ts` (`NpcSim`, FSM 5 Гц, маршруты детерминированы `world_version+room_id+индекс`; дела: смотреть картину, подойти к гиду, выйти в дверь и вернуться; максимум `NPC_MAX = 10` в `npc/limits.ts`), `server.ts` рассылает `npc.state` и привязывает симуляцию к залу игрока.

**Лампа и просьбы гиду** (`api-sunday.md` §4, §6). `lamp/lampActions.ts` — чистая логика: цель в прицеле (`pickLamp`: стоящая лампа или слот, пока лампа в руках), команды `object.act` (E — взять/поставить, Q — вкл/выкл, Z/X — поворот, C/V — наклон головки), положение лампы в руках (`heldPosition`), тексты отказов (`OBJECT_BUSY` → «Лампу держит другой игрок»). Поворот головки копится и уходит одной командой после паузы, не чаще раза в 1,1 с (лимит сервера — 10 команд лампе за 10 с), а угол виден сразу через `RuntimeView.setLampPreview`. Свою лампу игрок видит в левой руке (`HandCamera.setLamp`), фотоаппарат — в правой; в мире остаётся только её свет. В `game.ts` команда одна за раз (`Session.lampBusy`): `expected_revision` берётся из последнего принятого runtime, а runtime из ответа `object.acted` / `guide.action.completed` применяется отправителем сразу (остальным уходит `world.runtime`). `RuntimeView.setHolderPose` каждый кадр ставит лампу к держателю (своему — по камере, чужому — по интерполяции `PlayerRegistry.poseOf`). Кнопка «Изменить экспозицию» в `ui/guidePanel.ts` переключает режим общего поля ввода, просьба и ответ идут в ту же ленту диалога, тексты — `ui/guideAction.ts` (`UNSUPPORTED_ACTION` показывает примеры фраз). Мок: правила — `network/mock/lampSim.ts` (классификатор таблицы §6, проверки и применение `object.act`, возврат лампы при обрыве и входе в дверь), порядок проверок и лимиты (10/10 с и 3/10 с) — в `server.ts`.

**Тексты для игрока** собираются через `userErrorText` (`src/ui/errorText.ts`). Технические коды (`SOCKET_CLOSED:1006`, `REQUEST_TIMEOUT` и т. п.) игроку не показываются. Длина пользовательского текста считается в кодовых точках после `trimWs` (`src/ui/text.ts`), как на сервере.

## Тесты

В bun нет DOM и `OffscreenCanvas`. Тесты, которым нужны глобальные объекты браузера, подставляют их сами и восстанавливают после файла (`tests/controls.test.ts`). Тесты мока поднимают настоящий `createMockServer` через `tests/mockHarness.ts`: заглушки картинок мира (`buildWorld(image)`) и ручные часы (`createMockServer(world, storage, { now })`).

## Соглашения

- Код, комментарии, сообщения коммитов и описания PR — на русском. Коммиты короткие, одна логическая правка, в стиле `Область: что сделано` (`Мок: …`, `Фото: …`, `Переподключение: …`).
- Пользовательский текст выводится только через `textContent`/`createTextNode`, без `innerHTML`.
- `docs/superpowers/` (спеки и планы) в git не коммитится.
