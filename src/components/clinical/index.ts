/**
 * Signature components.
 *
 * The brief's §6 puts these in `components/clinical/`. They are exported through
 * one barrel so a workspace imports from the surface rather than reaching into an
 * individual file, and so the set is visible as a set.
 */

export {
  AmendmentDialog,
  type AmendmentChange,
  type AmendmentDialogProps,
} from './amendment-dialog';
export { AuditNote } from './audit-note';
export { BatchRow, type BatchRowItem, type BatchRowProps, type BatchRowState } from './batch-row';
export {
  BreakGlassBanner,
  BreakGlassDialog,
  type BreakGlassBannerProps,
  type BreakGlassDialogProps,
} from './break-glass-dialog';
export { Can, type CanProps } from './can';
export {
  CommandPalette,
  type CommandPaletteOption,
  type CommandPaletteProps,
} from './command-palette';
export {
  ConflictDialog,
  type ConflictDialogProps,
  type ConflictField,
  type ConflictResolution,
} from './conflict-dialog';
export { DataTable, type DataTableColumn } from './data-table';
export { EmptyState, type EmptyStateProps } from './empty-state';
export { EstimateBadge, type EstimateBadgeProps } from './estimate-badge';
export { FormSection, type FormSectionProps } from './form-section';
export { KeyValueGrid, type KeyValueGridProps, type KeyValueItem } from './key-value-grid';
export { MoneyText, type MoneyTextProps } from './money-text';
export {
  NowServing,
  QueueTicket,
  type NowServingProps,
  type QueueTicketSize,
} from './queue-ticket';
export { PatientBanner, type AllergyState, type PatientBannerProps } from './patient-banner';
export { ReasonField, reasonError, REASON_MIN_LENGTH } from './reason-field';
export { StatusPill, STATUS_TONE } from './status-pill';
export { Timeline, type TimelineEvent, type TimelineProps } from './timeline';
export {
  BedTile,
  WardBoard,
  BED_STATE_LABEL,
  type BedState,
  type BedTileProps,
  type WardBoardProps,
} from './ward-board';
