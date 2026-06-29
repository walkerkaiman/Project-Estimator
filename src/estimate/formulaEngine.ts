/**
 * Minimal formula engine for task recipe order-qty and labor-qty formulas.
 *
 * Supported functions: ROUNDUP, ROUNDDOWN, ROUND, IF, SUM, MIN, MAX, ABS
 * Supported operators: + - * / ^ (unary -) parentheses, comparison < > <= >= = <>
 *
 * Variables are injected from the task's ScopeEntry values:
 *   Length, Width, Height, Spacing, Count, Area, Volume
 * Plus the per-recipe-line `factor` value.
 *
 * Returns NaN for parse errors (displayed as "—" in the UI).
 */

type Vars = Record<string, number>;

// ── Tokeniser ────────────────────────────────────────────────────────────────

type TokType =
  | 'number' | 'ident' | 'string'
  | '+' | '-' | '*' | '/' | '^'
  | '<' | '>' | '<=' | '>=' | '=' | '<>'
  | '(' | ')' | ',' | 'EOF';

interface Token { type: TokType; value: string }

function tokenise(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] ?? ''))) {
      let n = '';
      while (i < src.length && /[\d.]/.test(src[i])) n += src[i++];
      tokens.push({ type: 'number', value: n });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let n = '';
      while (i < src.length && /[\w]/.test(src[i])) n += src[i++];
      tokens.push({ type: 'ident', value: n });
      continue;
    }
    if (c === '"') {
      let s = ''; i++;
      while (i < src.length && src[i] !== '"') s += src[i++];
      i++;
      tokens.push({ type: 'string', value: s });
      continue;
    }
    if (c === '<' && src[i + 1] === '=') { tokens.push({ type: '<=', value: '<=' }); i += 2; continue; }
    if (c === '>' && src[i + 1] === '=') { tokens.push({ type: '>=', value: '>=' }); i += 2; continue; }
    if (c === '<' && src[i + 1] === '>') { tokens.push({ type: '<>', value: '<>' }); i += 2; continue; }
    if ('+-*/^<>=(),'.includes(c)) { tokens.push({ type: c as TokType, value: c }); i++; continue; }
    i++; // skip unknown characters
  }
  tokens.push({ type: 'EOF', value: '' });
  return tokens;
}

// ── Recursive-descent parser / evaluator ─────────────────────────────────────

class Parser {
  private tokens: Token[];
  private pos = 0;
  constructor(private readonly vars: Vars, src: string) {
    this.tokens = tokenise(src);
  }

  private peek(): Token { return this.tokens[this.pos]; }
  private consume(): Token { return this.tokens[this.pos++]; }

  private expect(type: TokType): Token {
    const t = this.consume();
    if (t.type !== type) throw new Error(`Expected ${type}, got ${t.type}`);
    return t;
  }

  parse(): number {
    const val = this.expr();
    return val;
  }

  private expr(): number { return this.comparison(); }

  private comparison(): number {
    let left = this.addSub();
    while (true) {
      const op = this.peek().type;
      if (op !== '<' && op !== '>' && op !== '<=' && op !== '>=' && op !== '=' && op !== '<>') break;
      this.consume();
      const right = this.addSub();
      switch (op) {
        case '<':  left = left <  right ? 1 : 0; break;
        case '>':  left = left >  right ? 1 : 0; break;
        case '<=': left = left <= right ? 1 : 0; break;
        case '>=': left = left >= right ? 1 : 0; break;
        case '=':  left = left === right ? 1 : 0; break;
        case '<>': left = left !== right ? 1 : 0; break;
      }
    }
    return left;
  }

  private addSub(): number {
    let left = this.mulDiv();
    while (this.peek().type === '+' || this.peek().type === '-') {
      const op = this.consume().type;
      const right = this.mulDiv();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  private mulDiv(): number {
    let left = this.power();
    while (this.peek().type === '*' || this.peek().type === '/') {
      const op = this.consume().type;
      const right = this.power();
      left = op === '*' ? left * right : left / right;
    }
    return left;
  }

  private power(): number {
    const base = this.unary();
    if (this.peek().type === '^') { this.consume(); return Math.pow(base, this.unary()); }
    return base;
  }

  private unary(): number {
    if (this.peek().type === '-') { this.consume(); return -this.primary(); }
    if (this.peek().type === '+') { this.consume(); return this.primary(); }
    return this.primary();
  }

  private args(): number[] {
    const list: number[] = [];
    if (this.peek().type === ')') return list;
    list.push(this.expr());
    while (this.peek().type === ',') { this.consume(); list.push(this.expr()); }
    return list;
  }

  private primary(): number {
    const tok = this.peek();

    if (tok.type === 'number') {
      this.consume();
      return parseFloat(tok.value);
    }

    if (tok.type === '(') {
      this.consume();
      const v = this.expr();
      this.expect(')');
      return v;
    }

    if (tok.type === 'ident') {
      const name = this.consume().value.toUpperCase();

      if (this.peek().type === '(') {
        this.consume(); // eat '('
        const a = this.args();
        this.expect(')');
        return this.callFn(name, a);
      }

      // Variable lookup (case-insensitive)
      const key = Object.keys(this.vars).find(k => k.toUpperCase() === name);
      if (key !== undefined) return this.vars[key];
      throw new Error(`Unknown variable: ${name}`);
    }

    if (tok.type === 'string') {
      // Strings are only meaningful as IF branch values; coerce to 0 here
      this.consume();
      return 0;
    }

    throw new Error(`Unexpected token: ${tok.type} "${tok.value}"`);
  }

  private callFn(name: string, a: number[]): number {
    switch (name) {
      case 'ROUNDUP':   return a.length >= 2 ? Math.ceil(a[0] * Math.pow(10, a[1])) / Math.pow(10, a[1]) : Math.ceil(a[0]);
      case 'ROUNDDOWN': return a.length >= 2 ? Math.floor(a[0] * Math.pow(10, a[1])) / Math.pow(10, a[1]) : Math.floor(a[0]);
      case 'ROUND':     return a.length >= 2 ? Math.round(a[0] * Math.pow(10, a[1])) / Math.pow(10, a[1]) : Math.round(a[0]);
      case 'ABS':       return Math.abs(a[0]);
      case 'SUM':       return a.reduce((s, v) => s + v, 0);
      case 'MIN':       return Math.min(...a);
      case 'MAX':       return Math.max(...a);
      case 'IF':        return a[0] !== 0 ? (a[1] ?? 0) : (a[2] ?? 0);
      case 'SQRT':      return Math.sqrt(a[0]);
      case 'PI':        return Math.PI;
      default:          throw new Error(`Unknown function: ${name}`);
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Evaluate a formula string with the supplied variable bindings.
 * Returns NaN if the formula cannot be parsed or evaluated.
 */
export function evalFormula(formula: string, vars: Vars): number {
  try {
    if (!formula.trim()) return NaN;
    return new Parser(vars, formula).parse();
  } catch {
    return NaN;
  }
}

/**
 * Build a variable map from ScopeEntry values for a given task.
 * Keys are the capitalised ScopeRole names (Length, Width, Height, …).
 */
export function buildVars(scope: Array<{ role: string; value: number }>, extras?: Vars): Vars {
  const vars: Vars = {};
  for (const s of scope) {
    vars[s.role.charAt(0).toUpperCase() + s.role.slice(1)] = s.value;
  }
  return { ...vars, ...extras };
}
