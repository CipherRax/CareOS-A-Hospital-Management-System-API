/**
 * Signature components.
 *
 * The brief's §6 puts these in `components/clinical/`. They are exported through
 * one barrel so a workspace imports from the surface rather than reaching into an
 * individual file, and so the set is visible as a set.
 */

export { AuditNote } from './audit-note';
export { Can, type CanProps } from './can';
export { EmptyState, type EmptyStateProps } from './empty-state';
export { EstimateBadge, type EstimateBadgeProps } from './estimate-badge';
export { FormSection, type FormSectionProps } from './form-section';
export { KeyValueGrid, type KeyValueGridProps, type KeyValueItem } from './key-value-grid';
export { MoneyText, type MoneyTextProps } from './money-text';
export { PatientHeader, type PatientHeaderProps } from './patient-header';
export { DataTable, type DataTableColumn } from './data-table';
export { StatusPill, STATUS_TONE } from './status-pill';
export { Timeline, type TimelineEvent, type TimelineProps } from './timeline';
