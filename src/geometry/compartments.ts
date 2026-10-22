export interface CompartmentLayout {
  /** Compartment sizes along the axis, in order. */
  sizes: number[];
  /** Centre line of each divider, measured from the start of the inside space. */
  dividerCenters: number[];
  /** Inside length that the compartments and the dividers between them add up to. */
  requiredInner: number;
  /** Why the layout cannot be built, or null when it can. */
  error: string | null;
}

const TOLERANCE = 0.01;

/**
 * Splits `inner` mm of inside space into compartments separated by dividers `thickness` mm thick.
 * With `custom` sizes the compartments are exactly those sizes and must fill the space;
 * otherwise `count` equal compartments are used.
 */
export function layoutCompartments(
  inner: number,
  thickness: number,
  count: number,
  custom: number[] = [],
  axis = 'size',
): CompartmentLayout {
  let sizes: number[];
  let error: string | null = null;

  if (custom.length > 0) {
    sizes = custom;
    if (!custom.every(s => Number.isFinite(s) && s > 0)) {
      return { sizes, dividerCenters: [], requiredInner: NaN, error: `Compartment ${axis}s must be numbers greater than 0` };
    }
  } else {
    const n = Math.max(1, Math.floor(count));
    sizes = new Array<number>(n).fill((inner - thickness * (n - 1)) / n);
    if (sizes[0] <= 0) error = `${n} compartments do not fit the inside ${axis}`;
  }

  const requiredInner = sizes.reduce((a, b) => a + b, 0) + thickness * (sizes.length - 1);
  if (custom.length > 0 && Math.abs(requiredInner - inner) > TOLERANCE) {
    error =
      `Compartments need an inside ${axis} of ${requiredInner.toFixed(2)} mm ` +
      `but the box has ${inner.toFixed(2)} mm (use "Fit box size to compartments")`;
  }

  const dividerCenters: number[] = [];
  let run = 0;
  for (let k = 0; k < sizes.length - 1; k++) {
    run += sizes[k];
    dividerCenters.push(run + thickness / 2);
    run += thickness;
  }

  return { sizes, dividerCenters, requiredInner, error };
}

/** Parses "40, 30; 50" into numbers. Anything that is not a number becomes NaN so validation can report it. */
export function parseSizeList(text: string): number[] {
  const trimmed = text.trim();
  if (trimmed === '') return [];
  return trimmed.split(/[,;\s]+/).filter(t => t !== '').map(Number);
}
