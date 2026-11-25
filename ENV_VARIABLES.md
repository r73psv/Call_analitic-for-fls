# Реестр переменных окружения (Environment Variables)
## Проект: Анализатор звонков «Fashion Look Studio» / «LIQ28» (CallQA AI_RU v3.0)

В данном документе представлен актуальный перечень переменных окружения приложения, синхронизированный с `.env.example` и `Dockerfile`, с описанием назначения, формата значений и значений по умолчанию.

---

### Таблица переменных окружения

| Переменная | Назначение и описание | Категория / Сервис | Обязательность | Пример / Значение по умолчанию |
| :--- | :--- | :--- | :---: | :--- |
| **STORE_ENCRYPTION_KEY** | 256-битный ключ (64 hex-символа) для криптографической защиты локальной базы данных (`AES-256-GCM`) и обезличивания ПДн по стандарту 152-ФЗ. Генерируется через `openssl rand -hex 32`. | 152-ФЗ / Безопасность | **Обязательна** | `e1a4...c9f3` (64 символа hex) |
| **ADMIN_PASSWORD** | Пароль учётной записи администратора салона для авторизации в веб-панели и доступа к настройкам API. | Аутентификация | **Обязательна** | `admin123` |
| **SALON_NAME** | Официальное наименование салона для шапки интерфейса, промпта и отчётов (`Fashion Look Studio` / `LIQ28`). | Системные настройки | Опциональна | `Fashion Look Studio` |
| **SALON_TIMEZONE** | Часовой пояс салона для расчёта границ дня, фильтров и расписания ежедневной сводки в VK после 21:00. | Системные настройки | Опциональна | `Europe/Samara` |
| **DATA_PATH** | Путь к основному JSON-файлу базы данных приложения внутри контейнера или на сервере. | Хранилище данных | Опциональна | `/app/data/data-store.json` |
| **DATA_PATH_ENC** | Путь к зашифрованному файлу базы данных при включённом режиме шифрования 152-ФЗ. | 152-ФЗ / Безопасность | Опциональна | `/app/data/data-store.enc` |
| **ENV_FILE_PATH** | Путь к сохраняемому серверному `.env`-файлу runtime-настроек. | Хранилище данных | Опциональна | `/app/data/.env` |
| **CONSENT_PATH** / **CONSENTS_PATH** | Путь к реестру зашифрованных согласий клиентов на обработку персональных данных. | 152-ФЗ / Комплаенс | Опциональна | `/app/data/consents.enc` |
| **TTL_LOG_DAYS** | Регламентный срок хранения системных журналов и оперативных звонков до архивации в днях (152-ФЗ). | 152-ФЗ / Регламент | Опциональна | `30` |
| **TTL_TEMP_DAYS** | Срок хранения промежуточных временных файлов аудио и транскрипций в днях. | 152-ФЗ / Регламент | Опциональна | `30` |
| **TTL_AUDIO_DAYS** | Срок хранения выгруженных локальных аудиозаписей звонков в днях. | 152-ФЗ / Регламент | Опциональна | `30` |
| **STT_PROVIDER** | Активный провайдер распознавания речи: `yandex_speechkit`, `gigaam_v3` (GigaASR / GigaAM v3) или `tbank_voicekit`. | Распознавание речи (STT) | Опциональна | `yandex_speechkit` |
| **GIGAAM_API_URL** | URL inference-эндпоинта GigaASR / GigaAM v3 (например, Cloud.ru Foundation Models). | GigaASR / GigaAM v3 | Опциональна* | `https://foundation-models.api.cloud.ru/v1/audio/transcriptions` |
| **GIGAAM_API_KEY** | API-ключ доступа к GigaASR / GigaAM v3. | GigaASR / GigaAM v3 | Опциональна* | `sk-...` |
| **GIGAAM_MODEL_VARIANT** | Вариант модели GigaASR / GigaAM v3 (`e2e_rnnt`, `e2e_ctc`, `GigaChat/GigaASR`, `sber/GigaASR` и др.). | GigaASR / GigaAM v3 | Опциональна | `e2e_rnnt` |
| **ASR_MAX_CONCURRENT** | Максимальное число параллельных задач распознавания речи в очереди ASR. | Распознавание речи (STT) | Опциональна | `1` |
| **TBANK_VOICEKIT_API_KEY** | API-ключ сервиса T-Bank VoiceKit (Тинькофф Облако STT). | T-Bank VoiceKit | Опциональна* | `tb_api_key...` |
| **TBANK_VOICEKIT_SECRET_KEY** | Секретный ключ сервиса T-Bank VoiceKit. | T-Bank VoiceKit | Опциональна* | `tb_secret...` |
| **TBANK_VOICEKIT_ENDPOINT** | Базовый URL API T-Bank VoiceKit. | T-Bank VoiceKit | Опциональна | `https://api.tbank.ru` |
| **YC_FOLDER_ID** | Идентификатор каталога (Folder ID) в облаке Yandex Cloud для квот SpeechKit и IAM. | Yandex SpeechKit | Опциональна* | `b1gxxxxxxxxxxxxxxxxx` |
| **YC_API_KEY** | Секретный API-ключ сервисного аккаунта Yandex Cloud (начинается с `AQVN...`). Не путать с Key ID `aje...`. | Yandex SpeechKit | Опциональна* | `AQVNxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| **YC_SERVICE_ACCOUNT_ID** | Идентификатор сервисного аккаунта Yandex Cloud. | Yandex Cloud IAM | Опциональна | `aje...` |
| **YC_SERVICE_ACCOUNT_KEY_FILE** | Путь к JSON-файлу авторизованного ключа сервисного аккаунта (`authorized_key.json`) для генерации IAM-токенов. | Yandex Cloud IAM | Опциональна* | `/app/keys/authorized_key.json` |
| **YC_SERVICE_ACCOUNT_KEY_JSON** | Содержимое ключа сервисного аккаунта Yandex Cloud в виде JSON-строки (альтернатива файлу). | Yandex Cloud IAM | Опциональна | `{...}` |
| **YC_STORAGE_BUCKET** | Имя бакета в Yandex Object Storage для длинных аудиозаписей (> 1 МБ) при асинхронном распознавании. | Yandex Object Storage | Опциональна | `lik28-audio-temp` |
| **YC_STORAGE_ACCESS_KEY** | Статический идентификатор ключа доступа (Key ID) к бакету Yandex Object Storage. | Yandex Object Storage | Опциональна | `YCAJExxxxxxxxxxxxxxxx` |
| **YC_STORAGE_SECRET_KEY** | Секретный ключ доступа к бакету Yandex Object Storage. | Yandex Object Storage | Опциональна | `YCPxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
| **YC_STORAGE_ENDPOINT** | S3-совместимый сетевой адрес Yandex Object Storage. | Yandex Object Storage | Опциональна | `https://storage.yandexcloud.net` |
| **YC_STORAGE_REGION** | Регион размещения хранилища Yandex Cloud. | Yandex Object Storage | Опциональна | `ru-central1` |
| **GIGACHAT_AUTH_KEY** | Ключ авторизации Сбер GigaChat в формате Base64 (`Client ID : Client Secret`) для анализа диалогов, Repair и Verifier. | Сбер GigaChat | **Обязательна** | `ODVh...Mjcx` (Base64 строка) |
| **GIGACHAT_CREDENTIALS** | Псевдоним переменной `GIGACHAT_AUTH_KEY` для совместимости. | Сбер GigaChat | Опциональна | тот же, что `GIGACHAT_AUTH_KEY` |
| **GIGACHAT_MODEL** | Имя используемой языковой модели GigaChat по умолчанию (`GigaChat:Ultra`, `GigaChat:Max`, `GigaChat:Pro`, `GigaChat:Lite`). | Сбер GigaChat | Опциональна | **`GigaChat:Ultra`** |
| **GIGACHAT_SCOPE** | Область действия учётной записи GigaChat: `GIGACHAT_API_PERS`, `GIGACHAT_API_B2B` или `GIGACHAT_API_CORP`. | Сбер GigaChat | Опциональна | `GIGACHAT_API_PERS` |
| **MEGAFON_TOKEN** | API-ключ / токен интеграции с ВАТС Мегафон для классической версии JSON-RPC 2.0 (`data-api.cp.megafon.ru`). | Телефония Мегафон (JSON-RPC) | Опциональна* | `e74b...a210` |
| **MEGAFON_API_VERSION** | Активная версия протокола Мегафон ВАТС: `json_rpc` или `rest_wcgp`. | Телефония Мегафон | Опциональна | `json_rpc` |
| **MEGAFON_REST_DOMAIN** | Домен Виртуальной АТС Мегафон для REST CRM API (например: `vatsXXXXX.megapbx.ru`). | Телефония Мегафон (REST) | Опциональна* | `vats12345.megapbx.ru` |
| **MEGAFON_REST_TOKEN** | Ключ доступа ВАТС (токен из раздела интеграции CRM в личном кабинете ВАТС Мегафон). | Телефония Мегафон (REST) | Опциональна* | `d9e8...` |
| **MEGAFON_CRM_TOKEN** | Токен авторизации CRM для защиты входящих вебхуков от ВАТС (`crm_token`). | Телефония Мегафон (REST) | Опциональна* | `crm_secret_token_123` |
| **MEGAFON_LK_LOGIN** / **MEGAFON_LK_PASSWORD** | Учётные данные личного кабинета ВАТС Мегафон (при необходимости получения записей через ЛК). | Телефония Мегафон | Опциональна | — |
| **VK_TOKEN** | Ключ доступа API сообщества ВКонтакте (токен бота) для уведомлений о звонках (с обязательным кратким пересказом диалога) и ежедневных сводок KPI. | Оповещения VK | Опциональна | `vk1.a.xxxxxxxxxxxxxxxxxxxx...` |
| **VK_CHAT_ID** | Идентификатор целевого диалога или беседы ВКонтакте (`peer_id`). | Оповещения VK | Опциональна | `2000000001` |
| **VK_DAILY_REPORT_ENABLED** | Включение автоматической ежедневной выгрузки сводки KPI в VK после 21:00 (`true` / `false`). | Оповещения VK | Опциональна | `true` |
| **VK_DAILY_REPORT_TIME** | Время отправки ежедневной сводки KPI в VK по часовому поясу салона (не ранее `21:00`). | Оповещения VK | Опциональна | `21:05` |
| **YCLIENTS_LOGIN** | Логин аккаунта YClients (телефон или email) для режима «только чтение» списка мастеров. | Интеграция YClients (Read-Only) | Опциональна | `admin@salon.ru` |
| **YCLIENTS_PASSWORD** | Пароль аккаунта YClients для авторизации чтения списка мастеров. | Интеграция YClients (Read-Only) | Опциональна | — |
| **YCLIENTS_PARTNER_TOKEN** | Партнёрский токен разработчика для доступа к API YClients (чтение сотрудников). | Интеграция YClients (Read-Only) | Опциональна | `partner_secret_key` |
| **YCLIENTS_SALON_ID** | Числовой идентификатор филиала салона в сервисе YClients. | Интеграция YClients (Read-Only) | Опциональна | `123456` |
| **S3_ENDPOINT** | Сетевой адрес S3-хранилища Timeweb Cloud для защищённого резервного копирования базы данных по 152-ФЗ. | Timeweb Cloud S3 | Опциональна | `https://s3.timeweb.cloud` |
| **S3_ACCESS_KEY** | Идентификатор ключа доступа (Access Key) к S3 Timeweb Cloud. | Timeweb Cloud S3 | Опциональна | `TW_ACCESS_KEY_ID` |
| **S3_SECRET_KEY** | Секретный ключ (Secret Key) к S3 Timeweb Cloud. | Timeweb Cloud S3 | Опциональна | `TW_SECRET_KEY` |
| **S3_BUCKET_NAME** | Название целевого бакета резервных копий в Timeweb Cloud. | Timeweb Cloud S3 | Опциональна | `lik28-backup` |
| **S3_KEY_PREFIX** | Префикс путей/каталогов внутри бакета Timeweb S3. | Timeweb Cloud S3 | Опциональна | `lik28/data/` |
| **S3_REGION** | Регион размещения бакета Timeweb S3. | Timeweb Cloud S3 | Опциональна | `ru-1` |
| **S3_SYNC_INTERVAL_SEC** | Периодичность плановой фоновой выгрузки зашифрованных снимков базы в S3 (в секундах). | Резервное копирование | Опциональна | `300` (5 минут) |
| **S3_SYNC_DEBOUNCE_MS** | Дебаунс пакетной авто-синхронизации S3 при потоковых изменениях (в миллисекундах). | Резервное копирование | Опциональна | `45000` (45 сек) |
| **S3_SYNC_BATCH_SIZE** | Порог накопленных изменений, после которого выполняется внеочередной пакетный флаш в S3. | Резервное копирование | Опциональна | `15` |
| **PORT** | Порт, на котором Express-сервер принимает входящие HTTP-соединения. | Серверное ядро | Опциональна | `3000` |
| **HOST** | Сетевой интерфейс для прослушивания подключений (для контейнеров всегда `0.0.0.0`). | Серверное ядро | Опциональна | `0.0.0.0` |
| **NODE_ENV** | Режим окружения Node.js (`production` или `development`). | Среда выполнения | Опциональна | `production` |
| **TZ** | Часовой пояс операционной системы контейнера. | Системные настройки | Опциональна | `Europe/Moscow` |
| **NODE_OPTIONS** | Флаги оптимизации движка V8 Node.js (лимит памяти кучи `--max-old-space-size=2048`). | Среда выполнения | Опциональна | `--max-old-space-size=2048` |
| **NODE_EXTRA_CA_CERTS** | Путь к доверенным сертификатам Минцифры РФ (для безопасных TLS-запросов к Сбер GigaChat). | Сеть и TLS | Опциональна | `/etc/ssl/certs/ca-certificates.crt` |

---

### Примечания и рекомендации по безопасности:
1. **Шифрование 152-ФЗ**: переменная `STORE_ENCRYPTION_KEY` является критической. При её изменении база данных не сможет быть расшифрована без предварительной процедуры ротации ключей.
2. **YClients (строго Read-Only)**: интеграция использует `YCLIENTS_LOGIN`, `YCLIENTS_PASSWORD`, `YCLIENTS_PARTNER_TOKEN` и `YCLIENTS_SALON_ID` исключительно для чтения справочника мастеров — запись данных в CRM не выполняется.
3. **Развёртывание**: скопируйте `.env.example` в `.env`, заполните боевые ключи и перезапустите контейнер.
