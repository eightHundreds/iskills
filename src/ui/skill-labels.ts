import { t } from '../i18n/index.js';

/** Field labels for skill detail panes — single catalog family (`common.*`). */
export function skillFieldLabels(): {
  collectionStatus: string;
  description: string;
  location: string;
  note: string;
  path: string;
  relatedLocations: string;
  source: string;
  tags: string;
} {
  return {
    collectionStatus: t('common.collectionStatus'),
    description: t('common.description'),
    location: t('common.location'),
    note: t('common.note'),
    path: t('common.path'),
    relatedLocations: t('common.relatedLocations'),
    source: t('common.source'),
    tags: t('common.tags'),
  };
}
