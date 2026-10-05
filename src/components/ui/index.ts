/**
 * Barrel for the re-skinned primitive layer.
 *
 * Import from `@/components/ui` rather than reaching into individual files, so a
 * primitive can be split or renamed without touching call sites. Everything
 * exported here is built from design tokens only — no component in this layer may
 * hard-code a colour, radius or duration.
 */
export { Button, buttonVariants, type ButtonProps } from './button';
export { Field, Input, LabelledInput, Label, Select, Textarea, controlVariants } from './field';
export {
  Badge,
  Checkbox,
  CheckboxField,
  Panel,
  PanelHeader,
  Separator,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  badgeVariants,
} from './primitives';
export {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTrigger,
} from './dialog';
export { Toaster } from './toast';
