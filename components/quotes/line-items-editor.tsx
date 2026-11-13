'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { TextInput } from '@/components/ui/field';
import { CatalogueLinePicker, type CatalogueChoice } from '@/components/quotes/catalogue-line-picker';
import { centsToAmount, formatCurrency } from '@/lib/money';
import {
  lineTotalCents,
  makeBlankLine,
  serialiseLines,
  summariseDraft,
  type QuoteLineDraft,
} from '@/lib/quote-draft';
import { cn } from '@/lib/cn';

/**
 * The line items of a quote.
 *
 * Everything here is presentation and convenience: the totals shown while
 * typing use the same arithmetic module as the server, and the lines are
 * submitted as JSON for the Server Action to validate and recalculate. The
 * browser total is never what gets stored — a tampered form cannot change what
 * a quote is worth.
 */
export function LineItemsEditor({
  choices,
  defaultTaxRate,
  currencyCode,
  initialLines,
  errors,
}: {
  choices: CatalogueChoice[];
  defaultTaxRate: number;
  currencyCode: string;
  initialLines?: QuoteLineDraft[];
  errors?: string[];
}) {
  const [lines, setLines] = useState<QuoteLineDraft[]>(
    initialLines && initialLines.length > 0 ? initialLines : [makeBlankLine(defaultTaxRate)]
  );

  const totals = useMemo(() => summariseDraft(lines), [lines]);
  const money = (cents: number) => formatCurrency(centsToAmount(cents), currencyCode);

  function updateLine(key: string, patch: Partial<QuoteLineDraft>) {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line))
    );
  }

  function removeLine(key: string) {
    setLines((current) =>
      current.length === 1 ? current : current.filter((line) => line.key !== key)
    );
  }

  function moveLine(index: number, direction: -1 | 1) {
    setLines((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const copy = [...current];
      const moved = copy[index];
      const other = copy[target];
      if (!moved || !other) return current;
      copy[index] = other;
      copy[target] = moved;
      return copy;
    });
  }

  return (
    <div className="space-y-4">
      <input type="hidden" name="items" value={serialiseLines(lines)} readOnly />

      {errors && errors.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-signal-danger/40 bg-signal-danger/10 p-3 text-xs text-signal-danger">
          {errors.slice(0, 6).map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}

      <ul className="space-y-3">
        {lines.map((line, index) => {
          const total = lineTotalCents(line);
          return (
            <li key={line.key} className="rounded-lg border border-ink-700 bg-ink-900/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="cg-eyebrow">Line {index + 1}</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveLine(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move line ${index + 1} up`}
                    className="cg-icon-action"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveLine(index, 1)}
                    disabled={index === lines.length - 1}
                    aria-label={`Move line ${index + 1} down`}
                    className="cg-icon-action"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    disabled={lines.length === 1}
                    aria-label={`Remove line ${index + 1}`}
                    className="cg-icon-action text-signal-danger"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="mt-2 space-y-2.5">
                <div>
                  <label className="cg-label" htmlFor={`${line.key}-catalogue`}>
                    Catalogue item
                  </label>
                  <CatalogueLinePicker
                    inputId={`${line.key}-catalogue`}
                    choices={choices}
                    placeholder={
                      line.productId
                        ? 'Search to replace this item…'
                        : 'Optional — search the catalogue to fill this line'
                    }
                    onSelect={(choice) =>
                      updateLine(line.key, {
                        productId: choice.id,
                        description: choice.name,
                        unit: choice.unit || 'each',
                        unitPrice: choice.default_price,
                        taxRate: String(Number(choice.tax_rate) || defaultTaxRate),
                      })
                    }
                  />
                  {line.productId ? (
                    <p className="cg-hint">
                      Linked to a catalogue item. The line is a copy, so editing it here does not
                      change the catalogue.
                    </p>
                  ) : null}
                </div>

                <div>
                  <label className="cg-label" htmlFor={`${line.key}-description`}>
                    Description <span className="text-ember-400">*</span>
                  </label>
                  <TextInput
                    id={`${line.key}-description`}
                    value={line.description}
                    required
                    maxLength={300}
                    placeholder="Distribution board, 12-way, surface mounted"
                    onChange={(event) => updateLine(line.key, { description: event.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
                  <div>
                    <label className="cg-label" htmlFor={`${line.key}-quantity`}>
                      Qty
                    </label>
                    <TextInput
                      id={`${line.key}-quantity`}
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="cg-label" htmlFor={`${line.key}-unit`}>
                      Unit
                    </label>
                    <TextInput
                      id={`${line.key}-unit`}
                      value={line.unit}
                      maxLength={24}
                      list="cg-units"
                      onChange={(event) => updateLine(line.key, { unit: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="cg-label" htmlFor={`${line.key}-price`}>
                      Unit price
                    </label>
                    <TextInput
                      id={`${line.key}-price`}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={line.unitPrice}
                      onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })}
                    />
                  </div>
                  <div>
                    <label className="cg-label" htmlFor={`${line.key}-discount`}>
                      Disc %
                    </label>
                    <TextInput
                      id={`${line.key}-discount`}
                      inputMode="decimal"
                      value={line.discountPercent}
                      onChange={(event) =>
                        updateLine(line.key, { discountPercent: event.target.value })
                      }
                    />
                  </div>
                  <div>
                    <label className="cg-label" htmlFor={`${line.key}-tax`}>
                      VAT %
                    </label>
                    <TextInput
                      id={`${line.key}-tax`}
                      inputMode="decimal"
                      value={line.taxRate}
                      onChange={(event) => updateLine(line.key, { taxRate: event.target.value })}
                    />
                  </div>
                </div>

                <p className="text-right text-sm font-semibold text-paper">
                  Line total <span className="font-mono">{money(total)}</span>
                </p>
              </div>
            </li>
          );
        })}
      </ul>

      <datalist id="cg-units">
        <option value="each" />
        <option value="hour" />
        <option value="day" />
        <option value="metre" />
        <option value="m²" />
        <option value="length" />
        <option value="roll" />
        <option value="box" />
      </datalist>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setLines((current) => [...current, makeBlankLine(defaultTaxRate)])}
        >
          + Blank line
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setLines([makeBlankLine(defaultTaxRate)])}
        >
          Clear all lines
        </Button>
      </div>

      <dl className={cn('ml-auto w-full max-w-sm space-y-1 rounded-lg border border-ink-700 p-3')}>
        <div className="flex justify-between text-sm text-steel-300">
          <dt>Subtotal</dt>
          <dd className="font-mono">{money(totals.subtotalCents)}</dd>
        </div>
        <div className="flex justify-between text-sm text-steel-300">
          <dt>Discount</dt>
          <dd className="font-mono">{money(totals.discountCents)}</dd>
        </div>
        <div className="flex justify-between text-sm text-steel-300">
          <dt>VAT</dt>
          <dd className="font-mono">{money(totals.taxCents)}</dd>
        </div>
        <div className="flex justify-between border-t border-ember-500/40 pt-2 text-base font-semibold text-paper">
          <dt>Total</dt>
          <dd className="font-mono">{money(totals.totalCents)}</dd>
        </div>
      </dl>
    </div>
  );
}
