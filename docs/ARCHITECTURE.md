# NetLab — архитектура и дальнейшая разработка

## Цель

Платформа для одной машины Debian 13 x86_64 — физической либо гостевой с nested virtualization. Сетевые лаборатории состоят из узлов (на базе разных эмуляторов) и соединений, не привязаны к формату EVE-NG/PNETLab.

## Текущая реализация (MVP 0.3)

```text
                  [ Браузер / статический JS ]
                                |
              HTTP 127.0.0.1:8080 + Bearer token
                                |
                       [ Go NetLab API ]
                       /      |        \
                 JSON store   |       Images
                              |
                        [ QEMU engine ]
                         /     |    \
                     QMP  Serial  TAP interfaces
                                 |         |
                             [ Open vSwitch bridges ]
```

Каждое соединение образует отдельный L2-сегмент OVS. TAP, созданные root-оркестратором, разрешены на открытие пользователем `netlab-vm`. Сам QEMU не имеет прав root. Это не контейнерный sandbox уровня production и не снимает необходимости аудита сервера.

### API

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/health` | Публичная проверка доступности |
| GET | `/api/system` | Проверка зависимостей, KVM |
| GET | `/api/templates` | QEMU-профили |
| GET/POST | `/api/labs` | Список и создание лабораторий |
| GET/DELETE | `/api/labs/{lab}` | Открытие и удаление лаборатории |
| POST | `/api/labs/{lab}/start` | Запустить все узлы |
| POST | `/api/labs/{lab}/stop` | Остановить узлы, удалить OVS bridges |
| POST | `/api/labs/{lab}/nodes` | Создать QEMU-узел |
| PUT/DELETE | `/api/labs/{lab}/nodes/{node}` | Изменить или удалить узел |
| PATCH | `/api/labs/{lab}/nodes/{node}` | Позиция, подпись и PNG-иконка (можно при работающем узле) |
| POST | `/api/labs/{lab}/nodes/{node}/start` | Запустить узел |
| POST | `/api/labs/{lab}/nodes/{node}/stop` | Остановить узел |
| GET/POST | `/api/labs/{lab}/nodes/{node}/console` | Serial консоль: читать/вводить |
| GET | `/api/labs/{lab}/nodes/{node}/log` | Последние байты лога QEMU |
| POST | `/api/labs/{lab}/links` | Создать соединение между узлами |
| DELETE | `/api/labs/{lab}/links/{link}` | Удалить соединение |
| GET/POST | `/api/images` | Просмотр и загрузка образов |
| DELETE | `/api/images/{image}` | Удаление неиспользуемого образа |

Все API, кроме health, требуют `Authorization: Bearer <token>`. HTTPS не встроен: доступ через SSH port forwarding или внешний HTTPS reverse proxy с авторизацией.

## Ограничения MVP

1. Сетевое ядро рассчитано только на одну Debian-host машину; физические сетевые адаптеры не модифицируются.
2. Переопределение NIC/CPU/firmware для Cisco/Huawei/FortiGate требует отдельных профилей и реальных тестов.
3. При запуске приложения после аварии выполняется очистка только тех OVS bridges/TAP, которые записаны в собственных лабораториях. Нестандартные процессы и сторонние мосты не затрагиваются.
4. Картинки/названия в UI не означают, что конкретные проприетарные ОС уже протестированы.
5. Serial console — минимальный поллинг; полноценный xterm.js / WebSocket и графический noVNC в roadmap.
6. Смена образа после первого запуска VM запрещена без пересоздания узла, чтобы не разрушить overlay/backing chain.
7. Нет атомарных транзакций между записью на диск, созданием TAP/OVS и запуском QEMU; при сбоях отдельных операций остаются остаточные ресурсы до очистки лаборатории. Исправить в следующем этапе.

## Будущие интерфейсы драйверов

```go
type RuntimeDriver interface {
    Validate(template DeviceTemplate, image Image) error
    Start(ctx context.Context, instance InstanceSpec) error
    Stop(ctx context.Context, instanceID string) error
    Status(ctx context.Context, instanceID string) (RuntimeStatus, error)
    Console(ctx context.Context, instanceID string) (io.ReadWriteCloser, error)
}
```

Это **плановый контракт**, не код MVP. Дополнительные драйверы Dynamips, Cisco IOL/IOU, VPCS и Docker будут использовать единый реестр узлов и отдельный Network Engine. Важно также ввести модель комплексных устройств (например, несколько QEMU VM в одном виртуальном маршрутизаторе).

## Профили устройств: направление развития

- `mikrotik-chr`: QEMU x86_64; профили e1000 / virtio, IDE / virtio, определяемые по версии CHR.
- `huawei-ar1000v`, `huawei-usg6000v`: строго проверенные параметры машины/диска/прошивки/интерфейсов.
- `cisco-iosv`, `cisco-iosvl2`, `cisco-csr1000v`, `cisco-xrv9k` и другие: индивидуальные настройки QEMU, RAM/CPU, serial и интерфейсов.
- `cisco-iol`: Linux executable + отдельные зависимости и допустимые способы лицензирования; не образы QEMU.
- `cisco-c3725`, `cisco-c7200`: Dynamips .image с учетом модели chassis и допустимых адаптеров.
- `frrouting`, `alpine`, `ubuntu`: OCI/Docker.

В репозиторий не должны попадать коммерческие образы и недокументированные генераторы лицензий. Цель — обеспечить драйверы для законно приобретённых образов, а не распространять бинарники производителей.

## Ближайшее улучшение — без потери совместимости

1. Выделить `Store`, `NetworkBackend`, `QEMUDriver` в отдельные пакеты и интерфейсы.
2. Добавить воспроизводимые интеграционные тесты на выделенном Debian 13 x86_64 с KVM и OVS.
3. Переехать на PostgreSQL с миграциями и транзакционными изменениями топологии.
4. Переписать уже работающий UI на Vue 3 + TypeScript + Vue Flow и xterm.js.
5. Добавить ограничения ресурсов через cgroups v2, systemd transient units, дисковую квоту и журнал аудита.
6. Добавить начальные datapath-профили для Cisco, MikroTik, Huawei и проверить их с законно предоставленными пользователем образами.
