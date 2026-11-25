import type { KnownWidget, Widget, WidgetKind } from './contract';

const KNOWN_KINDS: ReadonlySet<string> = new Set<WidgetKind>([
  'metric',
  'chart',
  'table',
  'facts',
  'note',
  'observation',
] satisfies WidgetKind[]);

/** False for widget kinds this version does not know; renderers then show `UNKNOWN_WIDGET_TEXT`. */
export function isKnownWidget(widget: Widget): widget is KnownWidget {
  return KNOWN_KINDS.has(widget.kind);
}
