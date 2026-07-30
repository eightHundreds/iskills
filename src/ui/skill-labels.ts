import { t } from '../i18n/index.js';

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
    collectionStatus: t('label.collectionStatus'),
    description: t('label.description'),
    location: t('label.location'),
    note: t('label.note'),
    path: t('label.path'),
    relatedLocations: t('label.relatedLocations'),
    source: t('label.source'),
    tags: t('label.tags'),
  };
}
