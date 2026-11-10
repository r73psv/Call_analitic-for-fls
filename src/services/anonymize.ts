/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Обезличивание транскрипта перед отправкой в ИИ-модели (GigaChat).
 * Удаляет идентифицирующие персональные данные: телефоны, email, адреса.
 */
export function anonymizeTranscript(transcript: string): string {
  if (!transcript || typeof transcript !== 'string') {
    return transcript;
  }

  let result = transcript;

  // 1. Замена телефонных номеров в различных форматах: +7 (999) 123-45-67, 89991234567, 79991234567 и т.д.
  result = result.replace(
    /(?:\+7|8|7)[\s\-.(]*\d{3}[\s\-.)]*\d{3}[\s\-.]*\d{2}[\s\-.]*\d{2}/g,
    '[НОМЕР_ТЕЛЕФОНА]'
  );
  
  // Дополнительная замена отдельно стоящих 10-11 значных чисел, похожих на телефоны
  result = result.replace(/\b(?:\+?7|8)?\d{10}\b/g, '[НОМЕР_ТЕЛЕФОНА]');

  // 2. Замена email адресов
  result = result.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[EMAIL]');

  // 3. Замена адресов
  result = result.replace(/(?:ул\.|улица|пр-т|проспект|пер\.|переулок|бул\.|бульвар)\s+[\w\sА-Яа-яёЁ0-9-]+(?:,\s*(?:д\.|дом)\s*\d+[\w\sА-Яа-яёЁ0-9-]*)?/gi, '[АДРЕС]');
  result = result.replace(/ул\.\s+[\w\sА-Яа-яёЁ]+,\s+д\.\s+\d+/gi, '[АДРЕС]');

  // 4. Замена паспортных данных и номеров документов
  result = result.replace(/\b\d{4}\s+\d{6}\b/g, '[ПАСПОРТНЫЕ_ДАННЫЕ]');

  return result;
}

/**
 * Маскирование номера телефона в формат "****123456" (6 последних цифр номера клиента)
 */
export function maskPhone(phone: string): string {
  if (!phone) return 'Клиент (****000000)';
  const clean = phone.replace(/\D/g, '');
  if (clean.length >= 6) {
    return `****${clean.slice(-6)}`;
  }
  if (clean.length > 0) {
    return `****${clean}`;
  }
  return phone;
}

