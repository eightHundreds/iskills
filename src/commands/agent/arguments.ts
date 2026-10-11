import { OperationFailure } from '../../domain/operation.js';

export type OptionKind = 'boolean' | 'string' | 'multiple';
export interface Arguments {
  positional: string[];
  options: Record<string, string | string[] | boolean>;
}

/** Strict option parsing; a value containing dashes can be passed with --key=value. */
export function parseArguments(
  argv: string[],
  options: Record<string, OptionKind>,
): Arguments {
  const result: Arguments = { positional: [], options: {} };
  const kinds: Record<string, OptionKind> = { project: 'string', ...options };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]!;
    if (token === '--') {
      result.positional.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith('-')) {
      result.positional.push(token);
      continue;
    }
    const [option, inline] = token.split(/=(.*)/s);
    const key = option!.slice(2);
    const kind =
      option!.startsWith('--') && Object.hasOwn(kinds, key)
        ? kinds[key]
        : undefined;
    if (!kind)
      throw new OperationFailure('usage.unknownOption', 'Unknown option.', {
        option,
      });
    if (kind !== 'multiple' && key in result.options) {
      throw new OperationFailure(
        'usage.invalidArguments',
        'A single-value option was repeated.',
        { option },
      );
    }
    if (kind === 'boolean') {
      if (inline !== undefined)
        throw new OperationFailure(
          'usage.invalidArguments',
          'This option takes no value.',
          { option },
        );
      result.options[key] = true;
      continue;
    }
    const value = inline ?? argv[++index];
    if (
      value === undefined ||
      (inline === undefined && value.startsWith('--'))
    ) {
      throw new OperationFailure(
        'usage.invalidArguments',
        'An option value is required.',
        { option },
      );
    }
    if (kind === 'multiple') {
      const values = result.options[key] as string[] | undefined;
      result.options[key] = [...(values ?? []), value];
    } else result.options[key] = value;
  }
  return result;
}

export function stringOption(args: Arguments, key: string): string | undefined {
  return args.options[key] as string | undefined;
}

export function listOption(args: Arguments, key: string): string[] {
  return [...new Set((args.options[key] as string[] | undefined) ?? [])];
}

export function requirePositionals(
  args: Arguments,
  min: number,
  max = min,
): string[] {
  if (args.positional.length < min || args.positional.length > max) {
    throw new OperationFailure(
      'usage.invalidArguments',
      'Invalid number of positional arguments.',
      { min, max },
    );
  }
  return [...new Set(args.positional)];
}
