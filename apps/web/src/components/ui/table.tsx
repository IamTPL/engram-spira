import { type JSX, splitProps } from 'solid-js';
import { cn } from '@/lib/utils';

type TableProps = JSX.HTMLAttributes<HTMLTableElement>;

export function Table(props: TableProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <div class="relative w-full overflow-auto">
      <table
        class={cn('w-full caption-bottom text-sm', local.class)}
        {...others}
      >
        {local.children}
      </table>
    </div>
  );
}

type TableHeaderProps = JSX.HTMLAttributes<HTMLTableSectionElement>;

export function TableHeader(props: TableHeaderProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <thead class={cn('[&_tr]:border-b', local.class)} {...others}>
      {local.children}
    </thead>
  );
}

type TableBodyProps = JSX.HTMLAttributes<HTMLTableSectionElement>;

export function TableBody(props: TableBodyProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <tbody class={cn('[&_tr:last-child]:border-0', local.class)} {...others}>
      {local.children}
    </tbody>
  );
}

type TableFooterProps = JSX.HTMLAttributes<HTMLTableSectionElement>;

export function TableFooter(props: TableFooterProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <tfoot
      class={cn(
        'border-t bg-muted/50 font-medium [&>tr]:last:border-b-0',
        local.class,
      )}
      {...others}
    >
      {local.children}
    </tfoot>
  );
}

type TableRowProps = JSX.HTMLAttributes<HTMLTableRowElement>;

export function TableRow(props: TableRowProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <tr
      class={cn(
        'border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted',
        local.class,
      )}
      {...others}
    >
      {local.children}
    </tr>
  );
}

type TableHeadProps = JSX.HTMLAttributes<HTMLTableCellElement>;

export function TableHead(props: TableHeadProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <th
      class={cn(
        'h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0',
        local.class,
      )}
      {...others}
    >
      {local.children}
    </th>
  );
}

type TableCellProps = JSX.HTMLAttributes<HTMLTableCellElement>;

export function TableCell(props: TableCellProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <td
      class={cn('p-2 align-middle [&:has([role=checkbox])]:pr-0', local.class)}
      {...others}
    >
      {local.children}
    </td>
  );
}

type TableCaptionProps = JSX.HTMLAttributes<HTMLTableCaptionElement>;

export function TableCaption(props: TableCaptionProps) {
  const [local, others] = splitProps(props, ['class', 'children']);
  return (
    <caption class={cn('mt-4 text-sm text-muted-foreground', local.class)} {...others}>
      {local.children}
    </caption>
  );
}
