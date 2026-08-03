/** Default MO readiness checklist (W4 scenario D) — metadata only, no PMD */
export type ReadinessTemplate = {
  key: string;
  labelRu: string;
  required: boolean;
  kind: 'auto' | 'manual';
};

export const ORG_READINESS_TEMPLATE: ReadinessTemplate[] = [
  { key: 'org_created', labelRu: 'МО создана в системе', required: true, kind: 'auto' },
  { key: 'department_created', labelRu: 'Создано хотя бы одно отделение', required: true, kind: 'auto' },
  { key: 'org_admin_user', labelRu: 'Назначен администратор МО', required: true, kind: 'auto' },
  { key: 'consultant_user', labelRu: 'Есть консультант с учётной записью', required: true, kind: 'auto' },
  { key: 'consent_offer', labelRu: 'Опубликована оферта', required: true, kind: 'auto' },
  { key: 'consent_dmu', labelRu: 'Опубликовано согласие на ДМУ', required: true, kind: 'auto' },
  { key: 'consent_pmd', labelRu: 'Опубликовано согласие на ПМД', required: true, kind: 'auto' },
  { key: 'mis_mode_set', labelRu: 'Выбран режим МИС (manual/mock/zhetysu/damumed)', required: true, kind: 'auto' },
  { key: 'schedule_exists', labelRu: 'Есть расписание консультанта', required: false, kind: 'auto' },
  { key: 'catalog_offer', labelRu: 'Есть услуга в каталоге (для витрины)', required: false, kind: 'auto' },
  {
    key: 'hosting_rk_confirmed',
    labelRu: 'Подтверждено размещение контура в РК',
    required: true,
    kind: 'manual',
  },
  {
    key: 'sms_telegram_ready',
    labelRu: 'SMS/Telegram тестовые credentials подключены',
    required: true,
    kind: 'manual',
  },
  {
    key: 'ncalayer_pilot_ready',
    labelRu: 'NCALayer / тестовые ЭЦП проверены на пилоте',
    required: true,
    kind: 'manual',
  },
  {
    key: 'pilot_dry_run',
    labelRu: 'Пройден сухой прогон пилота (случай→сессия→заключение)',
    required: true,
    kind: 'manual',
  },
];
